#!/bin/sh
# Bundle and publish a Wrangler project to the fleet bucket, then ask the node
# to adopt it now instead of waiting for its next deploy/current.json poll.
#   deploy.sh [PROJECT_DIR]   (default /app)
# Env: CELLD_BUCKET, S3_ENDPOINT, AWS_REGION, AWS_ACCESS_KEY_ID,
#      AWS_SECRET_ACCESS_KEY, optional CELLD_RELOAD_URL.
set -eu

project="${1:-/app}"
: "${CELLD_BUCKET:?CELLD_BUCKET is not set}"
: "${S3_ENDPOINT:?S3_ENDPOINT is not set}"

echo "deploy: $(celld --version) -> ${CELLD_BUCKET}"
celld deploy "$project"

if [ -z "${CELLD_RELOAD_URL:-}" ]; then
  echo "deploy: published; nodes adopt it within CELLD_DEPLOY_POLL_S"
  exit 0
fi

out="$(mktemp)"
if ! code="$(curl -sS -o "$out" -w '%{http_code}' -X POST --max-time 180 "$CELLD_RELOAD_URL")"; then
  echo "deploy: published, but the reload request failed; nodes adopt it within CELLD_DEPLOY_POLL_S" >&2
  exit 0
fi
cat "$out"; echo
case "$code" in
  2??) grep -q '"ok":true' "$out" || { echo "deploy: node did not adopt the deployment" >&2; exit 1; } ;;
  *) echo "deploy: reload returned HTTP $code; the previous deployment keeps serving" >&2; exit 1 ;;
esac
echo "deploy: adopted"
