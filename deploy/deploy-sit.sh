#!/usr/bin/env bash
# Deploy the old repository to SIT. This script must be run from the old
# repository checkout; it deliberately refuses the new UAT repository.
#
# Usage:
#   deploy/deploy-sit.sh
#   SIT_HOST=root@43.139.250.182 deploy/deploy-sit.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIT_HOST="${SIT_HOST:-root@43.139.250.182}"
SIT_ROOT="/data/hub-issue"
SIT_BASE="/hub-issue/"
SIT_PUBLIC_ORIGIN="${SIT_PUBLIC_ORIGIN:-http://127.0.0.1}"

expected_repo="https://github.com/invagent/ticket-hub.git"
actual_repo="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
normalize_repo() {
  local url="${1%.git}"
  url="${url#https://github.com/}"
  url="${url#ssh://git@github.com/}"
  url="${url#git@github.com:}"
  printf '%s' "${url#github-ticket-hub:}"
}
if [[ "$(normalize_repo "$actual_repo")" != "invagent/ticket-hub" ]]; then
  echo "❌ SIT deployment must run from the old repository" >&2
  echo "   expected: $expected_repo" >&2
  echo "   actual:   ${actual_repo:-<missing origin>}" >&2
  exit 1
fi

echo "==> updating SIT checkout on ${SIT_HOST}"
ssh "$SIT_HOST" bash -s -- "$SIT_ROOT" <<'REMOTE_DEPLOY'
set -euo pipefail
sit_root="$1"
cd "$sit_root"
expected_repo="https://github.com/invagent/ticket-hub.git"
actual_repo="$(git remote get-url origin 2>/dev/null || true)"
normalize_repo() {
  local url="${1%.git}"
  url="${url#https://github.com/}"
  url="${url#ssh://git@github.com/}"
  url="${url#git@github.com:}"
  printf '%s' "${url#github-ticket-hub:}"
}
if [[ "$(normalize_repo "$actual_repo")" != "invagent/ticket-hub" ]]; then
  echo "❌ remote SIT checkout is not the old repository" >&2
  echo "   expected: $expected_repo" >&2
  echo "   actual:   ${actual_repo:-<missing origin>}" >&2
  exit 1
fi
git pull --ff-only origin main
docker compose -f deploy/docker-compose.sit.yml up -d --build
deploy/build-frontend.sh /data/hub-issue/frontend-dist
REMOTE_DEPLOY

echo "==> verifying SIT public routes"
ssh "$SIT_HOST" bash -s -- "$SIT_PUBLIC_ORIGIN" "$SIT_BASE" <<'REMOTE_CHECK'
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

echo "✅ SIT deployment and route verification completed"
