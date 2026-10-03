#!/usr/bin/env bash
# Vercel build: generate the client, apply migrations, ensure reference data
# (and the first admin when ADMIN_* is set), optionally load the FICTITIOUS
# demo seed into an empty database, then build Next.js.
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Connect a Postgres database (project → Storage → Neon), then redeploy." >&2
  exit 1
fi
if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  echo "BETTER_AUTH_SECRET is not set (Settings → Environment Variables)." >&2
  exit 1
fi
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/bootstrap.ts
if [ "${DEMO_SEED:-}" = "1" ]; then
  pnpm exec tsx scripts/seed-demo.ts --if-empty
fi
pnpm exec next build
