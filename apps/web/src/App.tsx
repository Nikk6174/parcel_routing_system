import React, { useState } from 'react';
import { ParcelForm } from './pages/ParcelForm';
import { BatchUpload } from './pages/BatchUpload';
import { ResultsTable } from './pages/ResultsTable';

type Tab = 'submit' | 'batch' | 'results';

export default function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('submit');

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <h1 className="header__title">Parcel Routing</h1>
          <span className="header__subtitle">Operations Dashboard</span>
        </div>
      </header>

      <nav className="nav">
        <button className={`nav__tab ${tab === 'submit' ? 'nav__tab--active' : ''}`}
          onClick={() => setTab('submit')}>
          Submit Parcel
        </button>
        <button className={`nav__tab ${tab === 'batch' ? 'nav__tab--active' : ''}`}
          onClick={() => setTab('batch')}>
          Batch Upload
        </button>
        <button className={`nav__tab ${tab === 'results' ? 'nav__tab--active' : ''}`}
          onClick={() => setTab('results')}>
          All Parcels
        </button>
      </nav>

      <main className="main">
        {tab === 'submit' && <ParcelForm />}
        {tab === 'batch' && <BatchUpload />}
        {tab === 'results' && <ResultsTable />}
      </main>
    </div>
  );
}
