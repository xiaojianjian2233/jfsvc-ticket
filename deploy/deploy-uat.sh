#!/usr/bin/env bash
# Build and deploy the frontend to UAT, then verify the complete public path.
#
# Usage:
#   deploy/deploy-uat.sh
#   UAT_HOST=rnd@106.55.57.40 deploy/deploy-uat.sh
#
# This script is intentionally UAT-specific. Do not reuse the SIT /hub-issue/
# base path here: UAT is mounted at /ticket-hub-uat/.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
UAT_HOST="${UAT_HOST:-rnd@106.55.57.40}"
UAT_BASE="/ticket-hub-uat/"
UAT_API_BASE="/ticket-hub-uat"
UAT_REMOTE_DIST="/data/ticket-hub-uat/frontend-dist"
UAT_PUBLIC_ORIGIN="${UAT_PUBLIC_ORIGIN:-http://127.0.0.1}"

expected_repo="https://github.com/xiaojianjian2233/jfsvc-ticket.git"
actual_repo="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
normalize_repo() {
  local url="${1%.git}"
  url="${url#https://github.com/}"
  url="${url#ssh://git@github.com/}"
  url="${url#git@github.com:}"
  printf '%s' "${url#github-ticket-hub:}"
}
if [[ "$(normalize_repo "$actual_repo")" != "xiaojianjian2233/jfsvc-ticket" ]]; then
  echo "❌ UAT deployment must run from the new repository" >&2
  echo "   expected: $expected_repo" >&2
  echo "   actual:   ${actual_repo:-<missing origin>}" >&2
  exit 1
fi

cd "$FRONTEND_DIR"
echo "==> installing frontend dependencies"
npm ci

echo "==> building frontend for UAT (${UAT_BASE})"
VITE_PUBLIC_BASE="$UAT_BASE" VITE_API_BASE="$UAT_API_BASE" npm run build

echo "==> validating generated asset paths"
if ! grep -q "${UAT_BASE}assets/" dist/index.html; then
  echo "❌ dist/index.html does not reference ${UAT_BASE}assets/" >&2
  exit 1
fi
if grep -Eq '(/hub-issue/|/ticket-hub-v2/)' dist/index.html; then
  echo "❌ dist/index.html contains a path from another environment" >&2
  exit 1
fi

echo "==> publishing dist -> ${UAT_HOST}:${UAT_REMOTE_DIST}/"
rsync -av --delete dist/ "${UAT_HOST}:${UAT_REMOTE_DIST}/"

echo "==> verifying UAT public routes"
ssh "$UAT_HOST" bash -s -- "$UAT_PUBLIC_ORIGIN" "$UAT_BASE" <<'REMOTE_CHECK'
set -euo pipefail
origin="$1"
base="$2"
root="${origin}${base}"

check_status() {
  local url="$1"
  local status
  status="$(curl --silent --show-error --location --output /dev/null --write-out '%{http_code}' "$url")"
  if [[ "$status" != "200" ]]; then
    echo "❌ $url returned HTTP $status" >&2
    exit 1
  fi
  echo "✅ $url -> $status"
}

check_asset() {
  local url="$1"
  local expected_type="$2"
  local headers
  local content_type
  headers="$(curl --silent --show-error --location --dump-header - --output /dev/null "$url")"
  content_type="$(printf '%s\n' "$headers" | sed -n 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//p' | tail -1 | tr -d '\r')"
  if [[ "$expected_type" == "javascript" ]]; then
    if [[ "$content_type" != application/javascript* && "$content_type" != text/javascript* ]]; then
      echo "❌ $url returned Content-Type '$content_type', expected JavaScript" >&2
      exit 1
    fi
  elif [[ "$content_type" != "$expected_type"* ]]; then
    echo "❌ $url returned Content-Type '$content_type', expected '$expected_type'" >&2
    exit 1
  fi
  echo "✅ $url -> 200 ($content_type)"
}

check_status "$root"
check_status "${origin}${base}health"

index="$(curl --silent --show-error --location "$root")"
assets="$(printf '%s' "$index" | grep -oE "${base}assets/[^\"']+\.(js|css)" | sort -u)"
if [[ -z "$assets" ]]; then
  echo "❌ no JS/CSS assets found in ${root}index.html" >&2
  exit 1
fi

while IFS= read -r asset; do
  [[ -z "$asset" ]] && continue
  if [[ "$asset" == *.js ]]; then
    check_asset "${origin}${asset}" "javascript"
  else
    check_asset "${origin}${asset}" "text/css"
  fi
done <<< "$assets"
REMOTE_CHECK

echo "✅ UAT frontend deployment and route verification completed"
