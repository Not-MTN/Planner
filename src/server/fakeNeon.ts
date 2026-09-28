/**
 * A tiny stand-in for the Neon serverless driver, used by `neonAuth.test.ts`.
 *
 * The real store talks SQL over HTTP and only runs inside a deployed function,
 * which is exactly where sign-up and sign-in bugs hide until a real user hits
 * them. This double executes the statements the store actually sends against
 * in-memory tables, so the whole account flow is tested against the same code
 * path that production uses. An unrecognised statement throws on purpose: if
 * the store's SQL changes, this file must be taught about it.
 */
export interface Row {
  [column: string]: unknown;
}

type Pending = { text: string; values: unknown[]; done: boolean; result: Row[] };

interface Query {
  then: <T1 = Row[], T2 = never>(onFulfilled?: ((value: Row[]) => T1 | PromiseLike<T1>) | null, onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) => PromiseLike<T1 | T2>;
  catch: (onRejected?: ((reason: unknown) => never | PromiseLike<never>) | null) => Promise<Row[]>;
  finally: (onFinally?: (() => void) | null) => Promise<Row[]>;
  __pending: Pending;
}

export interface FakeDb {
  tables: Record<string, Row[]>;
  sql: ((strings: TemplateStringsArray, ...values: unknown[]) => Query) & {
    transaction: (queries: Query[]) => Promise<Row[][]>;
  };
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function createFakeNeon(): FakeDb {
  const tables: Record<string, Row[]> = {
    planner_users: [],
    planner_credentials: [],
    planner_vaults: [],
    planner_sessions: [],
  };

  const now = () => new Date().toISOString();

  function execute(pending: Pending): Row[] {
    if (pending.done) return pending.result;
    pending.done = true;
    pending.result = run(pending.text, pending.values);
    return pending.result;
  }

  function run(text: string, values: unknown[]): Row[] {
    const q = normalise(text);

    if (/^CREATE /i.test(q)) return [];

    if (/^INSERT INTO planner_users /i.test(q)) {
      const [id, username, username_lower, email_lower, display_name, role] = values;
      const clash = tables.planner_users.some(
        (row) => row.username_lower === username_lower || (email_lower != null && row.email_lower === email_lower),
      );
      if (clash) return []; // ON CONFLICT DO NOTHING
      const row: Row = { id, username, username_lower, email_lower, display_name, role, created_at: now() };
      tables.planner_users.push(row);
      return [{ ...row }];
    }

    if (/^SELECT email_lower FROM planner_users WHERE username_lower = /i.test(q)) {
      return tables.planner_users.filter((row) => row.username_lower === values[0]).map((row) => ({ email_lower: row.email_lower }));
    }

    if (/^INSERT INTO planner_credentials /i.test(q)) {
      const [user_id, kdf_salt, auth_hash, hash_salt] = values;
      tables.planner_credentials.push({ user_id, kdf_salt, auth_hash, hash_salt, updated_at: now() });
      return [];
    }

    if (/^INSERT INTO planner_vaults /i.test(q)) {
      // `version` is the literal 1 in the statement, so it is not a value here.
      const [user_id, ciphertext, wrapped_dek, wrapped_recovery] = values;
      tables.planner_vaults.push({ user_id, version: 1, ciphertext, wrapped_dek, wrapped_recovery, updated_at: now() });
      return [];
    }

    if (/^SELECT u\.id/i.test(q)) {
      const needle = values[0];
      const user = tables.planner_users.find(
        (row) => row.username_lower === needle || row.email_lower === needle,
      );
      if (!user) return [];
      const credential = tables.planner_credentials.find((row) => row.user_id === user.id);
      if (!credential) return [];
      return [{ ...user, ...credential }];
    }

    if (/^UPDATE planner_credentials SET /i.test(q)) {
      const [kdf_salt, auth_hash, hash_salt, user_id] = values;
      const row = tables.planner_credentials.find((item) => item.user_id === user_id);
      if (!row) return [];
      row.kdf_salt = kdf_salt;
      row.auth_hash = auth_hash;
      row.hash_salt = hash_salt;
      row.updated_at = now();
      return [];
    }

    if (/^DELETE FROM planner_users WHERE id = /i.test(q)) {
      tables.planner_users = tables.planner_users.filter((row) => row.id !== values[0]);
      return [];
    }

    if (/^SELECT version, ciphertext, wrapped_dek AS "wrappedDek"/i.test(q)) {
      return tables.planner_vaults.filter((row) => row.user_id === values[0]).map((row) => ({
        version: row.version,
        ciphertext: row.ciphertext,
        wrappedDek: row.wrapped_dek,
        wrappedRecovery: row.wrapped_recovery,
        updated_at: row.updated_at,
      }));
    }

    if (/^UPDATE planner_vaults SET /i.test(q)) {
      const [ciphertext, user_id, baseVersion] = values;
      const row = tables.planner_vaults.find((item) => item.user_id === user_id && item.version === baseVersion);
      if (!row) return [];
      row.version = Number(row.version) + 1;
      row.ciphertext = ciphertext;
      row.updated_at = now();
      return [{ version: row.version, ciphertext: row.ciphertext, wrappedDek: row.wrapped_dek, wrappedRecovery: row.wrapped_recovery, updated_at: row.updated_at }];
    }

    if (/^DELETE FROM planner_sessions WHERE user_id = .* expires_at < now\(\)/i.test(q)) {
      const before = tables.planner_sessions.length;
      tables.planner_sessions = tables.planner_sessions.filter(
        (row) => row.user_id !== values[0] || new Date(String(row.expires_at)).getTime() > Date.now(),
      );
      void before;
      return [];
    }

    if (/^INSERT INTO planner_sessions /i.test(q)) {
      const [id, user_id, token_hash, label, expires_at] = values;
      tables.planner_sessions.push({ id, user_id, token_hash, label, expires_at, created_at: now(), last_seen_at: now() });
      return [];
    }

    if (/^SELECT s\.id/i.test(q)) {
      const tokenHash = values[0];
      const session = tables.planner_sessions.find(
        (row) => row.token_hash === tokenHash && new Date(String(row.expires_at)).getTime() > Date.now(),
      );
      if (!session) return [];
      const user = tables.planner_users.find((row) => row.id === session.user_id);
      if (!user) return [];
      const { id: _ignored, ...rest } = user;
      return [{ ...rest, ...session, u_id: user.id }];
    }

    if (/^DELETE FROM planner_sessions WHERE id = /i.test(q)) {
      tables.planner_sessions = tables.planner_sessions.filter((row) => row.id !== values[0]);
      return [];
    }

    throw new Error(`Fake Neon does not understand: ${q}`);
  }

  function makeQuery(text: string, values: unknown[]): Query {
    const pending: Pending = { text, values, done: false, result: [] };
    const query: Query = {
      then(onFulfilled, onRejected) {
        try {
          const result = execute(pending);
          return Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined);
        } catch (error) {
          return Promise.reject(error).then(onFulfilled ?? undefined, onRejected ?? undefined);
        }
      },
      catch(onRejected) {
        try {
          return Promise.resolve(execute(pending)).catch(onRejected ?? undefined);
        } catch (error) {
          return Promise.reject(error).catch(onRejected ?? undefined);
        }
      },
      finally(onFinally) {
        try {
          execute(pending);
          return Promise.resolve([]).finally(onFinally ?? undefined);
        } catch (error) {
          return Promise.reject(error).finally(onFinally ?? undefined);
        }
      },
      __pending: pending,
    };
    return query;
  }

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    makeQuery(strings.join('?'), values)) as FakeDb['sql'];

  sql.transaction = async (queries: Query[]) => queries.map((query) => execute(query.__pending));

  return { tables, sql };
}
