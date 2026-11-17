#!/usr/bin/env node
/**
 * Next Android versionCode: the highest version code Google Play has ever
 * accepted for the app, plus one. Google Play is the source of truth, like
 * Xcode Cloud's build counter on iOS, so nothing is stored in the repository.
 *
 * Considers every uploaded bundle and APK, and every release on any track.
 * Reads them in a temporary edit that is deleted afterwards.
 *
 * Usage (PLAY_ACCESS_TOKEN with the androidpublisher scope):
 *   node play-version-code.mjs --package com.example.app
 * Prints `version-code=<n>` and `highest=<n>` lines (GITHUB_OUTPUT format).
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { withEdit } from './play-api.mjs';

/** Highest version code among bundles, APKs and track releases; 0 when none. */
export const highestVersionCode = ({ bundles = [], apks = [], tracks = [] }) => {
  const codes = [
    ...bundles.map((bundle) => bundle.versionCode),
    ...apks.map((apk) => apk.versionCode),
    ...tracks.flatMap((track) =>
      (track.releases ?? []).flatMap((release) => release.versionCodes ?? []),
    ),
  ].map(Number);

  return codes.length > 0 ? Math.max(...codes) : 0;
};

const main = async () => {
  const { values } = parseArgs({ options: { package: { type: 'string' } } });
  const token = process.env.PLAY_ACCESS_TOKEN;

  if (!values.package || !token) {
    throw new Error('Needs --package and PLAY_ACCESS_TOKEN');
  }

  const highest = await withEdit(values.package, token, async (edit) => {
    const [bundles, apks, tracks] = await Promise.all([
      edit.get('bundles'),
      edit.get('apks'),
      edit.get('tracks'),
    ]);
    return highestVersionCode({
      bundles: bundles.bundles,
      apks: apks.apks,
      tracks: tracks.tracks,
    });
  });

  process.stdout.write(`version-code=${highest + 1}\nhighest=${highest}\n`);
};

const isEntryPoint =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
