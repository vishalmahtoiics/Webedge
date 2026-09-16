# ADR-001: Provider model

**Status:** Proposed — awaiting owner decision
**Date:** 2026-09-16
**Milestone:** M0
**Spec reference:** §5.3
**Decision owner:** project owner
**Blocks:** M2 entirely; M1's data model; the commercial plan

---

## Context

WebEdge resells hosting through a provider whose name customers never see. §5.3 requires this ADR to compare
three options on capability, isolation, brand leaks, cost per customer and build effort, recommend one, and
leave the decision to the owner.

The comparison rests on evidence gathered in `docs/PROVIDER-INTEGRATION.md` §2 — read that section first. The
short version: **the isolation unit differs by Hostinger product family**, and that single fact decides most of
this.

§5.4 states the constraint that does the deciding:

> Websites of different customers MUST NOT share an isolation unit unless M0 proves the provider isolates
> websites from each other.

---

## Options

### A. Hostinger shared / cloud / business hosting via the API, SFTP for file writes

The spec's default. **It fails the §5.4 MUST.**

Databases and cron jobs are addressed as `/api/hosting/v1/accounts/{username}/…` — scoped to the hosting
account, not the website. An account-level cron job runs as the account's OS user, so one customer can
schedule a job that reads another customer's files, and both see each other's databases in one namespace.

The only compliant use is **one customer per hosting account**, which removes the density the economics
depend on and multiplies the number of provider accounts, tokens and rate-limit budgets to manage.

Also: no usage metrics at all, so every resource meter in the dashboard shows "Not available".

### A′. Hostinger **Agency Hosting** via the API, SFTP for all file operations

Not enumerated in the spec — it appears inside option A as an aside — but the evidence separates it sharply.

Each website gets **its own system user** (`user: { username, state }`), its own SFTP and SSH scope
(`remote_access.sftp/ssh` with host, username, port), its own databases, and its own cron jobs. Per-website
CPU, memory and process metrics exist; SSL certificate names and expiry come back with the website record.

Its costs are real and known:

- **No file list/read endpoints**, so the file manager is SFTP end-to-end. This is a net simplification — SFTP
  covers every `FilePort` operation including rename, move and mkdir, which no API here will ever offer.
- **No database password-change endpoint** (PROVIDER-INTEGRATION §3.3).
- **Disk usage is order-level**, so per-website storage meters have no source (§3.6).
- **SFTP passwords may need hPanel setup per website** — the largest unresolved operational risk.

### B. Hostinger VPS fleet running a WebEdge-controlled stack

Full control, full brand isolation, complete capability. WebEdge owns patching, security, backups, mail
deliverability and on-call.

The spec's own assessment — "likely beyond this budget if done properly" — is correct, and the budget makes it
concrete: M7 allocates ₹1,60,000 for hardening, launch and two weeks of hypercare. Running a hosting platform
properly needs that much ongoing, every month, forever. The VPS API is comprehensive (64 endpoints: lifecycle,
firewall, snapshots, backups, PTR records, Docker projects, metrics), so this is a capable option — it is an
*operating-cost* decision, not a technical one.

### C. Hybrid — A′ for websites, B only where required

A′ for hosting; a VPS only where a specific requirement cannot otherwise be met. On current evidence the one
candidate is mail (ADR-002). Keeps the VPS surface to a single well-understood workload.

---

## Comparison

| | A (shared/cloud) | **A′ (Agency)** | B (VPS fleet) | C (hybrid) |
|---|---|---|---|---|
| **Satisfies §5.4 isolation** | **No** | Yes (documentary; needs live test) | Yes | Yes |
| Website capability | Good | Good | Complete | Good |
| File operations | API read + SFTP write | SFTP only (uniform) | Complete | SFTP only |
| Usage metrics | **None** | CPU/mem/processes per site; disk per order | Complete | Per A′ |
| SSL data | None | Names + expiry per site | Complete | Per A′ |
| Backups | None | None | Complete | None (site) |
| Brand leaks | Many | Many, same set | **Fewest** | Many |
| Cost per customer | Lowest | Low | **Highest** (ops, not rent) | Low–medium |
| Build effort | Medium | **Medium** | **Very high** | Medium–high |
| Ops burden | Low | Low | **Very high** | Medium |
| Fits ₹20,00,000 | Yes | **Yes** | **No** | Yes |

---

## Decision

**Recommended: A′ — Hostinger Agency Hosting, with all file operations over SFTP.**

Reasoning, in the order that matters:

1. **It is the only option that satisfies §5.4 within budget.** Option A fails the isolation MUST at any
   useful density. That alone eliminates the spec's default.
2. **It is the only option that makes the dashboard honest.** §8.3 requires every number to have a real source
   or show "Not available". Agency supplies per-website CPU, memory and processes, and per-site SSL expiry.
   Shared hosting supplies nothing, so a shared-hosting dashboard is mostly empty states — a weak product.
3. **Its gaps are known, bounded, and already have designed fallbacks.** No backups → the honest unavailable
   state plus a restore ticket, which the spec already specifies. No file API → SFTP, which is *more* capable.
   The four unbuildable requirements are listed with options in PROVIDER-INTEGRATION §4.
4. **B is unaffordable as an operating commitment,** not as a build.

**Adopt C's structure without committing to a VPS now:** build the ports so a second provider or a
WebEdge-operated backend can serve any single port (§5.1 already requires this). If ADR-002 chooses a
self-hosted mail stack, that is C, reached without re-architecture.

### Conditions on this recommendation

This is a recommendation on documentary evidence, not a proven result. Two conditions must clear first:

1. **The filesystem isolation test (§5.3.3) must pass on the staging account.** The API paths prove the *API*
   scopes resources per website; they do not prove the *filesystem* does. If a PHP script on website A can
   read website B's home directory, A′ fails §5.4 exactly as A does, and the real choice narrows to B — which
   the budget cannot carry. **Run this test first, before anything else in the spike.**
2. **SFTP password provisioning must be understood.** If every website needs manual hPanel setup, that is a
   hard scaling limit and belongs in the commercial plan.

### What the owner also needs to confirm

- **Written confirmation from Hostinger that white-label resale via the API is permitted for the Agency
  Hosting plan family** (§2.3). This ADR narrows that question from "the plans WebEdge will use" to one
  specific family — ask about Agency Hosting explicitly.
- **Commercial fit.** Agency Hosting is priced and packaged for agencies. Its per-order website limits and
  pricing tiers drive PROVIDER-INTEGRATION §5's ~300–500 customers per account ceiling and therefore
  `docs/COSTS.md`.

---

## Consequences

**If accepted:**

- M2 builds one Hostinger adapter targeting the `agency-hosting` and shared `dns`/`domains`/`mail` families.
- `FilePort` is an SFTP implementation from the start. The §6.5 path-confinement suite is written against
  SFTP semantics, and symlink handling is tested there specifically.
- The mapping wizard (§9.3) stores an encrypted SFTP password per website and connection-tests it.
- Capability declarations start from PROVIDER-INTEGRATION §3, with shared/cloud capabilities also modelled so
  an inherited shared-hosting account can be mapped read-only without violating §5.4.
- The four requirements in PROVIDER-INTEGRATION §4 are re-scoped at their respective milestones.

**If rejected in favour of B**, the budget and timeline in §2.1 no longer hold and need renegotiating before
M1 — this is a change-request conversation, not an implementation detail.

**Reversibility:** moderate. The port interfaces make swapping a *provider* cheap. Swapping the *isolation
model* is not cheap, because placement, the mapping wizard and the capability matrix all encode it. Decide
once, deliberately.
