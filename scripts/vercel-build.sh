#!/usr/bin/env bash
# Vercel build: generate the client, apply migrations, ensure reference data
# (and the first admin when ADMIN_* is set), optionally load the FICTITIOUS
# demo seed into an empty database, then build Next.js.
set -euo pipefail
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/bootstrap.ts
if [ "${DEMO_SEED:-}" = "1" ]; then
  pnpm exec tsx scripts/seed-demo.ts --if-empty
fi
pnpm exec next build
