import React, { useState, useEffect, useCallback } from 'react';
import { getRules, createRule, type RuleData, type CreateRulePayload } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/**
 * Rules Management page — admin only.
 * Lists active routing rules and allows creating new ones.
 */
export function RulesPage(): React.ReactElement {
  const { user } = useAuth();
  const [rules, setRules] = useState<RuleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [priority, setPriority] = useState('');
  const [ruleType, setRuleType] = useState<'condition_rule' | 'precondition_rule'>('condition_rule');
  const [field, setField] = useState('weight');
  const [operator, setOperator] = useState('>=');
  const [value, setValue] = useState('');
  const [routeTo, setRouteTo] = useState('');
  const [requireApproval, setRequireApproval] = useState('');

  const loadRules = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await getRules();
      setRules(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    const payload: CreateRulePayload = {
      name,
      priority: parseInt(priority, 10),
      type: ruleType,
      conditions: {
        all: [{ field, operator, value: isNaN(Number(value)) ? value : Number(value) }],
      },
      action: ruleType === 'condition_rule'
        ? { route_to: routeTo }
        : { require_approval: requireApproval, block_until_approved: true },
      createdBy: user?.username ?? 'admin',
    };

    try {
      await createRule(payload);
      setSuccessMsg(`Rule "${name}" created successfully`);
      setTimeout(() => setSuccessMsg(null), 3000);
      setShowForm(false);
      resetForm();
      void loadRules();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create rule');
    }
  };

  const resetForm = (): void => {
    setName('');
    setPriority('');
    setField('weight');
    setOperator('>=');
    setValue('');
    setRouteTo('');
    setRequireApproval('');
    setRuleType('condition_rule');
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>⚙️ Routing Rules</h2>
          <p className="text-muted text-sm">Manage the rules that determine how parcels are routed.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Rule'}
        </button>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}
      {successMsg && <div className="alert alert--success">{successMsg}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--color-surface-alt)' }}>
          <h3 style={{ marginTop: 0 }}>Create New Rule</h3>
          <form className="form" onSubmit={(e) => void handleCreate(e)}>
            <div className="form__row">
              <div className="form__field">
                <label className="form__label">Rule Name</label>
                <input className="form__input" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Express Department" required />
              </div>
              <div className="form__field">
                <label className="form__label">Priority</label>
                <input className="form__input" type="number" min="1" value={priority}
                  onChange={(e) => setPriority(e.target.value)} placeholder="e.g. 5" required />
              </div>
            </div>

            <div className="form__field">
              <label className="form__label">Rule Type</label>
              <select className="form__input" value={ruleType}
                onChange={(e) => setRuleType(e.target.value as 'condition_rule' | 'precondition_rule')}>
                <option value="condition_rule">Routing Rule (routes to department)</option>
                <option value="precondition_rule">Precondition Rule (requires approval)</option>
              </select>
            </div>

            <fieldset className="form__fieldset">
              <legend>Condition</legend>
              <div className="form__row form__row--3">
                <div className="form__field">
                  <label className="form__label">Field</label>
                  <select className="form__input" value={field} onChange={(e) => setField(e.target.value)}>
                    <option value="weight">weight</option>
                    <option value="value">value</option>
                    <option value="destinationCountry">destinationCountry</option>
                  </select>
                </div>
                <div className="form__field">
                  <label className="form__label">Operator</label>
                  <select className="form__input" value={operator} onChange={(e) => setOperator(e.target.value)}>
                    <option value="eq">= (equals)</option>
                    <option value="neq">≠ (not equals)</option>
                    <option value=">">{'>'} (greater than)</option>
                    <option value=">=">{'>='} (greater or equal)</option>
                    <option value="<">{'<'} (less than)</option>
                    <option value="<=">{'<='} (less or equal)</option>
                  </select>
                </div>
                <div className="form__field">
                  <label className="form__label">Value</label>
                  <input className="form__input" value={value} onChange={(e) => setValue(e.target.value)}
                    placeholder="e.g. 10 or NL" required />
                </div>
              </div>
            </fieldset>

            {ruleType === 'condition_rule' ? (
              <div className="form__field">
                <label className="form__label">Route to Department</label>
                <input className="form__input" value={routeTo} onChange={(e) => setRouteTo(e.target.value)}
                  placeholder="e.g. Express, Heavy, Mail" required />
              </div>
            ) : (
              <div className="form__field">
                <label className="form__label">Require Approval From</label>
                <input className="form__input" value={requireApproval}
                  onChange={(e) => setRequireApproval(e.target.value)}
                  placeholder="e.g. insurance_approver" required />
              </div>
            )}

            <button className="btn btn--primary" type="submit">Create Rule</button>
          </form>
        </div>
      )}

      {loading && rules.length === 0 ? (
        <p className="text-muted">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-muted">No active rules. Create one to start routing parcels.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Name</th>
              <th>Type</th>
              <th>Conditions</th>
              <th>Action</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r._id}>
                <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{r.priority}</td>
                <td>{r.name}</td>
                <td>
                  <span className={`badge ${r.type === 'precondition_rule' ? 'badge--warning' : 'badge--info'}`}>
                    {r.type === 'condition_rule' ? 'Routing' : 'Precondition'}
                  </span>
                </td>
                <td className="mono text-sm">
                  {formatConditions(r.conditions)}
                </td>
                <td>
                  {r.action.route_to && (
                    <span className="badge badge--success">→ {r.action.route_to}</span>
                  )}
                  {r.action.require_approval && (
                    <span className="badge badge--warning">⏳ {r.action.require_approval}</span>
                  )}
                </td>
                <td className="text-muted">v{r.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatConditions(conditions: RuleData['conditions']): string {
  const parts: string[] = [];
  for (const c of conditions.all ?? []) {
    parts.push(`${c.field} ${c.operator} ${String(c.value)}`);
  }
  for (const c of conditions.any ?? []) {
    parts.push(`${c.field} ${c.operator} ${String(c.value)}`);
  }
  return parts.join(' AND ') || '—';
}
