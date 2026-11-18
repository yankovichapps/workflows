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
| [`release-android.yml`](.github/workflows/release-android.yml)    | ready   | Pre-release → build for Play internal; release → promote the tested internal release to production, or build for production |
| [`ios-build.yml`](.github/workflows/ios-build.yml)                | ready   | Release published → push `release/<app>@<version>`, which starts Xcode Cloud |
| [`ios-submit.yml`](.github/workflows/ios-submit.yml)              | ready   | Release (after the Xcode Cloud upload, or on unticking pre-release) → submit the build for review |
| [`store-metadata.yml`](.github/workflows/store-metadata.yml)      | ready   | Manual: texts and screenshots to the App Store (into a version) and Google Play |

## Using it in a repository

1. Tag every app released through this flow with the Nx tag `release` in its `project.json`.
2. Tag the commit of each app's current release once, e.g.
   `git tag keep-an-eye@3.8.0 <sha> && git push origin keep-an-eye@3.8.0`.
3. Copy [`templates/release.yml`](templates/release.yml) to `.github/workflows/release.yml`
   and pin it to a release of this repository: `@<commit sha> # v1.0.0`. Dependabot's
   `github-actions` updates find the next release by that comment.

### What an app provides for `release-android`

| Item                         | Convention                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub environment `<app>`   | `GCP_PROJECT_ID`, `GCP_RELEASE_SERVICE_ACCOUNT`, `ANDROID_PACKAGE`, `SECRET_ANDROID_UPLOAD_KEYSTORE` (managed by `<repo>-infra`); repository variable `GCP_WORKLOAD_IDENTITY_PROVIDER` |
| Keystore secret              | JSON `{"keystore":"<base64>","storePassword","keyAlias","keyPassword"}` in Secret Manager           |
| fastlane                     | `apps/<app>/android`: lane `upload` with option `track`, building the release bundle and uploading it (the workflow sets `SUPPLY_VERSION_NAME` to the version, which names the Play release, so promotion can find it) |
| Gradle (`android/app/build.gradle`) | `versionCode`/`versionName` from the project properties of the same name (placeholders `1` / `0.0.0`); release signing from `ANDROID_UPLOAD_STORE_FILE`, `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` |
| Nx target `release-prepare`  | optional: generates gitignored sources the build needs; called with `--platform=android`           |

```gradle
defaultConfig {
    versionCode((findProperty("versionCode") ?: 1) as Integer)
    versionName(findProperty("versionName") ?: "0.0.0")
}
signingConfigs {
    release {
        if (project.hasProperty("ANDROID_UPLOAD_STORE_FILE")) {
            storeFile file(ANDROID_UPLOAD_STORE_FILE)
            storePassword ANDROID_UPLOAD_STORE_PASSWORD
            keyAlias ANDROID_UPLOAD_KEY_ALIAS
            keyPassword ANDROID_UPLOAD_KEY_PASSWORD
        }
    }
}
```

Both platforms promote the tested builds when you untick "pre-release" on a published
release: GitHub sends `released` for that and for a direct release alike, so each workflow asks
the store whether a tested build of the version is already there.

| Event                           | Android (`release-android`)                         | iOS (Xcode Cloud + `ios-submit`)                          |
| ------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| publish as pre-release          | build → internal                                    | push `release/<tag>` → Xcode Cloud → TestFlight; no submission |
| publish as release              | no internal release of the version → build → production | push `release/<tag>` → Xcode Cloud → TestFlight → dispatch → submit for review |
| untick pre-release              | internal release of the version → production (same AAB) | branch exists, no rebuild; newest build of the version → submit for review |

**Why a branch starts Xcode Cloud, not the tag:** publishing a draft makes GitHub create the
tag on the server, and Xcode Cloud never receives such a tag; it only sees refs that arrive
with a git push. `ios-build` pushes `release/<app>@<version>` with git, which always reaches
it. The branches stay as a record of what Xcode Cloud built.

### What an app provides for `ios-submit` and Xcode Cloud

| Item                         | Convention                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub environment `<app>`   | `GCP_PROJECT_ID`, `GCP_RELEASE_SERVICE_ACCOUNT`, `IOS_BUNDLE_ID`, `SECRET_APP_STORE_CONNECT_API_KEY` (JSON `{"keyId","issuerId","key":"<.p8 as base64>"}`) |
| fastlane                     | `apps/<app>/ios`: lane `submit` with options `version` and optional `build_number`. **With** `build_number` (Xcode Cloud dispatch, sent before the TestFlight upload): wait until that build appears and is processed, with a timeout, then submit. **Without** (release event): submit the newest build of the version, or do nothing when there is none yet, since the dispatch will submit it. Do nothing when the version is already submitted: both events can arrive |
| Info.plist                   | `CFBundleShortVersionString` `0.0.0`, `CFBundleVersion` `1` (in every target that has a version) |
| Xcode Cloud workflow         | start condition _Branch Changes_, prefix `release/<app>@`; archive + TestFlight distribution; variable `GITHUB_REPOSITORY`, secret `GITHUB_DISPATCH_TOKEN` (fine-grained, Contents: read & write on the repository) |
| Manual submission            | the caller's `workflow_dispatch` (tag, optional build number), e.g. when the dispatch failed |
| `ios/ci_scripts/`            | copy [`templates/xcode-cloud/`](templates/xcode-cloud/): `ci_post_clone.sh` writes the version from the release branch (or tag) and installs the toolchain; `ci_post_xcodebuild.sh` sends `ios-uploaded` |

### Store texts and screenshots (`store-metadata`)

Never part of a release. A caller with `workflow_dispatch` runs it by hand:

```yaml
on:
  workflow_dispatch:
    inputs:
      app: { description: 'App', required: true, default: <app> }
      platforms: { type: choice, options: [both, ios, android], default: both }
      ios-version: { description: 'App Store version (empty: newest release tag)', required: false }
jobs:
  metadata:
    permissions: { contents: read, id-token: write }
    uses: yankovichapps/workflows/.github/workflows/store-metadata.yml@<sha> # v1
    with:
      app: ${{ inputs.app }}
      platforms: ${{ inputs.platforms }}
      ios-version: ${{ inputs.ios-version }}
```

It runs the lanes `ios upload_metadata` (into the App Store version, created if needed; only
possible before the version is submitted for review) and `android upload_metadata`.

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

## Versioning

Releases of this repository are tags `vX.Y.Z` (GitHub Releases), created by an admin after
merging: patch for fixes, minor for new inputs or workflows, major for changes callers have to
adapt to. Callers pin the release's commit SHA with the tag as a comment, so Dependabot can
update them; a pin to a commit on `main` without a tag never gets updates.

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
