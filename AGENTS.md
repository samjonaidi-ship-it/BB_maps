<!-- BB-AGENT-CONTRACT v1.4 -- managed block. Edit the template, not the copies. -->
# Agent Workflow Contract | Bainbridge Builders | v1.4 | 2026-09-21 | BB

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

**Routine changes may auto-merge on green.** Auto-merge is enabled on the managed
repos; it waits for the required checks and merges only if they pass.

**STOP and hand to Sam** — do not merge, say what you changed and why it is here —
when the diff touches any of:

- authentication, authorization, permission or role logic
- database migrations, or anything that writes schema
- branch protection, CI config, or the workflow files themselves
- credentials, secrets, tokens, `.env`, or key handling
- deploy configuration (Railway, Dockerfile, start commands)
- money: billing, invoicing, payroll, QuickBooks posting

If you are unsure whether a change is routine, it is not. Ask.

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

The same helper gets written again in several repos when nobody looks first (a
phone-number normalizer, a money-to-cents converter, a distance formula). Before you
write a non-trivial function, parser, formatter or client, spend a minute looking:

- **In this repo:** grep for the verbs and nouns of what you are about to write, and
  read the `utils/` / `lib/` neighbours of the file you are editing.
- **Local agents on Sam's machine only** (Claude Code, Devin Desktop, dsh, Codex on
  the desktop) also have a by-meaning search over the docs and decisions. Ask it in a
  plain sentence; it needs Ollama running and says so if it is not:
  `node C:\Users\samjo\Desktop\Claude\TOOLS\embed-index.mjs search "<what you are looking for>"`.
  `node C:\Users\samjo\Desktop\Claude\TOOLS\doc-graph.mjs find <words>` is the literal
  (keyword) lookup over the same docs.
  For CODE rather than docs, the function index searches the top-level functions of
  every repo by meaning — describe what the function does, not what it might be called:
  `node C:\Users\samjo\Desktop\Claude\TOOLS\code-index.mjs search "<what the function does>"`.
- **Cloud agents** cannot reach those indexes — they live on Sam's machine — so do the
  in-repo grep and say in the PR body that the cross-repo search was not available.

**A search hit is a lead, not proof.** Both indexes are measured and modest: on a
14-query check the doc index put the right document in the top five for 8 of 14; on a
12-query check the function index put the right function in the top five for 7 of 12,
and it sees only functions declared at the top level of a file. A miss does not
mean nothing exists, and a hit does not mean it fits — open it and read it before you
reuse it or claim it does not exist. If you find an existing helper, use or extend it;
if you write a new one anyway, say in the PR body what you searched and why the
existing one did not fit.

<!-- END BB-AGENT-CONTRACT -->

---

## BB_maps — repo-specific notes

_Nothing repo-specific recorded yet. Add project facts, shared-file
collision points, and any local override BELOW this line — the block above
is managed and will be replaced wholesale on the next contract update._
