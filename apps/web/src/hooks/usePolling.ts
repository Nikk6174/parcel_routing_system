import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Generic polling hook with exponential backoff and terminal-state stop.
 *
 * POLLING BEHAVIOR:
 * - Starts at `intervalMs` between requests (default 2s)
 * - If `shouldStop` returns true, polling stops permanently
 * - If a request fails, interval doubles (exponential backoff, max 30s)
 * - On success, interval resets to initial value
 * - Tracks `lastUpdated` timestamp for stale-state detection
 *
 * CONNECTION DROP HANDLING:
 * - Tracks consecutive failures
 * - After 3 consecutive failures, sets `isStale` to true
 * - Component can show "may be stale" indicator
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  opts: {
    /** Poll interval in ms (default 2000). */
    intervalMs?: number;
    /** Max backoff interval in ms (default 30000). */
    maxIntervalMs?: number;
    /** Return true when polling should stop (100% terminal). */
    shouldStop?: (data: T) => boolean;
    /** Set to false to disable polling. */
    enabled?: boolean;
  } = {},
): {
  data: T | null;
  error: string | null;
  isStale: boolean;
  lastUpdated: Date | null;
  isPolling: boolean;
} {
  const {
    intervalMs = 2000,
    maxIntervalMs = 30_000,
    shouldStop,
    enabled = true,
  } = opts;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const stopped = useRef(false);
  const currentInterval = useRef(intervalMs);
  const consecutiveFailures = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use refs for fetcher and shouldStop so the poll loop doesn't restart
  // when the caller creates new closures on each render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const shouldStopRef = useRef(shouldStop);
  shouldStopRef.current = shouldStop;

  const poll = useCallback(async () => {
    if (stopped.current || !enabled) return;

    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
      setIsStale(false);
      consecutiveFailures.current = 0;
      currentInterval.current = intervalMs;

      if (shouldStopRef.current?.(result)) {
        stopped.current = true;
        setIsPolling(false);
        return;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      consecutiveFailures.current += 1;

      // After 3 consecutive failures, mark as stale
      if (consecutiveFailures.current >= 3) {
        setIsStale(true);
      }

      // Exponential backoff: double interval, cap at max
      currentInterval.current = Math.min(
        currentInterval.current * 2,
        maxIntervalMs,
      );
    }

    if (!stopped.current && enabled) {
      timerRef.current = setTimeout(() => void poll(), currentInterval.current);
    }
  }, [intervalMs, maxIntervalMs, enabled]);

  useEffect(() => {
    if (!enabled) return;

    stopped.current = false;
    setIsPolling(true);
    void poll();

    return () => {
      stopped.current = true;
      setIsPolling(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll, enabled]);

  return { data, error, isStale, lastUpdated, isPolling };
}
