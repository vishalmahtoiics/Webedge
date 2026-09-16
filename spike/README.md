# Provider spike

M0 deliverables 2 and 4 (spec §5.3): exercise the provider's read endpoints, save sanitized fixtures, and
measure real rate-limit headroom.

**Everything here is blocked on one thing: a staging Hostinger account and API token** (§2.3). The tooling is
ready so that the moment the token exists, the spike runs the same day.

## Safety

There is **no provider sandbox**. Every call touches a real account.

- `probe.ts` is **strictly read-only**. It issues no writes, by construction — there is no flag to make it
  write.
- `isolation-test.md` **does** write, and needs the owner's explicit go-ahead first (§5.3.2). It only ever
  touches disposable resources named `wetest-`.
- Use a staging token, never production. Put it in `.env`, never in a chat session, an issue, or a commit.

## Order of work

**1. Run the isolation test first** — `isolation-test.md`.

It decides whether ADR-001's recommendation survives, and therefore whether M2 can start at all. Running the
capability probe first would mean gathering detail about an architecture that might be void.

**2. Then run the capability probe.**

```bash
export HOSTINGER_STAGING_API_TOKEN='...'
node spike/probe.ts
```

No install step. Node 22 runs TypeScript natively, so the probe has zero dependencies — which also avoids
adopting `@hostinger/sdk` before its licence is confirmed (`docs/LICENSES.md`).

It runs 7 inventory probes, then up to 11 detail probes using the identifiers inventory discovered, skipping
any family the account does not hold. Requests are sequential with a 900 ms gap: repeated `429`s can get the
calling IP temporarily blocked (§5.2), and this is the owner's real account.

Output: `spike/fixtures/probe-report.json`.

## What the probe answers

Each probe carries the question it exists to settle. The ones that matter most:

| Probe | Settles |
|---|---|
| `agency-website-detail` | Does `user.username` differ per website? Are `remote_access.sftp`, `ssl`, `preview_domain` populated? This is the probe that corroborates ADR-001. |
| `hosting-account-cron`, `hosting-account-databases` | Confirms shared hosting is account-scoped — the §5.4 failure. |
| `agency-disk-usage` vs `agency-resource-usage` | Is disk really order-level with no per-website breakdown, while CPU/memory break down per website? |
| `mail-plan`, `mail-mailboxes` | Is quota really a plan property, and is mailbox usage actually populated? Decides whether §8.4's quota controls are buildable. |
| all | Rate-limit headers, which is the only non-destructive way to learn the real global limit. |

## Sanitization

Fixtures are meant to be committed, so the probe records **structure, not values**:

- Response bodies are reduced to key names and value types. A string is recorded as `<string>` or
  `<empty string>` — never its contents. Whether a documented field is ever populated is itself a finding.
- Sensitive keys (`username`, `ipv4`, `host`, `fqdn`, `auth_key`, `password`, `token`, …) become
  `<redacted>`.
- Discovered identifiers are substituted out of the recorded URLs, so paths read
  `/api/hosting/v1/accounts/{hostingUsername}/databases` rather than carrying the real account username.

This was verified against a mock returning planted secrets: none reached the fixture.

**Still read the fixture before committing it.** The redaction list is good, not omniscient, and a new
provider field could carry something sensitive in a key nobody has seen yet. `docs/audit/spike-raw/` is
gitignored if you need somewhere to keep an unsanitized capture locally.

## After the spike

1. Update `docs/PROVIDER-INTEGRATION.md` — promote `[?]` items to `[V]`, or correct them.
2. Record the real rate limit in §5 and re-run the headroom model with it.
3. Record the isolation result in `docs/PROGRESS.md` and set ADR-001's status.
4. Commit the sanitized fixture alongside those updates, so a reader can see what the conclusions rest on.
