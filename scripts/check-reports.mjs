#!/usr/bin/env node
/**
 * Ask a deployment whether anything is on fire.
 *
 * The crash-report dashboard (`GET /api/report/recent`) returns the alert rule's
 * verdict: `alerts` lists every message that has crossed the threshold inside
 * the window. This script turns that answer into an exit code, so the thing that
 * pages a human is whatever already runs on a schedule — a GitHub Actions cron,
 * a systemd timer, a Vercel cron that fetches this URL and checks the status.
 *
 *   PLANNER_APP_URL=https://planner.example.com \
 *   REPORT_DASHBOARD_SECRET=… \
 *   npm run check:reports
 *
 * Exit codes:
 *   0  nothing crossed the threshold (or `--warn-only` was passed)
 *   1  at least one message crossed it — the output names them
 *   2  the deployment could not be asked (missing configuration, bad status)
 *
 * `--json` prints the dashboard response unchanged, for a bigger monitor to
 * consume. `--window=2h` widens the read (`SECRET` endpoint accepts hours).
 */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const base = (process.env.PLANNER_APP_URL ?? option('url') ?? '').replace(/\/+$/, '');
const secret = process.env.REPORT_DASHBOARD_SECRET ?? option('secret') ?? '';

if (!base || !secret) {
  console.error('check-reports: set PLANNER_APP_URL and REPORT_DASHBOARD_SECRET (see README, “Crash reporting”).');
  process.exit(2);
}

const url = `${base}/api/report/recent?window=${encodeURIComponent(option('window') ?? '24h')}`;
let response;
try {
  response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
} catch (error) {
  console.error(`check-reports: could not reach ${base}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (response.status === 404) {
  console.error('check-reports: this deployment does not serve the dashboard — set REPORT_DASHBOARD_SECRET on it first.');
  process.exit(2);
}
if (response.status === 401) {
  console.error('check-reports: the secret was refused.');
  process.exit(2);
}
if (!response.ok) {
  console.error(`check-reports: ${response.status} ${response.statusText} from ${url}`);
  process.exit(2);
}

const body = await response.json();
if (flag('--json')) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const alerts = Array.isArray(body.alerts) ? body.alerts : [];
const total = typeof body.total === 'number' ? body.total : 0;
const groups = Array.isArray(body.groups) ? body.groups : [];

if (!alerts.length) {
  console.log(`check-reports: quiet — ${total} report(s), ${groups.length} distinct message(s), none past the threshold.`);
  process.exit(0);
}

console.error(`check-reports: ${alerts.length} message(s) past the threshold`);
for (const alert of alerts) {
  console.error(`  ${alert.count}× ${alert.message} (last ${alert.last}, ${alert.releases?.join(', ') || 'release unknown'})`);
}
process.exit(flag('--warn-only') ? 0 : 1);
