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
| [`release-draft.yml`](.github/workflows/release-draft.yml)        | ready   | One draft release per app, `<app>@<next version>`, from conventional commits, written by the release bot |
| [`release-android.yml`](.github/workflows/release-android.yml)    | ready   | Pre-release → build for Play internal; release → promote the tested internal release to production, or build for production; store texts from the tag either way |
| [`ios-submit.yml`](.github/workflows/ios-submit.yml)              | ready   | Release (after the Xcode Cloud upload, or on unticking pre-release) → submit the build for review with the store texts of the tag; pre-release → only the store texts, into the App Store version |
| [`store-screenshots.yml`](.github/workflows/store-screenshots.yml) | ready   | Manual: screenshots to the App Store (into a version) and Google Play           |

## Using it in a repository

1. Tag every app released through this flow with the Nx tag `release` in its `project.json`.
2. Tag the commit of each app's current release once, e.g.
   `git tag keep-an-eye@3.8.0 <sha> && git push origin keep-an-eye@3.8.0`.
3. Copy [`templates/release.yml`](templates/release.yml) to `.github/workflows/release.yml`
   and pin it to a release of this repository: `@<commit sha> # v1.0.0`. Dependabot's
   `github-actions` updates find the next release by that comment.

### App name and folder

The `<app>` in `<app>@<version>` is the app's **Nx project name**. The same name is used
for the GitHub environment and the Xcode Cloud tag prefix `<app>@`. The folder
can be named differently: the workflows and the Xcode Cloud scripts look up the
`project.json` whose `"name"` is the app, without installing anything
([`scripts/release/app-root.mjs`](scripts/release/app-root.mjs)).

| `project.json`                                           | Tags                    | Folder used        |
| -------------------------------------------------------- | ----------------------- | ------------------ |
| `apps/keep-an-eye/project.json`, `"name": "keep-an-eye"` | `keep-an-eye@3.9.0`     | `apps/keep-an-eye` |
| `apps/mobile/project.json`, `"name": "pawpower-mobile"`  | `pawpower-mobile@1.0.0` | `apps/mobile`      |
| `apps/<app>/project.json` without `"name"`               | `<app>@1.0.0`           | `apps/<app>`       |

Below, `apps/<app>` means the app's folder.

### What an app provides for `release-android`

| Item                         | Convention                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub environment `<app>`   | `GCP_PROJECT_ID`, `GCP_RELEASE_SERVICE_ACCOUNT`, `ANDROID_PACKAGE`, `SECRET_ANDROID_UPLOAD_KEYSTORE` (managed by `<repo>-infra`); repository variable `GCP_WORKLOAD_IDENTITY_PROVIDER` |
| Keystore secret              | JSON `{"keystore":"<base64>","storePassword","keyAlias","keyPassword"}` in Secret Manager           |
| fastlane                     | `apps/<app>/android`: lane `upload` with option `track`, building the release bundle and uploading it with the listing texts and release notes, without images (the workflow sets `SUPPLY_VERSION_NAME` to the version, which names the Play release, so promotion can find it); lane `upload_texts`, uploading only the listing texts (no bundle, release notes or images), run after a promotion |
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
| publish as pre-release          | build → internal                                    | Xcode Cloud builds the tag → TestFlight; no submission |
| publish as release              | no internal release of the version → build → production | Xcode Cloud builds the tag → TestFlight → dispatch → submit for review |
| untick pre-release              | internal release of the version → production (same AAB) | the tag is unchanged, no rebuild; newest build of the version → submit for review |

**Store texts come from the tag, on every path.** Titles, subtitles, descriptions, keywords and
release notes live in the app's `fastlane/metadata` and are uploaded by the release itself, so a
release always shows the texts committed at its tag:

| Event                  | Google Play                                                        | App Store                                                        |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| publish as pre-release | `upload`: texts + release notes with the internal build            | `upload_texts`: texts into the App Store version, not submitted  |
| publish as release     | `upload` (build) or `upload_texts` (after a promotion)             | `submit`: texts, then submit for review                          |
| untick pre-release     | `upload_texts` after the promotion; release notes stay the internal release's | `submit`: texts, then submit for review              |

The Google Play listing applies to every track, so texts uploaded with a pre-release are public
from then on. Screenshots are never part of a release: see `store-screenshots` below.

**Why the release bot writes the drafts:** publishing a draft makes GitHub create the tag on
the server. Xcode Cloud did not start on tags from drafts created by `github-actions[bot]`
(`keep-an-eye@3.9.0`, `3.11.0`), nor on a `release/<app>@<version>` branch pushed with
`GITHUB_TOKEN` (`ios-build`, v1.0.0–v1.1.0). Since v3.0.0 `release-draft` writes the drafts as
the org's release bot App, and Xcode Cloud starts on the published tag by itself
(`keep-an-eye@3.11.1`).

### What an app provides for `ios-submit` and Xcode Cloud

| Item                         | Convention                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub environment `<app>`   | `GCP_PROJECT_ID`, `GCP_RELEASE_SERVICE_ACCOUNT`, `IOS_BUNDLE_ID`, `SECRET_APP_STORE_CONNECT_API_KEY` (JSON `{"keyId","issuerId","key":"<.p8 as base64>"}`) |
| fastlane                     | `apps/<app>/ios`: lane `submit` with options `version` and optional `build_number`, uploading the store texts and submitting. **With** `build_number` (Xcode Cloud dispatch, sent before the TestFlight upload): wait until that build appears and is processed, with a timeout, then submit. **Without** (release event): submit the newest build of the version, or do nothing when there is none yet, since the dispatch will submit it. Do nothing when the version is already submitted: both events can arrive. Lane `upload_texts` with option `version`, for pre-releases: only the store texts into that App Store version (created if needed), no screenshots, no submission; do nothing when the version is already submitted |
| Info.plist                   | `CFBundleShortVersionString` `0.0.0`, `CFBundleVersion` `1` (in every target that has a version) |
| Xcode Cloud workflow         | start condition _Tag Changes_, prefix `<app>@`; archive + TestFlight distribution; variable `GITHUB_REPOSITORY`, secret `GITHUB_DISPATCH_TOKEN` (fine-grained, Contents: read & write on the repository) |
| Release bot (`release-draft`) | `yankovichapps-release-bot` installed on the repository; repository variables `GCP_SHARED_PROJECT_ID`, `GCP_RELEASE_BOT_SERVICE_ACCOUNT`, `SECRET_RELEASE_BOT_PRIVATE_KEY`, `RELEASE_BOT_CLIENT_ID` and `GCP_WORKLOAD_IDENTITY_PROVIDER` (managed by `<repo>-infra`, values from org-infra) |
| Manual submission            | the caller's `workflow_dispatch` (tag, optional build number), e.g. when the dispatch failed |
| `ios/ci_scripts/`            | copy [`templates/xcode-cloud/`](templates/xcode-cloud/): `ci_post_clone.sh` writes the version from the release tag and installs the toolchain; `ci_post_xcodebuild.sh` sends `ios-uploaded` |

### Store screenshots (`store-screenshots`)

Never part of a release; store texts are uploaded by the releases (see above). A caller with
`workflow_dispatch` runs it by hand:

```yaml
on:
  workflow_dispatch:
    inputs:
      app: { description: 'App', required: true, default: <app> }
      platforms: { type: choice, options: [both, ios, android], default: both }
      ios-version: { description: 'App Store version (empty: newest release tag)', required: false }
jobs:
  screenshots:
    permissions: { contents: read, id-token: write }
    uses: yankovichapps/workflows/.github/workflows/store-screenshots.yml@<sha> # v4.0.0
    with:
      app: ${{ inputs.app }}
      platforms: ${{ inputs.platforms }}
      ios-version: ${{ inputs.ios-version }}
```

It runs the lanes `ios upload_screenshots` (into the App Store version, created if needed; only
possible before the version is submitted for review, so run it before releasing) and
`android upload_screenshots` (screenshots and the other listing images; no texts or release
notes, which belong to a build).

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
