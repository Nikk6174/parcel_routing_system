import React, { useState, useCallback } from 'react';
import { submitParcel, getParcel, type ParcelDetailResponse } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { usePolling } from '../hooks/usePolling';
import { sanitize } from '../utils/sanitize';

const TERMINAL_STATUSES = new Set([
  'ROUTED', 'APPROVED', 'REJECTED', 'FAILED', 'TIMED_OUT', 'UNROUTED',
]);

export function ParcelForm(): React.ReactElement {
  const [weight, setWeight] = useState('');
  const [value, setValue] = useState('');
  const [country, setCountry] = useState('NL');
  const [recipientName, setRecipientName] = useState('');
  const [street, setStreet] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [customPairs, setCustomPairs] = useState<Array<{ key: string; value: string }>>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [parcelId, setParcelId] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  const fetcher = useCallback(
    () => (parcelId ? getParcel(parcelId) : Promise.reject(new Error('no id'))),
    [parcelId],
  );

  const { data: detail, isStale, lastUpdated, isPolling } = usePolling<ParcelDetailResponse>(
    fetcher,
    {
      intervalMs: 2000,
      enabled: parcelId !== null,
      shouldStop: (d) => TERMINAL_STATUSES.has(d.parcel.status),
    },
  );

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    const custom: Record<string, unknown> = {};
    for (const pair of customPairs) {
      if (pair.key.trim()) {
        custom[pair.key.trim()] = pair.value;
      }
    }

    try {
      const result = await submitParcel({
        weight: parseFloat(weight),
        value: parseFloat(value),
        destinationCountry: country,
        recipient: {
          name: recipientName,
          address: { street, houseNumber, postalCode, city },
        },
        custom,
      });
      setParcelId(result.parcelId);
      setCorrelationId(result.correlationId);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const addCustomPair = (): void => {
    setCustomPairs((prev) => [...prev, { key: '', value: '' }]);
  };

  const updateCustomPair = (index: number, field: 'key' | 'value', val: string): void => {
    setCustomPairs((prev) => {
      const next = [...prev];
      const item = next[index];
      if (item) item[field] = val;
      return next;
    });
  };

  const removeCustomPair = (index: number): void => {
    setCustomPairs((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Tracking result view ──────────────────────────────
  if (parcelId) {
    return (
      <div className="card">
        <h2>Parcel Submitted</h2>
        <p className="text-muted">Tracking result…</p>

        <div className="detail-grid">
          <span className="detail-label">Parcel ID</span>
          <span className="detail-value mono">{parcelId}</span>
          <span className="detail-label">Correlation ID</span>
          <span className="detail-value mono">{correlationId}</span>
          <span className="detail-label">Status</span>
          <span className="detail-value">
            {detail ? <StatusBadge status={detail.parcel.status} /> : 'Waiting…'}
          </span>
          {detail?.outcome && (
            <>
              <span className="detail-label">Department</span>
              <span className="detail-value">
                {sanitize(detail.outcome.department) || '—'}
              </span>
              <span className="detail-label">Reason</span>
              <span className="detail-value">{sanitize(detail.outcome.reason)}</span>
            </>
          )}
        </div>

        <ConnectionIndicator isStale={isStale} isPolling={isPolling} lastUpdated={lastUpdated} />

        <button className="btn btn--secondary" style={{ marginTop: '1rem' }}
          onClick={() => { setParcelId(null); setCorrelationId(null); }}>
          Submit Another
        </button>
      </div>
    );
  }

  // ── Form view ─────────────────────────────────────────
  return (
    <div className="card">
      <h2>Submit a Parcel</h2>

      <form onSubmit={(e) => void handleSubmit(e)} className="form">
        <fieldset className="form__fieldset">
          <legend>Parcel Details</legend>
          <div className="form__row">
            <label className="form__label">
              Weight (kg)
              <input type="number" step="0.01" min="0" required value={weight}
                onChange={(e) => setWeight(e.target.value)} className="form__input" />
            </label>
            <label className="form__label">
              Value (€)
              <input type="number" step="0.01" min="0" required value={value}
                onChange={(e) => setValue(e.target.value)} className="form__input" />
            </label>
            <label className="form__label">
              Country
              <input type="text" required value={country}
                onChange={(e) => setCountry(e.target.value)} className="form__input" />
            </label>
          </div>
        </fieldset>

        <fieldset className="form__fieldset">
          <legend>Recipient</legend>
          <label className="form__label">
            Name
            <input type="text" required value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)} className="form__input" />
          </label>
          <div className="form__row">
            <label className="form__label" style={{ flex: 2 }}>
              Street
              <input type="text" required value={street}
                onChange={(e) => setStreet(e.target.value)} className="form__input" />
            </label>
            <label className="form__label">
              House №
              <input type="text" required value={houseNumber}
                onChange={(e) => setHouseNumber(e.target.value)} className="form__input" />
            </label>
          </div>
          <div className="form__row">
            <label className="form__label">
              Postal Code
              <input type="text" required value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)} className="form__input" />
            </label>
            <label className="form__label">
              City
              <input type="text" required value={city}
                onChange={(e) => setCity(e.target.value)} className="form__input" />
            </label>
          </div>
        </fieldset>

        <fieldset className="form__fieldset">
          <legend>Custom Attributes (optional)</legend>
          <p className="text-muted text-sm">
            Add key-value pairs for custom routing metadata. These are stored on the parcel
            and can be referenced by routing rules.
          </p>
          {customPairs.map((pair, i) => (
            <div key={i} className="form__row">
              <input placeholder="Key" value={pair.key} className="form__input"
                onChange={(e) => updateCustomPair(i, 'key', e.target.value)} />
              <input placeholder="Value" value={pair.value} className="form__input"
                onChange={(e) => updateCustomPair(i, 'value', e.target.value)} />
              <button type="button" className="btn btn--sm btn--danger"
                onClick={() => removeCustomPair(i)}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn--sm btn--secondary" onClick={addCustomPair}>
            + Add attribute
          </button>
        </fieldset>

        {submitError && <div className="alert alert--danger">{submitError}</div>}

        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit Parcel'}
        </button>
      </form>
    </div>
  );
}
