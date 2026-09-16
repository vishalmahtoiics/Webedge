# WebEdge Solution

A white-label hosting control panel and webmail platform. Customers manage websites, domains, DNS, files,
databases, SSL, backups, email, billing and support from one dashboard, and never encounter the upstream
provider.

**Status: M0 — discovery and decisions. No application code yet.**

---

## Where things are

| | |
|---|---|
| **Start here** | [`docs/PROGRESS.md`](docs/PROGRESS.md) — milestone status, decisions, blockers |
| Working rules | [`CLAUDE.md`](CLAUDE.md) |
| Repository audit | [`docs/audit/REPO-AUDIT.md`](docs/audit/REPO-AUDIT.md) |
| Provider capability matrix + leak register | [`docs/PROVIDER-INTEGRATION.md`](docs/PROVIDER-INTEGRATION.md) |
| Design direction (M1 gate) | [`docs/DESIGN-DIRECTION.md`](docs/DESIGN-DIRECTION.md) |
| Running costs | [`docs/COSTS.md`](docs/COSTS.md) |
| Licence register | [`docs/LICENSES.md`](docs/LICENSES.md) |

### Decisions

| ADR | Subject | Status |
|---|---|---|
| [ADR-001](docs/adr/ADR-001-provider-model.md) | Provider model | **Proposed** — blocks M2 |
| [ADR-002](docs/adr/ADR-002-webedge-mail.md) | WebEdge Mail | **Proposed** — blocks M6 |
| [ADR-003](docs/adr/ADR-003-browser-to-api-topology.md) | Browser-to-API topology | **Proposed** — blocks M1 sessions |

## What M0 found

Two findings change the plan:

1. **The repository was empty.** The spec is written for an existing codebase; there isn't one. This is
   greenfield, which makes M1 larger than its budget assumes.
2. **The isolation unit differs by Hostinger product family.** Shared and cloud hosting scope databases and
   cron jobs to the hosting *account*, so two customers on one account can reach each other's files — failing
   the spec's own isolation requirement. Agency Hosting scopes them per website and gives each website its own
   system user. ADR-001 therefore recommends Agency Hosting, not the shared hosting the spec assumed.

Along the way, four customer-facing requirements turned out to have no data source at the provider and cannot
be built as written. They are listed with options in [`docs/PROVIDER-INTEGRATION.md`](docs/PROVIDER-INTEGRATION.md) §4.

## What is blocked

M0 cannot be signed off until the owner provides a **staging Hostinger account and API token**. Two spike
deliverables — exercising read endpoints and measuring real rate-limit headroom — need it, and the isolation
finding above needs live confirmation on a real filesystem before it can be trusted.

The full list is in [`docs/PROGRESS.md`](docs/PROGRESS.md#blocking-owner-dependencies).

## Planned layout

Established in M1, once M0 is accepted:

```
apps/       client · admin · api · worker · webmail
packages/   ui · config · contracts · domain
infra/      docker · nginx · scripts
docs/
```

## Security

- Never commit `.env`, tokens, or SFTP passwords. `.env.example` documents names only.
- There is **no provider sandbox** — every API call touches a real account. Outside production, writes are
  refused unless the target resource name starts with `wetest-`.
- If a secret is ever committed, tell the owner so it can be rotated. Do not rewrite history without approval.
