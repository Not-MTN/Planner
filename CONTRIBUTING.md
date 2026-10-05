# Contributing to Planner

Planner is a local-first planner with a website, packaged apps, an encrypted
account layer and a small server. This file is the practical part: how to run it,
where things live, and what a change is expected to come with.

## Getting set up

```bash
npm install
npm run dev              # the website and the app, on http://localhost:5173
```

Other entry points:

| Command | What it does |
|---|---|
| `npm test` | The unit suite (Vitest). ~3 minutes. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint, including the workflow files. |
| `npm run build` | Typecheck, Vite build, then writes `dist/.well-known/*` for deep links when the env has the fingerprints. |
| `npm run test:e2e` | Playwright against a production build (needs `npx playwright install chromium` once). |
| `npm run test:e2e:visual` | Screenshot comparison against the committed baselines — see [docs/VISUAL_TESTS.md](docs/VISUAL_TESTS.md). |
| `npm run size:report` | What every installer and the website carry. `-- --check 5` fails past the CI budget. |
| `npm run check:deployment` | Asks a live deployment whether accounts, sync, push and the deep-link files are set up. |

There is no database to install: accounts fall back to an in-memory store in
development, and `/api/auth/status` says so (`storage: "temporary"`). Set
`DATABASE_URL` in `.env.local` when the thing you are working on needs real
storage. [.env.example](.env.example) lists every variable with a note on what
breaks without it.

## Where things live

- `src/views/` — the pages. `src/components/` — everything reusable, including
  the Settings sheet and the shell (navigation, key handler, sheets).
- `src/context.tsx` — all state and mutations. It is the biggest file on purpose:
  one place where a change to the planner goes through, undo/redo, sync and the
  panels all hook in there.
- `src/auth/` — the gate, the vault, sessions, devices, passkeys, biometrics.
- `src/server/` — the API handlers, also mounted as Vite middleware so `npm run
  dev` serves the same endpoints the deployment does.
- `api/` — the Vercel entry point that routes into `src/server/`.
- `src/marketing/` — the public site, a separate bundle so opening the app never
  downloads it.
- `android/`, `ios/`, `desktop/` — thin shells around the same build. Nothing in
  `src/` should need to know which one it is running in beyond
  `src/shared/nativeShell.ts`.

## What a change is expected to come with

1. **A test where the behaviour is testable.** The suite runs in Node with jsdom,
   so a rule worth keeping is usually worth a unit test. Anything about layout,
   RTL or themes belongs in `e2e/` instead.
2. **A Persian string for every new UI string.** English is the key; add the
   translation to `src/locales/fa.ts` in the same commit. `src/i18n.test.ts`
   fails otherwise — including for strings that only reach `t()` as a variable,
   which have their own list there.
3. **No new raw numbers in JSX.** Times, dates and counts go through `faNum` /
   `faDigits` (or `digitsIn` when the language is a variable) so Persian sees
   Persian numerals.
4. **Docs in the same pull request** when behaviour a document describes changes.
   `SPEC.md` §15 is the shipped/not-shipped table; the audits carry status notes.
5. **A commit message that says why.** The subject is imperative and under ~70
   characters; the body explains the problem, not the diff.

## Traps worth knowing before you trip on them

- **State is shared between tests.** Each test file gets its own module registry,
  so a suite that changes the language, theme or display preferences must reset
  them in `afterEach`. Turning off isolation (`isolate: false`) to save the ~30 s
  of module setup was measured and rejected: 31 tests across 12 files leaked
  each other's language and theme. Keep the reset discipline instead.
- **Baselines are made on CI, not locally.** Font rendering differs between
  machines; a baseline captured on your laptop fails on the runner for reasons
  nobody can fix. The visual workflow generates and commits them.
- **The native projects are generated.** `npm run native:sync` copies the build
  into `android/` and `ios/`; `ios/App/CapApp-SPM/Package.swift` is managed by the
  Capacitor CLI and must not be hand-edited.
- **`/app` is the app; `/` is the website.** A guardian's invite link arrives at
  `/` with a route in the hash, which is why `bootTarget()` sends known routes to
  `/app` — see the comment there before changing routing.
- **Anything that writes to the vault is encrypted client-side.** The server sees
  ciphertext; if a feature would need the server to read planner content, the
  feature is designed wrong for this product.

## Releasing

1. Make sure `main` is green: typecheck, tests, build, visual, native compiles.
2. Tag it (`git tag v1.2.0 && git push --tags`). The Apps workflow builds the
   Windows/macOS/Linux installers and the Android/iOS artefacts from the tag and
   attaches them to a release.
3. The release job runs `npm run check:downloads` first, so a renamed artefact
   fails the build instead of leaving the website pointing at nothing.
4. `npm run check:deployment` against production, once, by hand: it checks the
   account API, sync, push and both deep-link files from the outside.

Installer filenames are deliberately fixed (no version numbers) because the
website links to `releases/latest/download/<file>`. For the same reason
`PLANNER_VERSION_NAME` carries the version instead.
