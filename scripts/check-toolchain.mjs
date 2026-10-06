#!/usr/bin/env node
/**
 * One Node version, one dependency policy, checked in one place.
 *
 *   npm run check:toolchain
 *
 * `package.json` declares the floor (`engines.node`), a dozen workflow steps
 * repeat it (`node-version`), and `.github/dependabot.yml` decides how upgrades
 * arrive. Three files, one fact — and nothing in the repository compared them.
 * The failure that costs an afternoon is the quiet one: the floor moves to a new
 * major, CI keeps testing the old one, and code that only the new runtime
 * supports passes locally and fails on the runner (or worse, the other way
 * around).
 *
 * Dependabot is validated for the same reason. It is a file GitHub reads and
 * nothing else does: a typo in `directory`, an ecosystem that does not exist, a
 * schedule GitHub does not accept — and the effect is silence. No pull requests,
 * no error message, nobody notices for months.
 */
import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The Node major a version or range names: '>=22.0.0' or '22' → '22'. */
export function nodeMajor(value) {
  const match = /\d+/.exec(String(value ?? ''));
  return match ? match[0] : null;
}

/**
 * Every place a workflow installs Node, with the step it came from. Both forms
 * count: a version, and a file that holds one (`.nvmrc`, `package.json`), since
 * a floor pinned by file is still a floor something has to read.
 */
export function workflowNodeVersions(files, readFile = () => null) {
  const found = [];
  for (const { path, text } of files) {
    let doc;
    try {
      doc = yaml.load(text) ?? {};
    } catch (error) {
      found.push({ path, version: null, broken: String(error.message ?? error) });
      continue;
    }
    for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
      for (const [index, step] of ((job?.steps ?? [])[0] ? job.steps : []).entries()) {
        const withValues = step?.with ?? {};
        const version = withValues['node-version'];
        const versionFile = withValues['node-version-file'];
        // `node-version: 22` is a number to a YAML parser; `22.x` is a string.
        if (typeof version === 'string' || typeof version === 'number') {
          found.push({ path: `${path} · ${jobId} step ${index + 1}`, version: String(version).trim() });
        } else if (typeof versionFile === 'string') {
          const declared = readFile(versionFile.trim());
          found.push({
            path: `${path} · ${jobId} step ${index + 1}`,
            version: typeof declared === 'string' ? declared.trim() : declared,
            via: versionFile.trim(),
          });
        }
      }
    }
  }
  return found;
}

/**
 * The Node floor and every workflow step that installs Node must agree on the
 * major. A workflow that installs nothing is a step that will drift, so it is a
 * problem too — the runner's default is not this project's promise.
 */
export function toolchainErrors({ engines, installs }) {
  const errors = [];
  const expected = nodeMajor(engines?.node);
  if (!expected) {
    errors.push('package.json has no engines.node, so nothing states which Node this project runs on.');
    return errors;
  }
  const broken = installs.filter((entry) => entry.broken);
  for (const entry of broken) errors.push(`${entry.path}: the workflow does not parse as YAML (${entry.broken}).`);
  const usable = installs.filter((entry) => !entry.broken);
  if (usable.length === 0) {
    errors.push('no workflow installs Node, so CI never runs on the version package.json promises.');
    return errors;
  }
  for (const install of usable) {
    const major = nodeMajor(install.version);
    if (!major) {
      errors.push(`${install.path}: installs Node from ${install.via ?? 'an unreadable value'}, which does not name a version.`);
    } else if (major !== expected) {
      errors.push(
        `${install.path}: installs Node ${String(install.version).trim()}${install.via ? ` (from ${install.via})` : ''}, ` +
          `but package.json promises ${engines.node} (major ${expected}).`,
      );
    }
  }
  return errors;
}

const ECOSYSTEMS = new Set([
  'npm', 'github-actions', 'docker', 'docker-compose', 'cargo', 'pip', 'gomod', 'bundler', 'composer', 'pub', 'swift',
  'nuget', 'gradle', 'maven', 'dotnet', 'rust-toolchain', 'devcontainers', 'helm', 'terraform', 'elm', 'mix', 'uv',
]);
const INTERVALS = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'semiannually', 'yearly', 'cron']);

/**
 * Dependabot's own rules, as far as they can be checked without GitHub: it
 * parses as YAML, it names real ecosystems and intervals, every `directory` is a
 * directory that exists — a typo there silently disables the ecosystem — and the
 * root npm entry groups minor with patch, so a week of updates is one reviewable
 * diff instead of a dozen.
 */
export function dependabotErrors({ config, exists, directories }) {
  const errors = [];
  if (!exists) {
    errors.push('.github/dependabot.yml is missing: dependency updates would be manual again.');
    return errors;
  }
  if (config?.version !== 2) errors.push('.github/dependabot.yml must declare version: 2.');
  const updates = config?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    errors.push('.github/dependabot.yml has no updates: entries, so nothing is watched.');
    return errors;
  }
  for (const [index, update] of updates.entries()) {
    const where = `updates[${index}] (${update?.['package-ecosystem'] ?? 'no ecosystem'})`;
    if (!ECOSYSTEMS.has(update?.['package-ecosystem'])) errors.push(`${where}: unknown package-ecosystem.`);
    const directory = update?.directory;
    if (typeof directory !== 'string' || !directory.startsWith('/')) {
      errors.push(`${where}: directory must be an absolute path inside the repository, like "/".`);
    } else if (!directories.has(directory)) {
      errors.push(`${where}: directory ${directory} does not exist, so this ecosystem watches nothing.`);
    }
    if (!INTERVALS.has(update?.schedule?.interval)) errors.push(`${where}: missing or unknown schedule.interval.`);
    if (update?.['open-pull-requests-limit'] !== undefined && !Number.isInteger(update['open-pull-requests-limit'])) {
      errors.push(`${where}: open-pull-requests-limit must be a whole number.`);
    }
  }
  const npmRoot = updates.find((update) => update?.['package-ecosystem'] === 'npm' && update.directory === '/');
  if (!npmRoot) {
    errors.push('.github/dependabot.yml does not watch the root npm package.');
    return errors;
  }
  const groups = Object.entries(npmRoot.groups ?? {});
  if (groups.length === 0) {
    errors.push('the root npm entry has no groups: a week of updates would arrive as a dozen pull requests.');
    return errors;
  }
  const covers = (kind) =>
    groups.some(([, group]) => Array.isArray(group?.['update-types']) && group['update-types'].includes(kind));
  for (const kind of ['minor', 'patch']) {
    if (!covers(kind)) errors.push(`no npm group covers ${kind} updates.`);
  }
  return errors;
}

/** Run both checks against a repository. Returns the problems, or [] when it all lines up. */
export function repoErrors(directory) {
  const read = (path) => readFileSync(resolve(directory, path), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const workflowFiles = globSync('.github/workflows/*.{yml,yaml}', { cwd: directory }).sort();
  const workflows = workflowFiles.map((path) => ({ path, text: read(path) }));
  const readVersionFile = (path) => {
    if (!existsSync(resolve(directory, path))) return null;
    const text = read(path);
    // `.nvmrc` holds a version; a package.json holds an object with one in it.
    if (path.endsWith('.json')) {
      try {
        const json = JSON.parse(text);
        return json?.engines?.node ?? json?.volta?.node ?? null;
      } catch {
        return null;
      }
    }
    return text.trim();
  };
  let config = null;
  let exists = true;
  try {
    config = yaml.load(read('.github/dependabot.yml'));
  } catch {
    exists = false;
  }
  const directories = new Set([
    '/',
    ...globSync('*/package.json', { cwd: directory })
      .map((path) => path.slice(0, path.lastIndexOf('/')))
      .map((folder) => `/${folder}`),
  ]);
  return [
    ...toolchainErrors({ engines: pkg.engines, installs: workflowNodeVersions(workflows, readVersionFile) }),
    ...dependabotErrors({ config, exists, directories }),
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = repoErrors(root);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }
  console.log('✓ toolchain holds: engines, every workflow, and dependabot agree');
}
