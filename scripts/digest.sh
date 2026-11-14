#!/usr/bin/env bash
# Writes two Markdown files:
#   updates.md  posts from links.htm published in the last 2 days
#   events.md   events from detroit-events.htm in the next 2 weeks
#
# Usage: scripts/digest.sh [output-dir]   (default: digest/)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/digest}"
mkdir -p "$OUT"

# Write to temp files first so a failed run doesn't leave a half-written digest.
tmp_updates="$(mktemp)"
tmp_events="$(mktemp)"
trap 'rm -f "$tmp_updates" "$tmp_events"' EXIT

echo "Fetching updates and events..."
node "$ROOT/scripts/list-updates.mjs" --days 2 --limit 50 >"$tmp_updates" &
updates_pid=$!
node "$ROOT/scripts/list-events.mjs" --days 14 --limit 50 >"$tmp_events" &
events_pid=$!

status=0
wait "$updates_pid" || { echo "list-updates.mjs failed" >&2; status=1; }
wait "$events_pid" || { echo "list-events.mjs failed" >&2; status=1; }
[ "$status" -eq 0 ] || exit "$status"

mv "$tmp_updates" "$OUT/updates.md"
mv "$tmp_events" "$OUT/events.md"

echo "Wrote $OUT/updates.md"
echo "Wrote $OUT/events.md"
