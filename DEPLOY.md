# Deploying WebEdge

Written against a Coolify/Nixpacks deploy, but the reasoning applies to any
platform that builds from the repository.

## Two applications, not one

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

| Setting | Value |
|---|---|
| Base directory | `frontend` |
| Ports exposes | `3000` |
| Build | `npm run build` |
| Start | `npm run start` |

It needs the API's public URL, and `CLIENT_ORIGIN` / `ADMIN_ORIGIN` on the
backend must name the frontend's URL, or CORS refuses the browser's requests.

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
