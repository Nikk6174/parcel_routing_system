/**
 * Routing drift detection — pure function, separate from the scheduler.
 *
 * DELIBERATE DESIGN: This is a simple statistical test using z-scores
 * on proportions, NOT a machine-learning model. It compares each
 * department's share of parcels in the last hour against its share over
 * the trailing 7 days. A high |z| indicates the department is receiving
 * a significantly different proportion of parcels than its baseline.
 *
 * This catches scenarios like:
 * - A rule change accidentally routes 80% of parcels to one department.
 * - A department that normally handles 5% suddenly gets 30%.
 *
 * It does NOT attempt to detect slow trends or seasonal patterns.
 * For that, use proper time-series anomaly detection.
 */

/** Input: per-department counts for two time windows. */
export interface DepartmentCounts {
  /** Department name (or 'UNROUTED'). */
  department: string;
  /** Count of parcels routed to this department in the 1-hour window. */
  hourCount: number;
  /** Count of parcels routed to this department in the 7-day window. */
  weekCount: number;
}

/** Output: a flagged department with its statistics. */
export interface DriftAlert {
  department: string;
  /** Proportion of parcels going to this dept in the 1-hour window. */
  hourShare: number;
  /** Proportion of parcels going to this dept in the 7-day window. */
  weekShare: number;
  /** Total parcels in the 1-hour window (all departments). */
  nHour: number;
  /** Computed z-score. */
  zScore: number;
}

/**
 * Detect routing drift across departments.
 *
 * Formula: z = (p_hour − p_7d) / sqrt(p_7d · (1 − p_7d) / n_hour)
 *
 * @param counts       Per-department counts for the two windows.
 * @param zThreshold   Flag a department if |z| > this value (default 2.0).
 * @param minSample    Skip the check entirely if n_hour < this (default 30).
 * @returns            Array of flagged departments, empty if none.
 */
export function detectDrift(
  counts: DepartmentCounts[],
  zThreshold: number,
  minSample: number,
): DriftAlert[] {
  const totalHour = counts.reduce((sum, c) => sum + c.hourCount, 0);
  const totalWeek = counts.reduce((sum, c) => sum + c.weekCount, 0);

  // Skip if too few parcels in the hour window for meaningful statistics
  if (totalHour < minSample) {
    return [];
  }

  // Skip if there's no 7-day baseline at all
  if (totalWeek === 0) {
    return [];
  }

  const alerts: DriftAlert[] = [];

  for (const entry of counts) {
    const pHour = totalHour > 0 ? entry.hourCount / totalHour : 0;
    const pWeek = totalWeek > 0 ? entry.weekCount / totalWeek : 0;

    // Skip departments with no 7-day baseline (can't compute z-score)
    if (pWeek === 0 || pWeek === 1) continue;

    const denominator = Math.sqrt((pWeek * (1 - pWeek)) / totalHour);
    if (denominator === 0) continue;

    const z = (pHour - pWeek) / denominator;

    if (Math.abs(z) > zThreshold) {
      alerts.push({
        department: entry.department,
        hourShare: pHour,
        weekShare: pWeek,
        nHour: totalHour,
        zScore: z,
      });
    }
  }

  return alerts;
}
