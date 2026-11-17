#!/usr/bin/env node
/**
 * Promotes a tested release from Google Play's internal track to production,
 * without rebuilding: the production release gets the same version codes and
 * release notes as the internal release of that version.
 *
 * Releases are matched by name: release-android names every upload after the
 * version (SUPPLY_RELEASE_NAME), and Play's own default name "<code> (<version>)"
 * is accepted too.
 *
 * Usage (PLAY_ACCESS_TOKEN with the androidpublisher scope):
 *   node play-promote.mjs --package com.example.app --version 3.9.0
 * Prints `action=<promote|done|build>` and, when promoted, `version-code=<n>`
 * (GITHUB_OUTPUT format):
 * - promote: the internal release was copied to production
 * - done:    production already has this version (e.g. a re-run)
 * - build:   no internal release of this version, the caller has to build it
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { withEdit } from './play-api.mjs';

/** Whether a track release is the release of `version`. */
export const isReleaseOf = (release, version) =>
  release.name === version || (release.name ?? '').endsWith(`(${version})`);

/**
 * Decides what promoting `version` means, from the internal and production
 * tracks as returned by the API (`{ releases: [...] }`).
 */
export const planPromotion = ({ version, internal, production }) => {
  const inProduction = (production?.releases ?? []).some(
    (release) => isReleaseOf(release, version) && release.status !== 'draft',
  );
  if (inProduction) {
    return { action: 'done' };
  }

  const tested = (internal?.releases ?? []).find(
    (release) => isReleaseOf(release, version) && (release.versionCodes ?? []).length > 0,
  );
  if (!tested) {
    return { action: 'build' };
  }

  return {
    action: 'promote',
    release: {
      name: version,
      versionCodes: tested.versionCodes,
      status: 'completed',
      ...(tested.releaseNotes ? { releaseNotes: tested.releaseNotes } : {}),
    },
  };
};

const main = async () => {
  const { values } = parseArgs({
    options: { package: { type: 'string' }, version: { type: 'string' } },
  });
  const token = process.env.PLAY_ACCESS_TOKEN;

  if (!values.package || !values.version || !token) {
    throw new Error('Needs --package, --version and PLAY_ACCESS_TOKEN');
  }

  const plan = await withEdit(values.package, token, async (edit) => {
    const [internal, production] = await Promise.all([
      edit.get('tracks/internal'),
      edit.get('tracks/production'),
    ]);
    const result = planPromotion({ version: values.version, internal, production });

    if (result.action === 'promote') {
      await edit.put('tracks/production', { track: 'production', releases: [result.release] });
      return { ...result, commit: true };
    }
    return result;
  });

  const lines = [`action=${plan.action}`];
  if (plan.release) {
    lines.push(`version-code=${plan.release.versionCodes.join(',')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
};

const isEntryPoint =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
