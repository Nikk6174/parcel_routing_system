import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatchCountsDisplay } from '../pages/BatchUpload';

describe('BatchCountsDisplay', () => {
  it('displays aggregated counts for a partial-failure batch', () => {
    /*
     * Mocked partial-failure response shape:
     * 5 routed, 2 pending approval, 3 failed, 1 received (still processing)
     */
    const counts: Record<string, number> = {
      ROUTED: 5,
      PENDING_APPROVAL: 2,
      FAILED: 3,
      RECEIVED: 1,
    };

    render(<BatchCountsDisplay counts={counts} />);

    const container = screen.getByTestId('batch-counts');
    expect(container).toBeInTheDocument();

    // Routed = ROUTED + APPROVED
    expect(container).toHaveTextContent('5');
    // Held = PENDING_APPROVAL
    expect(container).toHaveTextContent('2');
    // Failed = FAILED + REJECTED
    expect(container).toHaveTextContent('3');
    // Pending = RECEIVED + CLAIMED
    expect(container).toHaveTextContent('1');
  });

  it('displays zeros when counts are empty', () => {
    render(<BatchCountsDisplay counts={{}} />);

    const container = screen.getByTestId('batch-counts');
    // All counters should show 0
    const numbers = container.querySelectorAll('.batch-counts__number');
    numbers.forEach((el) => {
      expect(el).toHaveTextContent('0');
    });
  });

  it('combines ROUTED + APPROVED into the routed counter', () => {
    const counts = { ROUTED: 3, APPROVED: 2 };
    render(<BatchCountsDisplay counts={counts} />);

    const container = screen.getByTestId('batch-counts');
    // Routed = 3 + 2 = 5
    const routedItem = container.querySelector('.batch-counts__item--success .batch-counts__number');
    expect(routedItem).toHaveTextContent('5');
  });

  it('combines FAILED + REJECTED into the failed counter', () => {
    const counts = { FAILED: 4, REJECTED: 1 };
    render(<BatchCountsDisplay counts={counts} />);

    const container = screen.getByTestId('batch-counts');
    // Failed = 4 + 1 = 5
    const failedItem = container.querySelector('.batch-counts__item--danger .batch-counts__number');
    expect(failedItem).toHaveTextContent('5');
  });
});
