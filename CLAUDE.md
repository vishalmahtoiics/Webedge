# CLAUDE.md

Working rules for this repository.

> These are conventions derived from the technical blueprint plus decisions made while building. If the owner
> wants a rule that overrides the blueprint, add it under "Owner overrides" so its provenance is unambiguous.

## Owner overrides

*(none yet)*

---

## Project

WebEdge Solution — a white-label hosting control panel and mail platform. Customers manage hosting, domains,
DNS, files, databases and email through WebEdge and never encounter the underlying provider.

- **Current phase:** 3–4 are built to the limit of what works without a provider account. Auth, RBAC, tenancy,
  provider credential storage, customer management, dashboard, DNS, the file manager over SFTP, SSL checking
  and GST/invoicing are all done and tested. What remains needs the staging Hostinger account, Razorpay, or
  mail infrastructure.
- **Stack:** NestJS + Prisma + PostgreSQL (backend), Next.js (frontend), Redis + BullMQ (queues).

## Running it

```bash
docker compose -f docker/docker-compose.dev.yml up -d
cd backend && npm install && npx prisma migrate deploy && npm run seed && npm run start:dev
cd frontend && npm install && npm run dev
```

`npm test` in `backend/` needs a live migrated database — the isolation and audit tests run against real
Postgres on purpose, because they assert database-level behaviour that mocks cannot show.

## Non-negotiables

Easy to breach by accident, and each is acceptance-blocking.

- **No brand leaks.** The provider's name must not appear in UI copy, API responses, browser bundles, emails,
  invoices, error messages or logs. `providerResourceId` and `providerUsername` exist on `Website` but are
  never serialized to a customer.
- **No invented data.** A metric with no real source shows "Not available", never a placeholder number or a
  fabricated list. This matters most for backups, storage and security signals, where the provider often has
  nothing.
- **Tenant scope comes from the session.** Customer-owned data goes through `TenantScope`, which takes the
  principal and never a `customerId` from the request. Cross-tenant reads return `RESOURCE_NOT_FOUND`, never
  `PERMISSION_DENIED` — a 403 confirms the id exists and turns ids into an enumeration oracle.
- **Deny by default.** Every route declares `@Public` or `@RequirePermissions`; anything else is refused, and
  a test walks the router to enforce it.
- **Secrets never enter the repo or a chat.** Provider tokens, Razorpay keys and SFTP passwords live in `.env`
  or Docker secrets. `.env.example` documents names only.
- **No writes to real provider resources outside production** unless the resource name starts with `wetest-`
  or the account is flagged staging. There is no provider sandbox — every call touches a real account.

## Architecture rules

- UI components never call the API directly; requests go through `lib/api.ts` server-side, so tokens stay in
  httpOnly cookies and out of browser JavaScript.
- Controllers do guards, validation and response mapping. Services hold business rules and audit logging.
- Provider adapters are the only code that knows provider-specific details.
- Page loads read local state. Never fan out into live provider calls on page load.
- Every list endpoint is paginated with an enforced maximum.
- Money is stored in paise as integers. Never floats.

## Decisions already made, and why

Changing these needs a reason, not a preference.

- **Two identity tables, not one `users` table.** With a single table, a customer session authorizing a staff
  route is one forgotten `WHERE` clause away. Sign-in is two endpoints, never one taking a `realm` parameter.
- **Permissions are read per request, not carried in the access token.** Costs a query; buys immediate
  revocation when a role changes or an account is suspended.
- **Refresh tokens are random and stored hashed, and rotate on use.** Replaying a rotated token revokes the
  whole family. So never refresh concurrently for one session — `apiAuthed` is the single call site.
- **`activity_logs` is append-only via a database trigger**, not just revoked grants: the migration role owns
  the table and an owner bypasses its own grants.
- **`ActivityLog` actor columns are deliberately not foreign keys.** With `onDelete: SetNull` the cascade is
  an UPDATE, which the trigger refuses, making accounts undeletable; and a nulled actor is an audit trail that
  forgets who acted. Plain ids plus an `actorEmail` snapshot keep rows immutable and readable after deletion.
- **Provider credentials use AES-256-GCM with a versioned key.** GCM authenticates, so tampered ciphertext
  fails loudly instead of yielding a corrupt token. The version allows rotation with overlap.
- **GST is computed in integer paise, per line, and rounded half away from zero.** Floats lose paise; taxing
  the invoice total diverges from taxing lines the moment rates differ; and `Math.round` turns -0.5 into -0,
  so a credit note would not exactly reverse its invoice.

> **`src/billing/gst.ts` has not been reviewed by a Chartered Accountant.** The rules in it are read from the
> CGST and IGST Acts and are tested thoroughly against that reading, which is not the same as being correct.
> It must be reviewed before it bills anyone, and the tests are the artefact to hand the reviewer.

## Testing

Tests assert behaviour that would be a security incident if it broke, not line coverage. The ones that matter:

| | |
|---|---|
| `test/tenant-isolation.spec.ts` | Customer A cannot reach Customer B by any path, and a foreign id is indistinguishable from a missing one |
| `test/route-authorization.e2e-spec.ts` | Walks the real router; fails the build on any route without a permission declaration |
| `test/activity-log-durability.spec.ts` | The trail survives account deletion, redacts secrets, and cannot be rewritten |
| `src/providers/credential-cipher.service.spec.ts` | Tampered ciphertext, tags and IVs are all rejected |
| `src/rbac/permissions.catalog.spec.ts` | No role is composed from another realm's keys |
| `test/sftp-file-transport.spec.ts` | A symlink inside the website cannot be used to read, write or delete outside it |

| `src/billing/gst.spec.ts` | Tax splits, rounding and credit notes reconcile exactly |
| `src/checks/ssrf-guard.spec.ts` | Outbound checks cannot be pointed at internal or metadata addresses |
| `test/invoice-numbering.spec.ts` | Concurrent invoices get distinct, consecutive numbers with no gaps |

Several suites run against real services rather than mocks, because they assert
things a mock cannot show — that a symlink resolves somewhere its textual path
does not reveal, that a database trigger refuses an UPDATE. Bring them up with
`sudo backend/test/start-test-services.sh`.

When you fix a bug, prefer a test that catches the whole class over one that catches the instance. The
`SUPPORT_STAFF` cross-realm bug is the example: the fix was a rule, not a corrected list.

A concurrency test that passes proves nothing until you have seen it fail. The invoice numbering test was
checked by swapping the atomic allocator for a naive read-then-write one, which produced 30 missing serials —
do the same before trusting any test that claims to prove a race is handled.

## When the blueprint is wrong

It sometimes is, because it was written before the provider's API was verified. When it conflicts with
observed behaviour:

1. Do not implement it as written, and do not simulate the missing data.
2. Record the conflict with evidence.
3. Raise it with options and a recommendation.
4. Let the owner decide.

## Phases

1. Foundation — auth, RBAC, tenancy ← *current*
2. Provider integration — multiple Hostinger accounts, encrypted credentials, resource mapping
3. Hosting panel — dashboard, domains, websites, storage, DNS, file manager, editor
4. Advanced hosting — databases, SSL, backups, WordPress
5. WebEdge Mail — Postfix, Dovecot, mailboxes, quotas, IMAP/SMTP, webmail
6. Business — plans, orders, Razorpay, invoices, renewals
7. Scale — multiple providers, queues, monitoring, migration tools

Each phase can only automate what the provider API actually exposes. Map every module against the current
official Hostinger documentation before building it, and test against the exact hosting product in use.
