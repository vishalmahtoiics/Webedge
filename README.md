# WebEdge Solution

White-label hosting control panel and WebEdge Mail platform. Customers manage hosting, domains, DNS, files,
databases and email through WebEdge, and never encounter the underlying provider.

**Status: Phase 1 (Foundation) — backend auth and RBAC working.**

---

## Layout

```
backend/     NestJS API, Prisma schema and migrations
frontend/    Next.js customer and admin portals       (Phase 1, not started)
workers/     Background jobs — sync, notifications     (Phase 2)
docker/      Compose stacks
nginx/       Reverse proxy and TLS                     (Phase 7)
docs/
```

## Running it

Postgres 16 and Redis, then the API:

```bash
docker compose -f docker/docker-compose.dev.yml up -d

cd backend
cp .env.example .env          # fill in the two generated secrets it asks for
npm install
npx prisma migrate deploy
npm run seed                  # prints the super-admin password once
npm run start:dev
```

The API listens on `http://localhost:4000/api/v1`.

```bash
npm run typecheck   # tsc over src and the seed script
npm test            # vitest
```

## What exists so far

| | |
|---|---|
| Data model | 15 tables covering identity, RBAC, provider accounts, resources, plans, audit |
| Sign-in | Separate customer and staff endpoints, Argon2id, lockout, no user enumeration |
| Sessions | Short-lived JWT access tokens; hashed refresh tokens with rotation and reuse detection |
| Authorization | 67-permission catalog, four seeded roles, deny-by-default route guard |
| Audit | Append-only activity log with secret redaction |

## Design decisions worth knowing

**Two identity realms, two tables.** `AdminUser` and `CustomerUser` are separate rather than one `users` table
with a role column. With a single table, a customer session authorizing a staff route is one forgotten `WHERE`
clause away; with two, it isn't expressible. Sign-in is likewise two endpoints, never one with a `realm`
parameter.

**Deny by default.** A route that declares neither `@Public` nor `@RequirePermissions` is refused at runtime,
and `test/route-authorization.e2e-spec.ts` walks the real router and fails the build for any such route. A
forgotten decorator becomes a visibly broken route in development rather than an open one in production.

**Permissions are read per request, not carried in the token.** Access tokens hold identity only, so revoking
a role or suspending an account takes effect immediately instead of lingering until the token expires.

**Refresh tokens rotate, and reuse revokes the family.** Tokens are random and stored only as SHA-256 hashes,
so a database read cannot mint a session. Presenting an already-rotated token means a replay or a theft, so
every token for that user is revoked.

**The audit log is append-only in the database, not just in the application.** Revoking `UPDATE`/`DELETE` from
the app role is not enough, because the migration role owns the table and an owner bypasses its own grants. A
trigger raises on any update or delete, so a compromised API cannot rewrite its own trail.

**Money is stored in paise**, as integers. Never floats.

**Provider identifiers are internal.** `providerResourceId` and `providerUsername` exist on `Website` but are
never serialized into a customer response.

## Security notes

- Provider API tokens stay server-side, encrypted with a versioned key so they can be rotated with overlap.
  They are never sent to the browser.
- Configuration is validated at boot; the API refuses to start with a missing or weak secret.
- `trust proxy` is set to exactly one hop. Without that, `X-Forwarded-For` is caller-controlled and per-IP
  rate limits can be bypassed by spoofing it.
- Cross-tenant reads return `RESOURCE_NOT_FOUND`, never `PERMISSION_DENIED` — a 403 confirms the resource
  exists and lets an attacker enumerate other customers' ids.

## Phases

1. **Foundation** — Next.js, NestJS, PostgreSQL, Prisma, auth, RBAC ← *in progress*
2. Provider integration — multiple Hostinger accounts, encrypted credentials, resource mapping
3. Hosting panel — dashboard, domains, websites, storage, DNS, file manager, editor
4. Advanced hosting — databases, SSL, backups, WordPress
5. WebEdge Mail — Postfix, Dovecot, mailbox provisioning, quotas, IMAP/SMTP, webmail
6. Business — plans, orders, Razorpay, invoices, renewals
7. Scale — multiple providers, queues, monitoring, migration tools

Each phase can only automate what the provider API actually exposes. Every module is mapped against the
current official Hostinger API documentation before it is built, and tested against the exact hosting product
in use.
