import React, { useState } from 'react';
import { useAuth, type UserRole } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { ParcelForm } from './pages/ParcelForm';
import { BatchUpload } from './pages/BatchUpload';
import { ResultsTable } from './pages/ResultsTable';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { RulesPage } from './pages/RulesPage';

type Tab = 'submit' | 'batch' | 'results' | 'approvals' | 'rules';

/** Filter applied when navigating from batch counts → results */
export interface ResultsFilter {
  status?: string;
  batchId?: string;
}

/** Tabs visible per role */
const ROLE_TABS: Record<UserRole, Tab[]> = {
  operator:            ['submit', 'batch', 'results'],
  admin:               ['submit', 'batch', 'results', 'rules'],
  insurance_approver:  ['results', 'approvals'],
};

const TAB_LABELS: Record<Tab, string> = {
  submit:    'Submit Parcel',
  batch:     'Batch Upload',
  results:   'All Parcels',
  approvals: 'Approval Queue',
  rules:     'Routing Rules',
};

const ROLE_LABELS: Record<UserRole, string> = {
  operator: 'Operator',
  admin: 'Admin',
  insurance_approver: 'Insurance Approver',
};

export default function App(): React.ReactElement {
  const { user, logout, isAuthenticated } = useAuth();

  // Show login page if not authenticated
  if (!isAuthenticated || !user) {
    return <LoginPage />;
  }

  return <Dashboard user={user} logout={logout} />;
}

function Dashboard({ user, logout }: { user: { username: string; role: UserRole; displayName: string }; logout: () => void }): React.ReactElement {
  const tabs = ROLE_TABS[user.role];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'results');
  const [resultsFilter, setResultsFilter] = useState<ResultsFilter>({});

  /** Called from BatchUpload when a status box is clicked */
  const handleNavigateToResults = (filter: ResultsFilter): void => {
    setResultsFilter(filter);
    setTab('results');
  };

  /** When user manually clicks a tab, clear any filter */
  const handleTabClick = (t: Tab): void => {
    if (t !== 'results') {
      setResultsFilter({});
    }
    setTab(t);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <h1 className="header__title">Parcel Routing</h1>
          <span className="header__subtitle">Operations Dashboard</span>
        </div>
        <div className="header__user">
          <span className="header__user-role">{ROLE_LABELS[user.role]}</span>
          <span className="header__user-name">{user.displayName}</span>
          <button className="btn btn--sm btn--ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      <nav className="nav">
        {tabs.map((t) => (
          <button
            key={t}
            className={`nav__tab ${tab === t ? 'nav__tab--active' : ''}`}
            onClick={() => handleTabClick(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === 'submit' && <ParcelForm />}
        <div style={{ display: tab === 'batch' ? 'block' : 'none' }}>
          <BatchUpload onNavigateToResults={handleNavigateToResults} />
        </div>
        <div style={{ display: tab === 'results' ? 'block' : 'none' }}>
          <ResultsTable initialFilter={resultsFilter} onClearFilter={() => setResultsFilter({})} />
        </div>
        {tab === 'approvals' && <ApprovalQueue />}
        {tab === 'rules' && <RulesPage />}
      </main>
    </div>
  );
}
