#!/usr/bin/env node
/**
 * Creates, updates or deletes the draft GitHub Release of each app from the
 * output of next-version.mjs:
 *
 * - a version is due: one draft named and tagged `<app>@<version>`, targeting
 *   `--target`, with the generated notes (an existing draft is updated);
 * - nothing is due: existing drafts of the app are deleted.
 *
 * Drafts do not create their tag; it is created when a person publishes.
 *
 * Usage (GITHUB_TOKEN with contents: write, GITHUB_REPOSITORY set):
 *   node sync-drafts.mjs --versions versions.json --target <sha>
 */
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

const request = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  }

  return response.status === 204 ? null : response.json();
};

const listReleases = async (repository) => {
  const releases = [];

  for (let page = 1; ; page += 1) {
    const batch = await request(
      'GET',
      `/repos/${repository}/releases?per_page=100&page=${page}`,
    );

    releases.push(...batch);

    if (batch.length < 100) {
      return releases;
    }
  }
};

/** What to do for one app, given all releases of the repository. */
export const planDraft = (result, releases) => {
  const drafts = releases.filter(
    (release) => release.draft && release.tag_name.startsWith(`${result.app}@`),
  );

  if (!result.version) {
    return { update: null, create: false, remove: drafts };
  }

  const published = releases.find(
    (release) => !release.draft && release.tag_name === result.tag,
  );

  if (published) {
    throw new Error(
      `${result.tag} is already published, but next-version computed it again. ` +
        `Is the tag missing from the repository?`,
    );
  }

  const [keep, ...extra] = drafts;

  return { update: keep ?? null, create: !keep, remove: extra };
};

const summary = (line) => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  }

  console.log(line);
};

const main = async () => {
  const { values } = parseArgs({
    options: { versions: { type: 'string' }, target: { type: 'string' } },
  });
  const repository = process.env.GITHUB_REPOSITORY;

  if (!values.versions || !values.target || !repository || !process.env.GITHUB_TOKEN) {
    throw new Error('Needs --versions, --target, GITHUB_REPOSITORY and GITHUB_TOKEN');
  }

  const results = JSON.parse(readFileSync(values.versions, 'utf8'));
  const releases = await listReleases(repository);

  summary('| App | Last release | Draft |');
  summary('| --- | --- | --- |');

  for (const result of results) {
    const plan = planDraft(result, releases);
    const fields = {
      tag_name: result.tag,
      name: result.tag,
      body: result.notes,
      target_commitish: values.target,
      draft: true,
      prerelease: false,
    };

    for (const release of plan.remove) {
      await request('DELETE', `/repos/${repository}/releases/${release.id}`);
    }

    if (plan.update) {
      await request('PATCH', `/repos/${repository}/releases/${plan.update.id}`, fields);
    } else if (plan.create) {
      await request('POST', `/repos/${repository}/releases`, fields);
    }

    const draft = result.version ? `\`${result.tag}\` (${result.bump})` : 'none (no release-worthy commits)';

    summary(`| ${result.app} | \`${result.lastTag}\` | ${draft} |`);
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
