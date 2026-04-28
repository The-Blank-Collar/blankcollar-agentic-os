#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — deploy.sh
# Pull, build, restart on the Hostinger VPS.
# Run from your laptop:  ./infra/scripts/deploy.sh user@host
# Or run from the VPS itself:  ./infra/scripts/deploy.sh local
# -----------------------------------------------------------------------------
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <user@host> | local" >&2
  exit 2
fi

TARGET="$1"

remote_cmd() {
  if [ "$TARGET" = "local" ]; then
    bash -lc "$1"
  else
    ssh -o ServerAliveInterval=30 "$TARGET" "$1"
  fi
}

# Sanity: prod compose file must exist.
remote_cmd 'test -f docker-compose.prod.yml || (echo "no docker-compose.prod.yml in cwd; cd into the repo first" && exit 1)'

remote_cmd 'git fetch origin main && git switch main && git pull --ff-only origin main'

remote_cmd 'docker compose -f docker-compose.yml -f docker-compose.prod.yml build'

remote_cmd 'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans'

remote_cmd './infra/scripts/doctor.sh'

echo
echo "✅ deploy complete."
