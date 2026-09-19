# Build brief: manual control over the panel

Hand this to Claude Code as-is. It is written against the repository as it
stands, so that nothing already built gets built twice.

**Read `CLAUDE.md` first and follow it.** Everything below is subject to it —
particularly the non-negotiables on brand leaks, invented data, tenancy and
deny-by-default. Where this brief and `CLAUDE.md` disagree, `CLAUDE.md` wins.

---

## What already exists — do not rebuild

| Capability | Where | State |
|---|---|---|
| Add an upstream account | `/admin/providers` | Built, with a form |
| Add an API token to it | `/admin/providers` | Built. AES-256-GCM, never readable back |
| Test a token against the provider | `/admin/providers` | Built. Read-only, per product area |
| Sync the account's inventory | `/admin/providers` | Built. Stores into `DiscoveredResource` |
| See every domain | `/admin/domains` | Built. Read-only; merges sold + discovered |
| Issue an invoice | `POST /admin/billing/invoices` | API built. **No UI** |
| Void / credit-note an invoice | `POST /admin/billing/invoices/:id/void`, `/credit-note` | API built. **No UI** |
| Set a website's SFTP credentials | `PUT /admin/websites/:websiteId/sftp` | API built. **No UI** |
| Plans, subscriptions, renewals | `/admin/plans`, `/admin/renewals` | Built |
| Customers | `/admin/customers` | Built |

## Facts about the provider API, verified

Recorded in `docs/provider-api.md`, read from `hostinger-api-mcp` on npm. Do not
contradict them from memory.

1. **There is no FTP or SFTP credential endpoint.** The only file endpoints are
   `/api/hosting/v1/accounts/{username}/domains/{domain}/files`,
   `/api/hosting/v1/files/upload-urls` and the agency equivalents. FTP
   credentials cannot be created, read or rotated through the API. They must be
   taken from the provider's own panel and entered into WebEdge by a staff
   member. WebEdge already stores them encrypted and connects over SFTP itself.
2. **A hosting website payload has no `id`.** Keys observed:
   `client_id, created_at, domain, horizons_uuid, is_enabled, order_id,
   parent_domain, root_directory, username, vhost_type, website_type`.
   `username` is the SFTP username and `root_directory` the document root.
3. **`is_enabled` is the status**, a boolean. There is no status string.
4. **DNS has no parameterless GET.** Every read is `/api/dns/v1/zones/{domain}`.
5. **Agency hosting is a separate product** with its own paths.

---

## Task 1 — Attach a discovered resource to a customer

**Everything else depends on this.** A synced domain or website sits in
`DiscoveredResource`, owned by nobody. Until it is attached to a customer it
cannot appear in a portal, have DNS managed, or have SFTP credentials — because
`Domain` and `Website` both require a tenant.

Build:

- On `/admin/domains`, an **Assign to customer** action on any unassigned row.
  A customer picker, and on confirm: create the `Domain` (or `Website`) row with
  that `customerId`, copying name, status and expiry from the discovered record,
  and set `claimedByCustomerId` on the discovered row.
- The same for websites. A website carries `providerUsername` and
  `documentRoot` from the payload's `username` and `root_directory` — both
  internal, never serialized to a customer.
- Assigning is reversible only by staff, and every assignment writes an
  `ActivityLog` row.

Rules that bite here:

- Attaching the wrong domain to the wrong customer is a tenancy breach nothing
  downstream can undo. The confirmation must name **both** the domain and the
  customer, not ask "are you sure?".
- A domain already owned by another customer must be refused, not reassigned
  silently.
- Do not weaken `Domain.customerId` or `Website.customerId` to nullable.

Test: a second assignment of the same domain is refused; the discovered row is
marked claimed; and nothing appears in another customer's scope.

---

## Task 2 — Add a domain by hand

For a domain that is not on any synced account — registered elsewhere, or being
set up before it exists upstream.

Build a **New domain** form on `/admin/domains`:

- Fields: domain name, customer (required), status, expiry (optional),
  registrar (optional), nameservers (optional), "manage DNS here" toggle.
- Validate the name properly. There is already domain/DNS validation in
  `src/dns/dns-validation.ts` — use it rather than writing a second regex.
- A name that already exists — sold or discovered — is refused with a message
  naming which.

Rules: a customer is required, because there is no such thing as an untenanted
`Domain`. An unknown expiry stays null and renders as absent, never as a dash
that reads like "never".

---

## Task 3 — FTP / SFTP settings per website

The API cannot supply these, so this is a staff-entered form. `PUT
/admin/websites/:websiteId/sftp` already exists behind `admin.resource_mapping`;
it needs a UI and a verification step.

Build:

- On the admin customer page (`/admin/customers/[customerId]`), per website:
  host, port (default 22), username, root path, password.
- The password is write-only in the same way an API token is: cleared on
  submit, never re-rendered, never returned by any endpoint. Follow
  `components/provider-forms.tsx` — that pattern is already established.
- A **Test connection** button that opens the SFTP connection, lists the root,
  and stores `lastVerifiedAt` or `lastError`. Read-only; it must not write a
  file to check.
- Pre-fill `username` and `root` from the discovered payload's `username` and
  `root_directory` when the website came from a sync — those are the correct
  values and typing them by hand is how a typo becomes a support ticket.

Rules: `root` is the confinement boundary. `test/sftp-file-transport.spec.ts`
already proves a symlink cannot escape it — do not bypass that path.

---

## Task 4 — Raise an invoice by hand

The API exists and is careful; it has no UI.

Build on `/admin/billing`:

- **New invoice**: pick a customer, add line items (description, SAC code,
  quantity, unit price in rupees — converted to paise as integers), optional
  discount, optional due date. Show the computed GST split *before* issuing,
  from the same `calculateInvoice` the server uses — never a second calculation
  in the browser.
- **Void** and **Credit note** actions on an issued invoice, each requiring a
  reason.

Rules, all already enforced server-side — the UI must not fight them:

- An issued invoice has no edit and no delete. Correction is void plus credit
  note.
- Money is integer paise. The form takes rupees and converts once, at the edge.
- The confirmation must state that an issued invoice cannot be deleted.
- `src/billing/gst.ts` has not been reviewed by a Chartered Accountant. Do not
  remove that warning from the billing page.

---

## Task 5 — Branding and system settings

There is no settings store at all today. GSTIN and state code are read from
`process.env` in `invoice.service.ts`, which means changing them needs a deploy.

Build:

- A `SystemSetting` table — key, value, updatedBy, updatedAt — or a single-row
  settings model. Whichever, it must be readable without a deploy and writable
  only behind `admin.system_settings`.
- An **`/admin/settings`** page with:
  - **Branding**: panel name, logo upload, favicon, primary colour.
  - **Invoice identity**: legal name, GSTIN, state code, address, invoice
    number prefix (currently hardcoded `WEB/`), payment terms.
  - **Contact**: support email, support URL, shown in the customer portal.
- Move the GSTIN and state code reads off `process.env` and onto this store,
  keeping the env values as the fallback so an existing deploy does not break.

Rules:

- **The invoice number prefix may be changed only when no invoice has been
  issued in the current financial year.** Changing it mid-year breaks the
  gapless serial sequence, which is what an auditor asks about. Refuse it with
  that explanation rather than allowing it and warning.
- A logo is uploaded to local storage or the database, not hotlinked from a URL
  — a remote logo is an outbound request on every page load and a way to fetch
  an internal address. If a URL is accepted, it goes through
  `src/checks/ssrf-guard.ts`.
- Branding must never make the provider's name reachable. The settings page is
  staff-only, and nothing on it should be able to put the upstream provider's
  name into a customer-visible surface.
- Changing a setting writes an `ActivityLog` row with the old and new values.
  Not the logo bytes — its filename.

---

## How to work

- One task per commit, merged to `main` when green.
- Every new route declares `@RequirePermissions`. The router walk in
  `test/route-authorization.e2e-spec.ts` fails the build otherwise.
- Every list endpoint is paginated with an enforced maximum.
- Tests assert what would be an incident if it broke: a wrong tenant, a
  double charge, a credential in a log. Before trusting a test, break the code
  and watch it fail.
- Do not invent provider behaviour. If something is not in
  `docs/provider-api.md`, verify it against the MCP package —
  `npm pack hostinger-api-mcp@latest` — and record what you find there.
- Run `npm test` in `backend/` and `npm run build` at the root before
  committing.
