# Security

Planner uses a local-first, privacy-preserving design, but no software can honestly promise to be unhackable or stronger than every attacker. A compromised device, browser profile, operating system, hosting provider, or user account can defeat application-level controls. The goal here is defense in depth and clear boundaries.

## Current protections

- Production responses set a strict Content Security Policy, HSTS, clickjacking protection, referrer and permissions policies, and MIME-sniffing protection.
- The inline theme bootstrap was moved to a same-origin file so production JavaScript is restricted to `script-src 'self'`.
- Markdown is rendered as React elements rather than injected HTML; links are limited to HTTP(S) and open with `noopener noreferrer`.
- The xAI proxy never exposes the API key, accepts only the narrow JSON shape Planner sends, permits only the configured model and data-URL images, caps request and response sizes, rejects cross-origin browser requests, and applies a best-effort per-client rate limit.
- The sync API accepts only a validated hash-shaped sync id and bounded ciphertext. Planner content is encrypted in the browser with AES-GCM before it reaches Neon; the database does not receive the sync code or plaintext planner.
- Account recovery checks a SHA-256 verifier of a randomly generated, high-entropy recovery key; the database stores only a separately salted scrypt verifier, not a reusable proof. The recovery key and vault key stay in the browser; a successful recovery rotates the password wrappers and revokes existing sessions.
- AI memory is explicit and user-controlled. It is stored with the planner, sent to xAI only for a plan or review request, and can be edited or forgotten.
- No secrets belong in the browser bundle. Keep `XAI_API_KEY` and `DATABASE_URL` server-side and never use a `VITE_` prefix for them.

## Important limits

- Local browser storage is protected by the browser/OS profile, not by a server login. Use full-disk encryption, a strong device passcode, a current browser, and a trusted device.
- Anyone who obtains the sync code can decrypt that synced planner. Treat the code like a password and do not put it in screenshots, tickets, or chat.
- Text and images intentionally sent to the AI coach are processed by xAI through the server proxy. Do not save or submit information you are not comfortable sharing with that provider.
- The in-process API limiter is an abuse brake, not a global WAF. High-risk public deployments should put a durable edge rate limiter, monitoring, dependency scanning, and secret rotation in front of Vercel.
- Browser extensions, malicious scripts installed on the device, compromised dependencies, and a hostile hosting/runtime account are outside the app's trust boundary.

## Reporting a vulnerability

Please do not publish an exploitable issue before it is fixed. Use a private GitHub Security Advisory for this repository, including reproduction steps, affected route or component, impact, and a suggested fix when possible. Never include real planner exports, sync codes, API keys, or personal data in a report.
