import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export function LoginPage(): React.ReactElement {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    // Simulate a small delay for realism
    setTimeout(() => {
      const success = login(username, password);
      if (!success) {
        setError('Invalid username or password');
      }
      setIsLoading(false);
    }, 400);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__icon">📦</div>
          <h1 className="login-card__title">Parcel Routing</h1>
          <p className="login-card__subtitle">Sign in to access the dashboard</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form__field">
            <label className="login-form__label" htmlFor="username">Username</label>
            <input
              id="username"
              className="login-form__input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className="login-form__field">
            <label className="login-form__label" htmlFor="password">Password</label>
            <input
              id="password"
              className="login-form__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="login-form__error">
              {error}
            </div>
          )}

          <button
            className="login-form__submit"
            type="submit"
            disabled={isLoading || !username || !password}
          >
            {isLoading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="login-card__hint">
          <p className="login-card__hint-title">Demo Credentials</p>
          <div className="login-card__credentials">
            <button type="button" className="login-card__credential"
              onClick={() => { setUsername('operator'); setPassword('operator123'); }}>
              <span className="login-card__credential-role">Operator</span>
              <span className="login-card__credential-info">operator / operator123</span>
            </button>
            <button type="button" className="login-card__credential"
              onClick={() => { setUsername('admin'); setPassword('admin123'); }}>
              <span className="login-card__credential-role">Admin</span>
              <span className="login-card__credential-info">admin / admin123</span>
            </button>
            <button type="button" className="login-card__credential"
              onClick={() => { setUsername('approver'); setPassword('approver123'); }}>
              <span className="login-card__credential-role">Approver</span>
              <span className="login-card__credential-info">approver / approver123</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
