# CLAUDE.md

Working rules for this repository.

> **Precedence.** The master spec says CLAUDE.md overrides it. This file therefore contains only rules
> *derived* from the spec plus practical conventions — it does not invent policy. Where it restates a spec
> rule, that is for visibility, not to change it. If the owner wants a rule that genuinely overrides the spec,
> they should add it under "Owner overrides" below, where it is unambiguous that it came from them.

## Owner overrides

*(none yet)*

---

## Project

WebEdge Solution — a white-label hosting control panel and webmail platform. Customers manage websites,
domains, DNS, files, databases, SSL, backups, email, billing and support from one dashboard and never
encounter the upstream provider.

- **Master spec:** the product and engineering specification supplied by the owner. It is the plan of record.
- **Current milestone:** M0 (discovery and decisions). See `docs/PROGRESS.md`.
- **Repository state:** greenfield. See `docs/audit/REPO-AUDIT.md`.

## Before starting a milestone

1. Read `docs/PROGRESS.md` for what is accepted and what is open.
2. **Do not start a milestone until the owner has accepted the previous one.** This is a spec rule and it is
   the main thing to check before writing code.
3. Read only the spec sections that milestone references.
4. Check the ADRs. `docs/adr/ADR-001-provider-model.md` is still *Proposed* — M2 cannot start until it is
   Accepted, and M1's data model depends on it.

## Non-negotiables

These come from the spec and are acceptance-blocking. They are listed here because they are the ones easiest
to breach accidentally.

- **No brand leaks.** Never hardcode a brand string. Everything customer-visible reads from
  `packages/config/branding.ts`. The provider's name must not appear in UI copy, API responses, browser
  bundles, emails, invoices, error messages or logs. New leak vectors go in the register
  (`docs/PROVIDER-INTEGRATION.md` §6) — classified, never ignored.
- **No invented data.** A metric with no real source shows "Not available" or "No test yet". Never a
  placeholder number, never a fabricated list. This applies especially to backups, storage and security
  signals, where the provider genuinely has no data.
- **Tenant isolation.** Customer context comes only from the authenticated session, never from a request
  parameter. Tenant-owned models are read through the scoped repository. A resource owned by another customer
  returns `RESOURCE_NOT_FOUND` (404), never 403 — a 403 confirms the resource exists.
- **Deny by default.** Every route declares a permission. Hiding UI is convenience, not authorization.
- **Secrets never enter the repository or a chat session.** Provider tokens, Razorpay keys and SFTP passwords
  live in `.env` or Docker secrets. `.env.example` documents names only, never values.
- **No writes to real provider resources outside production** unless the resource name starts with `wetest-`
  or the account is flagged as staging. There is no provider sandbox — every call touches a real account.

## Architecture rules

- UI components never call `fetch` directly; they use the typed API client through query hooks.
- Controllers do guards, validation and response mapping. No business logic.
- Services hold business rules, plan-limit checks, orchestration and audit logging.
- Provider adapters are the only code that knows provider-specific details.
- `packages/domain` is pure functions with no framework imports, and is thoroughly unit-tested.
- Page loads read local state (PostgreSQL + Redis). **Never fan out into live provider calls on page load.**
- Every list endpoint is paginated with an enforced maximum page size.

## Conventions

- TypeScript strict mode everywhere.
- Pin exact versions in the lockfile; verify current stable versions at install time rather than assuming.
- Commits are atomic and describe *why*. Work happens on the assigned branch; nothing is pushed without owner
  approval; each accepted milestone is tagged.
- Default to no comments. Write one only when the "why" is non-obvious.

## When the spec is wrong

It sometimes is — M0 found four customer-facing requirements with no data source
(`docs/PROVIDER-INTEGRATION.md` §4). When the spec conflicts with verified provider behaviour:

1. Do not implement it as written, and do not silently simulate the missing data.
2. Record the conflict with evidence, in the provider doc or an ADR.
3. Raise it in the milestone report with options and a recommendation.
4. Let the owner decide.

The same applies when the spec conflicts with working behaviour already in the repository: preserve the
working behaviour and raise the conflict.
