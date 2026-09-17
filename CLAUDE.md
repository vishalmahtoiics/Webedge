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

- **Current phase:** 3–4 are built to the limit of what works without a provider account, 6 is built up
  to the point where money moves, and 5 has its foundation — addresses, passwords and routing. Auth, RBAC, tenancy, provider credential storage, customer management, both
  dashboards and portals, DNS, the file manager over SFTP, SSL checking, the audit trail, GST/invoicing, and
  plans with the subscription lifecycle are done and tested. What remains needs the staging Hostinger
  account, Razorpay, or mail infrastructure.
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
- **Reading the trail is a separate service from writing it.** A failed write is a monitoring problem; a read
  that returns one row too many is a disclosure. Staff and customers get different methods, not one method
  with a flag — the same reasoning as two identity tables.
- **The security trail is its own endpoint, not a filter.** `admin.logs` covers what happened to a customer's
  resources; `admin.security_logs` covers who can get in and with what. A page that silently drops the rows a
  viewer lacks permission for looks complete when it is not, so a role without the second permission is told
  so rather than shown a short list. Which actions are security-sensitive is a rule over the action name, not
  a maintained list — a forgotten entry would quietly downgrade a credential change to ordinary activity.
- **A customer never sees a staff member's address in their trail.** Their own user is named; anyone else is
  "WebEdge support". A staff address identifies a named employee to an outside party and is a valid address
  to attack.
- **`ActivityLog` actor columns are deliberately not foreign keys.** With `onDelete: SetNull` the cascade is
  an UPDATE, which the trigger refuses, making accounts undeletable; and a nulled actor is an audit trail that
  forgets who acted. Plain ids plus an `actorEmail` snapshot keep rows immutable and readable after deletion.
- **Provider credentials use AES-256-GCM with a versioned key.** GCM authenticates, so tampered ciphertext
  fails loudly instead of yielding a corrupt token. The version allows rotation with overlap.
- **Renewal dates never use `Date.setMonth`.** It overflows rather than clamping: 31 Jan + 1 month is
  3 March, 31 Aug + 1 month is 1 October, and a leap-day yearly renewal lands on 1 March. Each is a billing
  error that compounds — the anniversary drifts forward at every cycle and the customer gets days nobody
  charged for. `billing-period.ts` clamps to the month's last day, and every renewal is measured from the
  subscription's anchor rather than from the previous renewal, so a date that clamped to 28 February returns
  to the 31st the next month instead of staying stuck.
- **Proration measures the current period, not the subscription's lifetime.** The period being left runs one
  cycle back from the next renewal. Prorating from `startsAt` would credit a long-standing customer for years
  they already used.
- **A plan is never deleted, only withdrawn.** Subscriptions and issued invoices both cite the plan that was
  sold. Withdrawing stops new sales and leaves existing customers on what they bought.
- **Cancelling a subscription ends it at the end of the paid period, not immediately.** The customer has paid
  through `renewsAt`; cutting service off on the day they cancel takes back time they own. Auto-renew goes
  off, `cancelledAt` is stamped, and the status stays ACTIVE until the period ends.
- **Mailbox passwords are hashed by WebEdge and verified by Dovecot.** argon2id, stored with Dovecot's
  `{ARGON2ID}` prefix, which its own scheme reads directly — checked against a real `doveadm pw -t` rather
  than assumed. No plaintext crosses a process boundary, so none can appear in a process listing or a shell
  history, and nothing in the codebase can recover a password.
- **Email local parts are narrower than RFC 5321 allows.** The RFC permits quoted local parts containing `/`
  and `..`, which become a directory traversal the moment the local part is part of a maildir path.
  `"../../etc"@example.com` is a legal address. Nobody has ever needed one, so they are refused at creation
  rather than handled correctly by every component downstream.
- **Local parts are compared case-insensitively.** The RFC says case *may* be significant; no mail system
  treats it as such. Preserving it would let `Asha@` and `asha@` exist as two mailboxes, splitting one
  person's mail or delivering it to the wrong one.
- **An alias loop is refused before it is written, not detected at delivery.** Postfix catches the cycle after
  accepting the message: the sender believes it was sent, nobody receives it, and the evidence is in a log
  nobody reads. A diamond — two branches reaching the same mailbox — is not a loop and is allowed.
- **A mailbox has no tenant of its own.** `Mailbox` and `MailAlias` carry no `customerId` — their tenant is
  the domain's — so every route is nested under a domain id and every method resolves that domain through
  `TenantScope` first. Lookups are on `(id, domainId)`, never on the id alone, so there is no window in which
  the wrong row has been read.
- **Plan limits are enforced at creation, and null is the only unlimited.** A plan with no stated limit does
  not fall back to a default number: "unlimited" and "one hundred" are different promises. A customer with no
  active subscription has an allowance of zero, not an unbounded one — treating an absent plan as unlimited
  is how a cancelled account keeps consuming. The count and the write are not in one transaction, so
  simultaneous requests can exceed a limit by the number of requests made at once; bounded, visible on the
  next check, and worth a locked row when a creation path matters more than a mailbox.
- **A mail domain must prove ownership before mail is accepted for it.** Otherwise one customer adds
  another's domain and starts receiving their mail. `postmaster`, `abuse` and the addresses a certificate
  authority accepts as proof of control are reserved and never handed to a customer.
- **Postfix and Dovecot read the same database the panel writes to, and re-check everything.** No sync job,
  no flat file to regenerate, no window where the two disagree. Every lookup query in `mail/` filters on
  `mail_domains.status = 'ACTIVE'` and on the row's own `isActive`, duplicating what the panel already
  refuses — because the panel is not what answers the connection on port 25. If a row ever reaches ACTIVE
  without proof of ownership, these queries are what still stands between it and a stranger's mail.
- **An issued invoice has no edit or delete route.** Both would break the serial sequence, and a gap in it
  is what an auditor asks about. Correction is void — which keeps the number — plus a credit note, which
  takes its own number from the same sequence and records the invoice it revises, per Rule 53(1A).
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
| `test/activity-read.spec.ts` | A customer's trail excludes internal rows, other tenants and staff identities; the two staff trails partition the table with nothing in both |
| `src/providers/credential-cipher.service.spec.ts` | Tampered ciphertext, tags and IVs are all rejected |
| `src/rbac/permissions.catalog.spec.ts` | No role is composed from another realm's keys |
| `test/sftp-file-transport.spec.ts` | A symlink inside the website cannot be used to read, write or delete outside it |

| `src/billing/gst.spec.ts` | Tax splits, rounding and credit notes reconcile exactly |
| `src/checks/ssrf-guard.spec.ts` | Outbound checks cannot be pointed at internal or metadata addresses |
| `test/invoice-numbering.spec.ts` | Concurrent invoices get distinct, consecutive numbers with no gaps, and a credit note is identifiable as one |
| `src/billing/billing-period.spec.ts` | Renewal dates clamp at month ends and never drift off the anniversary |
| `src/mail/mail-password.spec.ts` | A real `doveadm` accepts the hashes WebEdge writes, and rejects wrong or truncated passwords |
| `src/mail/mail-address.spec.ts` | Local parts that would traverse a maildir path are refused, and addresses compare case-insensitively |
| `src/mail/mail-routing.spec.ts` | An alias cycle is found before it is written, and a diamond is not mistaken for one |
| `test/mail-lookup-maps.spec.ts` | A real `postmap -q` refuses an unverified domain, a suspended one, and a switched-off mailbox or alias |
| `test/mail-tenancy.spec.ts` | A mailbox is unreachable except through a domain the caller owns, an unverified domain carries nothing, and the plan allowance is counted across every domain |
| `test/subscription-lifecycle.spec.ts` | Renewing keeps the anniversary, cancelling keeps the paid period, a plan change credits only the unused part, and the catalogue never names the upstream product |

Several suites run against real services rather than mocks, because they assert
things a mock cannot show — that a symlink resolves somewhere its textual path
does not reveal, that a database trigger refuses an UPDATE, that Dovecot accepts
a hash written here, that Postfix's own lookup refuses an unverified domain.
Bring them up with `sudo backend/test/start-test-services.sh`, which also
installs `dovecot-core` and `postfix-pgsql` for `doveadm` and `postmap`. The mailbox password suite
fails rather than skipping when it is missing: a green run that proved nothing is
worse than a visible gap.

Test files run one at a time (`fileParallelism: false`). Several of them assert
properties of a whole table against one real database — that the serial sequence
has no gaps, that the trail cannot be rewritten — and in parallel they see each
other's rows. That failure reads as a defect in the code rather than in the
setup, which is why it is closed off in config rather than worked around.

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

1. Foundation — auth, RBAC, tenancy
2. Provider integration — multiple Hostinger accounts, encrypted credentials, resource mapping
3. Hosting panel — dashboard, domains, websites, storage, DNS, file manager, editor
4. Advanced hosting — databases, SSL, backups, WordPress
5. WebEdge Mail — Postfix, Dovecot, mailboxes, quotas, IMAP/SMTP, webmail ← *panel, rules and lookup maps built; needs servers*
6. Business — plans, orders, Razorpay, invoices, renewals ← *current; everything but Razorpay*
7. Scale — multiple providers, queues, monitoring, migration tools

Each phase can only automate what the provider API actually exposes. Map every module against the current
official Hostinger documentation before building it, and test against the exact hosting product in use.
