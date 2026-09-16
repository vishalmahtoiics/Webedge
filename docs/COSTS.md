# Recurring costs

**Milestone:** M0 (first estimate) — finalised in M7
**Date:** 2026-09-16
**Spec reference:** §2.1

The ₹20,00,000 budget covers **the build only**. This document estimates what WebEdge costs to *run*, which
is a separate and ongoing commitment.

> **These are planning estimates, not quotes.** Every figure needs confirming against a real quote before the
> owner commits. Provider pricing in particular depends on the ADR-001 decision, which is still open, and on
> the commercial terms the owner negotiates.

---

## 1. Platform infrastructure (WebEdge's own servers)

What it costs to run the control panel itself — the API, workers, database, Redis and portals.

| Item | Spec | Monthly (₹) | Notes |
|---|---|---|---|
| Production application server | 4 vCPU / 8 GB / 100 GB SSD | 3,000 – 6,000 | Runs API, workers, Nginx, portals via Docker Compose |
| Staging server | 2 vCPU / 4 GB | 1,200 – 2,500 | Required by §2.3; also where the provider spike runs |
| Managed PostgreSQL | 2 vCPU / 4 GB, automated backups | 2,500 – 6,000 | Self-hosting on the app server is cheaper but puts the restore path (§1.3) on WebEdge |
| Managed Redis | 1 GB | 800 – 2,000 | Sessions, cache, BullMQ. Can start on the app server. |
| Object storage | 100 GB + egress | 300 – 900 | Ticket attachments, invoice PDFs, future backups |
| Backups of the platform database | Offsite, retained 30 days | 300 – 800 | §1.3 requires a **tested** restore, not just a backup |
| **Subtotal** | | **8,100 – 18,200** | |

Start at the low end. The high end is where this lands at a few hundred customers.

## 2. Third-party services

| Item | Monthly (₹) | Notes |
|---|---|---|
| Transactional email | 0 – 1,500 | Free tiers cover early volume. Security notifications (§6.2) cannot be disabled, so this is not optional. |
| Error tracking | 0 – 2,000 | Self-hosted GlitchTip is ₹0 plus server load; hosted Sentry is the paid option |
| Uptime monitoring | 0 – 800 | |
| PageSpeed Insights API | 0 | Free within quota. Quota is monitored on the admin API-health page (§9.3). |
| SMS (2FA fallback, alerts) | 200 – 1,000 | Only if SMS is used; TOTP is the primary 2FA (§6.2) |
| Domain `webedgesolution.com` + TLS | ~100 | Let's Encrypt is free |
| **Subtotal** | | **300 – 5,400** | |

## 3. Provider hosting — depends on ADR-001

**This is the largest and least certain line.** It is a cost of goods sold, recovered from customers, not an
overhead — but it determines pricing and therefore whether the business works.

Under **ADR-001's recommendation (Agency Hosting)**, the shape is:

- Agency plans are sold per *order*, each holding a number of websites.
- `docs/PROVIDER-INTEGRATION.md` §5 models a practical ceiling of roughly **300–500 customers per provider
  account** before rate limits bind, independent of plan capacity.
- So cost scales in steps: each new order adds capacity; each new *account* adds a fresh rate-limit budget.

**Cannot be estimated without the owner's actual Agency Hosting pricing.** Required before M7:

1. Price per Agency Hosting order, at the term the owner will buy.
2. Websites included per order, and the cost of exceeding it.
3. Mail plan pricing per domain or per mailbox (drives ADR-002's economics).
4. Domain registration and renewal wholesale pricing, per TLD.

**Unit economics to compute once those are known:** provider cost per customer per month, against the WebEdge
plan price minus GST minus Razorpay fees. If that margin is thin at 50 customers, the plan structure needs
revisiting before M5 builds it.

## 4. Payment processing

| Item | Rate | Notes |
|---|---|---|
| Razorpay — domestic cards / UPI / net banking | ~2% + GST on fees | Confirm against the owner's negotiated rate |
| Razorpay — international cards | ~3% + GST on fees | |
| Settlement | Usually T+2 | Affects cash flow, not cost |

Fees are charged on the **GST-inclusive** amount collected, so they are computed on the gross, not the base
price. This matters when pricing plans — it is a common modelling error.

## 5. Professional and compliance

| Item | Cost (₹) | Frequency |
|---|---|---|
| Chartered Accountant — review GST logic and the invoice template | 15,000 – 40,000 | One-off, then annual filing retainer |
| GST filing | 1,000 – 3,000 | Monthly |
| Legal — ToS, Privacy, Refund, AUP | 25,000 – 75,000 | One-off |
| DPDP Act, 2023 data-protection review | 20,000 – 50,000 | One-off, revisited on material change |

These are §2.3 owner dependencies and sit outside the build budget. The legal and DPDP items should start
early — they block launch, not M1, but they take calendar time.

---

## 6. Summary

| | Monthly (₹) | Annual (₹) |
|---|---|---|
| Platform infrastructure | 8,100 – 18,200 | 97,000 – 2,18,000 |
| Third-party services | 300 – 5,400 | 3,600 – 65,000 |
| GST filing | 1,000 – 3,000 | 12,000 – 36,000 |
| **Fixed running cost** | **9,400 – 26,600** | **1,13,000 – 3,19,000** |
| Provider hosting | **Unknown — ADR-001** | Scales with customers |
| Payment fees | ~2–3% of revenue | Scales with revenue |
| One-off professional | — | 60,000 – 1,65,000 (first year) |

**The number the owner needs:** roughly **₹10,000–27,000 per month** to keep the platform running before any
customer exists, plus provider hosting and payment fees that scale. First-year professional fees add
₹60,000–1,65,000 on top.

## 7. What would change these figures

- **ADR-001 option B (VPS fleet)** would add server costs *and* an ongoing operations commitment — patching,
  security, backups, on-call — that this table does not price and the build budget does not fund. That is the
  main reason ADR-001 does not recommend it.
- **ADR-002 option B (self-hosted mail)** adds a VPS, IP reputation management and mail-storage backups.
- **Managed vs self-hosted PostgreSQL and Redis** is the largest controllable swing in section 1. Self-hosting
  saves ₹3,000–8,000 per month and moves the restore path onto WebEdge — acceptable early, worth revisiting
  once real customer data is at stake.

## 8. Open

- [ ] Agency Hosting pricing from the owner (blocks section 3 entirely)
- [ ] Negotiated Razorpay rate
- [ ] Choose managed vs self-hosted PostgreSQL and Redis
- [ ] Choose hosted vs self-hosted error tracking
- [ ] Confirm all figures against real quotes before M7 sign-off
