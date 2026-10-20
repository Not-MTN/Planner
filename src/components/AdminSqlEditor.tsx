import { useCallback, useEffect, useState } from 'react';
import { effectiveApiOrigin } from '../shared/nativeShell';
import { faNum, t } from '../i18n';

function apiUrl(path: string): string {
  const origin = effectiveApiOrigin()?.replace(/\/+$/, '') ?? '';
  return origin ? `${origin}${path}` : path;
}

type UserRow = {
  id: string;
  username: string;
  username_lower: string;
  email: string | null;
  role: string;
  created_at: string;
  sessions: number;
  vault_version: number | null;
};

const ADMIN_TOKEN_KEY = 'planner-admin-token';

export function AdminSqlEditor() {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(ADMIN_TOKEN_KEY) ?? ''; } catch { return ''; }
  });
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [sql, setSql] = useState('SELECT id, username, email, role, created_at FROM planner_users ORDER BY created_at DESC LIMIT 20');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token.trim()) h['X-Admin-Token'] = token.trim();
    return h;
  }, [token]);

  const saveToken = useCallback((v: string) => {
    setToken(v);
    try { localStorage.setItem(ADMIN_TOKEN_KEY, v); } catch {}
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl('/api/admin/users'), { headers: headers() });
      const body = await res.json() as { users?: UserRow[]; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setUsers(body.users ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setUsers(null); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const runSql = useCallback(async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(apiUrl('/api/admin/sql'), {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ query: sql }),
      });
      const body = await res.json() as { rows?: unknown[]; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setResult(body);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [headers, sql]);

  const deleteUser = useCallback(async (id: string) => {
    if (!confirm(`Delete user ${id} and ALL their vaults/sessions/links? This cannot be undone.`)) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/users?id=${encodeURIComponent(id)}`), { method: 'DELETE', headers: headers() });
      const body = await res.json() as { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      await loadUsers();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [headers, loadUsers]);

  return (
    <section className="set-section admin-sql">
      <h3 className="kicker">Admin · Users & SQL</h3>
      <p className="set-hint">{t('View every account and run safe SQL (SELECT/DELETE). Needs REPORT_DASHBOARD_SECRET or ADMIN_SQL_SECRET as X-Admin-Token — or be signed in as admin.')}</p>

      <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <label className="set-label">Admin token (X-Admin-Token)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="set-input" type="password" placeholder="Paste REPORT_DASHBOARD_SECRET / ADMIN_SQL_SECRET" value={token} onChange={(e) => saveToken(e.target.value)} style={{ flex: 1 }} />
          <button type="button" className="btn btn-soft" onClick={() => void loadUsers()} disabled={loading}>{loading ? '…' : 'Load users'}</button>
        </div>
        <p className="set-hint" style={{ fontSize: 12 }}>Stored in localStorage as <code>planner-admin-token</code>. Never sent to any third party.</p>
      </div>

      {error ? <div role="alert" className="notice notice-error" style={{ margin: '8px 0', color: '#b91c1c' }}>{error}</div> : null}

      {users ? (
        <div className="admin-table-wrap" style={{ margin: '12px 0' }}>
          <p className="set-label">{faNum(users.length)} {t('users')}</p>
          <table className="admin-table" style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}><th>Username</th><th>Email</th><th>Role</th><th>Vault</th><th>Sessions</th><th>Created</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border-muted, #eee)' }}>
                  <td style={{ fontFamily: 'monospace' }} title={u.id}>{u.username} <span style={{ opacity: .5 }}>{u.username_lower}</span></td>
                  <td>{u.email ?? '—'}</td>
                  <td><span className="badge">{u.role}</span></td>
                  <td>{u.vault_version ?? '∅'}</td>
                  <td>{u.sessions}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td><button type="button" className="btn btn-danger btn-sm" onClick={() => void deleteUser(u.id)} disabled={loading} title={`Delete ${u.username}`}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 ? <p className="set-hint">No users yet.</p> : null}
        </div>
      ) : <p className="set-hint">Loading users… or token missing — enter the admin token above.</p>}

      <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 16 }}>
        <label className="set-label">SQL editor (allow: SELECT, WITH, EXPLAIN, DELETE FROM, UPDATE, TRUNCATE)</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setSql('SELECT id, username, email, role, created_at FROM planner_users ORDER BY created_at DESC LIMIT 50')}>Users</button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setSql('SELECT * FROM planner_vaults ORDER BY updated_at DESC LIMIT 20')}>Vaults</button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setSql('SELECT * FROM planner_sessions ORDER BY last_seen_at DESC LIMIT 20')}>Sessions</button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setSql(`DELETE FROM planner_vaults WHERE user_id = 'PASTE_ID'`)}>Delete vault…</button>
        </div>
        <textarea className="set-input" rows={4} value={sql} onChange={(e) => setSql(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} placeholder="SELECT * FROM planner_users …" />
        <div><button type="button" className="btn btn-primary" onClick={() => void runSql()} disabled={loading || !sql.trim()}>{loading ? 'Running…' : 'Run SQL'}</button></div>
        {result ? <pre style={{ maxHeight: 360, overflow: 'auto', background: 'var(--bg-muted,#f6f6f6)', padding: 12, borderRadius: 8, fontSize: 12 }}>{JSON.stringify(result, null, 2)}</pre> : null}
      </div>

      <p className="set-hint" style={{ marginTop: 12, fontSize: 12 }}>Server env: <code>NEON_REALTIME_SECRET</code> (realtime JWT), <code>ADMIN_SQL_SECRET</code> or <code>REPORT_DASHBOARD_SECRET</code> or <code>CRON_SECRET</code> (admin). Vault deletes are immediate and irreversible.</p>
    </section>
  );
}
