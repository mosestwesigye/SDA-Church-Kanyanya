<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project rules (SDAK Church Manager)

- `data/` holds the real member register (personal data, Uganda DPPA 2019). Never commit it, print member names/phones in logs, or copy it into tests. Tests and demo use fictitious data only.
- All member writes go through `src/server/members/service.ts` (or another service using `AuditWriter` in the same transaction). Never write `Member` rows directly in app code.
- Read members with `memberScopeWhere(ctx)` + `memberSelect(ctx)` + `projectMember(ctx, row)` so scope and field restrictions are applied on the server.
- Checks: `pnpm typecheck && pnpm lint && pnpm test` (integration tests need `TEST_DATABASE_URL`).
