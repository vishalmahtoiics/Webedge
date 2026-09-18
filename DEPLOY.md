# Deploying WebEdge

Written against a Coolify/Nixpacks deploy, but the reasoning applies to any
platform that builds from the repository.

## One application (recommended)

Deploy the repository **root**. One resource, one domain, one port: the portal
is published, and the API runs on loopback behind it.

| Setting | Value |
|---|---|
| Base directory | `/` (the repository root — **not** `backend`) |
| Ports exposes | `3000` |
| Domain | the one people will visit |

Environment variables — three, and all of them runtime, never build:

```
DATABASE_URL=postgres://user:password@host:5432/database
JWT_ACCESS_SECRET=<openssl rand -base64 48>
CREDENTIAL_ENCRYPTION_KEY=<openssl rand -hex 32>
```

`PORT` is supplied by the platform; leave it alone unless you also change
"ports exposes" to match. `CLIENT_ORIGIN`, `ADMIN_ORIGIN` and `API_BASE_URL`
are **not needed** here — `scripts/start.mjs` wires the portal to the API over
127.0.0.1, so no request is ever cross-origin and nothing has an origin to get
wrong.

`scripts/start.mjs` applies migrations, starts the API on loopback, waits for it
to answer, then starts the portal on the public port. Both share a lifetime: if
either dies the other is stopped and the container exits non-zero, so the
platform restarts a whole system rather than leaving half of one answering
requests it cannot serve.

### After the first deploy

There is no account until you make one. In the container's terminal:

```bash
npm run seed
```

It prints the administrator's password **once**. Copy it immediately.

### Then

`https://<your-domain>/admin/login` is the staff portal and
`https://<your-domain>/login` is the customer portal. They are the same
application.

### Why the API is not published

Nothing outside the container can reach it, and the browser never addresses it.
That is the point: the session token stays in an httpOnly cookie that only
Next.js reads, and a stored XSS on a portal page cannot exfiltrate it. Visiting
`/api/v1/...` on the public domain returns the portal's 404, which is correct.

## Alternative: two applications

`backend/` and `frontend/` are separate deployables and need a resource each.
Pointing a single resource at `backend/` gives you a JSON API on your domain and
no interface at all — which is easy to miss, because the build succeeds.

## Backend

| Setting | Value | Why |
|---|---|---|
| Base directory | `backend` | |
| Ports exposes | `4000` | Must match `PORT`. A mismatch is the "bad gateway" with a container that looks healthy. |
| Start command | `npm run start:container` | Set by `nixpacks.toml`. |

`npm run start:container` applies migrations and then runs `dist/main.js`.
Migrations run at boot rather than in a separate step because an application
started against a schema it does not match fails on the first request instead of
at boot, and the failure then looks like a bug rather than a deploy. Several
replicas starting at once is safe: `prisma migrate deploy` takes an advisory
lock.

Do **not** use `npm start` as the entry point. It is a development command — it
clears `dist` and recompiles through the Nest CLI, so it throws away the image's
build on every restart and needs the dev dependencies to stay installed.

### Node version

`engines` in `package.json` and `nixpacks.toml` both pin Node 22. Both, because
different builders read different ones, and the default without them was Node
18 — which `@nestjs/core` 11 does not support. That failure is quiet: npm prints
`EBADENGINE` for a handful of packages and carries on building.

### Runtime variables, not build variables

`JWT_ACCESS_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` must be **runtime** variables.
Set as build variables they become `ARG`/`ENV` in the Dockerfile, which puts them
in the image history where anyone who can pull the image can read them. Docker
says so during the build:

```
SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data
```

`DATABASE_URL`, `CLIENT_ORIGIN`, `ADMIN_ORIGIN`, `PORT` and
`RENEWAL_SWEEP_MINUTES` are ordinary runtime variables. See `.env.example` for
the full list — it documents names only.

### First deploy

Migrations run themselves; the seed does not, because it creates an
administrator and prints a password once. Run it against the deployed database:

```bash
npm run seed
```

Or use the setup wizard instead — see `INSTALL.md`.

### A note on `.dockerignore`

It is applied before the Dockerfile runs, so a pattern there can delete a file
the builder itself generated. `.nixpacks` looks like scratch output and is, but
the builder writes its Dockerfile and nix expression into it and then copies
them in — ignoring it fails the build at the third layer with `not found` for a
file written seconds earlier. `test/build-output.spec.ts` asserts what the build
context must still contain.

## Frontend

Both portals are one Next.js application. `/admin/...` and the customer pages are
route groups inside it, so there is one resource and one port — not two.

| Setting | Value |
|---|---|
| Base directory | `frontend` |
| Ports exposes | `3000` |
| Domain | the one people will visit |

`nixpacks.toml` pins Node 22 and the start command. Unlike the backend, `npm
start` is the right entry point: `next start` serves the build rather than
recreating it.

One variable:

```
API_BASE_URL=https://<backend-domain>/api/v1
```

Server-side only, and deliberately not prefixed `NEXT_PUBLIC_`: the browser
never talks to the API directly, so the session token stays in an httpOnly
cookie and out of browser JavaScript.

### The backend's origins must name this application

```
CLIENT_ORIGIN=https://<frontend-domain>
ADMIN_ORIGIN=https://<frontend-domain>
```

The same URL twice, because it is the same application. Pointing either at
`localhost` means the container itself, so CORS rejects every request the
browser makes and the portal fails with nothing useful in any log.

### Visiting the backend's domain gives a 404

That is correct: every API route is under `/api/v1`, and `/admin/login` is a page
this application serves, not the API. A 404 carrying `Content-Security-Policy`
and `X-Content-Type-Options` headers came from the API itself, which means the
container is up and the proxy is reaching it. A bare 404 or a 502 without those
headers is the proxy failing to reach the container — usually the exposed port
not matching `PORT`.

### Sign-in over plain HTTP

Session cookies are `secure` when `NODE_ENV` is `production`, which the builder
sets. A browser silently discards those over plain HTTP: sign-in appears to
succeed and returns to the login page with no error anywhere. Browsers treat
`*.localhost` as a secure context so a local demo may work, but anything on a
real domain needs HTTPS.

## The domain

The FQDN field takes a hostname — `panel.example.com` — not a URL and not a
markdown link. A `.localhost` domain resolves only on the machine running it, so
it is fine for a local demo and useless for anyone else.

## What is not automated

- **Payments.** Renewals raise invoices and mark them due. Nothing collects.
- **Mail.** The panel, routing rules and lookup maps are built; the Postfix and
  Dovecot servers are not deployed by any of this.
- **Provider resources.** Nothing is created on the upstream provider without an
  account configured.
