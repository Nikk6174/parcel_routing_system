import { describe, it, expect } from 'vitest';
import { detectDrift, type DepartmentCounts } from './drift.js';

describe('detectDrift', () => {
  // ── Flags a clear shift ──────────────────────────────

  it('flags a department with a significant routing shift', () => {
    // Baseline (7 days): dept-A gets 50% of 1000 parcels
    // Last hour: dept-A gets 90% of 100 parcels — huge shift
    const counts: DepartmentCounts[] = [
      { department: 'dept-A', hourCount: 90, weekCount: 500 },
      { department: 'dept-B', hourCount: 10, weekCount: 500 },
    ];

    const alerts = detectDrift(counts, 2.0, 30);

    expect(alerts.length).toBeGreaterThan(0);

    const deptA = alerts.find((a) => a.department === 'dept-A');
    expect(deptA).toBeDefined();
    expect(deptA!.hourShare).toBeCloseTo(0.9);
    expect(deptA!.weekShare).toBeCloseTo(0.5);
    expect(Math.abs(deptA!.zScore)).toBeGreaterThan(2.0);
  });

  // ── Ignores small samples ────────────────────────────

  it('returns empty when hourly sample is below minSample', () => {
    const counts: DepartmentCounts[] = [
      { department: 'dept-A', hourCount: 5, weekCount: 500 },
      { department: 'dept-B', hourCount: 5, weekCount: 500 },
    ];

    const alerts = detectDrift(counts, 2.0, 30);
    expect(alerts).toEqual([]);
  });

  // ── Ignores missing baseline ─────────────────────────

  it('returns empty when there is no 7-day baseline', () => {
    const counts: DepartmentCounts[] = [
      { department: 'dept-A', hourCount: 50, weekCount: 0 },
      { department: 'dept-B', hourCount: 50, weekCount: 0 },
    ];

    const alerts = detectDrift(counts, 2.0, 30);
    expect(alerts).toEqual([]);
  });

  // ── Does not flag stable routing ─────────────────────

  it('does not flag a department with stable proportions', () => {
    // Both windows show ~50/50 split
    const counts: DepartmentCounts[] = [
      { department: 'dept-A', hourCount: 48, weekCount: 500 },
      { department: 'dept-B', hourCount: 52, weekCount: 500 },
    ];

    const alerts = detectDrift(counts, 2.0, 30);
    expect(alerts).toEqual([]);
  });

  // ── Handles single-department edge case ──────────────

  it('skips departments with weekShare of 0 or 1 (no valid z-score)', () => {
    const counts: DepartmentCounts[] = [
      { department: 'dept-A', hourCount: 100, weekCount: 1000 },
      // dept-B had 0 parcels in the 7-day window — new department
      { department: 'dept-B', hourCount: 10, weekCount: 0 },
    ];

    // Should not crash or flag dept-B (can't compute z with p_week=0)
    const alerts = detectDrift(counts, 2.0, 30);
    expect(alerts.every((a) => a.department !== 'dept-B')).toBe(true);
  });
});
