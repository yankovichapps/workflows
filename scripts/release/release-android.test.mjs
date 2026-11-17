import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
