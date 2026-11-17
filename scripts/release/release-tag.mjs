#!/usr/bin/env node
/**
 * Parses and validates a release tag `<app>@<major>.<minor>.<patch>`.
 *
 * Usage: node release-tag.mjs <tag>
 * Prints `app=<app>` and `version=<version>` lines (GITHUB_OUTPUT format).
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RELEASE_TAG_PATTERN =
  /^(?<app>[a-z0-9]+(?:-[a-z0-9]+)*)@(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;

export const parseReleaseTag = (tag) => {
  const match = RELEASE_TAG_PATTERN.exec(tag ?? '');

  if (!match) {
    throw new Error(
      `"${tag}" is not a release tag. Expected <app>@<major>.<minor>.<patch>, e.g. keep-an-eye@3.9.0`,
    );
  }

  return { app: match.groups.app, version: match.groups.version };
};

const isEntryPoint =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  try {
    const { app, version } = parseReleaseTag(process.argv[2]);

    process.stdout.write(`app=${app}\nversion=${version}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
