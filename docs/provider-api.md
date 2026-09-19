# The provider API, as verified

Every path here was read from the provider's own MCP package,
`hostinger-api-mcp@1.61.1`, fetched from npm on 19 September 2026. That package
carries the method and path of every endpoint it exposes, so it is a stronger
source than prose documentation and a much stronger one than memory.

This matters because the first four probe paths in `hostinger.client.ts` were
written from the published reference and **one of them was wrong**. Recording
the source is what makes the next correction cheap.

## Base URL and authentication

```
https://developers.hostinger.com
Authorization: Bearer <token>
```

Tokens are created in the provider's panel under API. A token inherits the
permissions of the user who created it and may carry an expiry, so a token that
reaches some products and not others is ordinary, not a fault.

Paths are `/api/{product}/v{n}/...`.

## GET endpoints that take no path parameter

These are the ones usable as a connection test, because they need nothing known
in advance.

| Product | Path |
|---|---|
| domains | `/api/domains/v1/portfolio` |
| domains | `/api/domains/v1/transfers` |
| domains | `/api/domains/v1/whois` |
| hosting | `/api/hosting/v1/websites` |
| agency-hosting | `/api/agency-hosting/v1/websites` |
| agency-hosting | `/api/agency-hosting/v1/domains` |
| agency-hosting | `/api/agency-hosting/v1/orders` |
| hosting | `/api/hosting/v1/orders` |
| hosting | `/api/hosting/v1/datacenters` |
| vps | `/api/vps/v1/virtual-machines` |
| vps | `/api/vps/v1/templates` |
| vps | `/api/vps/v1/data-centers` |
| billing | `/api/billing/v1/subscriptions` |
| billing | `/api/billing/v1/catalog` |
| billing | `/api/billing/v1/payment-methods` |
| mail | `/api/mail/v1/orders` |

## DNS has none

Every DNS read is scoped to a domain:

```
/api/dns/v1/zones/{domain}
/api/dns/v1/zones/{domain}/validate
/api/dns/v1/snapshots/{domain}
/api/dns/v1/snapshots/{domain}/{snapshotId}
/api/dns/v1/snapshots/{domain}/{snapshotId}/restore
```

`/api/dns/v1/zones` does not exist. Probing it returns 404, which reads as "this
token cannot reach DNS" — a false statement about the customer's account. DNS is
checked against a domain from the portfolio instead, and is deliberately absent
from the probe list.

## Agency hosting is a separate product, not a flag

`agency-hosting` has its own paths — `/api/agency-hosting/v1/websites`,
`/domains`, `/orders` — distinct from `/api/hosting/v1/...`. An agency account
404s on the shared path and the reverse, which is why the connection test probes
both: the account's own answer decides which product it is, rather than whatever
product family somebody selected on the form.

## Every product family the package ships

`agency-hosting`, `billing`, `dns`, `domains`, `ecommerce`, `horizons`,
`hosting`, `mail`, `reach`, `vps`, `wordpress`. WebEdge models a subset; the
others are listed so nobody re-derives the list to find out whether something
exists.

## Hosting is per account, not flat

Databases, cron jobs and the rest hang off a hosting account username:

```
/api/hosting/v1/accounts/{username}/databases
/api/hosting/v1/accounts/{username}/cron-jobs
```

`/api/hosting/v1/websites` is the flat list; anything below a website needs the
username first. This is also why `Website.providerUsername` exists on the model
and is never serialized to a customer.

## Re-checking this file

```bash
npm pack hostinger-api-mcp@latest
tar -xzf hostinger-api-mcp-*.tgz
grep -o '"path": "[^"]*"' package/src/core/tools/*.js | sort -u
```

Correct this file rather than working around it, and note the package version
that was read.
