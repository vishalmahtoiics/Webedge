# Provider integration

**Milestone:** M0
**Date:** 2026-09-16
**Spec reference:** §5
**Status:** capability matrix complete from documentary sources; live verification blocked on the staging account (§2.3)

---

## 1. How this was verified, and how far to trust it

§0 says provider facts must be re-verified against Hostinger's official documentation, and that the official
docs are the source of truth rather than the spec. That was done, with one important caveat about method.

**`developers.hostinger.com` and `docs.hostinger.com` are unreachable from the build environment** — both are
blocked by the network egress proxy. So the primary documentation site could not be read directly.

Two *official Hostinger* sources were used instead, both published by Hostinger and both generated from the
same OpenAPI specification that backs the documentation site:

| Source | What it gave | Retrieved |
|---|---|---|
| `github.com/hostinger/api-mcp-server`, `README.md` on `main` | A complete tool index: **389 endpoints**, each with HTTP method, path, and prose description, grouped into 11 product families | 2026-09-16 |
| `@hostinger/sdk@1.52.1` from the npm registry (`docs/`, `base.ts`) | **595 generated model documents** giving exact request/response field names, types and units, plus the API base URL | 2026-09-16 |

**Confidence.** Endpoint existence, paths, methods and response *shapes* are high-confidence: they come from
Hostinger's own generated artifacts. What these sources do *not* settle is runtime behaviour — actual latency,
actual rate-limit accounting, whether an endpoint returns `202` in practice, and whether a documented field is
ever populated. Those need the staging token.

**Every claim below is tagged:**

- **[V]** Verified against an official generated artifact. Safe to design against.
- **[?]** Not established by these sources. Must be confirmed with the staging token before any code depends on it.

Base URL **[V]**: `https://developers.hostinger.com` (from the SDK's `BASE_PATH`). Matches the spec.

### Facts the spec asserts that this audit could *not* confirm

| Spec claim (§5.2) | Status |
|---|---|
| "Rate limit of 90 requests per minute, counted per user" as a **global** limit | **[?] Not confirmed, and likely misstated.** See §5. |
| "There is no sandbox" | **[?]** Plausible and no evidence contradicts it, but not stated in either source. Treat as true until disproved — the cost of being wrong is destroying real customer data. |
| "Tokens inherit the permissions of the user who created them and can be set to expire" | **[?]** Not in these sources. |
| "`202 Accepted` means the operation completes asynchronously" | **[V] for specific endpoints** (billing orders, domain purchase, subscription renewal). Not shown to be a global convention. |
| "Official SDKs exist (including TypeScript), generated from the OpenAPI specification" | **[V]** `@hostinger/sdk@1.52.1`, sole runtime dependency `axios`. Pin this exact version (§4.1). |
| "A separate Email API exists for reading and sending mail" | **[V] Confirmed**, at `https://api.mail.hostinger.com/`. Mechanism in §3.5. |

---

## 2. The finding that drives everything: the isolation unit differs by product family

§5.3 deliverable 3 asks which provider unit gets its own OS user, filesystem permissions, SFTP scope and cron
scope — because if the answer is "the account", two customers cannot share one. §5.4 makes this a MUST:

> Websites of different customers MUST NOT share an isolation unit unless M0 proves the provider isolates
> websites from each other.

The endpoint paths answer this directly, because a REST path names its own scope.

**Shared / cloud / business hosting — isolation unit is the ACCOUNT [V]**

```
GET  /api/hosting/v1/accounts/{username}/databases          ← databases belong to the account
POST /api/hosting/v1/accounts/{username}/cron-jobs          ← cron belongs to the account
GET  /api/hosting/v1/accounts/{username}/domains/{domain}/files
```

Databases and cron jobs are addressed by `{username}` — the hosting account — not by website. An account-level
cron job runs as the account's OS user. If two customers' websites sit under one account, either customer can
schedule a job that reads the other's files, and both see the other's databases in the same namespace. The
`WebsiteResource` model confirms websites carry a `username` field, i.e. many websites share one username.

**Agency Hosting — isolation unit is the WEBSITE [V]**

```
GET  /api/agency-hosting/v1/websites/{website_uid}/databases       ← per website
POST /api/agency-hosting/v1/websites/{website_uid}/cron-jobs       ← per website
GET  /api/agency-hosting/v1/websites/{website_uid}                 ← returns .user.username
```

`AgencyHostingV1WebsitesWebsiteResource` exposes `user: { username, state }` — **a system user per website** —
plus `remote_access.sftp { username, host, port, is_enabled }` and `remote_access.ssh { … }` scoped to that
website. Databases and cron are website-scoped.

### Consequence

**Shared/cloud/business hosting cannot satisfy §5.4 for multi-tenant use.** It can only be used at one
customer per hosting account, which destroys the density that makes the economics work.

**Agency Hosting satisfies §5.4 on documentary evidence.** This is the basis of ADR-001's recommendation.

**[?] This must still be confirmed live.** The paths prove the *API* scopes these resources per website; they
do not prove the *filesystem* does. The spike must verify, on the staging account, that a PHP script running
on website A cannot read `/home/<userB>/` — the actual test §5.3.3 calls for. Do not treat the isolation MUST
as satisfied until that test passes.

---

## 3. Capability matrix

Per §5.1: capabilities are declared per provider account **and product family**, resolved per website, and
served to the UI via `GET /customer/websites/:id/capabilities`. The UI renders from resolved capabilities,
never from hardcoded assumptions — which is what makes the differences below survivable.

Legend: **Y** = endpoint exists [V] · **N** = no endpoint exists [V] · **SFTP** = achievable out-of-band ·
**—** = not applicable

### 3.1 `HostingPort`

| Operation | Shared/cloud | Agency | Notes |
|---|---|---|---|
| List websites | Y | Y | `GET /api/hosting/v1/websites` · `GET /api/agency-hosting/v1/websites` |
| Get website details | N | **Y** | Agency returns state, domains, SSL, SFTP/SSH, PHP, server, preview domain, staging root in one call |
| Create website | Y | Y | Agency is a two-step setup: `POST …/websites/setups` then poll `…/setups/{setup_uuid}` |
| Delete website | Y | Y | Agency deletion is asynchronous **[V]** |
| **Suspend website** | **N** | **N** | Confirms the spec. Suspension = WebEdge panel lock + admin runbook. `WebsiteResource.is_enabled` is readable but there is no endpoint to set it. |
| Parked domains / subdomains | Y | — | Agency uses link/unlink domain instead |
| PHP version / options / extensions | Y | Y | Both families |
| Clear cache | Y | Y | |
| Cron | Y (account) | Y (website) | See §2 |
| Datacenters | Y | Y | Friendly names must be mapped in WebEdge (§8.4) |

### 3.2 `FilePort` — the biggest divergence

| Operation | Shared/cloud | Agency |
|---|---|---|
| List directory | **Y** `GET …/domains/{domain}/files` | **N** |
| Read file | **Y** `GET …/files/content` | **N** |
| Upload | Y (TUS upload URL) | Y (TUS upload URL) |
| Write / rename / move / copy / delete / mkdir | **N** | **N** |

Neither family exposes file *mutation*. The spec's conclusion — writes go over SFTP — holds. But the spec
missed that **Agency Hosting has no file listing or read endpoints either**: its only file endpoints are
`upload-urls` and `import-archive` (which overwrites the whole site).

This inverts the spec's design. Rather than a hybrid where the API lists/reads and SFTP writes, on Agency
Hosting **the entire file manager is SFTP**. That is simpler and better:

- SFTP covers every `FilePort` operation in §5.1 uniformly, including rename, move and mkdir, which the API
  never will.
- One mechanism means one path-confinement implementation to audit (§6.5), not two.
- **Agency exposes SFTP host, username and port via the API** **[V]**, so per-website connection details are
  discovered automatically rather than typed into the mapping wizard.

**[?] The unresolved piece is the SFTP password.** No endpoint sets or returns it. The mapping wizard (§9.3)
must accept a password per website, encrypted at rest and connection-tested. Whether that password can be set
without hPanel clicking is the **single most important operational question for the spike**: if it cannot, then
onboarding every website needs manual work, and that caps how fast WebEdge can grow. Quantify it before M2.

Upload URLs are TUS endpoints returning `url`, `auth_key`, `rest_auth_key` **[V]** — provider-hostname-bearing,
so uploads are proxied server-side per the spec. Recorded in the leak register.

### 3.3 `DatabasePort`

| Operation | Shared/cloud | Agency |
|---|---|---|
| List / create / delete | Y (account-scoped) | Y (website-scoped) |
| Change password | Y | **N** |
| Separate database users | N | **Y** |
| Remote connections | Y | N |
| Repair | Y (async) | N |
| phpMyAdmin sign-on link | Y | N |

**[!] Agency Hosting has no database password-change endpoint.** §8.4 lists "Change password (level 1)" as a
customer action. On Agency this must be delivered by deleting and recreating the database *user*
(`POST/DELETE …/databases/{database_name}/users/…`), which changes the username too — a different user
experience that needs a UI decision. Alternatively the capability is declared unavailable. Flagged for M4.

### 3.4 `DnsPort` — fully supported, both families **[V]**

```
GET    /api/dns/v1/zones/{domain}              PUT /api/dns/v1/zones/{domain}
DELETE /api/dns/v1/zones/{domain}              POST /api/dns/v1/zones/{domain}/reset
POST   /api/dns/v1/zones/{domain}/validate
GET    /api/dns/v1/snapshots/{domain}          GET /api/dns/v1/snapshots/{domain}/{snapshotId}
POST   /api/dns/v1/snapshots/{domain}/{snapshotId}/restore
```

Zone-level, exactly as the spec describes. Record-level UX is validated read-modify-write with a snapshot
before every change; `validate` and `snapshots/restore` back the spec's "Undo last change" (§8.4) directly.
This is the best-supported port in the whole integration.

### 3.5 `MailPort` and `MailboxAccessPort`

Supported **[V]**: mail orders and plan quotas; mailbox list/create/delete (soft delete, restorable for a
limited period) and password change; aliases; forwarders (with confirmation resend and keep-copy); auto-replies;
catch-alls; five log streams (access, action, inbound, outbound, mailbox-actions); per-mailbox webhooks.

**Quota data is real, not simulated** — satisfying §0.1's requirement that quotas be enforced by the mail
system. `MailV1MailboxesMailboxUsageResource` **[V]**:

```
storage_used, storage_quota   (kilobytes)
messages_used, messages_quota
synced_at                     (null if never synced)
```

`synced_at` maps straight onto the spec's staleness rule (§7.4) — the UI can show real sync age.

Plan ceilings come from `GET /api/mail/v1/orders/{orderId}/plan` **[V]**: per-mailbox `storage_quota`,
`messages_quota`, `forwarder_quota`, `alias_quota`, `max_outbound_message_size`,
`max_outbound_recipient_limit`, `rate_limit_inbound`, `rate_limit_outbound`; per-domain `mailbox_quota`,
`forwarder_quota`, `alias_quota`, `is_catchall_enabled`, `is_imap_enabled`, `is_pop3_enabled`.

**[!] There is no per-mailbox quota-change endpoint.** Quota is a property of the *plan*, applied to every
mailbox in the order. §8.4 specifies "Create mailbox → quota from the remaining plan allowance" and "Mailbox
detail → quota change within plan". **Neither is implementable.** See §4.

Outbound rate limits and recipient caps are provider-fixed and readable — useful evidence for the §6.1 abuse
controls, but WebEdge cannot tighten them per mailbox.

**`MailboxAccessPort` (webmail)** **[V]**: a separate **Hostinger Email API** at
`https://api.mail.hostinger.com/`. Access tokens are minted via
`POST /api/mail/v1/orders/{orderId}/api-tokens`, returned in plaintext once, with a scope of either
`has_all_mailboxes: true` or an explicit mailbox list — **maximum 10 tokens per order [V]**.

That 10-token ceiling is a security problem, not a detail. It means per-mailbox tokens do not scale past ten
mailboxes per order, so webmail would have to hold one order-wide token and enforce per-mailbox access control
inside WebEdge — where a single authorization bug exposes every mailbox on that order. ADR-002 treats this as
disqualifying for the webmail read/send path and recommends per-user IMAP/SMTP authentication instead.
**[?]** The Email API's own surface could not be read (egress-blocked); confirm before ADR-002 is finalised.

### 3.6 `MetricsPort`

| | Shared/cloud | Agency |
|---|---|---|
| Disk + inodes | **N** | Y — `GET /api/agency-hosting/v1/orders/{order_id}/disk-usage-metrics` |
| CPU / memory / processes | **N** | Y — `…/resource-usage-metrics` |
| Per-website breakdown | — | **CPU/memory/processes only** |

Both return time series of samples **[V]**: disk gives `{disk_bytes, inodes, timestamp}` plus order `limits`;
resource usage gives `{cpu_percent, memory_bytes, processes, timestamp}` nested under a per-website resource
(`uid`, `domains`, `metrics`).

**[!] Disk usage is order-level only — there is no per-website storage figure.** The spec (§5.2) says Agency
provides "disk and inode usage … with per-website breakdown". The per-website breakdown exists for CPU and
memory, not for disk. So the dashboard's per-website storage meter (§8.3) has no data source. Storage must be
shown against the *order/plan*, or "Not available" per website. On shared/cloud there are no metrics at all,
and every usage meter shows "Not available" — which §7.4 already provides for.

### 3.7 `BackupPort` — **N for both families [V]**

No backup or snapshot endpoint exists outside VPS (and DNS snapshots, which are unrelated). Exactly as the
spec predicted: Tier 1 shows the honest unavailable state and a "Request a restore" ticket flow, with an admin
runbook covering the provider panel. **Never render a fabricated backup list.**

### 3.8 SSL

**No SSL endpoints exist in any family [V]** — confirming the spec. But Agency's website-details response
carries `ssl` as a sub-resource **[V]**:

```
AgencyHostingV1WebsitesSslCertResource: names[], expires_at, created_at
```

So on Agency, certificate names and expiry come from the provider for free, and provider-agnostic TLS
inspection becomes a cross-check rather than the only source. Issuance remains automatic/runbook-only.

### 3.9 Security signals

| Signal | Availability |
|---|---|
| PHP version + supported/unsupported | **Y** both families — `…/php/details` |
| Node.js dependency vulnerabilities | **Y** shared/cloud only — `…/nodejs/vulnerabilities` (+ a patch endpoint) |
| **WordPress core/plugin vulnerabilities** | **N — no endpoint exists in any family** |
| Malware scanning | **N — no endpoint exists in any family**, VPS included |

**[!] Two corrections to the spec.** §5.2 claims "WordPress core and plugin vulnerabilities" and a "malware
scanner on VPS only". Neither endpoint exists. The WordPress family (38 endpoints) offers installs, plugins,
themes, updates, cache and maintenance mode — `…/wordpress/{software}/updates` reports *available updates*,
which is a weaker but real signal. §8.4's Security tab must be built from: SSL status, PHP version support,
Node.js vulnerabilities (shared/cloud), and available WordPress updates. Nothing else — per §7.4, a metric
with no real source shows "Not available", never an invented number.

### 3.10 `DomainPort` — fully supported **[V]**

Portfolio, details, availability (plus AI-assisted alternatives), purchase, renewal info, nameservers, lock,
privacy, auth code (EPP), WHOIS profiles, transfers in and out, IRTP, and forwarding.

Purchases go through `POST /api/domains/v1/portfolio` and bill the *provider* account, returning `202` when
payment is still processing **[V]** — confirming the spec's requirement for a fulfilment state machine.
`GET /api/billing/v1/catalog` and `POST /api/billing/v1/orders` are the general provisioning-purchase path and
behave the same way.

---

## 4. Requirements in the spec that cannot be built as written

These are customer-facing behaviours the spec specifies which have no data source. Each needs an owner
decision before the milestone that would build it. **None should be simulated** — §7.4 is explicit that a
metric without a real source shows "Not available".

| # | Spec requirement | Problem | Options | Decide by |
|---|---|---|---|---|
| 1 | §8.4 Email — "quota from the remaining plan allowance" and "quota change within plan" | No per-mailbox quota endpoint; quota is plan-wide | (a) Drop the control; show the plan quota read-only. (b) Sell mail plans whose quota matches what WebEdge advertises, so plan == quota. **(b) is recommended** — it is honest and needs no UI. | M6 |
| 2 | §8.4 Security — WordPress core and plugin vulnerabilities | No endpoint | Show available WordPress *updates* instead, labelled as such. Vulnerability reporting becomes Tier 2 with a third-party feed. | M4 |
| 3 | §8.3 Dashboard — per-website storage meter | Disk metrics are order-level | Show storage per plan/order, not per website. Per-website meter shows "Not available". | M3 |
| 4 | §8.4 Databases — "Change password (level 1)" | No endpoint on Agency | Recreate the database user (changes the username), or declare the capability unavailable on Agency. | M4 |

---

## 5. Rate limits and sync headroom

### What is actually documented **[V]**

Only three endpoints carry an explicit "90 requests per minute" note, and they are all domain-search endpoints:
`checkDomainAvailabilityV1`, `suggestDomainNamesFromADomainV1`, `suggestDomainNamesFromADescriptionV1`. Two
others document *lower* limits: `listGitInstallationRepositoriesV1` at 10/min and `analyseFailedNode_jsBuildV1`
at 5/min.

**The spec's "90 requests per minute, counted per user" appears to be an endpoint-specific figure generalised
into a global one.** It may well also be the global limit — but that is not what these sources say, and §0
requires re-verification rather than inheritance. **[?] Confirm the global limit with the staging token before
sizing anything in production.**

### Design consequence

The §5.4 token bucket must be **per provider account *and* per endpoint family**, not a single global bucket.
A single global bucket sized at 75/min would happily spend the whole budget on domain-availability lookups and
starve inventory sync, and would still exceed the 5/min build-analysis limit. Each family gets its own bucket,
seeded from a config table so limits can be corrected without a deploy, and every `429` with `Retry-After`
narrows the relevant bucket adaptively.

### Headroom model

Arithmetic only — real costs need measurement **[?]**. Assuming the 90/min global figure is right, a 75/min
working ceiling (§5.4), and the spec's default intervals (inventory 15 min, usage hourly, DNS + TLS + expiry
daily), with Agency Hosting where list endpoints are order-scoped rather than per-website:

| Customers | Websites (≈1.5 each) | Requests/min for sync | Headroom at 75/min |
|---|---|---|---|
| 50 | 75 | ≈ 3 | comfortable |
| 200 | 300 | ≈ 9 | comfortable |
| 1,000 | 1,500 | ≈ 40 | **tight** — customer writes compete with sync |

The model holds because Agency list endpoints return many websites per call. It breaks if any per-website call
is needed on every cycle — notably `GET /api/agency-hosting/v1/websites/{website_uid}`, which is the only
source of SSL, SFTP and PHP detail. At 1,500 websites that endpoint alone is 1,500 requests per sweep: **25
minutes of the entire budget at 60 req/min**. So website *detail* must sync on a long interval (daily) and on
demand, never on the 15-minute inventory cycle.

**Practical ceiling: roughly 300–500 customers per provider account.** Beyond that, add accounts and let
placement (§5.4) spread load. This should inform the owner's commercial planning, and it is a reason the
`ProviderAccount` model must support many accounts from day one — which the spec already requires.

---

## 6. Leak register

Per §5.6. Classification: **Fixed** · **Mitigated** · **Accepted** (needs owner sign-off) · **Open**.

Nothing here can be closed while the product is unbuilt — application-surface entries are commitments that M1–M7
must honour, and the code-review rule in §7.9 (hardcoded brand strings fail review) is how they stay closed.

### 6.1 Application surfaces

| # | Vector | Status | Control |
|---|---|---|---|
| A1 | UI copy naming the provider | Open → Fixed in M1 | All strings from `packages/config/branding.ts`; brand-leak scan in CI |
| A2 | API responses leaking provider identifiers | Open → Fixed in M2 | Response DTOs expose WebEdge UUIDs only; `providerAccountId` and provider resource IDs never serialised to customers |
| A3 | JS bundles / source maps | Open → Fixed in M1 | Production source maps disabled; provider SDK imported only in `apps/api` and `apps/worker`, never in a browser bundle |
| A4 | HTML metadata, page titles, error pages | Open → Fixed in M1 | From branding config |
| A5 | Email templates and invoice PDFs | Open → Fixed in M5 | From branding config; CA-reviewed invoice template |
| A6 | Customer-visible error messages | Open → Fixed in M2 | §5.7 error mapping + the redaction test asserting a token-shaped string never reaches a response or log line |

### 6.2 Provider-generated URLs — all confirmed present **[V]**

| # | Vector | Status | Control |
|---|---|---|---|
| U1 | TUS upload URLs (`url`, `auth_key`, `rest_auth_key`) | Mitigated | Never sent to the browser; uploads proxied server-side and streamed (§6.5) |
| U2 | phpMyAdmin sign-on link (`…/databases/{name}/phpmyadmin-link`) | Mitigated | Not customer-facing in Tier 1; staff-only if used at all |
| U3 | WordPress auto-login links (`…/wordpress/{software}/login/links`) | Mitigated | Not exposed in Tier 1 |
| U4 | Free preview subdomains (`POST /api/hosting/v1/domains/free-subdomains`) | **Accepted — needs owner sign-off** | On a provider-owned domain. Either do not offer preview domains, or accept the leak. **Recommendation: do not offer them in Tier 1.** §8.4's "WebEdge preview domain" option in the Add-website flow depends on this decision. |
| U5 | Agency `preview_domain.fqdn` on every website record | **Accepted — needs owner sign-off** | Returned by the provider whether or not WebEdge offers it. MUST be stripped from customer-facing DTOs. Still reachable by anyone who guesses it. |
| U6 | Database names prefixed with the account username | Accepted | Provider-imposed. §8.4 already requires explaining automatic prefixes. |

### 6.3 DNS, network and connection details

| # | Vector | Status | Control |
|---|---|---|---|
| D1 | Nameserver hostnames | **Open — M2 decision** | Evaluate vanity nameservers; residual SOA/NS fingerprints likely remain → Accepted with sign-off |
| D2 | MX records pointing at provider mail hosts | **Open — ADR-002** | Decided by the mail backend choice |
| N1 | IP ownership / reverse DNS of hosting IPs | **Accepted** | Not controllable on shared infrastructure. Agency exposes `ipv4` and `server.hostname` per website — strip both from customer DTOs. |
| N2 | HTTP response headers served by hosted sites | **Open** | Inspect real responses during the spike; may be unfixable |
| N3 | TLS certificates on provider hostnames | Accepted | Inherent |
| C1 | **SFTP hostname and username** (`remote_access.sftp.host`) | **Open — highest-impact unresolved vector** | Customers need these to use SFTP. A WebEdge-branded CNAME to the provider host only works if TLS/host-key checks still pass. **[?] Test during the spike.** Otherwise Accepted with sign-off. |
| C2 | SSH hostname and username | Open | As C1; or do not expose SSH in Tier 1 |
| C3 | Database hostname and banner | Open | As C1 |
| M1 | IMAP/SMTP/MX hostnames in setup instructions | **Open — ADR-002** | |
| M2 | `Received` headers and DKIM signing domain/selector | **Open — ADR-002** | The hardest mail vector; likely Accepted unless WebEdge runs its own mail |

### 6.4 Owner sign-off required

Six entries need an explicit decision before launch, and three of them (U4, U5, C1) change what gets built:

1. **U4/U5 — preview domains.** Recommendation: do not offer them; strip `preview_domain` from all DTOs.
2. **C1/C2/C3 — connection hostnames.** Pending a spike test. A "customers never see the provider" promise
   that breaks the moment someone opens an SFTP client is worse than a promise scoped honestly up front.
3. **N1 — IP and reverse DNS.** Accept; not controllable.

---

## 7. Open questions for the spike

In priority order. Every one needs the staging account from §2.3.

1. **Can website A read website B's files on Agency Hosting?** The §5.3.3 filesystem test. Everything rests on this.
2. **Can an SFTP password be set without hPanel?** Determines whether onboarding scales.
3. **What is the real global rate limit?** Determines sync intervals and the customer ceiling per account.
4. **Can SFTP/IMAP/SMTP hostnames be WebEdge-branded with valid TLS?** Determines leak entries C1–C3, M1.
5. **How long do async operations actually take?** Website setup, domain purchase, database create. Drives
   `ProviderOperation` polling intervals and the provisioning UX.
6. **What does the Email API at `api.mail.hostinger.com` actually expose?** Finalises ADR-002.

Writes during the spike run only on disposable `wetest-` resources, and only with the owner's go-ahead (§5.3.2)
— there is no sandbox, so every call touches a real account.
