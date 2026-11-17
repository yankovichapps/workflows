# workflows

Shared GitHub Actions workflows for `yankovichapps` repositories. The release flow they
implement is described in
[org-infra: docs/release-flow.md](https://github.com/yankovichapps/org-infra/blob/main/docs/release-flow.md).

This repository is public on purpose: a reusable workflow checks out its own scripts at the
exact commit the caller pinned (`job.workflow_sha`), which needs no token for a public
repository. It contains no secrets and no project-specific values.

## Workflows

| Workflow                                                          | Status  | What it does                                                                  |
| ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| [`release-draft.yml`](.github/workflows/release-draft.yml)        | ready   | One draft release per app, `<app>@<next version>`, from conventional commits |
| `release-android.yml`                                             | planned | Version from the tag, `versionCode` = Play's highest + 1, build and upload    |
| `release-promote.yml`                                             | planned | Pre-release → release: promote the tested builds without rebuilding           |
| `ios-submit.yml`                                                  | planned | After the Xcode Cloud upload: TestFlight only, or submit for review           |
| `store-metadata.yml`                                              | planned | Texts and screenshots to the App Store and Google Play                        |

## Using it in a repository

1. Tag every app released through this flow with the Nx tag `release` in its `project.json`.
2. Tag the commit of each app's current release once, e.g.
   `git tag keep-an-eye@3.8.0 <sha> && git push origin keep-an-eye@3.8.0`.
3. Copy [`templates/release.yml`](templates/release.yml) to `.github/workflows/release.yml`
   and pin `<sha>` to a commit of this repository. Dependabot keeps the pin updated.

### How the next version is computed

- Commits since the app's last `<app>@x.y.z` tag that touch the app's folder or any project it
  depends on (Nx project graph).
- `feat` → minor, `fix` / `perf` → patch, `!` or a `BREAKING CHANGE:` footer → major. Other types
  appear in the notes under "Other changes" but do not cause a release.
- Without a release-worthy commit there is no draft, and a stale draft of the app is deleted.

### Expo apps

Expo apps commit `ios/` and `android/` and are released like any React Native app. Add the
`prebuild-check` target from
[`templates/expo/prebuild-check.project.json`](templates/expo/prebuild-check.project.json) and
the CI job from [`templates/expo/ci-prebuild-check.yml`](templates/expo/ci-prebuild-check.yml):
it re-applies the Expo config with `expo prebuild --no-install` (no `--clean`, so no
`pod install` and no macOS runner) and fails when the committed native folders change.

## Development

```bash
node --test                                                            # unit tests
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12   # lint workflows
```

`scripts/release/next-version.mjs` also runs locally inside a code repository:

```bash
pnpm exec nx graph --file=/tmp/graph.json
node <path>/next-version.mjs --apps '["keep-an-eye"]' --graph /tmp/graph.json \
  --head HEAD --repository yankovichapps/exercise-based
```
