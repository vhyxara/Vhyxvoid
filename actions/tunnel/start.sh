#!/usr/bin/env bash
# Starts @vhyxvoid/agent in the background for the rest of the job and
# exposes its public URL as the step output `url` and env VHYXVOID_URL.
set -euo pipefail

label="${INPUT_LABEL:-}"
if [ -z "$label" ]; then
  if [ -n "${PR_NUMBER:-}" ]; then label="pr-${PR_NUMBER}"; else label="ci-${RUN_ID}"; fi
fi
label="$(echo "$label" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\n' '-' | sed 's/^-*//; s/-*$//' | cut -c1-40)"
[ -n "$label" ] || { echo "::error::Tunnel label is empty after cleaning"; exit 1; }

if [ -z "${VHYXVOID_API_KEY:-}" ] || [ -z "${VHYXVOID_SECRET:-}" ]; then
  echo "::error::api-key and secret are required (store them as repository secrets)"
  exit 1
fi
echo "::add-mask::${VHYXVOID_SECRET}"

dir="${RUNNER_TEMP:-/tmp}/vhyxvoid-${label}"
mkdir -p "$dir"
envfile="$dir/url.env"
log="$dir/agent.log"
: > "$envfile"

# Wait for the app, so the first requests through the tunnel don't fail.
wait_app="${INPUT_WAIT_FOR_APP:-60}"
if [ "$wait_app" != "0" ]; then
  for ((i = 0; i < wait_app; i++)); do
    if (exec 3<>"/dev/tcp/127.0.0.1/${VHYXVOID_PORT}") 2>/dev/null; then break; fi
    sleep 1
  done
  if ! (exec 3<>"/dev/tcp/127.0.0.1/${VHYXVOID_PORT}") 2>/dev/null; then
    echo "::warning::Nothing is listening on port ${VHYXVOID_PORT} yet; starting the tunnel anyway"
  fi
fi

export VHYXVOID_LABEL="$label"
nohup npx -y "@vhyxvoid/agent@${INPUT_AGENT_VERSION:-latest}" start \
  --label "$label" --no-local-discovery \
  --write-env "$envfile" --env-key VHYXVOID_URL >"$log" 2>&1 &
pid=$!
echo "$pid" > "$dir/agent.pid"

url=""
for ((i = 0; i < ${INPUT_TIMEOUT:-60}; i++)); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "::error::The agent stopped before the tunnel was up:"
    sed 's/^/    /' "$log"
    exit 1
  fi
  url="$(grep -m1 '^VHYXVOID_URL=' "$envfile" 2>/dev/null | cut -d= -f2- || true)"
  [ -n "$url" ] && break
  sleep 1
done

if [ -z "$url" ]; then
  echo "::error::No tunnel URL after ${INPUT_TIMEOUT:-60}s. Agent output:"
  sed 's/^/    /' "$log"
  exit 1
fi

echo "Tunnel ${label} is live: ${url}"
echo "url=${url}" >> "$GITHUB_OUTPUT"
echo "label=${label}" >> "$GITHUB_OUTPUT"
echo "VHYXVOID_URL=${url}" >> "$GITHUB_ENV"
{
  echo "### Tunnel"
  echo ""
  echo "**${url}** → localhost:${VHYXVOID_PORT} (label \`${label}\`)"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
