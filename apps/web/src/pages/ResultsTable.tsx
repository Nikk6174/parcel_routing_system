import React, { useState, useEffect, useCallback } from 'react';
import {
  getParcels,
  getParcel,
  approveParcel,
  rejectParcel,
  type ParcelData,
  type PaginatedParcelsResponse,
  type ParcelDetailResponse,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { sanitize } from '../utils/sanitize';

const PAGE_SIZE = 20;

export function ResultsTable(): React.ReactElement {
  const [data, setData] = useState<PaginatedParcelsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<ParcelDetailResponse | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);

  const loadParcels = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await getParcels({
        page,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
      });
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load parcels');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void loadParcels();
  }, [loadParcels]);

  const handleRowClick = async (parcelId: string): Promise<void> => {
    try {
      const detail = await getParcel(parcelId);
      setSelectedParcel(detail);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load detail');
    }
  };

  const handleApprove = async (parcelId: string): Promise<void> => {
    setActionInFlight(true);
    try {
      await approveParcel(parcelId);
      setSelectedParcel(null);
      void loadParcels();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setActionInFlight(false);
    }
  };

  const handleReject = async (parcelId: string): Promise<void> => {
    setActionInFlight(true);
    try {
      await rejectParcel(parcelId);
      setSelectedParcel(null);
      void loadParcels();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setActionInFlight(false);
    }
  };

  // ── Detail panel ──────────────────────────────────────
  if (selectedParcel) {
    const { parcel, outcome } = selectedParcel;
    return (
      <div className="card">
        <button className="btn btn--sm btn--secondary" onClick={() => setSelectedParcel(null)}>
          ← Back to list
        </button>

        <h2 style={{ marginTop: '1rem' }}>Parcel Detail</h2>

        <div className="detail-grid">
          <span className="detail-label">Parcel ID</span>
          <span className="detail-value mono">{parcel._id}</span>
          <span className="detail-label">Correlation ID</span>
          <span className="detail-value mono">{parcel.correlationId}</span>
          <span className="detail-label">Status</span>
          <span className="detail-value"><StatusBadge status={parcel.status} /></span>
          <span className="detail-label">Weight</span>
          <span className="detail-value">{parcel.weight} kg</span>
          <span className="detail-label">Value</span>
          <span className="detail-value">€{parcel.value}</span>
          <span className="detail-label">Country</span>
          <span className="detail-value">{parcel.destinationCountry}</span>
          <span className="detail-label">Recipient</span>
          <span className="detail-value">{sanitize(parcel.recipient.name)}</span>
        </div>

        {/* Custom attributes — sanitized to prevent stored XSS */}
        {Object.keys(parcel.custom).length > 0 && (
          <>
            <h3>Custom Attributes</h3>
            <div className="detail-grid">
              {Object.entries(parcel.custom).map(([key, val]) => (
                <React.Fragment key={key}>
                  <span className="detail-label">{sanitize(key)}</span>
                  <span className="detail-value">{sanitize(val)}</span>
                </React.Fragment>
              ))}
            </div>
          </>
        )}

        {outcome && (
          <>
            <h3>Routing Outcome</h3>
            <div className="detail-grid">
              <span className="detail-label">Department</span>
              <span className="detail-value">{sanitize(outcome.department) || '—'}</span>
              <span className="detail-label">Rule ID</span>
              <span className="detail-value mono">{outcome.matchedRuleId ?? '—'}</span>
              <span className="detail-label">Rule Version</span>
              <span className="detail-value">{outcome.matchedRuleVersion ?? '—'}</span>
              <span className="detail-label">Reason</span>
              <span className="detail-value">{sanitize(outcome.reason)}</span>
            </div>
          </>
        )}

        {/* Approve/reject actions for PENDING_APPROVAL parcels */}
        {parcel.status === 'PENDING_APPROVAL' && (
          <div className="approval-actions">
            <h3>Held for Approval</h3>
            <p className="text-muted">
              This parcel requires human approval before routing proceeds.
            </p>
            <div className="approval-actions__buttons">
              <button className="btn btn--success" disabled={actionInFlight}
                onClick={() => void handleApprove(parcel._id)}>
                ✓ Approve
              </button>
              <button className="btn btn--danger" disabled={actionInFlight}
                onClick={() => void handleReject(parcel._id)}>
                ✕ Reject
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Table view ────────────────────────────────────────
  return (
    <div className="card">
      <div className="table-header">
        <h2>All Parcels</h2>
        <div className="table-header__controls">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="form__select">
            <option value="">All Statuses</option>
            <option value="RECEIVED">Received</option>
            <option value="CLAIMED">Processing</option>
            <option value="ROUTED">Routed</option>
            <option value="PENDING_APPROVAL">Held for Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="FAILED">Failed</option>
          </select>
          <button className="btn btn--sm btn--secondary" onClick={() => void loadParcels()}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      {loading && !data && <p className="text-muted">Loading…</p>}

      {data && data.parcels.length === 0 && (
        <p className="text-muted">No parcels found.</p>
      )}

      {data && data.parcels.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table" data-testid="results-table">
              <thead>
                <tr>
                  <th>Parcel ID</th>
                  <th>Recipient</th>
                  <th>Weight</th>
                  <th>Value</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.parcels.map((parcel) => (
                  <tr key={parcel._id} className="table__row--clickable"
                    onClick={() => void handleRowClick(parcel._id)}>
                    <td className="mono">{parcel._id.slice(0, 8)}…</td>
                    <td>{sanitize(parcel.recipient.name)}</td>
                    <td>{parcel.weight} kg</td>
                    <td>€{parcel.value}</td>
                    <td>{parcel.destinationCountry}</td>
                    <td><StatusBadge status={parcel.status} /></td>
                    <td>{new Date(parcel.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination">
            <button className="btn btn--sm btn--secondary" disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span className="pagination__info">
              Page {data.page} of {data.totalPages} ({data.total} parcels)
            </span>
            <button className="btn btn--sm btn--secondary" disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
