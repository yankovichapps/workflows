import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withEdit } from './play-api.mjs';
import { planPromotion } from './play-promote.mjs';
import { highestVersionCode } from './play-version-code.mjs';
import { parseReleaseTag } from './release-tag.mjs';

describe('parseReleaseTag', () => {
  it('splits app and version', () => {
    assert.deepEqual(parseReleaseTag('keep-an-eye@3.9.0'), { app: 'keep-an-eye', version: '3.9.0' });
    assert.deepEqual(parseReleaseTag('app2@10.0.12'), { app: 'app2', version: '10.0.12' });
  });

  it('rejects tags that are not <app>@x.y.z', () => {
    for (const tag of ['v3.9.0', 'keep-an-eye@3.9', 'keep-an-eye@3.9.0-beta.1', 'Keep@1.0.0', 'app@01.0.0', '-app@1.0.0', '', undefined]) {
      assert.throws(() => parseReleaseTag(tag), /not a release tag/, String(tag));
    }
  });
});

describe('highestVersionCode', () => {
  it('takes the maximum across bundles, APKs and track releases', () => {
    assert.equal(
      highestVersionCode({
        bundles: [{ versionCode: 140 }, { versionCode: 145 }],
        apks: [{ versionCode: 12 }],
        tracks: [
          { track: 'internal', releases: [{ versionCodes: ['146'] }] },
          { track: 'production', releases: [{ versionCodes: ['144'] }, {}] },
        ],
      }),
      146,
    );
  });

  it('is 0 for an app without uploads', () => {
    assert.equal(highestVersionCode({}), 0);
    assert.equal(highestVersionCode({ bundles: [], tracks: [{ track: 'internal' }] }), 0);
  });
});

describe('planPromotion', () => {
  const internal = {
    releases: [
      { name: '3.9.0', versionCodes: ['146'], status: 'completed', releaseNotes: [{ language: 'en-US', text: 'Fixes' }] },
    ],
  };

  it('copies the internal release of the version to production', () => {
    assert.deepEqual(planPromotion({ version: '3.9.0', internal, production: { releases: [] } }), {
      action: 'promote',
      release: {
        name: '3.9.0',
        versionCodes: ['146'],
        status: 'completed',
        releaseNotes: [{ language: 'en-US', text: 'Fixes' }],
      },
    });
  });

  it("accepts Play's default release name", () => {
    const plan = planPromotion({
      version: '3.8.0',
      internal: { releases: [{ name: '145 (3.8.0)', versionCodes: ['145'], status: 'completed' }] },
      production: {},
    });
    assert.equal(plan.action, 'promote');
    assert.deepEqual(plan.release.versionCodes, ['145']);
    assert.equal('releaseNotes' in plan.release, false);
  });

  it('is done when production already has the version', () => {
    const production = { releases: [{ name: '3.9.0', versionCodes: ['146'], status: 'inProgress' }] };
    assert.deepEqual(planPromotion({ version: '3.9.0', internal, production }), { action: 'done' });
  });

  it('ignores a production draft of the version', () => {
    const production = { releases: [{ name: '3.9.0', versionCodes: ['146'], status: 'draft' }] };
    assert.equal(planPromotion({ version: '3.9.0', internal, production }).action, 'promote');
  });

  it('never promotes an internal draft or halted release', () => {
    for (const status of ['draft', 'halted', undefined]) {
      const track = { releases: [{ name: '3.9.0', versionCodes: ['146'], status }] };
      assert.deepEqual(planPromotion({ version: '3.9.0', internal: track, production: {} }), { action: 'build' }, String(status));
    }
  });

  it('builds when the internal track has no release of the version', () => {
    for (const track of [{}, { releases: [{ name: '3.10.0', versionCodes: ['147'], status: 'completed' }] }, { releases: [{ name: '3.9.0', status: 'completed' }] }]) {
      assert.deepEqual(planPromotion({ version: '3.9.0', internal: track, production: {} }), { action: 'build' });
    }
    // 3.9.0 must not match 13.9.0 ...
    assert.equal(planPromotion({ version: '3.9.0', internal: { releases: [{ name: '13.9.0', versionCodes: ['1'], status: 'completed' }] }, production: {} }).action, 'build');
  });
});

describe('withEdit', () => {
  const recordFetch = (t) => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push(`${init.method} ${url.replace(/^.*\/applications\//, '')}`);
      const body = init.method === 'POST' && url.endsWith('/edits') ? { id: 'e1' } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
    return calls;
  };

  it('commits when the work asks for it', async (t) => {
    const calls = recordFetch(t);
    await withEdit('com.app', 'token', async (edit) => {
      await edit.put('tracks/production', {});
      return { commit: true };
    });
    assert.deepEqual(calls, ['POST com.app/edits', 'PUT com.app/edits/e1/tracks/production', 'POST com.app/edits/e1:commit']);
  });

  it('deletes the edit after a read-only or failed run', async (t) => {
    const calls = recordFetch(t);
    await withEdit('com.app', 'token', (edit) => edit.get('tracks'));
    await assert.rejects(withEdit('com.app', 'token', () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(calls, [
      'POST com.app/edits', 'GET com.app/edits/e1/tracks', 'DELETE com.app/edits/e1',
      'POST com.app/edits', 'DELETE com.app/edits/e1',
    ]);
  });
});
