import { describe, it, expect, vi, afterEach } from 'vitest';
import { ResultBuffer } from './result-buffer.js';
import type { PipelineResult } from './types.js';
import { PARCEL_STATUS, type ParcelDocument } from '@parcel-routing/shared';

function makeResult(id = 'parcel-1'): PipelineResult {
  const parcel: ParcelDocument = {
    _id: id,
    weight: 10,
    value: 100,
    destinationCountry: 'NL',
    recipient: {
      name: 'Test',
      address: {
        street: 'St',
        houseNumber: '1',
        postalCode: '1000',
        city: 'Amsterdam',
      },
    },
    custom: {},
    status: PARCEL_STATUS.CLAIMED,
    batchId: null,
    correlationId: `corr-${id}`,
    retryCount: 0,
    claimedBy: 'worker-1',
    claimedAt: new Date(),
    sourceFormat: 'json',
    createdAt: new Date(),
  };

  return {
    parcel,
    output: {
      parcelId: id,
      correlationId: `corr-${id}`,
      result: {
        department: 'test-dept',
        matchedRuleId: 'rule-1',
        matchedRuleVersion: 1,
        reason: 'Matched',
        requiresApproval: null,
        status: 'ROUTED',
      },
      error: null,
    },
  };
}

describe('ResultBuffer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Count-based flush ───────────────────────────────
  it('flushes when buffer reaches maxSize', async () => {
    const flushed: PipelineResult[][] = [];
    const buffer = new ResultBuffer(3, 60_000); // maxSize=3, long interval
    buffer.onFlush(async (items) => {
      flushed.push([...items]);
    });

    buffer.add(makeResult('p1'));
    buffer.add(makeResult('p2'));
    expect(flushed).toHaveLength(0); // Not yet

    buffer.add(makeResult('p3')); // Hits maxSize=3

    // flush is async — wait for it
    await vi.waitFor(() => {
      expect(flushed).toHaveLength(1);
    });
    expect(flushed[0]).toHaveLength(3);
    expect(buffer.size).toBe(0);

    buffer.dispose();
  });

  // ── SPEC-REQUIRED: Time-based flush ─────────────────
  it('flushes on time trigger even when count trigger not hit', async () => {
    vi.useFakeTimers();

    const flushed: PipelineResult[][] = [];
    const buffer = new ResultBuffer(100, 200); // maxSize=100, interval=200ms
    buffer.onFlush(async (items) => {
      flushed.push([...items]);
    });

    buffer.add(makeResult('p1')); // Just 1 item (way below 100)
    expect(flushed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(1);
    expect(buffer.size).toBe(0);

    buffer.dispose();
  });

  // ── Empty flush ─────────────────────────────────────
  it('does not call handler when flushing an empty buffer', async () => {
    const handler = vi.fn();
    const buffer = new ResultBuffer(10, 60_000);
    buffer.onFlush(handler);

    await buffer.flush();

    expect(handler).not.toHaveBeenCalled();

    buffer.dispose();
  });

  // ── Manual flush ────────────────────────────────────
  it('flush() drains the buffer immediately', async () => {
    const flushed: PipelineResult[][] = [];
    const buffer = new ResultBuffer(100, 60_000);
    buffer.onFlush(async (items) => {
      flushed.push([...items]);
    });

    buffer.add(makeResult('p1'));
    buffer.add(makeResult('p2'));

    await buffer.flush();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(2);
    expect(buffer.size).toBe(0);

    buffer.dispose();
  });
});
