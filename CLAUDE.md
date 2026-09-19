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

## Installing it

`npm run install:wizard` in `backend/` runs the first-run setup wizard: environment checks, database
connection, generated keys, migrations, seed, administrator, then it locks itself. See `INSTALL.md`.

## Running it

```bash
docker compose -f docker/docker-compose.dev.yml up -d
cd backend && npm install && npx prisma migrate deploy && npm run seed && npm run start:dev
cd frontend && npm install && npm run dev
```

`npm test` in `backend/` needs a live migrated database — the isolation and audit tests run against real
Postgres on purpose, because they assert database-level behaviour that mocks cannot show.

## Deploying it

See `DEPLOY.md`. The repository root deploys as **one** application: `scripts/start.mjs`
runs migrations, starts the API on loopback and publishes only the portal, so no request
is cross-origin and `CLIENT_ORIGIN`, `ADMIN_ORIGIN` and `API_BASE_URL` have nothing to get
wrong. Deploying `backend/` and `frontend/` separately still works and is documented, but
it needs four settings to agree across two resources, and each way of getting them wrong
fails silently — a domain answering 404, or a page that loads and cannot sign in.

`backend/` alone uses `npm run start:container` (migrations, then `dist/main.js`). Never
`npm start` as a container entry point there: it clears `dist` and recompiles, discarding
the image's build on every restart.

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
  whole family, so a session must never refresh concurrently. One call site is not enough on its own: a page
  rendering two `apiAuthed` calls in parallel reaches the refresh twice with the same stored token, and the
  second replays what the first just rotated. Five pages did exactly that. The rotation is wrapped in React's
  `cache`, which dedupes **per request** — request scope is the essential part, because a module-level
  promise is shared across every user the process serves and would hand one person's new token to another.
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
- **The renewal sweep invoices before it advances the date, and the database is its queue.** Nothing renewed
  anything until the worker existed: `renewsAt` was a date no code read, so a subscription passed it, no
  invoice was raised, service continued, and a cancelled customer kept their hosting indefinitely. The order
  is the design. Advance first and a crash loses the period silently — the date moved, nothing was billed,
  and no later sweep notices because the subscription is no longer due. Invoice first and a crash is
  recoverable: the next sweep finds it still due, is refused by the unique index on
  `(subscriptionId, periodStart)`, recovers the invoice that exists and finishes the advance. There is no
  Redis queue because a second store of who has been billed is a way to bill someone twice; the unique index
  is the lock and the table is the queue.
- **A worker that lists rows and then acts on them must pin what it listed.** `renew` re-reads the
  subscription, so a sweep that lost the race would read the *advanced* date and invoice for a period that
  has not started — a different key, which the unique index has no reason to refuse, producing a second
  charge dated a full cycle ahead. Reproduced: twenty-five due subscriptions and six concurrent sweeps issued
  twenty-eight invoices. The caller now passes the period it selected and the renewal does nothing if the row
  has moved. Idempotency on the write is not enough when the read is what went stale.
- **PAST_DUE is set and cleared in one place, and renewal does not touch it.** It is a statement about unpaid
  invoices, and raising another invoice does not settle the ones outstanding. A status that can be set but
  never cleared leaves a customer who has paid marked as in arrears until support edits the database.
- **A scheduled action is named as one in the customer's trail.** Their own user is named, a staff member is
  "WebEdge support", and a row with no actor at all is "WebEdge (automatic)". Calling an automatic renewal
  "WebEdge support" tells the customer a person opened their account and acted on it — which is the first
  thing they ask when a charge is unexpected, and it is not true.
- **Expiry is filtered on `cancelledAt`, not on `autoRenew`.** Auto-renew switched off without a cancellation
  is a customer who intends to pay by hand; expiring them cuts off someone who is paying.
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
- **The setup wizard authenticates by proof of filesystem access, and closes permanently.** There is no
  administrator to authenticate as before installation, so the installer prints a one-time token and requires
  it on every request; anyone who can read it already has the server. Afterwards the token is deleted and an
  install lock is written, and every setup route answers 409. Re-opening it takes `rm` on the lock from a
  shell — a button for that is a button that repoints the database and creates an administrator.
- **Provider endpoints are verified against the provider's own MCP package, and the source is recorded.**
  `docs/provider-api.md` holds the index, read from `hostinger-api-mcp` on npm — that package carries the
  method and path of every endpoint it exposes, which is a stronger source than prose and a far stronger one
  than memory. It earned its place immediately: of four probe paths written from the published reference,
  `/api/dns/v1/zones` did not exist. Every DNS read is `/api/dns/v1/zones/{domain}`, so that probe would have
  returned 404 forever and reported "this token cannot reach DNS" — a false statement about a customer's
  account, which is worse than a missing feature. DNS is absent from the probe list rather than approximated.
- **The domains page merges two sources and names which is which.** A domain sold to a customer and one found
  on the provider account are different facts, and a list that blends them silently reads as "our customers'
  domains" — inviting someone to act on a name nobody has been sold. Every row states its origin, an
  unassigned one says "Unassigned" rather than leaving a blank that looks like missing data, and a name
  present in both is folded into one row, because two rows for one domain is how someone deletes the one
  they were not looking at. Unassigned sorts first: that is the queue, and a page that buries the work under
  the settled rows is a page nobody uses to do the work.
- **Discovered provider resources are not customer data, and land in their own table.** A sync finds things on
  the provider account before anyone has decided whose they are. `Domain` and `Website` carry a non-null
  `customerId` because tenancy is the invariant nothing may weaken, so a discovered row goes to
  `DiscoveredResource` — infrastructure, like `HostingAccount`, staff-only. The alternatives were making the
  tenant nullable, which puts untenanted rows in the tables every tenant query reads, or attributing them to
  an arbitrary customer, which is a breach no later scoping can undo. Attaching one to a customer is a
  separate, deliberate act.
- **The provider's response shapes are unpublished, so the mapping guesses by key name and says when it
  failed.** Its own generated types read `response: any; // Response structure will depend on the API`. A
  field with no matching key stays null — never the resource's id wearing a name's clothes, never today's
  date — the payload is stored as received so a corrected mapping applies without re-syncing every account,
  and the provider's own key names are shown on screen when nothing matched, which is what the candidate
  list should be corrected against. `resource-mapping.ts` owns the candidates; correct them there and record
  what the provider actually sent in `docs/provider-api.md`. **Candidate keys are named exactly, never
  matched by pattern.** The live hosting payload has no `id` and carries `client_id` and `order_id`; taking
  anything ending in `_id` would key every website on the same `client_id`, collapsing nine into one row that
  each sync overwrites — an inventory that looks plausible and is wrong. Identity falling back to the name is
  the correct outcome there, and stays correct only while the list refuses to guess.
- **What a resource is expected to have depends on what it is.** A website has no expiry; the subscription
  paying for it does. Reporting a missing `expiresAt` on a website as a mapping gap is a false alarm, and a
  false alarm on a diagnostic is worse than none — it teaches whoever reads it to ignore the line where a
  real gap will appear.
- **A sync updates, it does not append.** Identity is `(account, kind, providerKey)`, and `providerKey` is the
  provider's own id or, failing that, the name. A record with neither is skipped and counted rather than
  stored under a key that changes every run — an inventory that duplicates on every press is worse than one
  with a visible gap. `firstSeenAt` is never rewritten: it is when the resource appeared on the account, not
  when someone last looked.
- **A connection test is every GET and no writes.** That is what makes it safe to run against a live account
  under the rule that nothing outside production is written unless its name starts with `wetest-`. It reports
  per product area, because a token inherits the permissions of whoever created it and reaching domains but
  not VPS is ordinary. An unrecognised response shape yields an unknown count, never zero: "0 records" reads
  as "your account is empty" and is indistinguishable from "we could not read the answer".
- **No dependency may require a compiler.** Every package must ship a prebuilt binary or be pure
  JavaScript, and the binary must load on Enterprise Linux 8 (glibc 2.28), which is what most managed hosting
  runs. `argon2` failed this: its prebuild needs GLIBC_2.34, so it fell back to compiling, and node-gyp's
  Python needs 3.8+ where EL8 has 3.6.8 — an install that dies with a `SyntaxError` in a Python file and
  names none of the three causes. `@node-rs/argon2` needs GLIBC_2.14 and never invokes a compiler. If
  `npm ci` ever starts running `node-gyp`, that is a regression, not a toolchain to install.
  `test/native-dependencies.spec.ts` enforces it, and distinguishes a blocking package from an optional one:
  `cpu-features` fails loudly under ssh2 and npm carries on, so that noise in a build log is expected.
- **No package may run code at install time.** `backend/.npmrc` sets `ignore-scripts`. An install script is
  arbitrary code from a package author, running with the deploying account's privileges before anything is
  reviewed — and it is also what resurrects a removed native dependency from a stale `node_modules` on a
  build host. The cost is that Prisma generates its client from an install script, so every entry point runs
  `prisma generate` explicitly. Chain it with `&&` inside the script body, never as a `prebuild` hook:
  `ignore-scripts` disables this project's own pre/post hooks too, which is how the first attempt produced a
  build with 206 type errors against a client that had never been generated.
- **Anything that compiles clears `tsconfig.tsbuildinfo` first.** `nest-cli.json` deletes `dist` and
  `tsconfig.json` is incremental; nothing tells tsc its output was deleted. Build twice without editing a
  source file and the second build removes `dist`, reads build info describing files that no longer exist,
  emits nothing, and exits 0 — leaving a `dist` holding only the copied assets. `npm run install:wizard` then
  fails with `MODULE_NOT_FOUND` for `dist/installer/cli.js`, naming a file that is plainly there in `src`.
  A build that reports success and produces nothing is worse than one that fails, so `npm run clean` runs
  before every compiler invocation and a test enforces it over the configuration rather than over today's
  scripts.
- **One module owns password hashing.** `common/password-hashing.ts`. Four files used to import an argon2
  library directly and restate the cost parameters, which is why replacing it was a four-file change.
  Swapping a hashing library is only safe if hashes already in the database still verify and Dovecot still
  reads the mailbox ones — both are pinned by tests against hashes written by other implementations.
- **The installer never installs dependencies over HTTP.** `npm ci` is a shell step before it. An endpoint
  that installs packages is remote code execution with a friendly form in front of it.
- **`.env` values are single-quoted, and anything unrepresentable is refused.** dotenv treats single quotes
  as fully literal; inside double quotes it expands `\n` and `\r` and does *not* unescape `\"` or `\\`, so
  the obvious escaping corrupts every password containing a quote or a backslash. A value needing both quote
  characters cannot be stored at all and is rejected with an explanation rather than written wrong.
- **The installer writes the lock last.** Configuration, migrations, seed, administrator, then lock. A
  failure partway leaves a retryable system; writing the lock first would leave a half-installed one with the
  wizard already closed.
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
| `test/provider-sync.spec.ts` | A sync stores nothing in a customer-owned table, does not duplicate on a second run, and keeps a record it cannot name rather than dropping it |
| `src/providers/resource-mapping.spec.ts` | An unrecognised payload yields null fields, never an invented name or date, and a record with no stable key is refused |
| `src/providers/hostinger-client.spec.ts` | An API token never reaches an error message, a log or the audit trail, and an unreadable response is counted as unknown rather than zero |
| `src/providers/credential-cipher.service.spec.ts` | Tampered ciphertext, tags and IVs are all rejected |
| `src/rbac/permissions.catalog.spec.ts` | No role is composed from another realm's keys |
| `test/sftp-file-transport.spec.ts` | A symlink inside the website cannot be used to read, write or delete outside it |

| `src/billing/gst.spec.ts` | Tax splits, rounding and credit notes reconcile exactly |
| `src/checks/ssrf-guard.spec.ts` | Outbound checks cannot be pointed at internal or metadata addresses |
| `test/invoice-numbering.spec.ts` | Concurrent invoices get distinct, consecutive numbers with no gaps, and a credit note is identifiable as one |
| `test/renewal-worker.spec.ts` | A subscription is invoiced exactly once per period under retries, concurrent sweeps and an interrupted run, and never for a period that has not started |
| `src/billing/billing-period.spec.ts` | Renewal dates clamp at month ends and never drift off the anniversary |
| `src/mail/mail-password.spec.ts` | A real `doveadm` accepts the hashes WebEdge writes, and rejects wrong or truncated passwords |
| `src/mail/mail-address.spec.ts` | Local parts that would traverse a maildir path are refused, and addresses compare case-insensitively |
| `test/build-output.spec.ts` | No script can run the compiler over stale build info, so a build cannot succeed and emit nothing |
| `test/native-dependencies.spec.ts` | No package npm cannot skip requires a compiler, so installing needs no toolchain |
| `src/common/password-hashing.spec.ts` | Hashes written by other argon2 implementations still verify, so the library can be replaced without locking anyone out |
| `src/installer/env-file.spec.ts` | Every generated `.env` value round-trips through the real dotenv, and a newline cannot become a setting |
| `src/installer/lock.spec.ts` | The wizard closes permanently after installing, and the setup token is compared in constant time |
| `src/installer/environment.spec.ts` | Version comparison is numeric, so "at least 9" does not reject 10 |
| `src/installer/secrets.spec.ts` | Generated keys match the config schema and generated passwords survive every quoting layer |
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
6. Business — plans, orders, Razorpay, invoices, renewals ← *current; everything but Razorpay. Renewals
   run on their own timer and stop at the point money moves — an invoice is raised and marked due, and
   nothing marks it paid.*
7. Scale — multiple providers, queues, monitoring, migration tools

Each phase can only automate what the provider API actually exposes. Map every module against the current
official Hostinger documentation before building it, and test against the exact hosting product in use.
