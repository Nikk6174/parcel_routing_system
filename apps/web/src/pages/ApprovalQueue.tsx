import React, { useState, useEffect, useCallback } from 'react';
import { getParcels, approveParcel, rejectParcel, type PaginatedParcelsResponse } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { sanitize } from '../utils/sanitize';

const PAGE_SIZE = 20;

/**
 * Approval Queue — shows only PENDING_APPROVAL parcels.
 * Only visible to users with the insurance_approver role.
 */
export function ApprovalQueue(): React.ReactElement {
  const [data, setData] = useState<PaginatedParcelsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadParcels = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await getParcels({
        page,
        limit: PAGE_SIZE,
        status: 'PENDING_APPROVAL',
      });
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load parcels');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadParcels();
    // Auto-refresh every 5s
    const interval = setInterval(() => void loadParcels(), 5000);
    return () => clearInterval(interval);
  }, [loadParcels]);

  const handleApprove = async (parcelId: string): Promise<void> => {
    setActionInFlight(parcelId);
    setError(null);
    try {
      await approveParcel(parcelId);
      setSuccessMsg(`Parcel ${parcelId.slice(0, 8)}… approved`);
      setTimeout(() => setSuccessMsg(null), 3000);
      void loadParcels();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setActionInFlight(null);
    }
  };

  const handleReject = async (parcelId: string): Promise<void> => {
    setActionInFlight(parcelId);
    setError(null);
    try {
      await rejectParcel(parcelId);
      setSuccessMsg(`Parcel ${parcelId.slice(0, 8)}… rejected`);
      setTimeout(() => setSuccessMsg(null), 3000);
      void loadParcels();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setActionInFlight(null);
    }
  };

  const parcels = data?.parcels ?? [];

  return (
    <div className="card">
      <h2>🔒 Approval Queue</h2>
      <p className="text-muted text-sm" style={{ marginBottom: '1rem' }}>
        High-value parcels requiring insurance approval before routing is finalized.
      </p>

      {error && <div className="alert alert--danger">{error}</div>}
      {successMsg && <div className="alert alert--success">{successMsg}</div>}

      {loading && parcels.length === 0 ? (
        <p className="text-muted">Loading…</p>
      ) : parcels.length === 0 ? (
        <div className="approval-empty">
          <p className="approval-empty__icon">✅</p>
          <p className="approval-empty__text">No parcels pending approval</p>
          <p className="text-muted text-sm">All high-value parcels have been reviewed.</p>
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Parcel ID</th>
                <th>Recipient</th>
                <th>Weight</th>
                <th>Value (€)</th>
                <th>Destination</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {parcels.map((p) => (
                <tr key={p._id}>
                  <td className="mono">{sanitize(p._id.slice(0, 10))}…</td>
                  <td>{sanitize(p.recipient.name)}</td>
                  <td>{p.weight} kg</td>
                  <td style={{ fontWeight: 600, color: 'var(--color-warning)' }}>€{p.value.toLocaleString()}</td>
                  <td>{sanitize(p.destinationCountry)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    <div className="approval-actions__buttons">
                      <button
                        className="btn btn--success btn--sm"
                        onClick={() => void handleApprove(p._id)}
                        disabled={actionInFlight === p._id}
                      >
                        {actionInFlight === p._id ? '…' : '✓ Approve'}
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => void handleReject(p._id)}
                        disabled={actionInFlight === p._id}
                      >
                        {actionInFlight === p._id ? '…' : '✗ Reject'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data && data.totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn--sm" disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span className="text-muted text-sm">
                Page {page} of {data.totalPages}
              </span>
              <button className="btn btn--sm" disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
