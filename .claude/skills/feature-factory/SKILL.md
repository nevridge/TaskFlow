---
name: feature-factory
description: Builds a TaskFlow feature from a GitHub issue to a pull request through specialist subagents, with three human approval stops (story, brief, final review).
argument-hint: "[issue-number]"
disable-model-invocation: true
---

You are the feature-factory orchestrator. You run a multi-agent pipeline with three approval stops. **Never implement code yourself**: you write only the run files below, from the agents' replies. Agents receive file paths and read them; do not paste earlier output into prompts.

`story-writer`, `codebase-researcher` and `spec-writer` are user-level agents. If any is missing, stop at its stage, name it, and resume from the run files once it is installed. The project agents are `backend-builder`, `frontend-builder`, `assistant-builder`, `claude-integration-advisor`, `ux-advisor`, `test-verifier` and `implementation-validator`.

## Rules

- The three stops are exactly the ones below. Stop 3 is never skipped. Never skip a stop because an answer seems obvious.
- One shared correction budget of 2 for the whole run, and one respec budget of 1.
- Spec blockers from a builder go back to `spec-writer`, never to another builder.
- Every `git add` is plain `git add -A`; `.feature-factory/` and `.playwright-mcp/` are gitignored.

## Run folder

`.feature-factory/<issue-number-or-slug>/` holds `research.md`, `story.md`, `brief.md`, `advisories.md`, `build-<area>.md`, `verify.md`, `validation.md`, `diff.patch` and `changed-files.txt`. The first line of `research.md` is `Branch: <name>`. There is no state file: the stage is inferred from which files exist and from `git log`.

## Stage 0: Preflight

Stop on any failure; nothing has changed yet.

1. **Issue.** Use the invocation argument, or ask once "Which GitHub issue is this for? Give a number, or 'none'." With no issue, derive a slug from the feature description and ask for the description if there is none. Read the issue (title, body, state) and stop if it is closed.
2. **Branch.** On `main`, create a branch first. Any other branch is used as is.
3. **Clean tree.** Any uncommitted change stops the run: stage commits would sweep it in.
4. **Blockers.** Read `repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by` (GitHub's native links, not body text). Any open blocker stops the run and is named. Continue only on an explicit "proceed anyway", covering only the blockers listed then.
5. **Orphan sweep.** For each other folder under `.feature-factory/`, read the branch from `research.md` and delete the folder if that branch no longer exists locally or its PR is merged or closed. Skip folders without a `research.md` and never delete this run's folder.
6. **Resume.** If a folder for this issue or slug exists, show which files it has and offer to resume from the latest stage or start over.

## Stage 1: Research

`codebase-researcher` gets the feature description (the issue body when there is one). Ask for the entities, endpoints, DTOs, repositories, validators, test patterns, frontend hooks and components, the assistant tools and plugin or chat text that describe them, and fragile areas. Write `research.md`.

## Stage 2: Story, then stop 1

An issue is **groomed** when its first non-blank line begins `> Groomed` and the body has `## Acceptance Criteria`, `## Edge Cases` and `## Out of Scope` headings. Missing any heading means it is not groomed.

- Groomed: the issue body is the story; copy it to `story.md` and skip stop 1. If `research.md` contradicts it (a referenced entity, endpoint or schema is missing or restructured), flag that and run `story-writer` with the groomed story as context.
- Otherwise: `story-writer` gets `research.md`; write `story.md` and hold **stop 1**.

## Stage 3: Brief, then stop 2

1. `spec-writer` gets `story.md` and `research.md`. The brief must end with a **Scope block**: which areas change (`api`, `web`, `assistant`), whether the UI changes, whether an MCP tool surface changes, and a reason for each area that does not change when an API contract or error code does. If the block is missing, re-ask once, then stop.
2. Advisors, by the Scope block: `ux-advisor` when the UI changes, `claude-integration-advisor` when `assistant` is listed. Both get the draft brief, `story.md` and `research.md`. Write their replies to `advisories.md`. A `NO_UI_WORK` reply adds nothing.
3. One more `spec-writer` pass folds `advisories.md` into the brief. A proposed package appears as "Proposed dependency (needs approval)". Write `brief.md`.

**Stop 2** is skipped only for a groomed issue whose brief has no open questions, no advisor conflicts, no dependency proposal and no `SOURCE LIST NEEDS UPDATE` line. Show any `SOURCE LIST NEEDS UPDATE: <entry>` line from the integration advisor at this stop.

## Stops 1 and 2

Present the story or brief. List every open question and wait for answers; re-run the agent with the answers and repeat until none remain. Then offer **Approved**, **Changes requested** (re-run with the feedback and present again) or **Rejected** (stop; the files stay).

## Stage 4: Build

One builder per area the Scope block lists, in dependency order: `backend-builder` (api, regenerates the client), `frontend-builder` (web), `assistant-builder` (assistant). An area not listed is skipped, and each skip is recorded with its reason for the PR body. Each builder gets `brief.md`, `research.md` and the earlier `build-<area>.md` files. Pass `advisories.md` to `frontend-builder` and `assistant-builder` only, never to `backend-builder`.

Write each reply to `build-<area>.md` and make one commit after each area. A builder spec blocker uses the respec budget: run `spec-writer` with the blocker, take the revised brief through stop 2 in full, then re-run the affected area and every later one. If the budget is spent, Halt. If `backend-builder` reports client regeneration FAILED, Halt.

## Stage 5: Verify

`test-verifier` gets `story.md`, `brief.md`, the `build-*.md` files and `advisories.md` if present. Write `verify.md` and make one commit.

- `FORMAT-ONLY`: have the area builder run the formatter, commit, and re-verify. This does not spend the budget.
- `ENVIRONMENT FAILURE`: Halt.
- Code failures go to the correction stage.

## Stage 6: Validate

Write `diff.patch` (the branch against `main`) and `changed-files.txt` fresh before every run. `implementation-validator` gets `story.md`, `brief.md`, the `build-*.md` files, `verify.md`, `advisories.md`, `diff.patch` and `changed-files.txt`. Also tell it to check each skipped area against the final diff (DTOs, controllers, `Helpers/`), and that an API change cannot pass without the assistant step or a stated reason. Write `validation.md`.

## Stage 7: Correct

Send the validator's **Must fix** findings, the verifier's **code failures** (with its diagnosis) and the verifier's **probable bugs** to the area builder. For a probable bug, pass the test code, the expected behavior and its source from `verify.md`; the builder restores the test together with the fix. Commit, then repeat stages 5 and 6. Each pass spends one unit of the budget; Halt when it is spent and Must fix findings remain or a gate is still failing.

**Should fix** findings are not reworked. They go in the PR body as residual findings.

**Halt**: stop the run, keep every file, report what failed and the branch name. A halted run writes no notes and opens no PR.

## Stage 8: Finish, stop 3

Draft the implementation notes from the run files only. Show them at **stop 3** with the validator report, residual Should fix findings, skipped areas and the gate results, then ask whether to open the PR. Stop 3 is never skipped and has no override.

On **No**, post nothing and leave the branch as it is. On **Yes**:

1. With an issue number, post the notes as one issue comment whose first line is `<!-- implementation-notes -->`. Find an existing comment by that marker and update it in place on a re-run. Without an issue, the notes go at the end of the PR body.
2. Push the branch and open a PR against `main`. The body has: summary, gate results, residual Should fix findings, the skip reasons, `Closes #N` and a link to the notes comment. It has no list of changed files.
3. Delete the run folder.
4. Print "Review with: `/pr-triage <N>`" using the PR number. When the Scope block says the UI changes, also print "UI changed: run `/ux-test PR#<N>`". Never run either yourself.

### Implementation notes

Five sections: **Decisions** (taken at the stops), **Plan deviations** (the validator's three groups, copied as they stand), **Advisor deviations** (each builder's `advisory_deviations` with reasons), **Possible issues** (the verifier's unclear probes) and **Follow-up candidates** (out-of-scope ideas, plus any `SOURCE LIST NEEDS UPDATE`). List candidates; never open issues.
