#!/usr/bin/env bash
# Usage: wait-for.sh URL [seconds]
set -euo pipefail
url="$1"; timeout="${2:-60}"
for _ in $(seq 1 "$((timeout * 2))"); do
  if curl -sf "$url" >/dev/null; then exit 0; fi
  sleep 0.5
done
echo "Timed out waiting for $url" >&2
exit 1
