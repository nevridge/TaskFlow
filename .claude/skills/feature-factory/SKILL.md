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
- Every decision put to the owner uses the AskUserQuestion tool (or a plain-text list if it is unavailable). Free-form questions stay as plain text.
- The orchestrator itself asks every owner question and runs every commit, reset, branch checkout, push and GitHub post. Never delegate these to an agent: agents cannot ask the owner questions and never commit.

## Run folder

`.feature-factory/<issue-number-or-slug>/` holds `research.md`, `story.md`, `brief.md`, `advisories.md`, `build-<area>.md`, `verify.md`, `validation.md`, `diff.patch` and `changed-files.txt`. The first line of `research.md` is `Branch: <name>`. There is no state file: the stage is inferred from which files exist and from `git log`. A stage that makes a commit (a build area, verify, a correction pass) is finished only when its commit is in `git log`; a `build-<area>.md` without that commit, or one holding a spec blocker, means the area runs again. After a halt-commit undo the work sits in the working tree, and the stage whose commit is missing runs again over it.

## Stage 0: Preflight

Stop on any failure. Steps 1 to 5 only read or ask, apart from the orphan sweep; the branch, the tree and this run's folder do not change before step 6.

1. **Issue.** Use the invocation argument, or ask once "Which GitHub issue is this for? Give a number, or 'none'." With no issue, derive a slug from the feature description and ask for the description if there is none. Read the issue (title, body, state) and stop if it is closed.
2. **Run folder.** Look for `.feature-factory/<issue-number-or-slug>/`. A folder without `research.md` counts as none. If one exists, show which files it has, then ask with AskUserQuestion (or a plain-text list if it is unavailable), offering **Resume from the latest stage** and **Start over**. The answer changes nothing until step 6. This is "this run's folder".
3. **Clean tree.** Any uncommitted change stops the run: stage commits would sweep it in. A Halt has already committed its pending work (see Halt), so a halted run passes.
4. **Blockers.** Read `repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by` (GitHub's native links, not body text). Any open blocker stops the run and is named. Ask with AskUserQuestion (or a plain-text list if it is unavailable), offering **proceed anyway** and **Stop**. Continue only on **proceed anyway**, which covers only the blockers listed then; the check before stop 3 re-reads `blocked_by`, and any blocker found there needs a new question.
5. **Orphan sweep.** For each other folder under `.feature-factory/`, read the branch from `research.md` and delete the folder if that branch no longer exists locally or its PR is merged or closed. Skip folders without a `research.md` and never delete the folder found in step 2.
6. **Branch and folder.** The first change in the run.
   - No run folder: on `main`, create a branch; any other branch is used as is.
   - Run folder found (Resume or Start over): the branch is the `Branch:` line of `research.md`. Never create a branch. If the current branch differs, name both and ask with AskUserQuestion (or a plain-text list if it is unavailable), offering **Check out <recorded branch>** and **Stop**. If the owner declines or the checkout fails, stop.
   - Resume: apply the halt-commit rule, then continue from the latest stage.
   - Start over: apply the halt-commit rule only on the keep path, then the Start over rule.

**Halt-commit rule** (Resume, and the Start over keep path):

- If HEAD's subject is exactly `chore: feature-factory halt commit` and HEAD is not on a remote branch, run `git reset --soft HEAD~1`. Its work returns to the working tree and the stage's normal commit takes it, so no halt commit reaches the PR.
- Reset nothing in any other case; resume only ever undoes a HEAD commit with exactly that subject.
- If a commit with that subject is in `git log main..HEAD` but was not undone (not HEAD, or HEAD but pushed), warn "Halt commit <short hash> is still in the branch history" and carry on.

**Start over rule:**

- No commits beyond `main` (`git log main..HEAD` is empty): delete the run folder, keep the branch, begin at Stage 1.
- Commits exist: run `git fetch origin`. The branch counts as pushed when `git ls-remote --heads origin <branch>` lists it and `git rev-list main..origin/<branch>` is non-empty. If the fetch or ls-remote fails, treat it as pushed.
- Not pushed: ask every time, with exactly two options.
  - **Keep the commits and run again**: apply the halt-commit rule, delete the run folder, run from Stage 1 on top of the commits.
  - **Reset the branch to main**: `git reset --hard main` (the tree is clean), delete the run folder, run from Stage 1.
- Pushed: do not offer the reset and ask no question. State "Commits are pushed; keeping them (no force push is ever used)." Then take the keep path.

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

**Halt**: a stop with these triggers only: a spec blocker with the respec budget spent, client regeneration FAILED, ENVIRONMENT FAILURE, and the correction budget spent with Must fix findings or a failing gate remaining.

- A Halt keeps every file, commits pending work on the feature branch, and reports what failed and the branch name. If the tree has any change, run `git add -A` and commit with the subject `chore: feature-factory halt commit`; a clean tree gets no commit. If the commit fails, report that and leave the tree as it is; the owner commits or stashes the changes before re-running, because preflight stops on a dirty tree.
- A halted run writes no notes and opens no PR.
- Rejected at stop 1 or 2, No at stop 3, a preflight stop and a blocker **Stop** are not Halts: no halt commit is made, and the files stay. This is intended.

## Stage 8: Finish, stop 3

Draft the implementation notes from the run files only. With an issue number, re-read `blocked_by` as in Stage 0 step 4. Show any open blocker not already covered by a **proceed anyway** in this run together with the review, and ask the same **proceed anyway** / **Stop** question before the Yes/No question. **Stop** keeps the files, makes no halt commit, and pushes and posts nothing. If the read fails, say so and stop.

Show the notes at **stop 3** with the validator report, residual Should fix findings, skipped areas and the gate results, then ask whether to open the PR with AskUserQuestion (or a plain-text list if it is unavailable), offering **Yes** and **No**. Stop 3 is never skipped and has no override.

On **No**, post nothing and leave the branch as it is (no halt commit). On **Yes**, in this order:

1. Push the branch. If the push fails, report it and the branch name and stop: nothing is posted, no PR is opened, the run folder stays.
2. With an issue number, post the notes as one issue comment whose first line is `<!-- implementation-notes -->`; find an existing comment by that marker and update it in place on a re-run. Without an issue, the notes go at the end of the PR body. If the post fails, report it and stop; the push stays.
3. Open a PR against `main`; if an open PR for the branch exists, update its body in place instead. The body has: summary, gate results, residual Should fix findings, the skip reasons, `Closes #N` and a link to the notes comment. It has no list of changed files. If this fails, report it and stop.
4. Print "Review with: `/pr-triage <N>`" using the PR number. When the Scope block says the UI changes, also print "UI changed: run `/ux-test PR#<N>`". Never run either yourself.
5. Delete the run folder last, only after the PR is open and step 4 has printed.

A failure in steps 1 to 3 is not a Halt: keep the run folder. Re-running resumes at this stage; stop 3 is asked again; on Yes the push is a no-op if already pushed, the marker comment is updated and the existing PR body is updated in place.

### Implementation notes

Five sections: **Decisions** (taken at the stops), **Plan deviations** (the validator's three groups, copied as they stand), **Advisor deviations** (each builder's `advisory_deviations` with reasons), **Possible issues** (the verifier's unclear probes) and **Follow-up candidates** (out-of-scope ideas, plus any `SOURCE LIST NEEDS UPDATE`). List candidates; never open issues.
