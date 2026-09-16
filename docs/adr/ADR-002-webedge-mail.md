# ADR-002: WebEdge Mail

**Status:** Proposed — awaiting owner decision
**Date:** 2026-09-16
**Milestone:** M0 (decision) / M6 (build)
**Spec reference:** §0.1, §1.3, §5.1 (`MailPort`, `MailboxAccessPort`), §8.4
**Decision owner:** project owner
**Depends on:** ADR-001

---

## Context

§0.1 records the unresolved tension this ADR settles:

> "WebEdge Mail must be real infrastructure" vs budget. Decided in ADR-002. **In every option, quotas are
> enforced by the mail system itself, never simulated in PostgreSQL.**

M6 has three weeks and ₹2,00,000. The deliverable is mailbox management, quotas, email DNS health, and
webmail branded "WebEdge Mail" at `mail.webedgesolution.com`.

Two ports are involved and they have very different answers:

- **`MailPort`** — provisioning: mailboxes, aliases, forwarders, auto-replies, catch-alls, quotas, logs.
- **`MailboxAccessPort`** — webmail: folders, list/search messages, read, send, flags, move, delete,
  attachments.

---

## Evidence

From `docs/PROVIDER-INTEGRATION.md` §3.5, verified against `@hostinger/sdk@1.52.1`:

**`MailPort` is well covered.** 38 endpoints: mail orders and plan quotas, mailbox create/delete (soft delete,
restorable) and password change, aliases, forwarders with confirmation flows, auto-replies, catch-alls, five
log streams, per-mailbox webhooks.

**Quota data is real.** `MailV1MailboxesMailboxUsageResource` returns `storage_used`, `storage_quota`,
`messages_used`, `messages_quota`, `synced_at` — enforced by the mail system, read by WebEdge. §0.1's
requirement is satisfied by the provider without WebEdge doing anything clever.

**But quota is a plan property, not a mailbox property.** There is no per-mailbox quota-change endpoint.
§8.4's "quota from the remaining plan allowance" and "quota change within plan" are not implementable.

**Webmail access exists but is awkwardly scoped.** A separate **Hostinger Email API** at
`https://api.mail.hostinger.com/` is reached with tokens minted by
`POST /api/mail/v1/orders/{orderId}/api-tokens`. Each token is scoped either to `has_all_mailboxes: true` or
an explicit mailbox list, and **a maximum of 10 tokens may exist per order**.

Per-mailbox protocol flags are exposed: `is_imap_enabled`, `is_pop3_enabled`, `is_smtp_in_enabled`,
`is_smtp_out_enabled`. So standard IMAP and SMTP are available to mailbox users.

---

## Options

### A. Hostinger Mail for everything — provisioning *and* webmail via the Email API

`MailPort` maps cleanly. `MailboxAccessPort` uses the Email API with an order-scoped token.

**The 10-token ceiling makes this unsafe.** Per-mailbox tokens cannot scale past ten mailboxes per order, so
WebEdge must hold one `has_all_mailboxes` token per order and enforce per-mailbox access control itself. A
single authorization bug in WebEdge then exposes **every mailbox on that order, across every customer sharing
it** — the highest-severity failure in the whole product, and precisely the cross-tenant threat §6.1 is built
to prevent. Storing a credential whose blast radius is "all mail for many customers" is the wrong shape.

### B. WebEdge-operated mail stack on a VPS

Postfix + Dovecot (or Stalwart/Mailu), WebEdge-controlled. Best brand isolation: MX, IMAP and SMTP hostnames
are WebEdge's, `Received` headers are WebEdge's, DKIM signs with WebEdge selectors.

The cost is deliverability and operations. IP reputation, warm-up, SPF/DKIM/DMARC alignment, feedback loops,
blocklist monitoring, spam filtering, backups of mail storage, and 24/7 availability — mail is the least
forgiving service to run badly, and customers notice within hours. M6's three weeks cannot absorb this on top
of building the product, and §2.1's budget carries no ongoing mail-operations line.

Licence caution (§2.2.2): several webmail and mail-stack projects are AGPL. In a network service, AGPL can
carry source-disclosure obligations that conflict with brand isolation. Check before adopting.

### C. Hostinger Mail for provisioning + IMAP/SMTP for webmail — **recommended**

`MailPort` → Hostinger Mail API, exactly as option A.

`MailboxAccessPort` → the webmail client authenticates **as the mailbox user, over IMAP and SMTP, with the
user's own mailbox password**, the way every webmail client has always worked.

This removes the shared-credential problem entirely:

- WebEdge never holds a credential that can read other customers' mail.
- The mail server enforces per-mailbox authorization, not WebEdge application code.
- A WebEdge authorization bug cannot cross mailboxes, because the IMAP session is already bound to one.
- No dependency on the 10-token ceiling, and no dependency on the Email API's shape (which could not be
  read from this environment).

Costs: the user signs in to WebEdge Mail with their mailbox password — a second sign-in, since WebEdge does
not hold mailbox passwords (they are set, never retrieved). That is standard webmail behaviour and honest:
WebEdge genuinely cannot read the customer's mail. Session handling holds the IMAP credential server-side for
the session only, encrypted, never in the browser.

### D. Third-party mail provider (Google Workspace / Microsoft 365 resale)

Excellent deliverability, no operations. But the brand is the product being sold and cannot be hidden, and
margins are thin. Fails §1.1's premise.

---

## Comparison

| | A (Hostinger + Email API) | B (self-hosted) | **C (Hostinger + IMAP/SMTP)** | D (third party) |
|---|---|---|---|---|
| Quotas enforced by mail system (§0.1) | Yes | Yes | **Yes** | Yes |
| Cross-tenant blast radius | **Order-wide** | Per mailbox | **Per mailbox** | Per mailbox |
| Brand isolation | Partial | **Full** | Partial | **None** |
| Deliverability risk | Low | **High** | Low | Lowest |
| Ops burden | Low | **Very high** | Low | Lowest |
| Fits M6 (3 weeks, ₹2,00,000) | Yes | **No** | **Yes** | Yes |
| Customer sign-in | Single | Single possible | **Second sign-in** | Separate |

---

## Decision

**Recommended: C.** Hostinger Mail for provisioning; IMAP/SMTP with per-user authentication for webmail.

It is the only option that keeps the cross-tenant blast radius at one mailbox while fitting the milestone. The
second sign-in is a real cost, and the right one to pay.

Build webmail on a maintained IMAP client library behind the `MailboxAccessPort` interface (§2.2.1: integrate
commodity, build the differentiator). Check the licence of anything adopted and record it in
`docs/LICENSES.md` (§2.2.2) — the AGPL caution above applies directly here.

### Consequences for the leak register

`MailPort` choices leave these open, and they are the hardest vectors in §5.6 because mail hostnames must
resolve and present valid TLS:

| Vector | Under C |
|---|---|
| MX records | Provider-owned. **Accepted** — unavoidable without option B. |
| IMAP/SMTP hostnames in setup instructions | **Open.** Test whether a WebEdge CNAME presents valid TLS. Otherwise Accepted. |
| `Received` headers | Provider-owned. **Accepted.** |
| DKIM signing domain and selector | **Open.** Test whether DKIM can sign as the customer's domain with a WebEdge-controlled selector. |

If the owner judges mail brand leaks unacceptable, that is a decision for **B**, and it must come with an
explicit ongoing mail-operations budget and a longer M6. It should not be adopted implicitly.

### Consequences for §8.4

- **Mailbox quota controls are removed.** Recommended resolution: sell mail plans whose quota equals what
  WebEdge advertises, so plan == quota and the UI shows a real, unchangeable number
  (PROVIDER-INTEGRATION §4, item 1).
- Connection settings (IMAP/SMTP/POP3 hosts, ports, encryption) render from the leak-register decision above.
- Mailbox deletion may state a restore window — the provider really does soft-delete, so §8.4's caveat
  ("mention a restore window only if the backend really provides one") is satisfiable. **[?]** Confirm the
  exact window during the spike before putting a number in the UI.

### Open questions before M6

1. What does `api.mail.hostinger.com` actually expose? Could not be read from this environment. If it turns
   out to support per-mailbox OAuth-style delegation rather than only order-scoped tokens, revisit option A.
2. Can IMAP/SMTP be reached on WebEdge-branded hostnames with valid TLS?
3. Can DKIM sign with a WebEdge-controlled selector on customer domains?
4. What is the exact mailbox soft-delete restore window?
