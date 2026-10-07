#!/usr/bin/env bash
# Runs `vhyxvoid spec check|push` for the action. The step itself never fails,
# so the comment step can run; the last step exits with the saved code.
set -uo pipefail

if [ -n "${INPUT_AGENT_PACKAGE:-}" ]; then
  pkg="$INPUT_AGENT_PACKAGE"
  case "$pkg" in /*|http*|@*) ;; *) [ -e "$pkg" ] && pkg="$(cd "$(dirname "$pkg")" && pwd)/$(basename "$pkg")" ;; esac
else
  pkg="@vhyxvoid/agent@${INPUT_AGENT_VERSION:-latest}"
fi

summary="${RUNNER_TEMP:-/tmp}/vhyxvoid-spec-$$.md"
log="${RUNNER_TEMP:-/tmp}/vhyxvoid-spec-$$.log"

if [ "${INPUT_MODE:-check}" = "push" ]; then
  args=(spec push "$INPUT_FILE" --spec "$INPUT_SPEC" --publish)
  [ "${INPUT_ALLOW_BREAKING:-false}" = "true" ] && args+=(--allow-breaking)
  [ -n "${INPUT_NOTES:-}" ] && args+=(--notes "$(printf '%s' "$INPUT_NOTES" | head -c 1900)")
else
  args=(spec check "$INPUT_FILE" --spec "$INPUT_SPEC" --fail-on "${INPUT_FAIL_ON:-breaking}" --markdown "$summary")
fi

npx -y --package="$pkg" vhyxvoid "${args[@]}" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}

breaking=$(grep -oE '[0-9]+ breaking' "$log" | head -1 | grep -oE '^[0-9]+' || true)
{
  echo "exit-code=$code"
  echo "breaking=${breaking:-0}"
  echo "result=$([ "$code" = 0 ] && echo passed || echo failed)"
  [ -s "$summary" ] && echo "summary-file=$summary"
} >> "$GITHUB_OUTPUT"
exit 0
