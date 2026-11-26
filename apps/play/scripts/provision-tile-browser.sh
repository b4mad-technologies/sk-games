#!/usr/bin/env bash
# Downloads and all browser state belong to this job, including on legacy Triton.
set -euo pipefail
: "${RUNNER_TEMP:?RUNNER_TEMP must name a job-owned directory}"
: "${AGENT_BROWSER_VERSION:?AGENT_BROWSER_VERSION must be pinned}"
root="$(mktemp -d "${RUNNER_TEMP}/tile-browser.XXXXXX")"
export HOME="${root}/home" XDG_CACHE_HOME="${root}/cache"
export NPM_CONFIG_PREFIX="${root}/npm" NPM_CONFIG_CACHE="${root}/npm-cache"
export AGENT_BROWSER_EXECUTABLE_PATH="${root}/chrome-linux64/chrome"
mkdir -p "$HOME" "$XDG_CACHE_HOME" "${NPM_CONFIG_PREFIX}/bin"
export TMPDIR="${root}/tmp" AGENT_BROWSER_SOCKET_DIR="${root}/sockets"
mkdir -p "$TMPDIR" "$AGENT_BROWSER_SOCKET_DIR"
export PATH="${NPM_CONFIG_PREFIX}/bin:$PATH"
printf '%s\n' "${NPM_CONFIG_PREFIX}/bin" >> "$GITHUB_PATH"
for name in HOME XDG_CACHE_HOME NPM_CONFIG_PREFIX NPM_CONFIG_CACHE AGENT_BROWSER_EXECUTABLE_PATH TMPDIR AGENT_BROWSER_SOCKET_DIR; do
  printf '%s=%s\n' "$name" "${!name}" >> "$GITHUB_ENV"
done
npm install -g --allow-scripts=agent-browser "agent-browser@${AGENT_BROWSER_VERSION}"
# This read-only probe skips sudo on provisioned images. Only legacy Triton
# installs missing libraries; no apt configuration or persistent caches are used.
deps="$(dirname "${BASH_SOURCE[0]}")/../../../scripts/ci/runners/toolchain/browser-deps.sh"
if ! bash "$deps" --check; then
  sudo bash "$deps" --install
fi
# agent-browser install resolves moving Stable; use a reviewed Chrome pin instead.
chrome_version=156.0.8078.47
chrome_sha256=e6c94490f0b6b337225aeb2d2a5034858516b7017356980ba94f5176d8774a50
curl -fL --retry 3 "https://storage.googleapis.com/chrome-for-testing-public/${chrome_version}/linux64/chrome-linux64.zip" -o "${root}/chrome.zip"
printf '%s  %s\n' "$chrome_sha256" "${root}/chrome.zip" | sha256sum -c -
unzip -q "${root}/chrome.zip" -d "$root"
rm "${root}/chrome.zip"
"$AGENT_BROWSER_EXECUTABLE_PATH" --version
