#!/usr/bin/env node
/**
 * Folder of the app a release tag names. The `<app>` in `<app>@<version>` is
 * the Nx project name, which may differ from its folder, e.g. the project
 * `pawpower-mobile` in `apps/mobile`. Reads the committed project.json files,
 * so it needs no `pnpm install`.
 *
 * - A project.json whose "name" is the app wins.
 * - Otherwise `apps/<app>/project.json` without a "name" (Nx then names the
 *   project after its folder) still counts, as before.
 *
 * Usage: node app-root.mjs <app> [--repo <dir>]
 * Prints `root=<folder>` (GITHUB_OUTPUT format), relative to the repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const APP_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {{ app: string, projects: { path: string, name?: string }[] }} input
 *   `path` is a project.json path relative to the repository root
 * @returns {string} the app's folder
 */
export const findAppRoot = ({ app, projects }) => {
  if (!APP_NAME_PATTERN.test(app ?? '')) {
    throw new Error(`"${app}" is not an app name (lowercase words joined by "-")`);
  }

  const named = projects.filter((project) => project.name === app);

  if (named.length > 1) {
    throw new Error(
      `Several Nx projects are named "${app}": ${named.map((project) => project.path).join(', ')}`,
    );
  }

  if (named.length === 1) {
    return dirname(named[0].path);
  }

  const byFolder = projects.find(
    (project) => project.path === `apps/${app}/project.json` && project.name === undefined,
  );

  if (byFolder) {
    return `apps/${app}`;
  }

  throw new Error(`No Nx project named "${app}": no project.json has "name": "${app}"`);
};

const readProjects = (repo) =>
  execFileSync('git', ['ls-files', '-z', '--', ':(glob)**/project.json'], {
    cwd: repo,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .map((path) => {
      let project;

      try {
        project = JSON.parse(readFileSync(join(repo, path), 'utf8'));
      } catch (error) {
        throw new Error(`${path} is not valid JSON: ${error.message}`);
      }

      return { path, name: typeof project.name === 'string' ? project.name : undefined };
    });

const isEntryPoint =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  try {
    const { values, positionals } = parseArgs({
      options: { repo: { type: 'string', default: '.' } },
      allowPositionals: true,
    });
    const app = positionals[0];
    const root = findAppRoot({ app, projects: readProjects(values.repo) });

    process.stdout.write(`root=${root}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
