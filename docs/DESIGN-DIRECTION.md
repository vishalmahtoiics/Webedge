# Design direction

**Milestone:** M1 gate — must be approved by the owner **before** components are built
**Date:** 2026-09-16
**Spec reference:** §7.1, §7.2
**Status:** Proposed — awaiting owner approval

---

## 0. Missing input

§0 says the owner places the dashboard reference screenshot at `docs/design/reference/`, and that if it is
missing it should be asked for before M1 design work.

**It is missing.** This document was written from the spec's written description of the reference instead —
"a dark compact navigation area, a large bright workspace, rounded components, soft borders, restrained
shadows, small status indicators, strong type hierarchy, generous whitespace". That description is enough to
propose a direction, but not enough to confirm the direction matches what the owner has in mind.

**Please supply the screenshot before approving this document.** It is visual direction only; its logos, text,
assets, colours and pixel layout are not copied (§7.1).

---

## 1. Palette

Starting from §7.2's proposal, with every text and background pairing contrast-checked. **Three tokens changed
and one added** — see §1.2.

### 1.1 Tokens

| Token | Hex | Use |
|---|---|---|
| `nav.bg` | `#0F1A2A` | Sidebar background ("Harbor") |
| `nav.fg` | `#B8C3D1` | Sidebar labels and icons |
| `nav.fg.active` | `#FFFFFF` | Active navigation item |
| `nav.edge` | `#3FC1C9` | Signature edge line on dark surfaces |
| `canvas` | `#F5F7FA` | Workspace background |
| `surface` | `#FFFFFF` | Cards, tables, dialogs |
| `border` | `#E4E8EE` | Default separation between surfaces |
| `border.strong` | `#CDD4DE` | Emphasised separation, hover borders |
| **`border.input`** | **`#7E8A9C`** | **New.** Borders of interactive controls — inputs, selects, checkboxes |
| `text` | `#142033` | Primary text |
| `text.muted` | `#566175` | Secondary text |
| **`text.subtle`** | **`#656F82`** | **Changed** from `#6B7589`. Metadata |
| `primary` / `.hover` / `.soft` | `#0A7285` / `#085E6E` / `#E7F3F5` | Primary actions, links, focus ring, selected ("Edge Teal") |
| **`success`** / `.soft` | **`#177444`** / `#EAF6EF` | **Changed** from `#1A7F4B`. Healthy, completed |
| `warning` / `.soft` | `#A15C07` / `#FDF3E3` | Needs attention soon |
| `danger` / `.soft` | `#B42318` / `#FDECEA` | Critical, destructive |
| `info` / `.soft` | `#2D5BD3` / `#EDF2FD` | Informational |

Colour carries meaning, never decoration. Status is never colour alone — always a dot or icon **plus** a text
label (§7.2).

### 1.2 Contrast verification and what changed

Every pairing was computed against WCAG 2.2 (4.5:1 body text, 3:1 large text and UI component boundaries).
Full results are reproducible; the three findings that mattered:

**Finding 1 — `text.subtle` failed on `canvas`.** `#6B7589` gives 4.63:1 on white but **4.32:1 on `#F5F7FA`**,
below 4.5. The spec anticipated this by restricting the token to "white surfaces only", but a token that is
safe on one background and unsafe on another is a defect waiting to ship — it depends on every future
developer remembering the restriction.

> **Changed to `#656F82`** — 5.06:1 on white, 4.72:1 on canvas. Passes everywhere, so the restriction can be
> dropped and the footgun disappears.

**Finding 2 — no token for interactive borders.** `border.strong` (`#CDD4DE`) is 1.49:1 on white. For a card
or table divider that is fine: WCAG's 3:1 non-text requirement applies to boundaries needed to *identify or
operate a control*, not to decorative separation. But it is not fine for a text input, where the border is the
only thing that shows the control exists and where it ends.

> **Added `border.input` = `#7E8A9C`** — 3.50:1 on white, 3.26:1 on canvas. Card and table borders keep the
> soft `#E4E8EE` / `#CDD4DE`, preserving the quiet look; form controls get a border you can actually see.
> This is the fix that most affects how the product feels to use.

**Finding 3 — `success` on `success.soft` had almost no headroom.** 4.53:1 against a 4.5 threshold survives
review but not a future tweak.

> **Changed to `#177444`** — 5.23:1. Visually near-identical, materially safer.

Everything else passed, several comfortably: `text` on `surface` 16.35:1, `nav.fg` on `nav.bg` 9.79:1,
`nav.edge` on `nav.bg` 8.06:1, white on `primary` 5.59:1.

**Dark theme (Tier 2)** is a separately tuned palette, never an inversion (§7.8). Because every component
above consumes semantic tokens only, it stays a token swap.

---

## 2. Typography

**Inter**, self-hosted variable, for all UI text. **JetBrains Mono**, self-hosted, only for technical values —
DNS values, IP addresses, file paths, hostnames, credentials, code. Never for labels.

Tabular numerals in tables and metrics, so digits align in a column and a changing value does not reflow.
Sentence case everywhere; no all-caps eyebrow labels; prose capped at 80 characters.

| Role | Size / line height | Weight |
|---|---|---|
| Page title | 28 / 36 (24 / 32 mobile) | 600 |
| Section title | 18 / 28 | 600 |
| Card title | 15 / 22 | 600 |
| Body | 14 / 22 | 400 |
| Table cell | 13 / 20 | 400 |
| Metadata | 12 / 18 | 400 |
| Badge | 12 / 16 | 500 |

**On Inter's `cv11` alternate** (single-storey "a"), which §7.1 asks to evaluate: **do not enable it.** It is a
recognisable stylistic tell that reads as "designed in 2024", and it slightly reduces the distinction between
`a` and `o` at 12–13px — which is where this product does its most important reading, in DNS values and file
paths. Default Inter is unremarkable in a good way. **Enable `cv05`** (an `l` with a tail) instead: it is one
feature, it targets the genuine `1` / `l` / `I` confusion that matters when reading a hostname or a generated
password, and nobody will consciously notice it. Distinctiveness comes from the edge line, not the letterforms.

---

## 3. Signature element: the edge line

A 2px accent line that marks **"where you are"** — and nothing else.

- The active navigation item (in `nav.edge` on the dark sidebar)
- The selected website in the website selector
- The active tab

It is never decoration, never a divider, never applied to a card because the card looked plain. That
restriction is what keeps it meaningful: because the line appears only on the current thing, the eye learns in
about a minute to find the current thing by looking for the line.

Everything around it stays quiet: no decorative gradients, no glassmorphism, no neon, no oversized cards or
type, no heavy shadows, no charts used for decoration, no animation on everything (§7.1).

**Cards carry a 1px border and no shadow at rest.** Interactive cards on hover gain `border.strong` and a
faint navy-tinted shadow, plus a 1px lift. Static information cards do not move — if it moves, it is clickable.
That is the second thing the interface teaches without saying it.

---

## 4. Dashboard wireframes

Following §8.3's layout. Content is illustrative; the structure is the proposal.

### 4.1 Desktop (1280px and up) — sidebar 248px expanded

```
┌────────────────┬──────────────────────────────────────────────────────────────────────────┐
│                │  Dashboard / ‹breadcrumb›        [website selector ▾]  [/] [🔔3] [?] [◐] │
│  ▌WebEdge      ├──────────────────────────────────────────────────────────────────────────┤
│                │                                                                          │
│  ▌Dashboard    │  Dashboard                                                               │
│   Websites     │  Manage your websites, domains, email and hosting resources in one place.│
│   Domains      │                                                                          │
│   Email        │  ┌──────────────────────────────────────────────┬───────────────────────┐│
│   Billing      │  │ ◉  example.com                     Active    │  Business plan        ││
│   Support      │  │    Created 12 Mar 2026 · SSL valid           │  5 websites · 100 GB  ││
│  ──────────    │  │    [Manage website]  [Open website ↗]        │  Renews 14 Oct 2026   ││
│   Activity     │  ├──────────────────────────────────────────────┤  [Upgrade plan]       ││
│   Settings     │  │ ⚠  SSL expires in 9 days                     ├───────────────────────┤│
│                │  │    Renews automatically. [Check config]      │  Quick actions        ││
│                │  ├──────────────────────────────────────────────┤  [+ Website]  [✉ Mail]││
│                │  │ Essentials                                   │  [📁 Files]  [⚙ DNS] ││
│                │  │ ┌────────┬────────┬────────┬────────┬───────┐│  [🗄 Database] [↻ Bkp]││
│                │  │ │ Files  │ Databs │ Email  │  DNS   │  SSL  │├───────────────────────┤│
│                │  │ │ 2.1 GB │   3    │ 4 / 10 │ 18 rec │ Valid ││  Security             ││
│                │  │ │ Manage │ Manage │ Manage │ Manage │ View  ││  SSL valid            ││
│                │  │ └────────┴────────┴────────┴────────┴───────┘│  PHP 8.3 supported    ││
│                │  ├───────────────────────┬──────────────────────┤  No known issues      ││
│                │  │ Resource usage        │ Performance          ├───────────────────────┤│
│                │  │ Storage   ▓▓▓▓▓▓░░ 62%│   Mobile    Desktop  │  Recent activity      ││
│                │  │ Databases ▓▓▓░░░░░ 3/8│     72         94    │  ▪ DNS record updated ││
│                │  │ Mailboxes ▓▓▓▓░░░░4/10│   Tested 2 days ago  │  ▪ File uploaded      ││
│                │  │ Updated 4 min ago   ↻ │   [Run speed test]   │  ▪ Mailbox created    ││
│                │  ├───────────────────────┼──────────────────────┤  ▪ Payment received   ││
│                │  │ Domains               │ Email                │  ▪ Backup requested   ││
│                │  │ 3 domains             │ 4 of 10 mailboxes    │  ▪ Signed in          ││
│                │  │ 1 expires in 21 days  │ Email DNS: all pass  │  [View all]           ││
│                │  └───────────────────────┴──────────────────────┴───────────────────────┘│
└────────────────┴──────────────────────────────────────────────────────────────────────────┘
  ▌ = the 2px edge line marking the current item
```

### 4.2 Tablet (768–1023px) — sidebar collapses to a 72px icon rail

```
┌────┬─────────────────────────────────────────────────────────────┐
│ ▌W │  Dashboard          [website selector ▾]   [/] [🔔3] [?] [◐]│
│    ├─────────────────────────────────────────────────────────────┤
│ ▌⌂ │  Dashboard                                                  │
│  ▣ │  Manage your websites, domains, email and hosting resources.│
│  ◈ │                                                             │
│  ✉ │  ┌───────────────────────────────┬─────────────────────────┐│
│  ₹ │  │ ◉ example.com        Active   │ Business plan           ││
│  ? │  │   Created 12 Mar · SSL valid  │ 5 websites · 100 GB     ││
│ ── │  │   [Manage]  [Open ↗]          │ Renews 14 Oct           ││
│  ↻ │  └───────────────────────────────┴─────────────────────────┘│
│  ⚙ │  ┌─────────────────────────────────────────────────────────┐│
│    │  │ ⚠ SSL expires in 9 days          [Check configuration]  ││
│    │  └─────────────────────────────────────────────────────────┘│
│    │  ┌──────────────────────────┬──────────────────────────────┐│
│    │  │ Essentials (3 × 2 grid)  │ Quick actions (2-col icons)  ││
│    │  ├──────────────────────────┼──────────────────────────────┤│
│    │  │ Resource usage           │ Performance                  ││
│    │  ├──────────────────────────┼──────────────────────────────┤│
│    │  │ Domains                  │ Email                        ││
│    │  ├──────────────────────────┴──────────────────────────────┤│
│    │  │ Security                 │ Recent activity              ││
│    │  └──────────────────────────┴──────────────────────────────┘│
└────┴─────────────────────────────────────────────────────────────┘
  Icons carry tooltips. Two-column card grid throughout.
```

### 4.3 Mobile (below 768px) — sidebar is an off-canvas drawer

Order per §8.3: website summary → alerts → quick actions → essentials → resource usage → performance → plan
→ security → domains → email → recent activity.

```
┌───────────────────────────────┐
│ ☰   Dashboard      🔔3    ◐   │  56px top bar, page title (no breadcrumbs)
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │ ◉ example.com      Active │ │
│ │   Created 12 Mar 2026     │ │
│ │   SSL valid               │ │
│ │ [Manage website]          │ │  full-width primary, 44px min height
│ │ [Open website          ↗] │ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ ⚠ SSL expires in 9 days   │ │
│ │   Renews automatically.   │ │
│ │   [Check configuration]   │ │
│ └───────────────────────────┘ │
│ Quick actions                 │
│ ┌─────────────┬─────────────┐ │  2-column icon grid,
│ │  + Website  │   ✉ Mail    │ │  44×44 minimum targets
│ ├─────────────┼─────────────┤ │
│ │  📁 Files   │   ⚙ DNS     │ │
│ ├─────────────┼─────────────┤ │
│ │ 🗄 Database │  ↻ Backups  │ │
│ └─────────────┴─────────────┘ │
│ Essentials                    │
│ ┌───────────────────────────┐ │  single column, full-width tiles
│ │ 📁 Files      2.1 GB    › │ │
│ ├───────────────────────────┤ │
│ │ 🗄 Databases      3     › │ │
│ ├───────────────────────────┤ │
│ │ ✉ Email      4 / 10     › │ │
│ └───────────────────────────┘ │
│ Resource usage                │
│ ┌───────────────────────────┐ │
│ │ Storage    ▓▓▓▓▓▓░░  62%  │ │
│ │ Databases  ▓▓▓░░░░░  3/8  │ │
│ │ Mailboxes  ▓▓▓▓░░░░  4/10 │ │
│ │ Updated 4 min ago       ↻ │ │
│ └───────────────────────────┘ │
│            ⋮ (continues)      │
└───────────────────────────────┘
```

**Mobile is designed, not stacked** (§7.10). The differences are deliberate: quick actions are promoted above
essentials because on a phone people arrive to *do one thing*; essentials become full-width rows with a
chevron rather than shrunken tiles; the website summary's two actions go full-width rather than sitting side
by side at 140px each.

---

## 5. Honest comparison against a generic SaaS admin template

§7.1 requires this document to compare the direction against generic templates, revise anything that reads as
a default rather than a choice, and say what changed.

### What was generic in the first pass, and what changed

| Was | Problem | Now |
|---|---|---|
| Stat cards in a row of four across the top | The single most template-ish pattern in existence. Four big numbers that nobody acts on. | **No stat-card row.** The dashboard opens with the *website*, because that is what the customer came for. Numbers appear inside Resource usage, where they have context and a limit to sit against. |
| A chart on the dashboard | Charts on a customer hosting dashboard are decoration; a customer with one website has nothing to plot. | **No charts in the customer portal.** Sparklines are admin-only (§7.3). Performance shows two scores and a date. |
| Coloured status pills everywhere | Colour-only status fails accessibility and turns the page into confetti. | Dot **plus** text label, one status per card, greyscale unless the status is actionable. |
| Purple/violet primary | Generic — and it evokes the upstream provider's identity (§7.1). | **Edge Teal `#0A7285`** on deep navy. |
| Drop shadows on every card | Reads as 2019 Bootstrap. | 1px border, no shadow at rest. Shadow only on hover for clickable cards, and on overlays. |
| Uniform 8px radius everywhere | Uniform radius is the default nobody chose. | Radius follows hierarchy: 6 badges, 8 buttons/inputs, 12 cards, 16 dialogs/drawers, full for avatars and dots. |
| Sidebar with 14 flat items | Overwhelming, and it buries the common tasks. | Eight top-level items with website-scoped tools revealed progressively (§8.1). |
| An animated entrance on every card | Makes a page feel slow and cheap. | Route content fades and rises 6px, once. No per-card stagger. |

### What is deliberately conventional

Not everything should be distinctive. These are conventional on purpose, because familiarity is worth more
than novelty in an infrastructure tool:

- Left sidebar, top bar, breadcrumbs.
- `Ctrl/Cmd+K` search, `/` to focus.
- Tables on desktop, cards on mobile.
- Destructive actions in red, with the resource named in the confirmation.

**The test in §7.10:** it should look like WebEdge, not like the reference and not like a template. The one
thing a customer should remember is the teal edge line tracking where they are on a deep navy rail, against a
large calm workspace. Everything else should be unremarkable enough to disappear.

---

## 6. What the owner is approving

1. The palette in §1, including the three changed tokens and one added token.
2. Inter with `cv05`, not `cv11`, and JetBrains Mono restricted to technical values.
3. The edge line as the sole signature element, with its restriction to "where you are".
4. The dashboard structure in §4 at all three breakpoints — in particular **no stat-card row and no charts**.
5. The conventional/distinctive split in §5.

Once approved, `packages/ui` implements these as semantic tokens and the living style guide at
`/design-system` (development and staff only, never publicly reachable in production) renders every component
in every state for visual QA at each milestone.

**Please also supply the reference screenshot (§0) before approving.**
