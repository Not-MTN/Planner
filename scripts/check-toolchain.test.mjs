import { describe, expect, it } from 'vitest';
import { dependabotErrors, nodeMajor, repoErrors, toolchainErrors, workflowNodeVersions } from './check-toolchain.mjs';

const workflow = (path, nodeVersion) => ({
  path,
  text: `jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${nodeVersion}\n`,
});

const dependabot = (overrides = {}) => ({
  config: {
    version: 2,
    updates: [
      {
        'package-ecosystem': 'npm',
        directory: '/',
        schedule: { interval: 'weekly' },
        groups: { 'minor-and-patch': { 'update-types': ['minor', 'patch'] } },
      },
      { 'package-ecosystem': 'github-actions', directory: '/', schedule: { interval: 'monthly' } },
    ],
    ...overrides,
  },
  exists: true,
  directories: new Set(['/', '/desktop']),
});

describe('toolchain check', () => {
  it('reads the major out of a range or a bare version', () => {
    expect(nodeMajor('>=22.0.0')).toBe('22');
    expect(nodeMajor('22.x')).toBe('22');
    expect(nodeMajor('24')).toBe('24');
    expect(nodeMajor('lts/*')).toBe(null);
    expect(nodeMajor(undefined)).toBe(null);
  });

  it('finds every step that installs Node, including through a version file', () => {
    const found = workflowNodeVersions(
      [workflow('a.yml', 22), { path: 'b.yml', text: 'jobs:\n  x:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version-file: .nvmrc\n' }],
      (path) => (path === '.nvmrc' ? '22\n' : null),
    );
    expect(found).toEqual([
      { path: 'a.yml · build step 1', version: '22' },
      { path: 'b.yml · x step 1', version: '22', via: '.nvmrc' },
    ]);
  });

  it('refuses a workflow that does not parse, rather than silently finding no Node', () => {
    const found = workflowNodeVersions([{ path: 'broken.yml', text: 'jobs: [unclosed' }]);
    expect(found[0].broken).toBeTruthy();
    expect(toolchainErrors({ engines: { node: '>=22.0.0' }, installs: found }).join('\n')).toContain('does not parse as YAML');
  });

  it('accepts CI that matches the floor, and every form of the same major', () => {
    expect(
      toolchainErrors({
        engines: { node: '>=22.0.0' },
        installs: [
          { path: 'a.yml', version: '22' },
          { path: 'b.yml', version: '22.x' },
          { path: 'c.yml', version: '>=22 <25' },
        ],
      }),
    ).toEqual([]);
  });

  it('fails when CI tests a different Node than the floor promises', () => {
    const errors = toolchainErrors({ engines: { node: '>=24.0.0' }, installs: [{ path: 'apps.yml · android step 1', version: '22' }] });
    expect(errors.join('\n')).toContain('apps.yml · android step 1');
    expect(errors.join('\n')).toContain('major 24');
  });

  it('fails when nothing states a floor, or nothing installs Node', () => {
    expect(toolchainErrors({ engines: {}, installs: [{ path: 'a.yml', version: '22' }] }).join('\n')).toContain('no engines.node');
    expect(toolchainErrors({ engines: { node: '>=22.0.0' }, installs: [] }).join('\n')).toContain('no workflow installs Node');
  });

  it('accepts a dependabot file that watches the root npm package in one group', () => {
    expect(dependabotErrors(dependabot())).toEqual([]);
  });

  it('fails a dependabot directory that does not exist, since that is silent on GitHub', () => {
    const { config } = dependabot();
    config.updates[0].directory = '/app';
    config.updates[1].directory = '/app';
    const errors = dependabotErrors({ config, exists: true, directories: new Set(['/', '/desktop']) });
    expect(errors).toContainEqual(expect.stringContaining('/app does not exist'));
  });

  it('fails an unknown ecosystem, a missing schedule, and a limit that is not a number', () => {
    const { config } = dependabot();
    config.updates[1]['package-ecosystem'] = 'npmm';
    config.updates[1].schedule = { interval: 'often' };
    config.updates[0]['open-pull-requests-limit'] = 'many';
    const errors = dependabotErrors({ config, exists: true, directories: new Set(['/', '/desktop']) }).join('\n');
    expect(errors).toContain('unknown package-ecosystem');
    expect(errors).toContain('unknown schedule.interval');
    expect(errors).toContain('open-pull-requests-limit');
  });

  it('insists on the grouping that keeps a week of updates reviewable', () => {
    const { config } = dependabot();
    delete config.updates[0].groups;
    expect(dependabotErrors({ config, exists: true, directories: new Set(['/']) }).join('\n')).toContain('no groups');

    const patchOnly = dependabot();
    patchOnly.config.updates[0].groups = { shrinking: { 'update-types': ['patch'] } };
    expect(dependabotErrors(patchOnly).join('\n')).toContain('no npm group covers minor updates');
  });

  it('fails when the file is gone, or claims a different version', () => {
    expect(dependabotErrors({ config: null, exists: false, directories: new Set(['/']) }).join('\n')).toContain('is missing');
    expect(dependabotErrors(dependabot({ version: 3 })).join('\n')).toContain('version: 2');
  });

  it('passes against the repository as it stands', () => {
    // The real guard: this is what `npm run check:toolchain` runs in CI.
    expect(repoErrors(new URL('..', import.meta.url).pathname)).toEqual([]);
  });
});
