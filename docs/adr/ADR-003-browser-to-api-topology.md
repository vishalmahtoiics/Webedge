# ADR-003: Browser-to-API topology

**Status:** Proposed — awaiting owner decision (low contention)
**Date:** 2026-09-16
**Milestone:** M0 (decision) / M1 (build)
**Spec reference:** §4.4, §6.2
**Decision owner:** project owner

---

## Context

§4.4 states a preferred topology and says "ADR-003 confirms" it, with an escape hatch: if the repository
already uses a different topology, keep it only if it provides the same guarantees.

**The repository is empty** (`docs/audit/REPO-AUDIT.md`). There is no existing topology, so the escape hatch
does not apply and this decision is uncontested. It is recorded anyway, because the *reason* matters to M1 and
constrains how sessions and CORS are implemented.

---

## Decision

**Adopt §4.4's preferred topology unchanged.**

Each portal calls its own origin under `/api`. Nginx proxies `client.webedgesolution.com/api` and
`admin.webedgesolution.com/api` to the API service. `api.webedgesolution.com` serves only payment and mail
webhooks, health endpoints, and the restricted API documentation.

```
client.webedgesolution.com  ──/api──▶ ┐
admin.webedgesolution.com   ──/api──▶ ├─ nginx ─▶ apps/api
api.webedgesolution.com     ─────────▶ ┘           (webhooks, health, docs only)
```

---

## Why this over a shared API origin

The alternative — both portals calling `api.webedgesolution.com` with credentialed CORS — is worse on the one
axis that matters most here, tenancy:

1. **Session cookies become `__Host-` cookies.** The `__Host-` prefix requires `Secure`, `Path=/`, and **no
   `Domain` attribute**, which makes a cookie host-only and un-shareable across subdomains. A customer session
   set on `client.…` is then *incapable* of being sent to `admin.…`. §6.2 requires that a customer session
   never authorize a staff route; this makes it true at the browser level rather than only in a guard.
2. **No credentialed CORS for the portals.** Same-origin requests need no `Access-Control-Allow-Credentials`,
   so the class of misconfiguration where a permissive origin reflection exposes authenticated endpoints
   cannot arise for the portals at all.
3. **Defence in depth on staff routes.** The client host must not proxy staff routes, and the API separately
   rejects staff routes that did not arrive via the admin host, using the forwarded host header set by Nginx.
   Two independent controls, neither trusting the other.

The cost is a slightly more involved Nginx configuration and a build-time API base URL per app. Small, and
paid once in M1.

---

## Consequences

- **Nginx owns a security control, not just routing.** The client server block must not route staff paths, and
  both blocks must set a trusted forwarded-host header. This configuration is reviewed as security-relevant
  code, and lives in `infra/nginx/` under version control.
- **Trusted proxies must be configured correctly.** §6.2 requires that `X-Forwarded-For` cannot be spoofed to
  bypass rate limits. With Nginx in front of the API this is mandatory, not optional: the API trusts forwarded
  headers only from the proxy's own address. Getting this wrong silently disables login rate limiting, so it
  needs an explicit test.
- **Two cookie names, two session realms.** Customer and staff sessions are distinct server-side Redis
  sessions under distinct `__Host-` cookies, with the separate timeouts from §6.2 (customers 24h idle / 30d
  absolute; staff 30m idle / 12h absolute).
- **Local development must mirror this**, or the `__Host-` guarantees are only exercised in production.
  `__Host-` requires `Secure`, which requires HTTPS — so local development runs behind the same Nginx with
  local TLS rather than hitting the API directly on `localhost`. Worth the setup cost: a topology whose
  security properties only exist in production is a topology nobody has tested.
- **Webmail** at `mail.webedgesolution.com` is a third host and gets the same treatment: its own origin, its
  own `__Host-` session, holding the IMAP credential server-side per ADR-002.

---

## Reversibility

High. Changing topology later means Nginx configuration, cookie settings and the API client base URL — no data
model or business logic. Recorded for the rationale, not because it is hard to undo.
