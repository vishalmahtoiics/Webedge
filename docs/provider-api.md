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

## Response shapes, as observed

The provider publishes none — its generated types read
`response: any; // Response structure will depend on the API` and its README
carries no example bodies. What follows was observed from a live account on
19 September 2026 and is the only record of it.

### `GET /api/hosting/v1/websites`

```
client_id, created_at, domain, horizons_uuid, is_enabled, order_id,
parent_domain, root_directory, username, vhost_type, website_type
```

Three things that shaped the mapping:

- **There is no `id`.** Identity falls back to `domain`, which is correct.
  `client_id` is the same value on *every* website of an account and `order_id`
  belongs to the order, not the site. Matching either — for instance by taking
  anything ending in `_id` — collapses every website into one row, each sync
  overwriting the last, and leaves an inventory that looks plausible and is
  wrong. `resource-mapping.spec.ts` fails if the candidate list is loosened
  that way.
- **There is no `status`.** There is `is_enabled`, a boolean. The mapping reads
  it as `enabled`/`disabled`, and `false` is a value rather than an absence: a
  disabled site must read disabled, not unknown.
- **There is no expiry.** A website does not expire; the subscription paying
  for it does. Expected fields are therefore declared per kind, so a missing
  expiry on a website is not reported as a mapping gap — a false alarm on a
  diagnostic teaches people to ignore the line where a real gap will appear.

`username` and `root_directory` correspond to `Website.providerUsername` and
`Website.documentRoot`, both internal and never serialized to a customer.

### Other areas

A domain from `/api/domains/v1/portfolio` resolved a name and a status word
(`active`). A subscription from `/api/billing/v1/subscriptions` resolved a name
(the product, e.g. `.COM Domain`, `Business Web Hosting`) and a status
(`active`, `non_renewing`). Their exact key lists have not been captured; add
them here when they are.

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
