#!/bin/sh
# -----------------------------------------------------------------------------
# Container entrypoint.
#   1) Apply Prisma migrations (idempotent — safe to re-run on every boot).
#   2) Seed reference data (defaults + sample global policy). Disable by setting
#      RUN_SEED=false in environments that own their own seed lifecycle.
#   3) Hand off (exec) to the Node process so PID 1 stays signalable.
# -----------------------------------------------------------------------------
set -eu

echo "[entrypoint] prisma migrate deploy"
npx --no-install prisma migrate deploy

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] seeding database (RUN_SEED=true)"
  node dist/prisma/seed.js
else
  echo "[entrypoint] skipping seed (RUN_SEED=${RUN_SEED})"
fi

echo "[entrypoint] starting service"
exec node dist/src/index.js
