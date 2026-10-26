# External API

The planner can be driven from your own software — a home assistant (e.g.
Jarvis), a script, a dashboard, or another app — through a small HTTPS API.

Everything stays end-to-end encrypted. Two different secrets do two different
jobs, and you need both to read or change planner data:

| Secret | Proves | Stored where | Revocable |
 | --- | --- | --- | --- |
| **API token** | which account is calling | only its SHA-256 hash is in the database | yes, instantly, in Settings → Developer API |
| **Vault key** | the ability to decrypt the planner's contents | never on the server | it *is* your encryption key; rotating it means changing the account password |

The server only ever stores and relays encrypted blobs. A leaked token can be
revoked without touching the encryption key; a database dump contains no
plaintext tokens and no planner data.

## 1. Create a token

In the app: **Settings → Developer API → Create a token**.

- **Name** — what uses it (`Jarvis on the home server`).
- **Access** — *Read only* or *Read & write*.
- **Expires** — 30 days, 90 days, 1 year, or never.

The plaintext token (`plnr_at_…`) is shown **once**. Copy it into your
project's secret store. The settings list afterwards shows metadata only —
name, scope, last use, expiry — never the secret itself.

In the same section, reveal and copy the **vault key** (a base64 256-bit key).
It unlocks the data the token is allowed to reach. Keep both secrets together
in your project's secret manager, never in a screenshot, chat, or git repo.

## 2. Authentication

Send the token on every request:

```
Authorization: Bearer plnr_at_…
```

Tokens are meant for server-to-server calls, so these endpoints intentionally
do **not** enforce the browser same-origin policy. A browser-based app on a
different origin would additionally need that origin allow-listed
(`PLANNER_APP_ORIGINS`, see `docs/APPS.md`); prefer calling from a backend.

## 3. Endpoints

Base URL: `https://<your-planner-domain>/api/external`

### `GET /me`

Verifies a token and reports the account and scope it belongs to.

```bash
curl -H "Authorization: Bearer $PLANNER_TOKEN" \
  https://planner.example.com/api/external/me
```

```json
{
  "account": { "id": "…", "username": "nina", "displayName": "Nina", "role": "personal" },
  "token": { "id": "…", "label": "Jarvis at home", "scope": "readwrite", "expiresAt": null }
}
```

### `GET /vault`

Returns the encrypted vault: the same blob the apps sync.

```bash
curl -H "Authorization: Bearer $PLANNER_TOKEN" \
  https://planner.example.com/api/external/vault
```

```json
{ "version": 12, "ciphertext": "base64…", "updatedAt": "2026-10-26T08:00:00.000Z" }
```

`404` means the account has not synced a vault yet.

### `PUT /vault`

Writes a new encrypted vault with optimistic concurrency. Send the `version`
you read as `baseVersion`:

```bash
curl -X PUT https://planner.example.com/api/external/vault \
  -H "Authorization: Bearer $PLANNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"baseVersion": 12, "ciphertext": "base64…"}'
```

- `200` — the write won; the response carries the new version.
- `409` — another device wrote first. The response includes the current
  `{ version, ciphertext, updatedAt }` in `current`; decrypt that, merge your
  change, and retry with the new base version. This is the same rule the apps
  follow, so a script can never silently clobber a phone's edit.
- `403` (`forbidden_scope`) — the token is read-only.

The body limit is 3 MB of encrypted data.

## 4. Encrypting and decrypting

The vault is JSON planner state encrypted with **AES-256-GCM** under the vault
key, exactly as `src/auth/crypto.ts` (`encryptState` / `decryptState`) does:

1. Base64-decode the vault key to 32 raw bytes and import it as an AES-GCM key.
2. Decrypt the `ciphertext` (the app stores IV and tag in the same envelope the
   WebCrypto `encrypt` call produces).
3. Change the resulting planner JSON.
4. Re-encrypt with a fresh random IV and PUT the new ciphertext with the base
   version you read.

A minimal TypeScript example for Node 20+ (WebCrypto is built in):

```ts
const key = await crypto.subtle.importKey(
  'raw',
  Buffer.from(process.env.PLANNER_VAULT_KEY, 'base64'),
  { name: 'AES-GCM' },
  false,
  ['encrypt', 'decrypt'],
);

async function pull() {
  const res = await fetch('https://planner.example.com/api/external/vault', {
    headers: { Authorization: `Bearer ${process.env.PLANNER_TOKEN}` },
  });
  if (res.status === 404) return { version: 0, state: null };
  if (!res.ok) throw new Error(`vault GET failed: ${res.status}`);
  const { version, ciphertext } = await res.json();
  const bytes = Buffer.from(ciphertext, 'base64');
  const iv = bytes.subarray(0, 12);
  const data = bytes.subarray(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return { version, state: JSON.parse(Buffer.from(plain).toString('utf8')) };
}
```

Mirror `encryptState`/`decryptState` in `src/auth/crypto.ts` byte-for-byte if
you write in another language; the envelope layout is part of the contract.

## 5. TypeScript SDK

You do not have to implement any of section 4 yourself. Two dependency-free
files in `src/external/` are copy-paste ready for Node 20+, Bun, Deno, or a
browser:

- `cryptoEnvelope.ts` — the standalone AES-256-GCM envelope, interchangeable
  with `src/auth/crypto.ts` (a test proves both directions byte-for-byte).
- `plannerClient.ts` — `PlannerClient` plus pure view helpers for widgets,
  reminders, and the student panel.

Copy both files into your project and instantiate the client with the token
and vault key from Settings → Developer API:

```ts
import { PlannerClient, widgetBundle, upcomingReminders } from './plannerClient';

const planner = new PlannerClient({
  baseUrl: 'https://planner.example.com',
  token: process.env.PLANNER_TOKEN!,       // plnr_at_…
  vaultKey: process.env.PLANNER_VAULT_KEY!, // base64, 32 bytes
});
```

Every write is an optimistic *pull → mutate → push*: the client decrypts the
latest vault, applies your change to a fresh copy, encrypts, and writes. If
another device wins the version race it gets the same `409` the apps get,
decrypts the `current` blob from the response, re-applies your change, and
retries (three times by default). Your code never deals with versions or
ciphertext directly.

### Recipe: a home-screen widget

The pure view functions take a decrypted state and never touch the network,
so one periodic pull can feed every widget you render:

```ts
const { state } = await planner.pull();

const widget = widgetBundle(state);
// {
//   openTasks, overdueTasks, completedToday, eventsToday, planLessonsToday,
//   nextReminders: [ …up to five… ],
//   student: { activePlans, openHomework, upcomingExams, fixedClasses } | null
// }
```

For a single day's screen use `agendaForDay(state, '2026-10-26')`, which splits
open tasks from overdue ones and adds that day's events, fixed classes, and
guardian-plan lessons.

### Recipe: notifications and reminders

The server deliberately stores no plaintext, so it cannot push notification
*content*. Instead, derive reminders on your own schedule and deliver them
through whatever channel your project already has (speech, a push service,
email, a smart display):

```ts
const reminders = upcomingReminders(state, {
  from: todayISO(),
  withinMinutes: 60 * 24, // next 24 hours (default: 7 days)
  limit: 20,
});
for (const reminder of reminders) {
  // reminder.kind: 'task' | 'event' | 'fixed-class' | 'plan-item'
  // reminder.startsAt is a full ISO timestamp when timed; untimed tasks
  // fall back to the end of their due day.
}
```

Polling the vault on the same cadence as your reminders (e.g. every few
minutes) is enough; the rate limit is 120 requests per minute. For
near-instant reaction to changes made elsewhere, combine a read-only token
with the Neon realtime events mentioned in section 7.

### Recipe: add and remove plans, tasks, and events

Write methods need a *Read & write* token; a read-only token gets
`403 forbidden_scope`:

```ts
// New task (returns the new vault version)
await planner.addTask({
  title: 'Pack the sports bag',
  dueDate: '2026-10-27',
  dueTime: '07:30',
  priority: 'high',
});

await planner.completeTask('task-…');
await planner.updateTask('task-…', { note: 'Kit is in the hall cupboard.' });
await planner.removeTask('task-…');

await planner.addEvent({
  title: 'Dentist',
  date: '2026-10-28',
  startTime: '09:00',
  endTime: '09:45',
});
await planner.removeEvent('event-…');
```

Guardian plans arrive through the student panel, and the app only lets a
student remove one under the same rule the UI enforces: the guardian link no
longer exists, or the plan ended more than a week ago. `removeStudentPlan`
checks that rule locally before writing, records the deletion so a later
guardian sync cannot resurrect the plan, and throws `PlannerApiError` when the
rule forbids it:

```ts
try {
  await planner.removeStudentPlan('plan-…');
} catch (error) {
  if (error instanceof PlannerApiError) {
    // 403-style business rule: this plan is active and still protected.
  }
}
```

### Recipe: read the student panel

`studentPanelView(state)` joins homework and exam submissions into one view
(what is open, submitted, or approved) and summarizes plans and fixed
classes. It returns `null` when the student panel is switched off. This is
the same data the student's own screen renders, so a dashboard or voice
assistant can answer "what homework do I have?" without any extra endpoint.

## 6. Limits & errors

- 20 active tokens per account; create tokens per project so each can be
  revoked independently.
- Rate limit: 120 external requests per minute per client; management calls in
  the app are limited separately.
- Error responses always use the envelope
  `{ "error": { "message": "…", "code": "…" } }` with `Cache-Control: no-store`.
  Common codes: `unauthenticated` (missing/unknown/expired/revoked token),
  `forbidden_scope`, `conflict`, `not_found`, `not_configured` (the deployment
  has no account database), `429` (rate limited).

## 7. Alternatives considered

- **Webhooks.** The planner already publishes realtime events over Neon
  (`/api/realtime/*`). If "make changes" really means "react when something
  changes", subscribing to those events plus a read-only token avoids polling
  entirely. The external API remains the right choice when the project needs
  to write planner data on its own schedule.
- **OAuth.** Overkill for a single-user, self-operated setup. Revocable bearer
  tokens with scopes and expiry give the same practical control without a
  redirect flow the token owner would have to host.
- **Server-side decryption.** Deliberately unsupported: it would require the
  server to hold the vault key, ending the zero-knowledge guarantee the rest
  of the app is built on.
