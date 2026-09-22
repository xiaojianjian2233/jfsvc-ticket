#!/usr/bin/env bash
# Build the frontend inside a throwaway node container (host needs no node)
# and publish the static dist to the nginx-served path.
#
# Usage: deploy/build-frontend.sh [OUT_DIR]
#   OUT_DIR defaults to /data/hub-issue/frontend-dist
#
# Base paths match the nginx /hub-issue/ mount (deploy/nginx/hub-issue.conf).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/data/hub-issue/frontend-dist}"

expected_repo="https://github.com/xiaojianjian2233/jfsvc-ticket.git"
actual_repo="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
normalize_repo() {
  local url="${1%.git}"
  url="${url#https://github.com/}"
  url="${url#ssh://git@github.com/}"
  url="${url#git@github.com:}"
  url="${url#github-ticket-hub:}"
  url="${url#git@github-xiaojianjian:}"
  printf '%s' "${url#github-xiaojianjian:}"
}
if [[ "$(normalize_repo "$actual_repo")" != "xiaojianjian2233/jfsvc-ticket" ]]; then
  echo "❌ SIT frontend build must run from the UAT repository" >&2
  echo "   expected: $expected_repo" >&2
  echo "   actual:   ${actual_repo:-<missing origin>}" >&2
  exit 1
fi

echo "==> building frontend (VITE_PUBLIC_BASE=/hub-issue/) ..."
docker run --rm \
  -v "$REPO_ROOT/frontend:/app" \
  -w /app \
  node:20-alpine sh -c '
    npm ci &&
    VITE_PUBLIC_BASE=/hub-issue/ VITE_API_BASE=/hub-issue npm run build
  '

echo "==> publishing dist -> $OUT"
mkdir -p "$OUT"
rm -rf "${OUT:?}"/*
cp -r "$REPO_ROOT/frontend/dist/." "$OUT/"
echo "==> done. reload nginx if the path is new: nginx -s reload"
