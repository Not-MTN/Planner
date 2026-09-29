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
    planner_links: [],
    planner_passkeys: [],
    planner_sync: [],
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

    if (/^(CREATE|ALTER) /i.test(q)) return [];

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
      const [user_id, kdf_salt, auth_hash, hash_salt, recovery_hash, recovery_hash_salt] = values;
      tables.planner_credentials.push({ user_id, kdf_salt, auth_hash, hash_salt, recovery_hash, recovery_hash_salt, updated_at: now() });
      return [];
    }

    if (/^INSERT INTO planner_vaults /i.test(q)) {
      // `version` is the literal 1 in the statement, so it is not a value here.
      const [user_id, ciphertext, wrapped_dek, wrapped_recovery] = values;
      tables.planner_vaults.push({ user_id, version: 1, ciphertext, wrapped_dek, wrapped_recovery, updated_at: now() });
      return [];
    }

    if (/^SELECT u\.id, c\.recovery_hash/i.test(q)) {
      const needle = values[0];
      const user = tables.planner_users.find((row) => row.username_lower === needle || row.email_lower === needle);
      if (!user || !tables.planner_vaults.some((row) => row.user_id === user.id)) return [];
      const credential = tables.planner_credentials.find((row) => row.user_id === user.id);
      return credential
        ? [{ id: user.id, recovery_hash: credential.recovery_hash ?? null, recovery_hash_salt: credential.recovery_hash_salt ?? null }]
        : [];
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

    if (/^WITH credential_update AS /i.test(q)) {
      const [kdf_salt, auth_hash, hash_salt, recovery_hash, recovery_hash_salt, user_id, proof, proof_salt, wrapped_dek, wrapped_recovery] = values;
      const credential = tables.planner_credentials.find((row) => row.user_id === user_id);
      if (!credential || credential.recovery_hash !== proof || credential.recovery_hash_salt !== proof_salt) return [];
      const vault = tables.planner_vaults.find((row) => row.user_id === user_id);
      if (!vault) return [];
      credential.kdf_salt = kdf_salt;
      credential.auth_hash = auth_hash;
      credential.hash_salt = hash_salt;
      credential.recovery_hash = recovery_hash;
      credential.recovery_hash_salt = recovery_hash_salt;
      credential.updated_at = now();
      vault.wrapped_dek = wrapped_dek;
      vault.wrapped_recovery = wrapped_recovery;
      vault.updated_at = now();
      tables.planner_sessions = tables.planner_sessions.filter((row) => row.user_id !== user_id);
      return [{ user_id }];
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

    if (/^INSERT INTO planner_links /i.test(q)) {
      const [id, guardian_id, student_username_lower, code_hash, wrapped_share] = values;
      const clash = tables.planner_links.some(
        (row) => row.guardian_id === guardian_id && row.student_username_lower === student_username_lower,
      );
      if (clash) return [];
      const row: Row = {
        id,
        guardian_id,
        student_id: null,
        student_username_lower,
        code_hash,
        wrapped_share,
        share_ciphertext: null,
        share_week: null,
        share_updated_at: null,
        status: 'pending',
        created_at: now(),
        updated_at: now(),
      };
      tables.planner_links.push(row);
      return [{ ...row }];
    }

    if (/^SELECT \* FROM planner_links WHERE guardian_id = /i.test(q)) {
      return tables.planner_links
        .filter((row) => row.guardian_id === values[0] && row.status !== 'revoked')
        .map((row) => ({ ...row }));
    }

    if (/^SELECT l\.\*, u\.username AS guardian_username/i.test(q)) {
      const [usernameLower, userId] = values;
      return tables.planner_links
        .filter(
          (row) =>
            (row.student_username_lower === usernameLower && row.status === 'pending') ||
            (row.student_id === userId && row.status === 'linked'),
        )
        .map((row) => {
          const guardian = tables.planner_users.find((user) => user.id === row.guardian_id);
          return { ...row, guardian_username: guardian?.username ?? '', guardian_display_name: guardian?.display_name ?? '' };
        });
    }

    if (/^UPDATE planner_links SET status = /i.test(q)) {
      const [student_id, code_hash, student_username_lower] = values;
      const row = tables.planner_links.find(
        (item) =>
          item.code_hash === code_hash &&
          item.student_username_lower === student_username_lower &&
          item.status === 'pending',
      );
      if (!row) return [];
      row.student_id = student_id;
      row.status = 'linked';
      row.updated_at = now();
      return [{ ...row }];
    }

    if (/^UPDATE planner_links SET share_ciphertext = /i.test(q)) {
      const [ciphertext, weekOf, id, student_id] = values;
      const row = tables.planner_links.find(
        (item) => item.id === id && item.student_id === student_id && item.status === 'linked',
      );
      if (!row) return [];
      row.share_ciphertext = ciphertext;
      row.share_week = weekOf;
      row.share_updated_at = now();
      row.updated_at = row.share_updated_at;
      return [{ ...row }];
    }

    if (/^SELECT \* FROM planner_links WHERE id = /i.test(q)) {
      const [id, guardian_id] = values;
      return tables.planner_links.filter((row) => row.id === id && row.guardian_id === guardian_id).map((row) => ({ ...row }));
    }

    if (/SET note_to_student = /i.test(q)) {
      const [ciphertext, weekOf, id, guardian_id] = values;
      const row = tables.planner_links.find(
        (item) => item.id === id && item.status === 'linked' && item.guardian_id === guardian_id,
      );
      if (!row) return [];
      row.note_to_student = ciphertext;
      row.note_week = weekOf;
      row.updated_at = now();
      return [{ ...row }];
    }

    if (/SET note_to_guardian = /i.test(q)) {
      const [ciphertext, weekOf, id, student_id] = values;
      const row = tables.planner_links.find(
        (item) => item.id === id && item.status === 'linked' && item.student_id === student_id,
      );
      if (!row) return [];
      row.note_to_guardian = ciphertext;
      row.note_week = weekOf;
      row.updated_at = now();
      return [{ ...row }];
    }

    if (/^SELECT \* FROM planner_links WHERE id = /i.test(q)) {
      return tables.planner_links.filter((row) => row.id === values[0]).map((row) => ({ ...row }));
    }

    if (/^DELETE FROM planner_links WHERE id = /i.test(q)) {
      const [id, user_id] = values;
      const kept = tables.planner_links.filter(
        (row) => !(row.id === id && (row.guardian_id === user_id || row.student_id === user_id)),
      );
      const removed = kept.length !== tables.planner_links.length;
      tables.planner_links = kept;
      return removed ? [{ id }] : [];
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

    if (/^INSERT INTO planner_passkeys /i.test(q)) {
      const [credential_id, user_id, public_key, label, sign_count, prf_wrapped_dek, transports] = values;
      const clash = tables.planner_passkeys.some((row) => row.credential_id === credential_id);
      if (clash) return [];
      const row: Row = {
        credential_id,
        user_id,
        public_key,
        label,
        sign_count,
        prf_wrapped_dek,
        transports,
        created_at: now(),
        last_used_at: null,
      };
      tables.planner_passkeys.push(row);
      return [{ ...row }];
    }

    if (/^SELECT \* FROM planner_passkeys WHERE user_id = /i.test(q)) {
      return tables.planner_passkeys
        .filter((row) => row.user_id === values[0])
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((row) => ({ ...row }));
    }

    if (/^SELECT \* FROM planner_passkeys WHERE credential_id = /i.test(q)) {
      return tables.planner_passkeys.filter((row) => row.credential_id === values[0]).map((row) => ({ ...row }));
    }

    if (/^UPDATE planner_passkeys SET sign_count = /i.test(q)) {
      const [sign_count, credential_id] = values;
      const row = tables.planner_passkeys.find((item) => item.credential_id === credential_id);
      if (!row) return [];
      row.sign_count = sign_count;
      row.last_used_at = now();
      return [];
    }

    if (/^DELETE FROM planner_passkeys WHERE credential_id = /i.test(q)) {
      const [credential_id, user_id] = values;
      const kept = tables.planner_passkeys.filter(
        (row) => !(row.credential_id === credential_id && row.user_id === user_id),
      );
      const removed = kept.length !== tables.planner_passkeys.length;
      tables.planner_passkeys = kept;
      return removed ? [{ credential_id }] : [];
    }

    if (/^SELECT version, ciphertext, updated_at FROM planner_sync WHERE id = /i.test(q)) {
      return tables.planner_sync.filter((row) => row.id === values[0]);
    }

    if (/^INSERT INTO planner_sync /i.test(q)) {
      // `version` is the literal 1 in the statement, so it is not a value here.
      const [id, ciphertext] = values;
      if (tables.planner_sync.some((row) => row.id === id)) return []; // ON CONFLICT DO NOTHING
      const row: Row = { id, version: 1, ciphertext, updated_at: now() };
      tables.planner_sync.push(row);
      return [{ ...row }];
    }

    if (/^UPDATE planner_sync SET /i.test(q)) {
      const [ciphertext, id, baseVersion] = values;
      const row = tables.planner_sync.find((item) => item.id === id && item.version === baseVersion);
      if (!row) return [];
      row.version = Number(row.version) + 1;
      row.ciphertext = ciphertext;
      row.updated_at = now();
      return [{ ...row }];
    }

    if (/^DELETE FROM planner_sync WHERE id = /i.test(q)) {
      tables.planner_sync = tables.planner_sync.filter((row) => row.id !== values[0]);
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
