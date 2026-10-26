<!-- BB-AGENT-CONTRACT v2.0 -- managed block. Edit the template, not the copies. -->
# Agent Workflow Contract | Bainbridge Builders | v2.0 | 2026-10-26 | BB

**Every agent working in this repo follows this file — Claude Code, Devin (cloud
AND desktop), Codex, and any future one.** It is deliberately IN THE REPO and
self-contained: a cloud agent cannot read anything on Sam's machine, so a rule
that lives only in `~/.claude/CLAUDE.md` or `C:\Users\samjo\...` does not exist as
far as it is concerned. Do not replace any rule below with a pointer to an
off-repo file.

## 1. Never push to `main`

`main` is protected on the active repos: a direct push is rejected with
`GH006 Protected branch update failed`. Even where protection is not yet on,
treat `main` as read-only. All work reaches `main` through a pull request.

## 2. One branch per task

- Claude / Codex: `agent/<task>` — kebab-case, task-named, not dated, not versioned.
- Devin: its own `devin/<id>-<slug>` naming is fine. Everything else here still applies.
- Rebase onto `origin/main` at the start of a session and before pushing.
- Reason about `origin/main`, never a stale local `main`.

## 3. Open a PR and let CI decide

Push the branch, open a PR, wait for the required checks. A red or **inconclusive**
build is not a pass — `cancelled`, `skipped`, `neutral` and `null` all mean nothing
was proven. Do not merge on them.

## 4. Who merges

**The agent that opens a PR owns it until it is merged** — red CI, conflicts,
Devin threads and re-arming are all yours, never handed back to Sam. Auto-merge
is enabled on the managed repos; it waits for the required checks and merges
only if they pass. Auth, CI, secrets, deploy and money changes are no
exception, but two different reviews apply, and the pace changes how each runs:

- **The CI gate** (`Risky path review`, driven by `scripts/risky-paths.json`): at
  `BB_PACE=normal` it stays red on a risky diff until a human adds the
  `human-reviewed` label. **Agents never add that label**, so a risky PR waits
  for Sam — it is parked on him, not stuck; say so. At `BB_PACE=fast` the job
  still runs, but the verdict is advisory for the ordinary risky categories:
  it annotates `::warning`s and goes green, and the PR merges on green CI with
  the lookback audit as the control. The gate-critical subset — CI and
  workflow files, `scripts/check-risky-paths.mjs`, `scripts/risky-paths.json`,
  and the category that covers them — stays red until `human-reviewed` at
  EVERY pace: a PR rewriting the gate that judges it gets no advisory pass.
- **The local pre-push reviewer** (`bb-review` on Sam's machine, not CI): at
  every pace it reads every code push before it goes out, against the repo's
  `REVIEW.md` and the touched files' past Devin findings, and a P1 blocks the
  push. If the reviewer cannot run, a small routine push goes out; a T3 or
  larger push, a push that touches the gate itself, or a T2 review that could
  not finish is blocked instead (fails closed). On a later push of a branch
  already on the remote with an open PR, the fix-push check also blocks when
  it cannot read the PR's Devin findings, or when it cannot read the push's
  commit messages and a flagged file needs a `CASE-TABLE:` line; `BB_SKIP`
  is the way past (`BB_PREPUSH_FIXLOOP=0` turns the check off, and says so).
  A push to a local folder skips the check only when gh cannot answer at all,
  and logs it.
  Docs-only pushes are skipped; a push that touches migrations goes to the
  full reviewer ladder instead. Both still run the fix-push check.
  At `BB_PACE=fast`, any part of a push the pre-push review could not
  read gets a background review instead, which posts its verdict as the
  `bb-review` commit status, and devin-gate fails on a P1 there; a push it read
  in full gets no background review and no status. It reviews the
  diff; it does not apply or verify a migration — that is the rule below.

**STOP and hand to Sam** — do not merge, say what you changed and why it is here —
only for:

- **payroll or QuickBooks posting**: anything that changes what is paid, or what
  is written to QuickBooks / QB Time;
- **running a migration against production**: writing the migration file is
  yours; applying it to the prod database is Sam's. Find out how this repo runs
  its migrations before you arm:
  - **run by hand, with a ledger** (BMB: `migrations/run-NNN-*.mjs`, recorded in
    `schema_migrations`): the PR cannot be armed until it has run — stage it for
    Sam, confirm its row in `schema_migrations`, then arm with
    `landed --arm --migration-applied <sha8,…>`;
  - **run by hand, with no ledger** (BB_Scan_OpenAI-v4: `db/apply-schema.mjs`
    re-applies the idempotent files in its fixed `SCHEMA_FILES` list and records
    nothing — a new `db/schema-*.sql` must also be added to that list, or the
    applier never runs it): Sam runs
    the applier; you confirm with a read-only query that the new table or column
    exists in prod, and only then arm. There is no row to check, so the query is
    the proof — put its output in the PR body;
  - **run by the app itself on deploy or boot** (ControlTower: the BFF applies
    every new `bff/migrations/*.sql` at startup): **merging IS running it** — do
    not arm; Sam merges that PR.

  What `landed --arm` does with each kind: the first, it refuses until you pass
  `--migration-applied` with the applied migrations' sha8s (that flag is the
  only way through, and only after Sam has run them); the third, it refuses
  outright, with no flag. It cannot see the second — that check is yours.

  Until then the PR is parked on Sam, not stuck — say so.

**Held for Sam.** Separately from the two cases above, Sam can hold any PR: a
title that starts with uppercase `HOLD`, or carries `[HOLD` anywhere (e.g.
`… [HOLD — Sam merges]`), or the label `sams-merge`. A held PR: `landed --arm`
refuses it (exit 5), the devin-gate check fails with "held for Sam: title HOLD /
label sams-merge" (and re-runs the moment the title or that label changes), and
an overnight driver turns its auto-merge off and leaves it. Only Sam lifts a hold
— an agent never edits the title or the label to get past it. It too is parked
on Sam, not stuck — say so.

If you are unsure whether a change pays people, posts to QuickBooks, or runs on
the production database, it does. Ask.

## 5. Clean up after yourself

When a feature is done: delete the branch (local and origin) and remove its
worktree. A merged branch left behind is a trap — the next agent resumes on dead
code. Note that a **squash-merged** branch does not read as merged by ancestry;
check the PR state, not just `merge-base`.

## 6. Never bypass a gate

No `--no-verify`. No disabling a lint to make it pass. No committing a suppression
to silence a check. If a gate blocks you, the gate is the message — fix the cause
or explain why it is wrong. (If a pre-push hook blocks a branch *deletion*, that
is a hook bug: a deletion pushes no content. Delete the ref via the API instead
and report the bug.)

## 7. The pull request body is the change record

Every change lands through a PR. Its body carries what changed, the evidence
(measurements, the real test output with its exit code, the CI run) and the
review trail. That body is the changelog entry — `docs/VERSION_MATRIX.md` and
`.session/TEST_LOG.md` are frozen (2026-09-02) and take no new entries. Render
the changelog from merged PRs with `node C:\Users\samjo\Desktop\Claude\TOOLS\changelog.mjs`.
Do not bump a "matrix version"; `package.json` carries the only version that runs.

Every PR body also carries a **"Searched first:"** line naming what §12's brain
search found and whether it was reused — a cloud agent instead states that the
cross-repo search was unavailable and that it grepped this repo in-repo.

## 8. Prove it

"Tested" means output. Run the repo's test command and quote the result, including
the real exit code — a piped command reports the pipe's status, not the program's.
"I wrote it but did not run it" is an acceptable thing to say. "It works" without
evidence is not.

## 9. If you run on Sam's desktop, stay out of the primary checkout

This applies to any agent with local filesystem access — desktop Devin, Codex,
Claude Code. Several agents share one clone.

- The repo's **primary checkout** (e.g. `C:\Users\samjo\Desktop\<Repo>`) stays on
  `main`, read-only. **Never `git checkout`/`switch` a branch there.** Another
  agent is reading those files right now; switching the branch under it changes
  its working tree mid-task.
- Do your work in a **worktree**: `git worktree add .claude/worktrees/<task> -b agent/<task>`.
  Keep worktrees under `.claude/worktrees/` — sibling directories like
  `<Repo>-myfeature` work but hide from every cleanup sweep.
- Remove your worktree when the branch is merged. Do not remove one that is
  dirty or on an unmerged branch: that is someone's unfinished work.

Claude Code enforces the read-only rule with a PreToolUse hook. **Other agents
have no such hook — for them this section is the only thing standing between two
agents and a corrupted working tree.**

## 10. ADRs are not documentation — they are the CI

If this repo has `docs/decisions/`, those ADRs record invariants the codebase
depends on, and almost all of them are backed by a machine check wired into the
required CI job. You do not need to have read an ADR to be bound by it: the check
fails your PR and branch protection will not merge it.

- Before changing a seam — a client, a store, a schema, a DB access path, a
  layering boundary — read the ADR that covers it.
- Run the repo's architecture gate locally before pushing
  (`npm run check:arch`, or `npm test` where the lints are chained into it).
- **A failing ADR check is a decision to discuss, never something to route
  around.** Do not add a suppression, widen an allowlist, or rename a file to
  dodge a rule. If the invariant is genuinely wrong, say so and propose amending
  the ADR — that is a normal thing to do, and it is what §4 escalation is for.
- Adding an ADR means adding its check in the same PR. An ADR with no machine
  check binds only the agents that happen to load it into context — which, in
  practice, means Claude and not Devin.

## 11. Shared files are collision points

Anything every task touches — a root layout, a shared store, an index/registry, a
changelog — will conflict when two agents edit it at once. Rebase immediately
before touching one, and keep the edit as small as possible.

## 12. Before writing new logic, search for what already exists

**Every task starts with one brain search** — the main agent and every subagent
it spawns, on any AI tool (Claude, Codex, Devin) — before the first grep, Explore
call, or edit. This is not optional preference: a PreToolUse gate on Claude Code
blocks a subagent's first Write/Edit/Grep/Glob once if no brain search preceded
it, and the block fires at most once per agent.

The same helper gets written again in several repos when nobody looks first (a
phone-number normalizer, a money-to-cents converter, a distance formula). Before you
write a non-trivial function, parser, formatter or client, spend a minute looking:

- **In this repo:** grep for the verbs and nouns of what you are about to write, and
  read the `utils/` / `lib/` neighbours of the file you are editing.
- **The second brain, first.** Claude Code has the `mcp__brain-search__brain_search`
  tool (plus `brain_read` and `brain_inspect` to go deeper) loaded automatically —
  it is one call over docs, global memory, session digests, merged PRs, the wiki
  and code, ranked by meaning, not keyword. Codex reaches the same server through
  its own MCP config. Call it FIRST for "have we built / decided / hit this
  before" — before grepping this repo, before `embed-index`/`doc-graph`, before
  writing anything non-trivial. If the MCP tool is unavailable, the CLI fallback
  is `node C:\Users\samjo\Desktop\Claude\TOOLS\brain.mjs search "<question>"`.
- **Local agents on Sam's machine only** (Claude Code, Devin Desktop, dsh, Codex on
  the desktop) also have a by-meaning search over the docs and decisions, as a
  secondary tool once the brain has been checked. Ask it in a
  plain sentence; it needs Ollama running and says so if it is not:
  `node C:\Users\samjo\Desktop\Claude\TOOLS\embed-index.mjs search "<what you are looking for>"`.
  `node C:\Users\samjo\Desktop\Claude\TOOLS\doc-graph.mjs find <words>` is the literal
  (keyword) lookup over the same docs.
  For CODE rather than docs, the function index searches the top-level functions of
  every repo by meaning — describe what the function does, not what it might be called:
  `node C:\Users\samjo\Desktop\Claude\TOOLS\code-index.mjs search "<what the function does>"`.
- **Cloud agents** (cloud Devin included) cannot reach the brain or those indexes —
  they all live on Sam's machine — so do the in-repo grep and say in the PR body
  that the cross-repo search was not available.

**A brain hit is a lead, not proof, same as the other indexes below.** Open the
source and re-check it before relying on it or repeating it as fact.

**A search hit is a lead, not proof.** Both indexes are measured and modest: on a
14-query check the doc index put the right document in the top five for 8 of 14; on a
12-query check the function index put the right function in the top five for 7 of 12,
and it sees only functions declared at the top level of a file. A miss does not
mean nothing exists, and a hit does not mean it fits — open it and read it before you
reuse it or claim it does not exist. If you find an existing helper, use or extend it;
if you write a new one anyway, say in the PR body what you searched and why the
existing one did not fit.

## 13. Read the lessons before you code; fix Devin's review in one round

Devin Review has flagged well over a thousand bugs across these repos, and the
same kinds come back in the same files. Every finding ever posted is kept, per
file and per bug class (time zones, races, silent data loss, permissions…), in
the second brain under `lessons/devin`. Sam, 2026-10-05: ask for the lessons
before coding starts.

- **Before your first edit to a file**, read its past findings:
  `node C:\Users\samjo\Desktop\Claude\TOOLS\devin-lessons.mjs lookup <repo> <path>`,
  or `brain_search "Devin lessons <file or topic>"`. Claude Code is shown them
  automatically on the first edit of each file. Check your change against each one
  before the first push.
- **When Devin reviews your PR, take the whole review at once:** fix every
  finding in ONE commit, fix the same pattern everywhere else in the diff (not
  only the line it named), add a test for each red finding, then push once.
  One push = one more review round.
- **No round limit.** Keep fixing — one commit per round — until Devin has no
  open red findings and CI is green. The PR is yours to land, not Sam's. **Round 3+:
  stop patching.** Write the full case table for the function(s) Devin keeps
  flagging, rewrite each once against it, and if the session is long start a
  clean one.
- **Arm only with `landed --arm`, never a bare `gh pr merge --auto`.** CI's
  devin-gate fails on an open red finding, on a failed `bb-review` status, and —
  only on a PR that changes the canonical guardrails — on any open Devin thread;
  elsewhere a yellow or 🔍 note never fails it, and after 8 minutes with no
  Devin verdict it passes without one. `landed --arm` waits for Devin's review
  of the current head and refuses only while a RED finding (a 🔴 bug, or a `SEC_`
  id) is open on it; on a PR that changes the canonical guardrails any open
  thread refuses. A yellow or info note does not block: answer it with a reason
  or a follow-up issue, then resolve the thread — never leave it silent
  (`landed` prints each one). Arming any other way lets auto-merge land the PR with
  findings still open. A **cloud agent** has no `landed`: leave the PR unarmed,
  say so in the PR body, and a local agent or Sam arms it.
- **Armed is not the same as reviewed.** When Devin cannot vouch — it never
  showed up, skipped the head, was still running past the wait, ended in a
  non-pass state, or its threads could not be read — `landed --arm` arms anyway
  and prints a warning containing `arming WITHOUT` (`… a Devin review`, `… its
  verdict`, `… checking its findings`). When any line says `arming WITHOUT`, say
  in the PR body that Devin did not vouch for this head and why; never report
  the PR as reviewed.
- **Before pushing a fix round to a PR whose auto-merge is armed, disarm it
  first** (`gh pr merge <n> --disable-auto`), then re-arm once the round is
  pushed. GitHub merges whatever head is green: a fix pushed after it merged is
  orphaned and has to go in a new PR.
- **Cloud agents** cannot reach the lessons; read the PR's own Devin threads
  and the history of the files you touch instead.

## 14. Shared lockfiles use the claim idiom — never unlink what you did not create

Several tools coordinate through lockfiles (`findings-ledger`, `suite-lock`,
`session-end-capture`, `pr-driver-claim`). Review rounds found the same race in
every one of them, so the rules are fixed:

- **Acquire by exclusive creation** of a *generation* file (`<lock>.<n>` carrying
  your token, created with `wx`), not by testing a shared path then writing it.
- **Never unlink, truncate or overwrite a shared lock path based on an earlier
  observation that it was stale** — a fresh claim can land in the gap. Re-verify
  identity (inode and content) in the same transaction before any destructive
  step, and remove only a claim whose token is provably yours.
- **Operations that rewrite shared state must be lossless.** Re-read under the
  lock and merge rows appended during your hold; never rename a stale snapshot
  over them. Writers that honor no lock exist — the rewrite must still not lose
  their data.
- A stale claim you cannot open for writing is reclaimed by rename-aside under
  the same re-verify, never by delete-then-recreate.
- `pr-driver-claim.mjs` is the reference implementation. Reuse it; do not invent
  a third scheme.

Before two agents edit the same file, `bb claims` lists the live claims and
recent collisions; `bb procs` lists stale dev-tool processes; `bb resume-state
<repo>` shows the derived state a session resumes from.

## 15. The machine runs a harness mode — check it before relying on a scheduled task

`BB_HARNESS=full|lean|off` (`bb harness status`) controls which scheduled tasks
and hooks are live. Under `lean` only the guard dispatcher, proc-watch, the
worktree sweep, the brain watchdog and the pre-push review run; under `off`
optional machinery is disabled. Do not assume the digest or a watcher ran —
check the mode. Hook rows are either **hard** (guards — a verdict that cannot
run fails closed) or **optional** (injectors — fail open); a new row must say
which it is, and a gate that cannot run must never silently pass.

## 16. Every factual claim carries an evidence label

Any claim about the estate that a later decision will rest on — a PR body
asserting production state, a report to Sam, an estate-registry row, a
recovery or drill claim — carries one of these labels:

- `LIVE-VERIFIED`: queried from the production service during this execution.
- `CODE-VERIFIED`: demonstrated by current source at a named commit.
- `DATED-VERIFIED`: correct at a recorded date but must not be treated as
  current.
- `TEST-REQUIRED`: implementation exists or documentation claims support, but
  behavior has not been exercised.
- `OWNER-DECISION`: cannot be resolved technically without Sam choosing
  policy, cost, retention, or risk tolerance.

**No agent may translate `DATED-VERIFIED` or `TEST-REQUIRED` into "working."**
A claim with no label is unverified — say "unverified" instead of assuming
(§8's rule, applied to facts as well as tests). An `OWNER-DECISION` parks on
Sam like any other escalation: state it plainly, never resolve it by guessing.

## 17. Parallel write lanes and unattended runs — the stop conditions

When several agents (or overnight lanes) run at once:

- **At most three concurrent write lanes, and one write lane per repo.** A
  second lane needing the same repo queues or picks another repo — it does not
  share the checkout. Every lane works in its own worktree under
  `.claude/worktrees/` (§9), on its own `agent/<task>` branch (§2).
- **No lane touches payroll/QuickBooks-posting, auth, migrations-apply, or
  CI/workflow/gate files.** Those park by design (§4); do not route around the
  park.
- **Every PR is armed only via `landed --arm`, and only after every commit is
  pushed** (§13). A cloud agent leaves the PR unarmed and says so.
- **Read-only lanes write artifacts to `Claude\REPORTS\` only** — no repo
  writes.
- **Handoff:** one `CHECKPOINT.md` block plus one report file listing what
  landed, what parked, and what is queued — per lane, when the lane ends.

**Stop and park** — write `PR-GOAL: parked #<n>: <reason>` (or the plain-word
equivalent when no PR exists yet) and move to other work; never improvise —
when:

- a backup source and restore target cannot be uniquely identified;
- a production mutation would be required before a disposable test
  environment exists;
- a table is silently excluded from backup;
- a live setting contradicts a runbook;
- a shared-infrastructure file is already claimed;
- a reviewer's provider cannot be identified;
- a security finding requires secret rotation;
- branch protection would strand active PRs;
- a repository transfer would affect packages, actions, Railway links, or
  customer URLs without a tested plan;
- more than five unmerged `agent/*` branches exist;
- current uncommitted work exceeds the session's triage threshold.

## 18. Session-start hooks run through the dispatcher

`settings.json` carries **one** SessionStart entry —
`session-start-dispatch.mjs` — never several entries each spawning a process.
Serial entries timed out under load (110 hook timeouts in one Devin log;
Devin's evaluator caps a hook call at ~15 s regardless of the declared
timeout). The dispatcher runs its registered children in parallel, so wall
time is the slowest child, not the sum.

- The registered set lives in the dispatcher's `HOOKS` list (today:
  `session-branch-check`, `global-memory-inject`, `compact-limit`). Adding a
  session-start hook means adding a row there — never a second settings.json
  entry.
- Budgets are fixed and deliberately under the evaluator cap: 12 s child
  deadline measured from process start, a 13.5 s watchdog that emits whatever
  has settled (children report as they finish; a timed-out child's buffered
  output is kept and merged if usable), and a 2 s stdin budget so an
  open-but-unclosed pipe resolves partial input instead of freezing.
- **Exit 0 always.** Session-start hooks are injectors in §15's sense — they
  fail open; a dead injector must never wedge a session start. A spawning
  error resolves that one child empty; it never loses its siblings.
- **A skipped or timed-out hook must emit a `systemMessage`** — a check that
  never ran must not read as a pass (a timed-out branch check is not a clean
  branch).
- Child stdout that is not hook JSON goes to `additionalContext`; the merge
  warns on dropped keys and non-string values rather than silently
  downgrading them.
- The resume-card claim follows dispatcher delivery (the
  `BB_DISPATCHED`/`__cardFile` handoff through `global-memory-inject`): a
  session claims only the card it actually received.

## 19. Backup and archive jobs use the completeness vocabulary

A job that exports state into an archive with a manifest (BMB's nightly
`neon_full_backup` is the reference implementation) uses these exact
semantics — the vocabulary exists in the code; docs, PRs and drills must use
the same words:

- **`manifest.completeness`** is `complete` | `partial` | `critical_failure`:
  a failed *critical* table is `critical_failure`; any other table error, or
  detected cross-table orphans, is `partial`; `complete` means every table
  exported **and** no orphans detected.
- **`_PARTIAL` in the archive filename** marks any completeness short of
  `complete` — a failed *non-critical* table marks it too. A normal-looking
  archive name is the completeness guarantee; a table error that lands only
  in `manifest.errors` with a normal filename is the bug class that let two
  broken exports (a `ORDER BY` on a nonexistent column) hide for weeks.
- **Every table error surfaces**, not just critical ones: a warn log, a
  silent-failure event (kind `neon_backup_table_export_errors`), and a `partial`
  cron status. "Non-fatal" must never mean "invisible."
- **Drift** (`rowCountDrift`): exported row count vs a live `count(*)` taken
  after export, direction `grew` | `lost` | `unknown`. Drift is informational
  and **never lowers completeness** — `lost` means rows were deleted after
  their page was exported, which is correct backup behavior, not corruption.
- **Orphans** (`orphanRows`): a cross-table inconsistency inside the archive
  itself (the ledger pair: `cal_day_op_rows` rows whose `op_id` is absent from
  the exported `cal_day_ops`). Orphans **do** lower completeness to `partial`.
- **Consistency** is declared honestly as `per-page-keyset`: pages are fetched
  by keyset on real primary keys, not unbounded `SELECT *` or offset scans.
  `complete` is **not** a point-in-time snapshot and **not** proven
  cross-table consistent — a commit editing an already-exported parent can
  leave a consistent-looking archive. Say so; do not overclaim.
- Exports page under **heap-derived ceilings** so a large table degrades to
  `partial`, never to a silently truncated response.
- **Upload is verified by read-back**: the sha256 recorded for the archive is
  computed on the object downloaded back from the destination, not only
  pre-upload. A pre-upload hash proves intent, not integrity — a corrupted
  upload must be detected the same night, not at the next monthly drill.

<!-- END BB-AGENT-CONTRACT -->

---

## BB_maps — repo-specific notes

_Nothing repo-specific recorded yet. Add project facts, shared-file
collision points, and any local override BELOW this line — the block above
is managed and will be replaced wholesale on the next contract update._
