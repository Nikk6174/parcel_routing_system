// Initialize Sentry BEFORE React renders so error handling is instrumented.
import { initSentryReact } from './sentry';
initSentryReact();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from './ErrorBoundary';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
