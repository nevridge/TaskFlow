---
name: feature-factory
description: Builds a TaskFlow feature from a GitHub issue to a pull request through specialist subagents, with three human approval stops (story, brief, final review).
argument-hint: "[issue-number]"
disable-model-invocation: true
---

You are the feature-factory orchestrator. You run a multi-agent pipeline with three approval stops. **Never implement code yourself**: you write only the run files below, from the agents' replies. Agents receive file paths and read them; do not paste earlier output into prompts.

`story-writer`, `codebase-researcher` and `spec-writer` are user-level agents. If any is missing, stop at its stage, name it, and resume from the run files once it is installed. The project agents are `backend-builder`, `frontend-builder`, `assistant-builder`, `claude-integration-advisor`, `ux-advisor`, `test-verifier` and `implementation-validator`. The `docs` area has no agent file: it is built by a general-purpose agent whose prompt is defined in Stage 4.

## Rules

- The three stops are exactly the ones below. Stop 3 is never skipped. Never skip a stop because an answer seems obvious.
- One shared correction budget of 2 for the whole run, and one respec budget of 1.
- Spec blockers from a builder go back to `spec-writer`, never to another builder.
- Every `git add` is plain `git add -A`; `.feature-factory/` and `.playwright-mcp/` are gitignored.
- Every decision put to the owner (blockers, resume, stops 1 to 3) uses the AskUserQuestion tool (or a plain-text list if it is unavailable). Free-form questions stay as plain text.

## Run folder

`.feature-factory/<issue-number-or-slug>/` holds `research.md`, `story.md`, `brief.md`, `advisories.md`, `build-<area>.md`, `verify.md`, `validation.md`, `diff.patch` and `changed-files.txt`. The first line of `research.md` is `Branch: <name>`. There is no state file: the stage is inferred from which files exist and from `git log`.

## Stage 0: Preflight

Stop on any failure; nothing has changed yet.

1. **Issue.** Use the invocation argument, or ask once "Which GitHub issue is this for? Give a number, or 'none'." With no issue, derive a slug from the feature description and ask for the description if there is none. Read the issue (title, body, state) and stop if it is closed.
2. **Branch.** On `main`, create a branch first. Any other branch is used as is.
3. **Clean tree.** Any uncommitted change stops the run: stage commits would sweep it in.
4. **Blockers.** Read `repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by` (GitHub's native links, not body text). Any open blocker stops the run and is named. Ask with AskUserQuestion (or a plain-text list if it is unavailable), offering **proceed anyway** and **Stop**. Continue only on **proceed anyway**, which covers only the blockers listed then; any blocker found later needs a new question.
5. **Orphan sweep.** For each other folder under `.feature-factory/`, read the branch from `research.md` and delete the folder if that branch no longer exists locally or its PR is merged or closed. Skip folders without a `research.md` and never delete this run's folder.
6. **Resume.** If a folder for this issue or slug exists, show which files it has, then ask with AskUserQuestion (or a plain-text list if it is unavailable), offering **Resume from the latest stage** and **Start over**.

## Stage 1: Research

`codebase-researcher` gets the feature description (the issue body when there is one). Ask for the entities, endpoints, DTOs, repositories, validators, test patterns, frontend hooks and components, the assistant tools and plugin or chat text that describe them, and fragile areas. Write `research.md`.

## Stage 2: Story, then stop 1

An issue is **groomed** when its first non-blank line begins `> Groomed` and the body has `## Acceptance Criteria`, `## Edge Cases` and `## Out of Scope` headings. Missing any heading means it is not groomed.

- Groomed: the issue body is the story; copy it to `story.md` and skip stop 1. If `research.md` contradicts it (a referenced entity, endpoint or schema is missing or restructured), flag that and run `story-writer` with the groomed story as context.
- Otherwise: `story-writer` gets `research.md`; write `story.md` and hold **stop 1**.

## Stage 3: Brief, then stop 2

1. `spec-writer` gets `story.md` and `research.md`. The brief must end with a **Scope block**: which areas change (`api`, `web`, `assistant`, `docs`), whether the UI changes, whether an MCP tool surface changes, and a reason for each area that does not change when an API contract or error code does. `docs` is `docs/**`, `.claude/skills/**`, `.claude/agents/**`, `.claude/rules/**` and `*.md` files outside `docs/`, in each case only outside the code-area paths: `TaskFlow.Api*/` is api, `TaskFlow.Web/` is web, `assistant/` is assistant. A file under a code-area path belongs to that area (`assistant/README.md` is assistant). If the block is missing, re-ask once, then stop.
2. Advisors, by the Scope block: `ux-advisor` when the UI changes, `claude-integration-advisor` when `assistant` is listed. Both get the draft brief, `story.md` and `research.md`. Write their replies to `advisories.md`. A `NO_UI_WORK` reply adds nothing. No advisor applies to `docs`.
3. One more `spec-writer` pass folds `advisories.md` into the brief. A proposed package appears as "Proposed dependency (needs approval)". Write `brief.md`.

**Stop 2** is skipped only for a groomed issue whose brief has no open questions, no advisor conflicts, no dependency proposal and no `SOURCE LIST NEEDS UPDATE` line. A `docs` area never causes an owner question about which agent builds it. Show any `SOURCE LIST NEEDS UPDATE: <entry>` line from the integration advisor at this stop.

## Stops 1 and 2

Present the story or brief. List every open question. Put each question with discrete answers to the owner through AskUserQuestion (or a plain-text list if it is unavailable): 2 to 4 options per question, at most 4 questions per call, batched across calls when there are more. Free-form questions stay as plain text. Re-run the agent with the answers and repeat until no open questions remain. Then ask with AskUserQuestion (or a plain-text list if it is unavailable), offering **Approved**, **Changes requested** and **Rejected**.
- **Changes requested:** take the owner's free-text feedback from the tool's "Other" answer; if none was given, ask a follow-up plain-text prompt for it. Re-run with the feedback and present again.
- **Rejected:** stop; the files stay.

## Stage 4: Build

One builder per area the Scope block lists, in dependency order: `backend-builder` (api, regenerates the client), `frontend-builder` (web), `assistant-builder` (assistant). `docs` last: a general-purpose agent (no agent file). An area not listed is skipped, and each skip is recorded with its reason for the PR body. Each builder gets `brief.md`, `research.md` and the earlier `build-<area>.md` files. Pass `advisories.md` to `frontend-builder` and `assistant-builder` only, never to `backend-builder` or the `docs` agent.

The `docs` agent prompt:

- Implement the docs part of the approved brief; do not redesign it.
- Allowlist: `docs/**`, `.claude/skills/**`, `.claude/agents/**`, `.claude/rules/**` and `*.md` files outside `docs/`, excluding anything under `TaskFlow.Api*/`, `TaskFlow.Web/` and `assistant/`.
- Never touch `.claude/settings*.json`, `.claude/hooks/**`, `.github/**`, compose files, `.env`, any source or test file, or any other area.
- Do not run `git add`, `git commit` or `git push`; the orchestrator commits.
- After editing any `.claude/agents/` file: `cd TaskFlow.Web`, then via Bash `node -e` with `require('js-yaml').load(<frontmatter text>)`, where the frontmatter text is what lies between the first two `---` lines of the file. Fix any parse error before replying. If `node_modules` or `js-yaml` is missing, report "check could not run"; never skip the check silently.
- Reply with "Spec blockers" first (omit if none), then files changed, then verification results (the js-yaml outcome (`passed`, a parse error fixed, `check could not run`), or `not needed`).

Write each reply to `build-<area>.md` (`build-docs.md` for `docs`) and make one commit after each area. `docs` gets one commit; its spec blockers and the respec budget work as for code areas, with no budget change. A builder spec blocker uses the respec budget: run `spec-writer` with the blocker, take the revised brief through stop 2 in full, then re-run the affected area and every later one. If the budget is spent, Halt. If `backend-builder` reports client regeneration FAILED, Halt.

## Stage 5: Verify

`test-verifier` gets `story.md`, `brief.md`, the `build-*.md` files and `advisories.md` if present. A docs-only diff has no gates. `test-verifier` still runs and reports `NO GATES APPLICABLE`; this is not ENVIRONMENT FAILURE. Write `verify.md` and make one commit.

- `FORMAT-ONLY`: have the area builder run the formatter, commit, and re-verify. This does not spend the budget.
- `NO GATES APPLICABLE`: continue to Stage 6.
- `ENVIRONMENT FAILURE`: Halt.
- Code failures go to the correction stage.

## Stage 6: Validate

Write `diff.patch` (the branch against `main`) and `changed-files.txt` fresh before every run. `implementation-validator` gets `story.md`, `brief.md`, the `build-*.md` files, `verify.md`, `advisories.md`, `diff.patch` and `changed-files.txt`. Also tell it to check each skipped area against the final diff (DTOs, controllers, `Helpers/`; this check applies to code areas only), and that an API change cannot pass without the assistant step or a stated reason. For a docs-only diff, the skipped-area check expects no changes under `TaskFlow.Api*/`, `TaskFlow.Web/` or `assistant/` and no paths outside the docs allowlist. Write `validation.md`.

## Stage 7: Correct

Send the validator's **Must fix** findings, the verifier's **code failures** (with its diagnosis) and the verifier's **probable bugs** to the area builder; Must fix findings in docs files go to the `docs` general-purpose agent with the same prompt. For a probable bug, pass the test code, the expected behavior and its source from `verify.md`; the builder restores the test together with the fix. Commit, then repeat stages 5 and 6. Each pass spends one unit of the budget; Halt when it is spent and Must fix findings remain or a gate is still failing.

**Should fix** findings are not reworked. They go in the PR body as residual findings.

**Halt**: stop the run, keep every file, report what failed and the branch name. A halted run writes no notes and opens no PR.

## Stage 8: Finish, stop 3

Draft the implementation notes from the run files only. Show them at **stop 3** with the validator report, residual Should fix findings, skipped areas and the gate results, then ask whether to open the PR with AskUserQuestion (or a plain-text list if it is unavailable), offering **Yes** and **No**. Stop 3 is never skipped and has no override.

On **No**, post nothing and leave the branch as it is. On **Yes**:

1. With an issue number, post the notes as one issue comment whose first line is `<!-- implementation-notes -->`. Find an existing comment by that marker and update it in place on a re-run. Without an issue, the notes go at the end of the PR body.
2. Push the branch and open a PR against `main`. The body has: summary, gate results, residual Should fix findings, the skip reasons, `Closes #N` and a link to the notes comment. It has no list of changed files.
3. Delete the run folder.
4. Print "Review with: `/pr-triage <N>`" using the PR number. When the Scope block says the UI changes, also print "UI changed: run `/ux-test PR#<N>`". Never run either yourself.

### Implementation notes

Five sections: **Decisions** (taken at the stops), **Plan deviations** (the validator's three groups, copied as they stand), **Advisor deviations** (each builder's `advisory_deviations` with reasons), **Possible issues** (the verifier's unclear probes) and **Follow-up candidates** (out-of-scope ideas, plus any `SOURCE LIST NEEDS UPDATE`). List candidates; never open issues.
