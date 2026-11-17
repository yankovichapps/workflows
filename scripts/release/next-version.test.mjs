import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bumpVersion,
  dependencyRoots,
  parseCommit,
  pickLatestTag,
  renderNotes,
  requiredBump,
} from './next-version.mjs';
import { planDraft } from './sync-drafts.mjs';

const commit = (subject, body = '', sha = 'a'.repeat(40)) =>
  parseCommit({ sha, subject, body });

describe('pickLatestTag', () => {
  it('picks the highest version of the app by semver, not by string order', () => {
    const latest = pickLatestTag('keep-an-eye', [
      'keep-an-eye@3.9.0',
      'keep-an-eye@3.10.0',
      'keep-an-eye@3.8.1',
      'other-app@9.0.0',
      'v4.0.0',
    ]);

    assert.equal(latest.tag, 'keep-an-eye@3.10.0');
  });

  it('ignores tags of apps whose name starts the same', () => {
    assert.equal(pickLatestTag('app', ['app-pro@2.0.0', 'app@1.0.0']).tag, 'app@1.0.0');
  });

  it('ignores tags that are not plain versions', () => {
    assert.equal(pickLatestTag('app', ['app@1.0.0-beta.1', 'app@next']), null);
  });
});

describe('parseCommit', () => {
  it('reads type, scope and description', () => {
    assert.deepEqual(commit('fix(android): free disk space (#74)'), {
      sha: 'a'.repeat(40),
      type: 'fix',
      scope: 'android',
      description: 'free disk space (#74)',
      breaking: false,
    });
  });

  it('detects breaking changes from "!" and from the footer', () => {
    assert.equal(commit('feat!: drop iOS 15').breaking, true);
    assert.equal(commit('feat: new api', 'BREAKING CHANGE: old api removed').breaking, true);
  });

  it('returns null for subjects that are not conventional commits', () => {
    assert.equal(commit('Merge branch main'), null);
    assert.equal(commit('Revert "feat: x"'), null);
  });
});

describe('requiredBump', () => {
  it('returns the strongest bump', () => {
    assert.equal(requiredBump([commit('fix: a'), commit('feat: b')]), 'minor');
    assert.equal(requiredBump([commit('feat: a'), commit('fix!: b')]), 'major');
    assert.equal(requiredBump([commit('perf: a')]), 'patch');
  });

  it('returns null when only non-release types changed', () => {
    assert.equal(requiredBump([commit('chore: a'), commit('docs: b'), commit('ci: c')]), null);
  });
});

describe('bumpVersion', () => {
  it('resets the lower parts', () => {
    assert.equal(bumpVersion([3, 8, 2], 'patch'), '3.8.3');
    assert.equal(bumpVersion([3, 8, 2], 'minor'), '3.9.0');
    assert.equal(bumpVersion([3, 8, 2], 'major'), '4.0.0');
  });
});

describe('dependencyRoots', () => {
  const graph = {
    graph: {
      nodes: {
        app: { data: { root: 'apps/app' } },
        ui: { data: { root: 'libs/ui' } },
        icons: { data: { root: 'libs/icons' } },
        unrelated: { data: { root: 'libs/unrelated' } },
      },
      dependencies: {
        app: [{ target: 'ui' }, { target: 'npm:react' }],
        ui: [{ target: 'icons' }, { target: 'app' }],
        icons: [],
        unrelated: [],
      },
    },
  };

  it('includes transitive dependencies and skips npm packages and cycles', () => {
    assert.deepEqual(dependencyRoots(graph, 'app'), ['apps/app', 'libs/icons', 'libs/ui']);
  });

  it('throws for an unknown project', () => {
    assert.throws(() => dependencyRoots(graph, 'missing'), /not found/);
  });
});

describe('renderNotes', () => {
  it('groups commits, lists a breaking feature once, and folds other changes', () => {
    const notes = renderNotes({
      commits: [
        commit('feat!: new api', '', '1111111aaaa'),
        commit('feat(ui): dark mode', '', '2222222bbbb'),
        commit('fix: crash', '', '3333333cccc'),
        commit('chore(deps): bump x', '', '4444444dddd'),
      ],
      repository: 'org/repo',
      fromTag: 'app@1.0.0',
      toSha: 'abc',
    });

    assert.equal(
      notes,
      [
        '## ⚠️ Breaking changes',
        '',
        '- new api (1111111)',
        '',
        '## ✨ Features',
        '',
        '- **ui:** dark mode (2222222)',
        '',
        '## 🐛 Fixes',
        '',
        '- crash (3333333)',
        '',
        '<details>',
        '<summary>Other changes</summary>',
        '',
        '- **deps:** bump x (4444444)',
        '',
        '</details>',
        '',
        '**Full changelog:** https://github.com/org/repo/compare/app@1.0.0...abc',
        '',
      ].join('\n'),
    );
  });
});

describe('planDraft', () => {
  const release = (id, tag, draft) => ({ id, tag_name: tag, draft });

  it('updates the existing draft and removes duplicates', () => {
    const plan = planDraft({ app: 'app', version: '1.1.0', tag: 'app@1.1.0' }, [
      release(1, 'app@1.0.1', true),
      release(2, 'app@1.0.2', true),
      release(3, 'app-pro@1.0.0', true),
      release(4, 'app@1.0.0', false),
    ]);

    assert.equal(plan.update.id, 1);
    assert.equal(plan.create, false);
    assert.deepEqual(plan.remove.map(({ id }) => id), [2]);
  });

  it('creates a draft when none exists', () => {
    const plan = planDraft({ app: 'app', version: '1.1.0', tag: 'app@1.1.0' }, []);

    assert.deepEqual(plan, { update: null, create: true, remove: [] });
  });

  it('removes drafts when no release is due', () => {
    const plan = planDraft({ app: 'app', version: null }, [release(1, 'app@1.0.1', true)]);

    assert.deepEqual(plan.remove.map(({ id }) => id), [1]);
  });

  it('refuses to recreate an already published version', () => {
    assert.throws(
      () => planDraft({ app: 'app', version: '1.0.0', tag: 'app@1.0.0' }, [release(1, 'app@1.0.0', false)]),
      /already published/,
    );
  });
});
