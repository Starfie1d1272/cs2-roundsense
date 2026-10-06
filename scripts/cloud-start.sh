#!/usr/bin/env bash
# Run once at the beginning of each cloud task, before making changes.
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
tools_dir=/workspace/.roundsense-tools
cd "$repo_dir"

if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Cloud sync stopped: preserve or commit local changes before pulling main." >&2
  exit 1
fi
# Keep the current task branch; refuse divergent history instead of resetting it.
git pull --ff-only origin main

export PATH="$tools_dir/node24/bin:$tools_dir/node_modules/.bin:$PATH"
export XDG_CACHE_HOME="$tools_dir/cache"
export XDG_DATA_HOME="$tools_dir/data"
export pnpm_config_store_dir="$tools_dir/pnpm-store"

expected_node="v$(cat .node-version)"
expected_pnpm="$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).packageManager.split("@")[1]')"
if [[ "$(node --version)" != "$expected_node" || "$(pnpm --version)" != "$expected_pnpm" ]]; then
  echo "Cloud toolchain differs from repository pins; run the saved environment install_script." >&2
  exit 1
fi

CI=true pnpm install --frozen-lockfile
echo "Cloud checkout synced and dependencies ready."
