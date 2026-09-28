#!/usr/bin/env bash
# Starts the match server and web app against DATABASE_URL, then runs the
# server and browser smokes. Logs are kept in ./smoke-logs for artifacts.
set -euo pipefail
mkdir -p smoke-logs
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT
export CARDFORGE_ADMIN_TOKEN="${CARDFORGE_ADMIN_TOKEN:-ci-operator-token-0123456789abcdef0123}"
export CARDFORGE_ACTION_CLOCK_MS=60000
export CARDFORGE_AUTH_RATE_LIMIT=1000
export CARDFORGE_ROOM_MESSAGE_LIMIT=1000

(cd apps/match-server && exec env DISCORD_CLIENT_ID=stub DISCORD_CLIENT_SECRET=stub \
  CARDFORGE_DISCORD_API_BASE=http://127.0.0.1:2599/api \
  node dist/index.js > ../../smoke-logs/match-server.log 2>&1) &
pids+=($!)
scripts/ci/wait-for.sh http://127.0.0.1:2567/ready 60

(cd apps/web && exec env CARDFORGE_PUBLIC_API_URL=http://localhost:2567 CARDFORGE_ENVIRONMENT=ci \
  node node_modules/next/dist/bin/next start -p 3000 > ../../smoke-logs/web.log 2>&1) &
pids+=($!)
scripts/ci/wait-for.sh http://127.0.0.1:3000/healthz 60

pnpm --filter @cardforge/match-server smoke
pnpm --filter @cardforge/match-server smoke:journey
pnpm --filter @cardforge/match-server smoke:training
pnpm --filter @cardforge/match-server smoke:operations
pnpm --filter @cardforge/match-server smoke:discord
pnpm --filter @cardforge/web smoke:player
pnpm --filter @cardforge/web smoke
pnpm --filter @cardforge/web smoke:studio

if grep -q '"level":"critical"' smoke-logs/match-server.log; then
  echo "Critical log lines were emitted during smokes:" >&2
  grep '"level":"critical"' smoke-logs/match-server.log >&2
  exit 1
fi
