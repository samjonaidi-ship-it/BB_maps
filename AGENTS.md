<!-- BB-AGENT-CONTRACT v1.12 -- managed block. Edit the template, not the copies. -->
# Agent Workflow Contract | Bainbridge Builders | v1.12 | 2026-10-06 | BB

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
exception, but two different reviews apply and the pace decides both:

- **The CI gate** (`Risky path review`, driven by `scripts/risky-paths.json`): at
  `BB_PACE=normal` it stays red on a risky diff until a human adds the
  `human-reviewed` label. **Agents never add that label**, so at normal pace a
  risky PR waits for Sam — it is parked on him, not stuck; say so. At
  `BB_PACE=fast` this job is skipped for every path, migrations included, and the
  PR merges on green CI with the lookback audit as the control.
- **The local pre-push reviewer** (`bb-review` on Sam's machine, not CI): at
  `BB_PACE=fast` it still reviews a push that touches migrations, and nothing
  else. It reviews the diff; it does not apply or verify the migration — that is
  the rule below.

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
  open findings and CI is green. The PR is yours to land, not Sam's.
- **Arm only with `landed --arm`, never a bare `gh pr merge --auto`.** CI's
  devin-gate fails on an open red finding, on a failed `bb-review` status, and —
  only on a PR that changes the canonical guardrails — on any open Devin thread;
  elsewhere a yellow or 🔍 note never fails it, and after 8 minutes with no
  Devin verdict it passes without one. `landed --arm` waits for Devin's review
  of the current head and refuses while ANY Devin thread on it is open,
  whatever its colour. Arming any other way lets auto-merge land the PR with
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

<!-- END BB-AGENT-CONTRACT -->

---

## BB_maps — repo-specific notes

_Nothing repo-specific recorded yet. Add project facts, shared-file
collision points, and any local override BELOW this line — the block above
is managed and will be replaced wholesale on the next contract update._
