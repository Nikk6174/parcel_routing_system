import React, { createContext, useContext, useState, useCallback } from 'react';
import { setActiveRole } from '../api/client';

// ── Types ─────────────────────────────────────────────

export type UserRole = 'operator' | 'admin' | 'insurance_approver';

export interface User {
  username: string;
  role: UserRole;
  displayName: string;
}

interface AuthState {
  user: User | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
  isAuthenticated: boolean;
}

// ── Hardcoded dev users ───────────────────────────────
// In production, this would be a real API call to validate credentials.
const DEV_USERS: Record<string, { password: string; role: UserRole; displayName: string }> = {
  operator: { password: 'operator123', role: 'operator', displayName: 'Operator' },
  admin:    { password: 'admin123',    role: 'admin',    displayName: 'Admin' },
  approver: { password: 'approver123', role: 'insurance_approver', displayName: 'Insurance Approver' },
};

// ── Context ───────────────────────────────────────────

const AuthContext = createContext<AuthState>({
  user: null,
  login: () => false,
  logout: () => {},
  isAuthenticated: false,
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// ── Provider ──────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<User | null>(() => {
    // Restore from sessionStorage on page reload
    const saved = sessionStorage.getItem('auth_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as User;
        setActiveRole(parsed.role);
        return parsed;
      } catch { /* ignore */ }
    }
    return null;
  });

  const login = useCallback((username: string, password: string): boolean => {
    const entry = DEV_USERS[username];
    if (!entry || entry.password !== password) {
      return false;
    }

    const newUser: User = {
      username,
      role: entry.role,
      displayName: entry.displayName,
    };

    setActiveRole(entry.role);
    setUser(newUser);
    sessionStorage.setItem('auth_user', JSON.stringify(newUser));
    return true;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setActiveRole('operator');
    sessionStorage.removeItem('auth_user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}
