# SDAK Church Manager

Membership records system for the Seventh-day Adventist Church Kanyanya (Central Uganda Conference). It replaces the Church Clerk's Excel register and helps clerks complete and clean member records.

Design reference: [`design/SDAK Church Manager v2.dc.html`](design/) (screenshots: `design/screens-1a…1f.png`).

## Stack

Next.js 16 (App Router, server actions) · TypeScript · PostgreSQL + Prisma 7 · Better Auth (email + password, argon2id, TOTP 2FA) · Tailwind CSS 4 with design tokens · ExcelJS · Vitest + Playwright. Hosted on Vercel with Vercel Postgres.

## Getting started

```bash
pnpm install
cp .env.example .env              # set DATABASE_URL, BETTER_AUTH_SECRET, ADMIN_*
pnpm db:migrate                   # apply migrations (includes triggers, sequence, pg_trgm)
pnpm db:bootstrap                 # roles, permission matrix, controlled lists, first admin
pnpm dev
```

The first System Admin must set up two-step verification at first sign-in (also required for Church Clerks).

### Loading the clerk's register

The register contains personal data. Keep it in `data/` (git-ignored) and **never commit it**.

```bash
pnpm import:register data/register.xlsx --dry-run   # validate, write data/register.issues.csv
pnpm import:register data/register.xlsx             # commit
```

- Header row and columns are detected automatically (`Member ID`, `Last Name`, `First Name`, `Gender`, `Date of Birth`, `Year joined church`, `Physical Address`, `Contact`, `Email`, `Membership`, `Marital`, `Name of Wife/ Husband`, `Next of kin`, `Profession`, `Ministry`, `Role`).
- Member IDs from the register are kept (`SDAK/M0001`). Rows without an ID get a new number above every ID in the file.
- Values that don't match a controlled list (zones, ministries, roles, professions), invalid phones and unreadable dates are **not guessed**. They are stored for the Data clean-up queues. Known spellings ("Nil/Nill/Non", "Senior Cetizin", "Business Woman"…) map automatically. See `src/server/setup/reference-data.ts`.
- Ages such as "12yrs" become approximate birth years counted from the workbook's last-saved date (override with `--ages-as-of=YYYY-MM-DD`).
- Re-running is safe: members match by ID and only empty fields are filled, so corrections made in the app are never overwritten. Every row is logged with its source row number, and every change is in the audit log with source `IMPORT`.

### Demo data

`pnpm db:seed:demo` fills an **empty** database with ~1,050 fictitious members and one login per role (`admin@example.org`, `clerk@example.org`, … password `DEMO_PASSWORD`). Use it for demos and staging, never alongside real data.

## Tests

```bash
pnpm test:unit
pnpm test:integration    # needs TEST_DATABASE_URL (name must contain "test"; it is reset)
pnpm typecheck && pnpm lint
# End-to-end smoke tests (Playwright) against the demo seed:
pnpm build && pnpm test:e2e            # or E2E_BASE_URL=http://localhost:3001 pnpm test:e2e
```

## Deploying to Vercel

1. Create the project from this repo and add a Postgres database (Vercel Marketplace / Neon). `DATABASE_URL` should be the pooled URL.
2. Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the production URL), `SESSION_IDLE_MINUTES`, `RESEND_API_KEY`, `EMAIL_FROM`.
3. For member sign-in by SMS, set `AT_USERNAME`, `AT_API_KEY` and optionally `AT_SENDER_ID` (Africa's Talking). Without them, phone sign-in fails in production.
4. Run `pnpm db:migrate` and `pnpm db:bootstrap` once against the production database (from your machine with `DATABASE_URL` pointing at it), then import the register.

## Data rules

- **Photo in completeness**: Admin → Data rules → “Photo counts toward profile completeness” (setting `completeness.photoRequired`, default on, matching the design). Changing it is audited and immediately rescores every member.

## Reports

`/reports` has the Clerk's quarterly statistical report, membership by status, ministry rosters, zone lists and monthly birthday lists. Each one previews on screen, prints with clean A4 print styles, and downloads as PDF or Excel.

- PDFs are generated on the server with `pdf-lib`. It is pure JavaScript, so no headless browser is needed on Vercel.
- Downloads need `export:run` and an acknowledged privacy notice. Each download is written to `ExportLog` and the audit trail.
- Report rows use the same scoped, field-projected queries as the directory, and columns the viewer may not read are left out.
- Quarterly totals count members "on the books": Active, Irregular, Under discipline, or status not recorded. Gains and losses come from approved status changes.

## Member self-service

Members sign in at `/login/phone` with the phone number on their record and a 6-digit SMS code. There is no password.

- A login is created from the register the first time, and only when exactly one living member has that number. Shared family numbers need the clerk.
- The reply is the same whether or not the number is found.
- Before the record is shown, the member accepts the privacy notice. This is stored as a DPPA consent for the current policy version.
- At `/me` members see their own record and can ask for corrections. Clerks review the requests as a diff under **Self-service requests**. They approve all or some fields, or reject with a reason.
- Approved fields are written through the audited member service with source `self-service`.
- SMS goes through Africa's Talking (`AT_USERNAME`, `AT_API_KEY`, optional `AT_SENDER_ID`). In development the code is logged with the phone number masked.

## Offline use (PWA)

The app is installable: it has a manifest, icons and a service worker (`public/sw.js`).

- Pages a staff member has opened are kept on the device for up to 7 days and can be read offline. This covers the dashboard, members, member profiles and edit forms, ministries, families and `/me`. Other pages show an offline notice.
- Member edits made offline go to an IndexedDB outbox. The top bar shows how many are waiting, and they are sent when the connection returns.
- Each queued edit carries the record version it was based on. If someone else changed the member in the meantime, the server rejects the edit as a conflict instead of overwriting, and the user redoes it.
- Retries are applied only once (the client id is the audit correlation id).
- Signing out deletes the offline pages and any unsent edits from the device, after a warning if edits are still waiting.
- Limitation: the indicator follows the browser's online flag. A connection with no internet behind it still shows "Online", but pages fall back to the saved copy.

## Admin

Admin → Users, Roles & permissions (editable matrix with All / Own ministries / Own record scopes), Lists, Data rules, Security (sessions, per-role 2FA, failed sign-ins) and Audit log.

- Every change is audited.
- System Admin can't remove its own access-management permissions.
- The last active admin can't be removed.
- Two-step verification stays mandatory for Admin and Clerk.

## Security and privacy model

- **Permissions**: role × resource × action matrix in the database (`Permission`), with scope `ALL`, `MINISTRY` or `SELF`. Defaults: `src/server/authz/defaults.ts`.
- **Field-level restrictions** are enforced on the server. Marital status, spouse, next of kin and discipline data are never selected from the database for roles without `member.sensitive:read`. Ministry Heads only see members of their ministries. Treasurers see name, ID and ministry.
- **Audit log** is append-only. A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`. Every write goes through `AuditWriter` in the same transaction as the change.
- **Member IDs** are permanent. A trigger derives `SDAK/M####` from a sequence, blocks changes and blocks hard deletes (purge wipes personal data and keeps a tombstone).
- **Headers**: CSP, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, a permissions policy and HSTS in production (`next.config.ts`).
- **Auth**: argon2id passwords, TOTP 2FA (required for Admin and Clerk), 30-minute idle timeout, device list with revoke, database-backed rate limiting, password reset by email.
