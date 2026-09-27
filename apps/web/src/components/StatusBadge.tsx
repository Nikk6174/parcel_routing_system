import React from 'react';

/** Map parcel status → display label + CSS class. */
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  RECEIVED:         { label: 'Received',         className: 'badge badge--info' },
  CLAIMED:          { label: 'Processing',       className: 'badge badge--info' },
  ROUTED:           { label: 'Routed',           className: 'badge badge--success' },
  PENDING_APPROVAL: { label: 'Held for Approval', className: 'badge badge--warning' },
  APPROVED:         { label: 'Approved',         className: 'badge badge--success' },
  REJECTED:         { label: 'Rejected',         className: 'badge badge--danger' },
  UNROUTED:         { label: 'Unrouted',         className: 'badge badge--muted' },
  FAILED:           { label: 'Failed',           className: 'badge badge--danger' },
  TIMED_OUT:        { label: 'Timed Out',        className: 'badge badge--danger' },
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    className: 'badge badge--muted',
  };

  return (
    <span className={config.className} data-testid={`status-${status}`}>
      {config.label}
    </span>
  );
}
