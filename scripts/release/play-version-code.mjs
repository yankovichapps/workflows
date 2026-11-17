#!/usr/bin/env node
/**
 * Next Android versionCode: the highest version code Google Play has ever
 * accepted for the app, plus one. Google Play is the source of truth, like
 * Xcode Cloud's build counter on iOS, so nothing is stored in the repository.
 *
 * Considers every uploaded bundle and APK, and every release on any track.
 * Opens a temporary edit to read them and deletes it afterwards.
 *
 * Usage (PLAY_ACCESS_TOKEN with the androidpublisher scope):
 *   node play-version-code.mjs --package com.example.app
 * Prints `version-code=<n>` and `highest=<n>` lines (GITHUB_OUTPUT format).
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

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

const request = async (method, url, token) => {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  }

  return response.status === 204 ? {} : response.json().catch(() => ({}));
};

const main = async () => {
  const { values } = parseArgs({ options: { package: { type: 'string' } } });
  const token = process.env.PLAY_ACCESS_TOKEN;

  if (!values.package || !token) {
    throw new Error('Needs --package and PLAY_ACCESS_TOKEN');
  }

  const appUrl = `${API}/${encodeURIComponent(values.package)}`;
  const { id: editId } = await request('POST', `${appUrl}/edits`, token);
  const editUrl = `${appUrl}/edits/${editId}`;

  try {
    const [bundles, apks, tracks] = await Promise.all([
      request('GET', `${editUrl}/bundles`, token),
      request('GET', `${editUrl}/apks`, token),
      request('GET', `${editUrl}/tracks`, token),
    ]);
    const highest = highestVersionCode({
      bundles: bundles.bundles,
      apks: apks.apks,
      tracks: tracks.tracks,
    });

    process.stdout.write(`version-code=${highest + 1}\nhighest=${highest}\n`);
  } finally {
    await request('DELETE', editUrl, token);
  }
};

const isEntryPoint =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
