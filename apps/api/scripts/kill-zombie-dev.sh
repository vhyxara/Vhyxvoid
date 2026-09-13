#!/bin/bash
# Runs automatically before `pnpm dev` (wired as the `predev` script in
# package.json). ts-node-dev --respawn is a supervisor/worker pair —
# stopping the dev server by killing only the port-9000 listener (e.g.
# `lsof -ti :9000 | xargs kill`) kills the worker but leaves the
# supervisor alive, which silently respawns a new worker and re-binds the
# port later. Left unchecked this accumulates one zombie supervisor per
# incompletely-stopped session (six were found accumulated in one past
# audit — see context.md risk #35 and LOCAL_DEV_BACKEND.md). Running this
# before every `pnpm dev` means a zombie never survives past the next
# start, regardless of how the previous instance was stopped.
#
# Matches on BOTH "Black-Server" (this repo's own directory name, so a
# ts-node-dev process from a different, unrelated project on the same
# machine is never touched) AND "ts-node-dev" (so this only ever touches
# ts-node-dev processes, never e.g. this repo's own apps/web Next.js dev
# server). Neither substring alone is precise enough — see decision.md,
# 2026-09-14, "Zombie ts-node-dev processes" for why.

PIDS=$(ps aux | grep "Black-Server" | grep "ts-node-dev" | grep -v grep | awk '{print $2}')

if [ -n "$PIDS" ]; then
  echo "⚠️  Found leftover ts-node-dev process(es) from a previous run — cleaning up before starting: $PIDS"
  echo "$PIDS" | xargs kill -9
else
  echo "✅ No leftover ts-node-dev processes found."
fi
