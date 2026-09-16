# Licence register

**Spec reference:** §2.2.2
**Updated:** 2026-09-16 (M0)

Every adopted component's licence is checked before adoption and recorded here.

> **The rule that matters (§2.2.2):** copyleft licences used in a network service — AGPL above all — can carry
> source-disclosure or notice obligations that conflict with WebEdge's brand isolation. An AGPL component
> serving customer traffic can oblige WebEdge to offer its own source to those users, which is incompatible
> with a white-label product. **Raise any AGPL or SSPL candidate with the owner before adopting it.**

---

## Adopted

No third-party runtime dependency has been adopted yet. M0 produced documentation only.

| Component | Version | Licence | Used in | Risk | Adopted |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## Checked during M0

| Component | Version | Licence | Verdict |
|---|---|---|---|
| `@hostinger/sdk` | 1.52.1 | To confirm before adoption | **Used in M0 for documentation research only** — its generated model docs were read to build the capability matrix. Not a dependency of any shipped code. Confirm the licence before M2 imports it. Sole runtime dependency is `axios`. |

## Planned, to check before adoption

The spec names these in §4.1. Each needs its licence confirmed and recorded here at the milestone that adopts
it — not assumed from memory, since licences change.

| Component | Milestone | Expected | Watch for |
|---|---|---|---|
| React, TypeScript, Vite/Next.js | M1 | MIT / permissive | — |
| Tailwind CSS | M1 | MIT | — |
| Radix UI (or equivalent headless primitives) | M1 | MIT | — |
| Motion (formerly Framer Motion) | M1 | MIT | Confirm the current package and licence after the rename |
| Lucide icons | M1 | ISC | — |
| Inter, JetBrains Mono | M1 | SIL OFL 1.1 | OFL permits self-hosting; keep the licence file with the fonts |
| NestJS, Prisma | M1 | MIT / Apache-2.0 | — |
| BullMQ | M1 | MIT | — |
| TanStack Query / Table | M1 | MIT | — |
| Monaco Editor | M4 | MIT | — |
| **IMAP/SMTP client library** | M6 | **Varies — check carefully** | Several mail libraries are MIT; some tooling around them is not |
| **Webmail foundations** | M6 | **Several are AGPL** | **Highest-risk item in the project.** Roundcube is GPL; other webmail projects are AGPL. Per ADR-002 WebEdge builds its own UI on an IMAP client rather than adopting a webmail application, which avoids this — but verify whatever is adopted. |
| Error tracking (Sentry SDK / GlitchTip) | M1 | SDKs MIT/BSD; **GlitchTip server is AGPL** | Self-hosting an AGPL *server* WebEdge does not modify and does not serve to customers is normally fine; confirm with the owner |
| Playwright, Vitest/Jest, axe-core | M1 | Apache-2.0 / MIT | axe-core is MPL-2.0 — fine for test-time use |

## How to record an adoption

When a component is adopted, add a row to **Adopted** with: name, exact version, licence with SPDX identifier,
where it is used, a risk note if the licence is anything other than a permissive one, and the date. Where a
licence requires attribution, note where that attribution is surfaced.

## Open

- [ ] Confirm `@hostinger/sdk` licence before M2
- [ ] Owner decision on any AGPL component, should one become necessary (M1 and M6 are where this could arise)
