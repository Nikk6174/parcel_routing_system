import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  const cases = [
    { status: 'RECEIVED',         label: 'Received',           className: 'badge--info' },
    { status: 'CLAIMED',          label: 'Processing',         className: 'badge--info' },
    { status: 'ROUTED',           label: 'Routed',             className: 'badge--success' },
    { status: 'PENDING_APPROVAL', label: 'Held for Approval',  className: 'badge--warning' },
    { status: 'APPROVED',         label: 'Approved',           className: 'badge--success' },
    { status: 'REJECTED',         label: 'Rejected',           className: 'badge--danger' },
    { status: 'FAILED',           label: 'Failed',             className: 'badge--danger' },
    { status: 'TIMED_OUT',        label: 'Timed Out',          className: 'badge--danger' },
    { status: 'UNROUTED',         label: 'Unrouted',           className: 'badge--muted' },
  ];

  for (const { status, label, className } of cases) {
    it(`renders "${label}" with ${className} for status=${status}`, () => {
      render(<StatusBadge status={status} />);

      const badge = screen.getByTestId(`status-${status}`);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(label);
      expect(badge.className).toContain(className);
    });
  }

  it('renders unknown status as-is with muted styling', () => {
    render(<StatusBadge status="WEIRD_STATUS" />);

    const badge = screen.getByTestId('status-WEIRD_STATUS');
    expect(badge).toHaveTextContent('WEIRD_STATUS');
    expect(badge.className).toContain('badge--muted');
  });
});
