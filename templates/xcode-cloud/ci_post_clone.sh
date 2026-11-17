#!/bin/sh
# ==============================================================================
# Xcode Cloud: runs after the repository is cloned, before xcodebuild.
# Copy to apps/<app>/ios/ci_scripts/ci_post_clone.sh (executable).
#
# 1. Release version: when Xcode Cloud builds a release tag `<app>@<version>`,
#    writes <version> into every Info.plist of the app whose
#    CFBundleShortVersionString is the placeholder 0.0.0. Any other start
#    (branch, pull request) keeps 0.0.0. The build number is Xcode Cloud's.
# 2. Toolchain for a React Native app: node + pnpm workspace, the optional
#    Nx target `<app>:release-prepare`, CocoaPods from the app's Gemfile.
# ==============================================================================
set -eu

NODE_FORMULA="node@24"
# apps/<app>/ios/ci_scripts -> apps/<app>/ios
APP_IOS_PATH="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="$(dirname "${APP_IOS_PATH}")"
# apps/<app> -> <app> (= Nx project name)
APP_NAME="$(basename "${APP_PATH}")"

# --- 1. Release version -------------------------------------------------------
if [ -n "${CI_TAG:-}" ]; then
  VERSION="${CI_TAG#"${APP_NAME}"@}"
  if [ "${VERSION}" = "${CI_TAG}" ] || ! echo "${VERSION}" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
    echo "error: ${CI_TAG} is not a release tag of ${APP_NAME} (${APP_NAME}@<major>.<minor>.<patch>)"
    exit 1
  fi

  UPDATED=0
  PLISTS="$(mktemp)"
  find "${APP_IOS_PATH}" -name Info.plist -not -path "*/Pods/*" -not -path "*/build/*" > "${PLISTS}"
  while IFS= read -r PLIST; do
    CURRENT="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "${PLIST}" 2>/dev/null || true)"
    if [ "${CURRENT}" = "0.0.0" ]; then
      /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" "${PLIST}"
      echo "Version ${VERSION}: ${PLIST#"${APP_IOS_PATH}"/}"
      UPDATED=$((UPDATED + 1))
    fi
  done < "${PLISTS}"
  rm -f "${PLISTS}"

  if [ "${UPDATED}" -eq 0 ]; then
    echo "error: no Info.plist with the placeholder CFBundleShortVersionString 0.0.0 in ${APP_IOS_PATH}"
    exit 1
  fi
else
  echo "Not a tag build: the version stays 0.0.0."
fi

# --- 2. Toolchain -------------------------------------------------------------
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Git hooks are irrelevant on CI
export HUSKY=0

# The system Ruby is too old for current Gemfiles, so a Homebrew Ruby runs Bundler
echo "Installing ${NODE_FORMULA} and Ruby..."
brew install "${NODE_FORMULA}" ruby
NODE_BIN_DIR="$(brew --prefix "${NODE_FORMULA}")/bin"
RUBY_BIN_DIR="$(brew --prefix ruby)/bin"
export PATH="${NODE_BIN_DIR}:${RUBY_BIN_DIR}:${PATH}"

echo "Installing workspace dependencies with the pinned pnpm version..."
cd "${CI_PRIMARY_REPOSITORY_PATH}"
corepack enable pnpm
pnpm install --frozen-lockfile

if NX_DAEMON=false pnpm exec nx show project "${APP_NAME}" --json | grep -q '"release-prepare"'; then
  echo "Preparing ${APP_NAME} (release-prepare)..."
  NX_DAEMON=false pnpm exec nx run "${APP_NAME}:release-prepare" --platform=ios
fi

echo "Installing gems (CocoaPods pinned by the app's Gemfile)..."
cd "${APP_PATH}"
bundle config set --local path vendor/bundle
bundle install

echo "Installing pods..."
cd "${APP_IOS_PATH}"
# Xcode build phases source this file to locate node (keg-only Homebrew formula)
echo "export NODE_BINARY=${NODE_BIN_DIR}/node" > .xcode.env.local
bundle exec pod install
