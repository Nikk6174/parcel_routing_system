import React from 'react';

interface ConnectionIndicatorProps {
  isStale: boolean;
  isPolling: boolean;
  lastUpdated: Date | null;
}

/**
 * Shows connection/polling status to the user.
 *
 * REQUIREMENT: "Handle the polling connection dropping (e.g. laptop sleep)
 * — show a 'reconnecting...' or 'may be stale' indicator, don't silently
 * show a frozen state as if it were live."
 */
export function ConnectionIndicator({
  isStale,
  isPolling,
  lastUpdated,
}: ConnectionIndicatorProps): React.ReactElement | null {
  if (isStale) {
    return (
      <div className="connection-indicator connection-indicator--stale">
        <span className="connection-indicator__dot" />
        Connection lost — data may be stale. Reconnecting…
      </div>
    );
  }

  if (isPolling && lastUpdated) {
    return (
      <div className="connection-indicator connection-indicator--live">
        <span className="connection-indicator__dot" />
        Live — updated {lastUpdated.toLocaleTimeString()}
      </div>
    );
  }

  if (!isPolling && lastUpdated) {
    return (
      <div className="connection-indicator connection-indicator--stopped">
        <span className="connection-indicator__dot" />
        Complete — final update {lastUpdated.toLocaleTimeString()}
      </div>
    );
  }

  return null;
}
