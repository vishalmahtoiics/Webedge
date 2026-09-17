# Installing WebEdge

```bash
git clone <your-repo> webedge && cd webedge
cd backend && npm ci
npm run install:wizard
```

The last command prints a URL and a setup token. Open the URL, paste the token,
fill in four sections, and the installer does the rest: it writes `.env`,
generates the session and encryption keys, runs the migrations, seeds roles and
plans, creates your administrator, then locks itself.

## What it needs first

- **Node 22 or newer.** The installer checks and refuses to continue below it.
- **No compiler, no Python, no build toolchain.** Every dependency ships a
  prebuilt binary or is pure JavaScript. `npm ci` on a machine with nothing but
  Node installed is expected to work, and if it ever starts invoking `node-gyp`
  that is a regression worth fixing rather than a toolchain to install.
- **PostgreSQL 14 or newer**, with a database and a user already created. The
  installer does not create databases — doing so needs credentials with rights
  over the whole server, which is not something a setup wizard should hold.

```sql
CREATE DATABASE webedge;
CREATE USER webedge WITH PASSWORD 'something long';
GRANT ALL PRIVILEGES ON DATABASE webedge TO webedge;
```

## The setup token

The installer has to run before any administrator exists, so there is nobody to
authenticate as. What can be required instead is proof of access to the server:
the token is written to `backend/.webedge/install.token` with owner-only
permissions and printed to the terminal of whoever started the installer. Anyone
who can read it already has the filesystem.

The wizard binds to `127.0.0.1` for the same reason. On a remote server, reach
it through an SSH tunnel rather than exposing it:

```bash
ssh -L 4500:127.0.0.1:4500 you@your-server
```

`--host 0.0.0.0` exists and prints a warning when used. For as long as
installation takes, it is an unauthenticated endpoint that can write the
database connection and create an administrator.

## After it finishes

The installer deletes the setup token, writes `backend/.webedge/install.lock`,
and closes. Every setup route then answers 409, and the wizard will not start
again.

`.env` is **kept**. The application needs it to run, and an installer that tidies
away the configuration it just wrote leaves a deployment that cannot boot. It is
written `0600` — readable only by the account that owns it.

The administrator password is shown once, on the final screen. It is stored as an
argon2id hash and nothing in the codebase can recover it; a forgotten one is
reset, not retrieved.

## Reinstalling

Deliberately not a button. Re-opening the wizard means whoever reaches it can
repoint the database and create themselves an administrator, so it takes a shell
on the server:

```bash
rm backend/.webedge/install.lock
npm run install:wizard
```

## If something goes wrong

Every failure names four things: what failed, why, what to do, and whether
retrying unchanged could work. A wrong database password says so and points at
that field; a missing database says so and gives the `CREATE DATABASE` line.

Migrations and seeding are both safe to re-run, so a failure partway through is
recovered by fixing the cause and running the installer again. Nothing is locked
until every step has succeeded.

An existing `.env` is copied to `.env.replaced-<timestamp>` before a new one is
written — running the installer on a configured machine does not destroy the
only copy of your configuration.

## If `npm ci` fails building a native module

It should not, and the fix is in the dependency rather than on your server.

This happened once with the `argon2` package: its prebuilt Linux binary requires
GLIBC_2.34, and Enterprise Linux 8 — which most managed and shared hosting still
runs — has glibc 2.28. The prebuild fails to load, npm falls back to compiling
from source, and `node-gyp`'s bundled Python code needs 3.8+ while EL8 ships
3.6.8. The install dies with a `SyntaxError` inside a Python file, which points
at none of the three real causes.

It was replaced with `@node-rs/argon2`, whose binary needs only GLIBC_2.14.
If another dependency does the same thing, the answer is the same: find one that
ships a binary your platform can actually load. Installing a compiler on a
production host to build a cryptography library is the worse trade.

## What the installer does not do

- **Install dependencies.** `npm ci` is the step before it, from your shell. An
  HTTP endpoint that installs packages is remote code execution with a friendly
  form in front of it, and the one thing a setup wizard must not be is a way to
  run code on the server.
- **Create the database or its user.** That needs server-wide rights.
- **Configure a web server or TLS.** See `nginx/`.
- **Install example content.** The option is in the wizard and the data does not
  exist yet; the installer says so rather than reporting success.
