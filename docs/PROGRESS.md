# Progress

Milestone status, decisions and change requests. Updated at the end of every milestone.

**Current milestone:** M0 — discovery, repository audit, provider spike, decisions
**Status:** delivered in part; **blocked** on owner dependencies before it can be accepted

---

## Milestone status

| Milestone | Focus | Status |
|---|---|---|
| M0 | Discovery, repository audit, provider spike, decisions | **In review (partly blocked)** |
| M1 | Foundation: design system, shells, auth, RBAC, tenancy, DevOps | Not started — blocked on M0 acceptance |
| M2 | Provider layer | Not started — blocked on ADR-001 |
| M3 | Customer core | Not started |
| M4 | Files, editor, databases, backups, performance, security | Not started |
| M5 | Billing (India) and support | Not started |
| M6 | WebEdge Mail | Not started — shaped by ADR-002 |
| M7 | Hardening, launch, hypercare | Not started |

## Regression checklist

Per spec §3.2, every milestone report confirms previously working features still work.

**Currently empty** — greenfield repository, no pre-existing features (`docs/audit/REPO-AUDIT.md` §4). Entries
start accumulating when M1 ships the first user-facing behaviour.

---

## M0

### Delivered

| Deliverable | Where |
|---|---|
| Repository audit | `docs/audit/REPO-AUDIT.md` |
| Hostinger endpoint index (389 endpoints) and capability matrix per product family | `docs/PROVIDER-INTEGRATION.md` §2–3 |
| Corrections to the spec's provider assumptions | `docs/PROVIDER-INTEGRATION.md` §4 |
| Rate-limit analysis and sync headroom model | `docs/PROVIDER-INTEGRATION.md` §5 |
| Leak register | `docs/PROVIDER-INTEGRATION.md` §6 |
| ADR-001 provider model | `docs/adr/ADR-001-provider-model.md` |
| ADR-002 WebEdge Mail | `docs/adr/ADR-002-webedge-mail.md` |
| ADR-003 browser-to-API topology | `docs/adr/ADR-003-browser-to-api-topology.md` |
| Design direction (M1 gate) | `docs/DESIGN-DIRECTION.md` |
| Recurring cost estimate | `docs/COSTS.md` |
| Licence register | `docs/LICENSES.md` |
| Repository bootstrap and conventions | `CLAUDE.md`, workspace config |

### Not delivered, and why

Both gaps need the staging Hostinger account from spec §2.3. Neither can be closed from this environment.

| Spec §5.3 deliverable | Blocker |
|---|---|
| 2 — Exercise read endpoints with the staging token; save sanitized fixtures | No staging account or token exists |
| 4 — Measure real rate-limit headroom and async operation timings | Same |

The capability matrix was built from official Hostinger artifacts instead (the published MCP server endpoint
index and the generated `@hostinger/sdk@1.52.1` models). That establishes what endpoints exist and what fields
they return; it does not establish runtime behaviour.

### The headline finding

**The isolation unit differs by Hostinger product family**, and it decides the architecture:

- Shared/cloud/business hosting scopes databases and cron jobs to the **hosting account**. Two customers on
  one account can read each other's files. This **fails spec §5.4**, which is the spec's own default option.
- Agency Hosting scopes them to the **website**, and gives each website its own system user.

ADR-001 therefore recommends **Agency Hosting**, not the shared/cloud hosting the spec assumed. Full reasoning
and the conditions attached are in the ADR.

---

## Decisions

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | Provider model — **Agency Hosting recommended** | **Proposed.** Blocks M2 and shapes M1's data model. |
| ADR-002 | WebEdge Mail — Hostinger Mail for provisioning, IMAP/SMTP for webmail | **Proposed.** Blocks M6. |
| ADR-003 | Browser-to-API topology — per-portal `/api` on own origin | **Proposed** (low contention). Blocks M1's session work. |

---

## Blocking owner dependencies

Ordered by how soon they block. Items 1–3 block M1 or M2 directly.

| # | Dependency | Blocks | Spec |
|---|---|---|---|
| 1 | **Accept or reject ADR-001** | M2 entirely; M1's data model | §5.3 |
| 2 | **Staging Hostinger account + API token** (separate from production) | Closing M0; all of M2 | §2.3 |
| 3 | **Dashboard reference screenshot** at `docs/design/reference/` | M1 design work | §0, §7.1 |
| 4 | **Approve `docs/DESIGN-DIRECTION.md`** | M1 component build | §7.1 |
| 5 | **Written confirmation from Hostinger that white-label resale is permitted** — ask about the **Agency Hosting** family specifically | Launch; commercial viability | §2.3 |
| 6 | **Decide the four unbuildable requirements** (`docs/PROVIDER-INTEGRATION.md` §4) | M3, M4, M6 | — |
| 7 | **Sign off the leak register's Accepted entries** | Launch | §5.6 |
| 8 | Brand assets (logo, colours) | M1 | §2.3 |
| 9 | Razorpay activation (test keys suffice until M5) | M5 | §2.3 |
| 10 | GST registration details + Chartered Accountant review | M5 | §2.3 |
| 11 | Legal documents (ToS, Privacy, Refund, AUP) + DPDP Act review | M7 | §2.3 |
| 12 | DNS control, platform servers (staging + production), transactional email provider | M7 | §2.3 |

## Risks

| Risk | Impact | Response |
|---|---|---|
| Filesystem isolation test fails on Agency Hosting | ADR-001's recommendation collapses; only the unaffordable VPS option satisfies §5.4 | **Run this test first in the spike.** Until it passes, treat §5.4 as unproven. |
| SFTP passwords need manual hPanel setup per website | Caps onboarding throughput; an ongoing labour cost not in the budget | Quantify during the spike; feeds `docs/COSTS.md` and the commercial plan |
| Real global rate limit is lower than assumed | Fewer customers per provider account than modelled | Measure before sizing sync intervals |
| M1 is larger than budgeted — §2.1 assumes an existing app, but this is greenfield | Schedule slip in the first milestone | Raised at M0 review; owner decides on scope or schedule (§2.2.4) |
| Mail brand leaks (MX, `Received`, DKIM) judged unacceptable late | Forces self-hosted mail, which M6's budget cannot carry | Decide ADR-002 and the leak register **before** M6 starts |

## Change requests

None. The change reserve (8%, ₹1,60,000) is untouched.

Per spec §2.2.4, unplanned work is paid from the reserve only with written owner approval, recorded here.
