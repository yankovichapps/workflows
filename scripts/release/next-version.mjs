#!/usr/bin/env node
/**
 * Next release version per app, from the conventional commits since the app's
 * last `<app>@<semver>` tag.
 *
 * A commit counts for an app when it touches the app's folder or the folder of
 * any project the app depends on (Nx project graph). The result is printed as
 * JSON, one entry per app:
 *
 *   { app, lastTag, lastVersion, bump, version, tag, notes }
 *
 * `bump`, `version`, `tag` and `notes` are null when no commit since the last
 * tag requires a release.
 *
 * Usage:
 *   node next-version.mjs --apps '["keep-an-eye"]' --graph graph.json \
 *     --head <sha> --repository owner/repo
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const SUBJECT_PATTERN =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: (?<description>.+)$/i;
const BREAKING_FOOTER_PATTERN = /^BREAKING[ -]CHANGE: /m;

const BUMP_RANK = { major: 3, minor: 2, patch: 1 };
const BUMP_BY_TYPE = { feat: 'minor', fix: 'patch', perf: 'patch' };

const NOTE_SECTIONS = [
  { title: '⚠️ Breaking changes', matches: (commit) => commit.breaking },
  { title: '✨ Features', matches: (commit) => commit.type === 'feat' },
  { title: '🐛 Fixes', matches: (commit) => commit.type === 'fix' },
  { title: '⚡ Performance', matches: (commit) => commit.type === 'perf' },
];

/** `3.9.0` → `[3, 9, 0]`, or null when it is not a plain `x.y.z` version. */
export const parseVersion = (version) => {
  const match = SEMVER_PATTERN.exec(version);

  return match ? match.slice(1, 4).map(Number) : null;
};

export const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
};

/** The highest `<app>@x.y.z` tag, ignoring tags that are not plain versions. */
export const pickLatestTag = (app, tags) => {
  const prefix = `${app}@`;
  let latest = null;

  for (const tag of tags) {
    if (!tag.startsWith(prefix)) {
      continue;
    }

    const version = parseVersion(tag.slice(prefix.length));

    if (version && (!latest || compareVersions(version, latest.version) > 0)) {
      latest = { tag, version };
    }
  }

  return latest;
};

/** A conventional commit, or null for subjects that do not follow the format. */
export const parseCommit = ({ sha, subject, body = '' }) => {
  const match = SUBJECT_PATTERN.exec(subject.trim());

  if (!match) {
    return null;
  }

  const { type, scope, breaking, description } = match.groups;

  return {
    sha,
    type: type.toLowerCase(),
    scope: scope || null,
    description,
    breaking: Boolean(breaking) || BREAKING_FOOTER_PATTERN.test(body),
  };
};

/** The strongest bump the commits require, or null when none needs a release. */
export const requiredBump = (commits) => {
  let bump = null;

  for (const commit of commits) {
    const commitBump = commit.breaking ? 'major' : BUMP_BY_TYPE[commit.type];

    if (commitBump && (!bump || BUMP_RANK[commitBump] > BUMP_RANK[bump])) {
      bump = commitBump;
    }
  }

  return bump;
};

export const bumpVersion = ([major, minor, patch], bump) => {
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump: ${bump}`);
  }
};

/**
 * Folders of the app and of every project it depends on, directly or not.
 * Expects the output of `nx graph --file=graph.json`.
 */
export const dependencyRoots = (projectGraph, app) => {
  const { nodes, dependencies } = projectGraph.graph;

  if (!nodes[app]) {
    throw new Error(`Project "${app}" not found in the Nx project graph`);
  }

  const visited = new Set();
  const queue = [app];

  while (queue.length > 0) {
    const project = queue.shift();

    if (visited.has(project)) {
      continue;
    }

    visited.add(project);

    for (const { target } of dependencies[project] ?? []) {
      // External nodes (npm packages) are not part of `nodes`
      if (nodes[target] && !visited.has(target)) {
        queue.push(target);
      }
    }
  }

  return [...visited].map((project) => nodes[project].data.root).sort();
};

const formatCommit = (commit) => {
  const scope = commit.scope ? `**${commit.scope}:** ` : '';

  return `- ${scope}${commit.description} (${commit.sha.slice(0, 7)})`;
};

export const renderNotes = ({ commits, repository, fromTag, toSha }) => {
  const lines = [];
  const listed = new Set();

  for (const section of NOTE_SECTIONS) {
    const sectionCommits = commits.filter(
      (commit) => !listed.has(commit) && section.matches(commit),
    );

    if (sectionCommits.length > 0) {
      lines.push(`## ${section.title}`, '', ...sectionCommits.map(formatCommit), '');
      sectionCommits.forEach((commit) => listed.add(commit));
    }
  }

  const otherCommits = commits.filter((commit) => !listed.has(commit));

  if (otherCommits.length > 0) {
    lines.push(
      '<details>',
      '<summary>Other changes</summary>',
      '',
      ...otherCommits.map(formatCommit),
      '',
      '</details>',
      '',
    );
  }

  lines.push(
    `**Full changelog:** https://github.com/${repository}/compare/${fromTag}...${toSha}`,
  );

  return `${lines.join('\n')}\n`;
};

const git = (args) => execFileSync('git', args, { encoding: 'utf8' });

const readCommits = (fromTag, head, roots) => {
  // A root of "." means the project spans the whole repository
  const paths = roots.includes('.') ? [] : ['--', ...roots];
  const log = git([
    'log',
    '--no-merges',
    '--format=%H%x1f%s%x1f%b%x1e',
    `${fromTag}..${head}`,
    ...paths,
  ]);

  return log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split('\x1f');

      return { sha, subject, body };
    });
};

export const nextVersion = ({ app, projectGraph, head, repository, tags }) => {
  const latest = pickLatestTag(app, tags);

  if (!latest) {
    throw new Error(
      `No release tag "${app}@x.y.z" found. Tag the commit of the app's current ` +
        `release once, e.g. "git tag ${app}@1.0.0 <sha> && git push origin ${app}@1.0.0".`,
    );
  }

  const roots = dependencyRoots(projectGraph, app);
  const commits = readCommits(latest.tag, head, roots)
    .map(parseCommit)
    .filter(Boolean);
  const bump = requiredBump(commits);
  const result = {
    app,
    lastTag: latest.tag,
    lastVersion: latest.version.join('.'),
    bump,
    version: null,
    tag: null,
    notes: null,
  };

  if (!bump) {
    return result;
  }

  const version = bumpVersion(latest.version, bump);

  return {
    ...result,
    version,
    tag: `${app}@${version}`,
    notes: renderNotes({ commits, repository, fromTag: latest.tag, toSha: head }),
  };
};

const main = () => {
  const { values } = parseArgs({
    options: {
      apps: { type: 'string' },
      graph: { type: 'string' },
      head: { type: 'string' },
      repository: { type: 'string' },
    },
  });

  for (const option of ['apps', 'graph', 'head', 'repository']) {
    if (!values[option]) {
      throw new Error(`Missing --${option}`);
    }
  }

  const apps = JSON.parse(values.apps);
  const projectGraph = JSON.parse(readFileSync(values.graph, 'utf8'));
  const tags = git(['tag', '--list']).split('\n').filter(Boolean);
  const results = apps.map((app) =>
    nextVersion({
      app,
      projectGraph,
      head: values.head,
      repository: values.repository,
      tags,
    }),
  );

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
};

const isEntryPoint =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main();
}
