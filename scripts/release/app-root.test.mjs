import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findAppRoot } from './app-root.mjs';

describe('findAppRoot', () => {
  const projects = [
    { path: 'apps/keep-an-eye/project.json', name: 'keep-an-eye' },
    { path: 'apps/mobile/project.json', name: 'pawpower-mobile' },
    { path: 'apps/gateway/project.json' },
    { path: 'libs/mobile/ui-lib/project.json', name: 'ui-lib' },
  ];

  it('finds the folder of a project whose name matches it', () => {
    assert.equal(findAppRoot({ app: 'keep-an-eye', projects }), 'apps/keep-an-eye');
  });

  it('finds a project whose name differs from its folder', () => {
    assert.equal(findAppRoot({ app: 'pawpower-mobile', projects }), 'apps/mobile');
  });

  it('accepts apps/<app> when its project.json has no name', () => {
    assert.equal(findAppRoot({ app: 'gateway', projects }), 'apps/gateway');
  });

  it('rejects a folder name when the project there is named differently', () => {
    assert.throws(() => findAppRoot({ app: 'mobile', projects }), /No Nx project named "mobile"/);
  });

  it('rejects unknown apps and invalid names', () => {
    assert.throws(() => findAppRoot({ app: 'web', projects }), /No Nx project named "web"/);
    for (const app of ['', undefined, 'Mobile', '../mobile', 'apps/mobile']) {
      assert.throws(() => findAppRoot({ app, projects }), /is not an app name/, String(app));
    }
  });

  it('rejects a name used by two projects', () => {
    const twice = [...projects, { path: 'apps/mobile-old/project.json', name: 'pawpower-mobile' }];
    assert.throws(() => findAppRoot({ app: 'pawpower-mobile', projects: twice }), /Several Nx projects/);
  });
});

describe('app-root.mjs (CLI)', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'app-root.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'app-root-'));
  after(() => rmSync(repo, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };

  it('reads the committed project.json files of a repository', () => {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    write('apps/mobile/project.json', JSON.stringify({ name: 'pawpower-mobile' }));
    write('apps/mobile/node_modules/x/project.json', JSON.stringify({ name: 'pawpower-mobile' }));
    write('libs/ui/project.json', JSON.stringify({ name: 'ui' }));
    execFileSync('git', ['add', 'apps/mobile/project.json', 'libs/ui/project.json'], { cwd: repo });

    const output = execFileSync('node', [script, 'pawpower-mobile', '--repo', repo], { encoding: 'utf8' });

    assert.equal(output, 'root=apps/mobile\n');
  });
});
