# Repository audit

**Milestone:** M0
**Date:** 2026-09-16
**Repository:** `vishalmahtoiics/Webedge`
**Audited ref:** no commits existed at audit time
**Spec reference:** §3.1

---

## 1. Headline finding

**The repository was empty.** Not "sparse", not "a prototype we should be careful with" — empty. There was no
commit, no branch, and no file on the remote or in the local clone.

This matters because the master spec is written throughout on the assumption that an existing application is
being extended. §0.1 resolves an ambiguity in favour of "the existing repository's stack wins"; §3 is an entire
section devoted to not breaking working behaviour. **Neither applies.** WebEdge is a greenfield build.

The owner should confirm this is expected. If there is an existing WebEdge codebase somewhere else — a
different repository, a different account, a zip on a laptop — it needs to be pushed or handed over *before*
M1 starts, because every later milestone's "stack wins" and regression-checklist rules depend on it.

## 2. Evidence

```
$ git status
On branch claude/practical-rubin-ma59yr
No commits yet
nothing to commit (create/copy files and use "git add" to track)

$ git log --all --oneline
fatal: your current branch 'claude/practical-rubin-ma59yr' does not have any commits yet

$ git branch -a
(no output)

$ ls -la
.  ..  .git          # nothing else

$ git fetch origin
(no output, no refs fetched)
```

Remote state was checked independently of the local clone, via the GitHub API: listing branches on
`vishalmahtoiics/Webedge` returned `[]`. An empty local clone can mean a failed fetch; an empty branch list on
the remote means the repository genuinely has no content.

## 3. The §3.1 checklist, answered

§3.1 requires the audit to cover a fixed list of topics. Each is answered below. "N/A — empty repository" is
the honest answer for most of them, and is recorded explicitly rather than skipped, so that a reader can tell
the difference between *checked and empty* and *not checked*.

| §3.1 topic | Finding |
|---|---|
| Git status, branch, recent history | No commits. Working branch `claude/practical-rubin-ma59yr` created by this session. |
| Stack and versions | None. To be established in M1 per §4.1. |
| Apps and entry points | None. |
| Routes and pages | None. |
| Components | None. |
| API endpoints | None. |
| Database schema | None. No migrations, no Prisma schema. |
| Authentication | None. |
| Styling | None. |
| Dependencies | None. No `package.json`, no lockfile. |
| Environment variable names | None. `.env.example` is created by this milestone as the starting point. |
| Tests | None. |
| CI | None. No `.github/workflows`. |
| Docker | None. |
| What works (verified by running it) | Nothing to run. |
| What is broken | N/A. |
| What is reusable | Nothing. |
| What needs redesign | N/A. |
| Architectural problems | None inherited. See §6 below for problems inherited from the *spec* instead. |
| Security red flags (committed secrets, missing authz) | **None found.** No files and no history, therefore no committed secrets. Verified by the absence of any object in the repository, not by scanning. |

## 4. Regression checklist

§3.2 requires this audit to list every working user-facing feature, so that later milestone reports can
confirm those features still work.

**The list is empty.** There are no existing user-facing features. Every later milestone report should state
"regression checklist: empty (greenfield, per REPO-AUDIT §4)" rather than silently omitting the section, until
M1 ships the first features and the checklist starts accumulating entries.

From M1 onward the checklist lives in `docs/PROGRESS.md` and grows as each milestone adds shippable behaviour.

## 5. What this changes about the plan

Greenfield is mostly good news — no legacy to work around — but it shifts three things:

1. **§3.3 "redesign, don't rewrite" is inert for M1.** There is no screen to preserve the business logic of.
   The rule stays in force for later milestones, where it will apply to WebEdge's *own* earlier code.
2. **M1 is bigger than the spec's budget assumes.** §2.1 allocates M1 four weeks for "design system, shells,
   auth, RBAC, tenancy, DevOps baseline". That allocation reads as though a repository with a working app
   and some existing auth is being brought up to standard. Starting from nothing, M1 also has to absorb
   workspace setup, tooling, CI, Docker, and the first migration. This is a scheduling risk to raise at the
   M0 review, not a reason to change the budget unilaterally (§2.2.4).
3. **The M0 provider spike could not be completed as specified.** See §7.

## 6. Problems inherited from the spec rather than from code

The audit found no architectural problems in the repository, because there is no repository. It did find
issues in the spec that behave like architectural problems — assumptions that later milestones would build
on and that turn out not to hold. They are documented in full in `docs/PROVIDER-INTEGRATION.md` §4, and
summarised here because §3.1 asks the audit to surface architectural problems:

- The spec's provider-capability table (§5.2) is **materially wrong in both directions** for the two Hostinger
  product families WebEdge would actually sell. Some features the spec assumes exist do not; some it assumes
  are missing do exist. Two customer-facing requirements (per-mailbox quota changes, WordPress vulnerability
  reporting) have **no data source at all** and cannot be built as written.
- The spec's isolation requirement (§5.4) and its default provider option (§5.3 option A, "Hostinger shared,
  cloud or agency hosting") are in direct conflict. Shared and cloud hosting scope databases and cron jobs to
  the hosting *account*, not the website, so hosting two customers on one shared account breaks the isolation
  MUST. This is the single most consequential M0 finding and drives ADR-001.

## 7. M0 completeness

§5.3 defines six deliverables for the M0 provider spike. Status:

| # | Deliverable | Status |
|---|---|---|
| 1 | Endpoint index and capability matrix per product family | **Done.** From official sources, without a token. See PROVIDER-INTEGRATION §2–3. |
| 2 | Exercise read endpoints with the staging token; save fixtures | **Blocked.** No staging Hostinger account or token exists yet (§2.3 owner dependency). |
| 3 | Verify the isolation unit | **Done on documentary evidence; needs live confirmation.** See ADR-001. |
| 4 | Measure rate-limit headroom and async timings | **Partly done.** Headroom is modelled arithmetically in PROVIDER-INTEGRATION §5; the input figure itself needs confirming, and async timings need a live token. |
| 5 | Draft the leak register | **Done.** PROVIDER-INTEGRATION §6. |
| 6 | ADR-001 provider model | **Done, pending owner decision.** `docs/adr/ADR-001-provider-model.md`. |

Deliverables 2 and 4 are the reason the M0 review cannot simply be signed off. They need the staging account
from §2.3. Everything that could be established without provider credentials has been.

## 8. Recommended owner actions before M1

1. Confirm the repository is genuinely greenfield, or hand over the existing codebase.
2. Provide the staging Hostinger account and API token (§2.3) so spike deliverables 2 and 4 can close.
3. Decide ADR-001 (provider model). M2 cannot start without it and M1's data model is shaped by it.
4. Place the dashboard reference screenshot at `docs/design/reference/`. It is absent, and §0 says to ask for
   it before M1 design work.
5. Read `docs/PROVIDER-INTEGRATION.md` §4 and confirm the four customer-facing features that cannot be built
   as specified are dropped, deferred, or re-scoped.
