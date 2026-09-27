import React, { useState, useCallback } from 'react';
import { uploadBatch, getBatchStatus, type BatchUploadResponse, type BatchStatusResponse } from '../api/client';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { usePolling } from '../hooks/usePolling';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const TERMINAL_STATUSES = new Set([
  'ROUTED', 'APPROVED', 'REJECTED', 'FAILED', 'TIMED_OUT', 'UNROUTED',
]);

export function BatchUpload(): React.ReactElement {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<BatchUploadResponse | null>(null);

  const fetcher = useCallback(
    () => (uploadResult ? getBatchStatus(uploadResult.batchId) : Promise.reject(new Error('no id'))),
    [uploadResult],
  );

  const { data: batchStatus, isStale, lastUpdated, isPolling } = usePolling<BatchStatusResponse>(
    fetcher,
    {
      intervalMs: 3000,
      enabled: uploadResult !== null,
      shouldStop: (d) => {
        const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
        const terminal = Object.entries(d.counts)
          .filter(([k]) => TERMINAL_STATUSES.has(k))
          .reduce((a, [, v]) => a + v, 0);
        return total > 0 && terminal === total;
      },
    },
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    /*
     * CLIENT-SIDE PRE-CHECK ONLY — for fast user feedback.
     *
     * THIS IS NOT A SECURITY BOUNDARY. Real validation (file size, format,
     * content) is enforced server-side by @fastify/multipart and the
     * streaming parsers. A malicious user can bypass these checks trivially.
     */
    if (!file.name.endsWith('.json')) {
      setError('Only .json files are supported. Use the correct file format.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`);
      return;
    }

    setUploading(true);
    try {
      const result = await uploadBatch(file);
      setUploadResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ── Upload result + live polling view ─────────────────
  if (uploadResult) {
    return (
      <div className="card">
        <h2>Batch Upload Result</h2>

        <div className="batch-summary">
          <div className="batch-summary__item">
            <span className="batch-summary__label">Batch ID</span>
            <span className="batch-summary__value mono">{uploadResult.batchId}</span>
          </div>
          <div className="batch-summary__row">
            <div className="batch-summary__stat">
              <span className="stat__number">{uploadResult.acceptedRows}</span>
              <span className="stat__label">Accepted</span>
            </div>
            <div className="batch-summary__stat">
              <span className="stat__number stat__number--danger">{uploadResult.rejectedRows}</span>
              <span className="stat__label">Rejected</span>
            </div>
            <div className="batch-summary__stat">
              <span className="stat__number">{uploadResult.totalRows}</span>
              <span className="stat__label">Total Rows</span>
            </div>
          </div>
        </div>

        {/* Live-updating aggregate counts */}
        {batchStatus && <BatchCountsDisplay counts={batchStatus.counts} />}

        <ConnectionIndicator isStale={isStale} isPolling={isPolling} lastUpdated={lastUpdated} />

        <button className="btn btn--secondary" style={{ marginTop: '1rem' }}
          onClick={() => { setUploadResult(null); setError(null); }}>
          Upload Another
        </button>
      </div>
    );
  }

  // ── File picker view ──────────────────────────────────
  return (
    <div className="card">
      <h2>Batch Upload</h2>
      <p className="text-muted">
        Upload a JSON file containing an array of parcel objects.
        Each parcel is validated individually — invalid rows are rejected
        without failing the entire batch.
      </p>

      <label className="file-picker">
        <input type="file" accept=".json" onChange={(e) => void handleFileChange(e)}
          disabled={uploading} className="file-picker__input" />
        <span className="file-picker__label">
          {uploading ? 'Uploading…' : 'Choose a .json file'}
        </span>
      </label>

      {error && <div className="alert alert--danger">{error}</div>}
    </div>
  );
}

// ── Sub-component: live aggregate counts ────────────────

interface BatchCountsDisplayProps {
  counts: Record<string, number>;
}

function BatchCountsDisplay({ counts }: BatchCountsDisplayProps): React.ReactElement {
  const routed = (counts['ROUTED'] ?? 0) + (counts['APPROVED'] ?? 0);
  const held = counts['PENDING_APPROVAL'] ?? 0;
  const failed = (counts['FAILED'] ?? 0) + (counts['REJECTED'] ?? 0);
  const pending = (counts['RECEIVED'] ?? 0) + (counts['CLAIMED'] ?? 0);

  return (
    <div className="batch-counts" data-testid="batch-counts">
      <div className="batch-counts__item batch-counts__item--success">
        <span className="batch-counts__number">{routed}</span>
        <span className="batch-counts__label">Routed</span>
      </div>
      <div className="batch-counts__item batch-counts__item--warning">
        <span className="batch-counts__number">{held}</span>
        <span className="batch-counts__label">Held</span>
      </div>
      <div className="batch-counts__item batch-counts__item--danger">
        <span className="batch-counts__number">{failed}</span>
        <span className="batch-counts__label">Failed</span>
      </div>
      <div className="batch-counts__item batch-counts__item--info">
        <span className="batch-counts__number">{pending}</span>
        <span className="batch-counts__label">Pending</span>
      </div>
    </div>
  );
}

// Export for testing
export { BatchCountsDisplay };
