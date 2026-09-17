# WebEdge Mail

Postfix and Dovecot read everything they need from the same PostgreSQL database
the panel writes to. There is no sync job, no flat file to regenerate and no
window in which the two disagree: a mailbox created in the panel is live on the
next lookup.

## The queries are the second line of defence, not a convenience

Every query here filters on `mail_domains.status = 'ACTIVE'` and on the row's
own `isActive`. That is deliberate duplication. The panel already refuses to
build on an unverified domain — but the panel is not what answers the connection
on port 25, and the two must fail independently.

Concretely: if a `mail_domains` row ever reaches `ACTIVE` without ownership
having been proved — a migration, a support fix applied with `psql`, a defect —
the panel's checks are already behind us. These queries are what still stands
between that row and another company's mail being delivered to a stranger.

`backend/test/mail-lookup-maps.spec.ts` runs these exact queries through
`postmap -q` against a real Postgres and asserts they refuse a pending domain, a
suspended domain, an inactive mailbox and an inactive alias.

## Why `.example` files

The real `.cf` files carry a database password, and a password committed to git
is a password that has leaked. Copy each one, fill in the credentials, and keep
the copies out of version control — `.gitignore` already covers them.

## Files

| | |
|---|---|
| `postfix/pgsql-virtual-mailbox-domains.cf` | Which domains this server accepts mail for |
| `postfix/pgsql-virtual-mailbox-maps.cf` | Which addresses have a mailbox, and its maildir path |
| `postfix/pgsql-virtual-alias-maps.cf` | Named forwarding, one row per destination |
| `postfix/pgsql-virtual-alias-catchall.cf` | The `*` catch-all, queried second so a named alias wins |
| `dovecot/dovecot-sql.conf.ext` | Dovecot's password, user and iterate queries |

In `main.cf`, the two alias maps are listed in order — the named map first:

```
virtual_alias_maps =
    pgsql:/etc/postfix/pgsql-virtual-alias-maps.cf
    pgsql:/etc/postfix/pgsql-virtual-alias-catchall.cf
```

Postfix stops at the first map that answers, so precedence comes from the
ordering rather than from row order inside a single query, which nothing
guarantees.

## Still to decide

Where these servers run. The queries are the same either way — only `hosts` and
`connect` change — but the answer decides the delivery architecture, the IP
reputation work, and whether DKIM private keys need the same AES-256-GCM
treatment as provider credentials.

## Not built yet

DKIM signing, SPF and DMARC alignment, Rspamd, quota enforcement at delivery,
and webmail. The panel stores `quotaMib` and the Dovecot `user_query` emits a
`quota_rule` from it, but nothing has yet measured usage back into `usedMib` —
which is why the panel shows "Usage not available" rather than a zero.
