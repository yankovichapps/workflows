#!/bin/sh
# ==============================================================================
# Xcode Cloud: runs after xcodebuild. Copy to
# <app folder>/ios/ci_scripts/ci_post_xcodebuild.sh (executable), e.g.
# apps/<app>/ios/ci_scripts/.
#
# After a successful archive of a release tag `<app>@<version>`, notifies
# GitHub (repository_dispatch `ios-uploaded`), so the repository's Release
# workflow (shared ios-submit) submits the build for review, unless the
# release is a pre-release.
#
# Xcode Cloud workflow environment:
#   GITHUB_REPOSITORY      variable, e.g. yankovichapps/exercise-based
#   GITHUB_DISPATCH_TOKEN  secret: fine-grained token, Contents: read & write
#                          on that repository only
# ==============================================================================
set -eu

if [ "${CI_XCODEBUILD_ACTION:-}" != "archive" ] || [ "${CI_XCODEBUILD_EXIT_CODE:-1}" != "0" ]; then
  echo "Not a successful archive, skipping GitHub dispatch."
  exit 0
fi

# <app> is the Nx project name (= tag prefix = GitHub environment). It may
# differ from the folder (project pawpower-mobile in apps/mobile); a
# project.json without "name" is named after its folder. plutil reads JSON too.
APP_PATH="$(cd "$(dirname "$0")/../.." && pwd)"
APP_NAME="$(plutil -extract name raw -o - "${APP_PATH}/project.json" 2>/dev/null || basename "${APP_PATH}")"

case "${CI_TAG:-}" in
  "${APP_NAME}"@*) ;;
  *)
    echo "Not a release tag of ${APP_NAME}, skipping GitHub dispatch."
    exit 0
    ;;
esac

PAYLOAD=$(printf '{"event_type":"ios-uploaded","client_payload":{"tag":"%s","build_number":"%s"}}' \
  "${CI_TAG}" "${CI_BUILD_NUMBER}")

echo "Dispatching ios-uploaded for ${CI_TAG} (build ${CI_BUILD_NUMBER})..."

# A failed dispatch must not fail the build: the archive still goes to
# TestFlight, and a manual run of the Release workflow (tag, build number)
# submits it.
if ! curl --fail --silent --show-error --retry 3 \
  -X POST "https://api.github.com/repos/${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}/dispatches" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_DISPATCH_TOKEN:?GITHUB_DISPATCH_TOKEN is not set}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d "${PAYLOAD}"; then
  echo "warning: GitHub dispatch failed. Run the Release workflow manually (Actions > Release > Run workflow) with tag ${CI_TAG} and build number ${CI_BUILD_NUMBER}."
fi
