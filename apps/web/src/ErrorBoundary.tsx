/**
 * Top-level error boundary for the React app.
 *
 * Catches unhandled React rendering errors and displays a user-friendly
 * fallback with the correlation ID (if available from the last API call)
 * so operators can trace the error in Sentry.
 */
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  correlationId: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, correlationId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
          background: '#0f0f12',
          color: '#e4e4e7',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#a1a1aa', marginBottom: '1rem' }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          {this.state.correlationId && (
            <p style={{ fontSize: '0.875rem', color: '#71717a' }}>
              Reference ID: <code style={{ color: '#f472b6' }}>{this.state.correlationId}</code>
            </p>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.5rem',
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
