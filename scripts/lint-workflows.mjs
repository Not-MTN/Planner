#!/usr/bin/env node
/**
 * Validate the GitHub Actions workflows before GitHub does.
 *
 *   npm run lint:workflows
 *
 * This exists because of a real failure: a workflow that parsed as valid YAML
 * and looked correct was rejected by GitHub with "This run likely failed
 * because of a workflow file issue", which produced a failed run and no
 * explanation in the log — the job never started. The cause was using the
 * `env` context inside `jobs.<job_id>.env`, where GitHub does not allow it.
 * Nothing in the repository could have caught that: Vite, tsc, ESLint and the
 * test suite never look at workflow files.
 *
 * actionlint understands GitHub's rules, including which contexts are allowed
 * where, so it catches exactly that class of mistake.
 *
 * One known false positive is ignored, deliberately and narrowly: the actionlint
 * build published to npm is missing the `vars` context and reports it as
 * undefined everywhere, including places GitHub documents as valid (and which
 * this repository has already run successfully). Only that exact message is
 * suppressed — every other error, including the `env`-context mistake this
 * script was written for, still fails the check.
 */
import { globSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createLinter } from 'actionlint';

/** Messages from the stale `vars` handling described above. */
const KNOWN_FALSE_POSITIVE = /^undefined variable "vars"\./;

const files = globSync('.github/workflows/*.{yml,yaml}').sort();
if (files.length === 0) {
  console.error('✗ No workflow files found. Run this from the repository root.');
  process.exit(1);
}

let problems = 0;
let suppressed = 0;

for (const file of files) {
  // Isolate each workflow in a fresh WASM linter instance. Reusing one instance
  // after the large Apps workflow can trap inside actionlint's Go runtime.
  const lint = await createLinter();
  const text = readFileSync(file, 'utf8');
  const results = lint(text, file).filter((result) => {
    if (!KNOWN_FALSE_POSITIVE.test(result.message)) return true;
    suppressed += 1;
    return false;
  });
  if (results.length === 0) {
    console.log(`✓ ${file}`);
    continue;
  }
  console.log(`✗ ${file}`);
  for (const result of results) {
    console.log(`   ${result.line}:${result.column}  [${result.kind}] ${result.message}`);
    if (result.kind === 'expression' && /context "(\w+)" is not allowed here/.test(result.message)) {
      console.log('   → GitHub rejects the whole file for this, and the run stops before any job starts.');
      console.log('     https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability');
    }
  }
  problems += results.length;
}

if (suppressed > 0) {
  console.log(`\n(${suppressed} known false positive${suppressed === 1 ? '' : 's'} ignored — see the header of this script.)`);
}

if (problems > 0) {
  console.log(`\n${problems} problem${problems === 1 ? '' : 's'} GitHub would reject.`);
  process.exit(1);
}
console.log('\nAll workflows are valid.');
