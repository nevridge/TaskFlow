---
name: feature-factory
description: Builds a TaskFlow feature from a GitHub issue to a pull request through specialist subagents, with three human approval stops (story, brief, final review); only the last is never skipped.
argument-hint: "[issue-number]"
disable-model-invocation: true
---

You are the feature-factory orchestrator of a multi-agent pipeline with three approval stops, the first two skippable only under Stages 2 and 3. **Never implement code yourself**: you write only the run files below, from the agents' replies. Agents receive file paths and read them; do not paste earlier output into prompts.

`story-writer`, `codebase-researcher` and `spec-writer` are user-level agents. If any is missing, stop at its stage, name it, and resume from the run files once it is installed. Every other agent named below is a project agent. `docs` has no agent file: a general-purpose agent builds it from the prompt in Stage 4.

## Rules

- The three stops are exactly the ones below. Stops 1 and 2 are skipped only as Stages 2 and 3 say, and never because an answer seems obvious; stop 3 is never skipped and has no override.
- One shared correction budget of 2 for the whole run, and one respec budget of 1.
- Spec blockers from a builder go back to `spec-writer`, never to another builder.
- When the Outcome table (`references/outcome-table.md`) and stage prose disagree, the table wins.
- Every `git add` is plain `git add -A`; `.feature-factory/` and `.playwright-mcp/` are gitignored.
- Every decision put to the owner uses the AskUserQuestion tool (or a plain-text list if it is unavailable). Free-form questions stay as plain text.
- The orchestrator itself asks every owner question and runs every commit, reset, branch checkout, push and GitHub post. Never delegate these to an agent: agents cannot ask the owner questions and never commit.

## Run folder

`.feature-factory/<issue-number-or-slug>/` holds `research.md`, `story.md`, `brief.md`, `advisories.md`, `build-<area>.md`, `verify.md`, `validation.md`, `decisions.md`, `diff.patch` and `changed-files.txt`. `decisions.md` is append-only: one line per entry, holding a date, the stage or gate, and the decision. The Decisions record (`references/decisions-record.md`) says what is appended and when. The orchestrator writes `Branch: <name>` as the first line of `research.md`, also for a branch used as is. There is no state file: the stage is inferred from which files exist and from `git log`. `decisions.md` does not set the stage; it is read only for these checks: stops 1 and 2 on Resume, budgets, the FORMAT-ONLY count and blocker coverage. A stage that makes a commit (a build area, verify, a correction pass) is finished only when its commit is in `git log`; a `build-<area>.md` without that commit, or one holding a spec blocker, means the area runs again.

## Reference files

After a compaction, re-read `SKILL.md` and the reference files the current stage or stop names. `SKILL.md` must stay at or under 3,000 words, counted with `wc -w`.

Read each file in full when a stage says to:

- [references/outcome-table.md](references/outcome-table.md): the Outcome table, which gives the outcome of every agent reply value.
- [references/decisions-record.md](references/decisions-record.md): the Decisions record.
- [references/resume-halt-start-over.md](references/resume-halt-start-over.md): the Halt-commit rule, the Start over rule, Halt and the Resume rules.
- [references/ci-jobs-by-area.md](references/ci-jobs-by-area.md): the CI jobs by area table.
- [references/implementation-notes.md](references/implementation-notes.md): the sections of the implementation notes.

Read `references/resume-halt-start-over.md` in full before any Halt and before a budget check on a resumed run (Resume after a budget Halt).

## Stage 0: Preflight

Read `references/decisions-record.md` and `references/resume-halt-start-over.md` in full before this stage.

Stop on any failure. Steps 1 to 5 only read or ask, apart from the orphan sweep and the halt commit retry in step 3; this run's folder does not change before step 6, and the branch and the tree change only through that retry.

1. **Issue.** Use the invocation argument, or ask once "Which GitHub issue is this for? Give a number, or 'none'." With no issue, derive a slug from the feature description, asking for the description if there is none. Read the issue (title, body, state) and stop if it is closed.
2. **Run folder.** Look for `.feature-factory/<issue-number-or-slug>/`. A folder without `research.md` counts as none, even when it holds a `decisions.md`. If one exists, show which files it has, then ask (see Rules), offering **Resume from the latest stage** and **Start over**. This is "this run's folder".
3. **Clean tree.** Any uncommitted change stops the run: stage commits would sweep it in.
   - No run folder in step 2: stop and tell the owner to commit or stash.
   - Run folder found in step 2: a halt commit may have failed. If the current branch is not the `Branch:` line of `research.md`, stop, name both branches and commit nothing. Otherwise ask (see Rules), offering **Retry the halt commit** and **Stop**. **Retry** runs the halt commit (see Halt in `references/resume-halt-start-over.md`): on success preflight continues, on failure report it and stop.
   - Neither this offer nor Start over discards a change. A Start over answer from step 2 stays held, so the folder is not deleted before the retry.
4. **Blockers.** Read `repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by` (GitHub's native links, not body text). On Resume, read `decisions.md` first: a blocker listed in a recorded **proceed anyway** entry is covered, so only new blockers are asked about. On Start over no recorded entry counts. Any open blocker that is not covered stops the run and is named. Ask (see Rules), offering **proceed anyway** and **Stop**. Continue only on **proceed anyway**, which covers only the blockers listed then.
5. **Orphan sweep.** For each other folder under `.feature-factory/`, read the branch from `research.md` and delete the folder if that branch no longer exists locally or its PR is merged or closed. Skip folders without a `research.md` and never delete the folder found in step 2.
6. **Branch and folder.**
   - No run folder: on `main`, create a branch `<type>/<issue-number>-<short-slug>` (type `feat`, `fix` or `chore` from the issue; slug a few title words; with no issue `<type>/<slug>`; for example `chore/523-restructure-feature-factory-skill`); any other branch is used as is, whatever its name. Create the run folder; if a folder without `research.md` held a `decisions.md`, delete that file and start a new record. Append the held answers.
   - Run folder found (Resume or Start over): the branch is the `Branch:` line of `research.md`. Never create a branch. If the current branch differs, name both and ask (see Rules), offering **Check out <recorded branch>** and **Stop**. If the owner declines or the checkout fails, stop. If the recorded branch no longer exists, say so and that deleting the run folder starts a fresh run.
   - Resume: apply the halt-commit rule in `references/resume-halt-start-over.md`, append the held answers, then continue from the latest stage.
   - Start over: apply the Start over rule in `references/resume-halt-start-over.md`.

## Stage 1: Research

Read `references/outcome-table.md` in full before this stage.

`codebase-researcher` gets the feature description (the issue body when there is one). Ask for the entities, endpoints, DTOs, repositories, validators, test patterns, frontend hooks and components, the assistant tools and plugin or chat text that describe them, and fragile areas. End the prompt with: "Do not ask questions. Record any ambiguity under `### Risks and Missing Information`." Write `research.md` only from a reply that has a `### Relevant Files` heading.

## Stage 2: Story, then stop 1

Once `research.md` is written, read `references/decisions-record.md` in full before this stage.

An issue is **groomed** when its first non-blank line begins `> Groomed` and the body has `## Acceptance Criteria`, `## Edge Cases` and `## Out of Scope` headings.

- Groomed and not contradicted: the issue body is the story; copy it to `story.md` and skip stop 1 (record the skip).
- Contradicted (`research.md` shows a referenced entity, endpoint or schema missing or restructured): flag that and run `story-writer` once (no loop) with the groomed story as context and write `story.md`; the run is then not groomed, so hold stops 1 and 2 and record no skip.
- Otherwise: `story-writer` gets `research.md`; write `story.md` and hold **stop 1**.

## Stage 3: Brief, then stop 2

Read `references/outcome-table.md` and `references/decisions-record.md` in full before this stage.

1. `spec-writer` gets `story.md` and `research.md`. The brief must end with a **Scope block**: which areas change (`api`, `web`, `assistant`, `docs`), whether the UI changes, and a reason for each area that does not change when an API contract or error code does. If the block is missing, re-ask once. The areas:
   - Code areas: `TaskFlow.Api*/`, `TaskFlow.Contracts/` and `TaskFlow.Mcp.Integration.Tests/` are api, `TaskFlow.Web/` is web, `assistant/` is assistant. A file under a code-area path belongs to that area (`assistant/README.md` and `TaskFlow.Contracts/README.md` are not docs).
   - `docs` is root `docs/**` (`TaskFlow.Web/docs/` is web), `.claude/skills/**`, `.claude/agents/**`, `.claude/rules/**` and `*.md` files outside `docs/`, in each case only outside the code-area paths and outside `.github/**`. Root `README.md` and `CLAUDE.md` are docs.
   - `.github/**` is in no area and is never docs, so its files (including `*.md`) are routed by hand.
   - Root-level build files (`TaskFlow.sln`, `Directory.Build.props`, `global.json`) and `.gitignore` are in no area and change only when the brief names them, and the brief says who edits each; an unnamed edit is reported by the validator as outside the brief. `assistant/Directory.Build.props` and `assistant/.editorconfig` stay assistant.
2. Advisors, by the Scope block: `ux-advisor` when the UI changes, `claude-integration-advisor` when `assistant` is listed. Launch them together, in parallel; neither reads the other's output. Both get the draft brief, `story.md` and `research.md`. Write their replies to `advisories.md`, as the Outcome table (`references/outcome-table.md`) says for each reply value. No advisor applies to `docs`.
3. One more `spec-writer` pass folds `advisories.md` into the brief. A proposed package appears as "Proposed dependency (needs approval)". Write `brief.md`.

**Stop 2** is skipped only for a groomed issue whose stop 1 was skipped, whose brief has no `## 8. Open Questions` section, and whose advisor replies have no value whose Outcome table row (`references/outcome-table.md`) says stop 2 is held. A `docs` area never causes an owner question about which agent builds it.

## Stops 1 and 2

Read `references/decisions-record.md` and `references/resume-halt-start-over.md` in full before each stop.

Present the story or brief. List every open question. Put each question with discrete answers to the owner through AskUserQuestion (see Rules): 2 to 4 options per question, at most 4 questions per call, batched across calls when there are more. Re-run the agent with the answers and repeat until no open questions remain. Then ask (see Rules), offering **Approved**, **Changes requested** and **Rejected**.
- **Changes requested:** take the owner's free-text feedback from the tool's "Other" answer; if none was given, ask a follow-up plain-text prompt for it. Re-run with the feedback and present again.
- **Rejected:** apply the halt commit (see Halt in `references/resume-halt-start-over.md`) and stop.
- **On Resume:** apply Stops 1 and 2 on Resume in `references/resume-halt-start-over.md`.

## Stage 4: Build

Read `references/outcome-table.md` and `references/decisions-record.md` in full before this stage.

One builder per area the Scope block lists, in dependency order: `backend-builder` (api, regenerates the client), `frontend-builder` (web), `assistant-builder` (assistant), then `docs`. An area not listed is skipped. Each builder gets `brief.md`, `research.md` and the earlier `build-<area>.md` files. Pass `advisories.md` to `frontend-builder` and `assistant-builder` only.

The `docs` agent prompt:

- Implement the docs part of the approved brief; do not redesign it.
- Allowlist: root `docs/**`, `.claude/skills/**`, `.claude/agents/**`, `.claude/rules/**` and `*.md` files outside `docs/`, excluding anything under `TaskFlow.Api*/`, `TaskFlow.Contracts/`, `TaskFlow.Mcp.Integration.Tests/`, `TaskFlow.Web/`, `assistant/` and `.github/`; plus root files the brief names (for example `.gitignore`), never a path in the next bullet.
- Never touch `.claude/settings*.json`, `.claude/hooks/**`, `.github/**`, compose files, `.env`, any source or test file, or any other area.
- Do not run `git add`, `git commit` or `git push`.
- After editing any file under `.claude/agents/`, `.claude/skills/` or `.claude/rules/`: `cd TaskFlow.Web`, then via Bash `node -e` with `require('js-yaml').load(<frontmatter text>)`, where the frontmatter text is what lies between the first two `---` lines of the file. A file with no frontmatter (its first line is not `---`) needs no check and counts as `not needed`. An agent file or a `SKILL.md` must have frontmatter; a missing one is a parse error. Fix any parse error before replying. If `node_modules` or `js-yaml` is missing, report "check could not run"; never skip the check silently.
- Reply with "Spec blockers" first (omit if none), then files changed, then verification results: the js-yaml outcome, exactly one of `passed`, `parse error fixed`, `check could not run` or `not needed`.

Write each reply to `build-<area>.md` (`build-docs.md` for `docs`) and make one commit after each area.

**Respec procedure** (the `loop: Stage 3` rows of the Outcome table, `references/outcome-table.md`), in this order:

1. Record the spend (stage and reason).
2. Run `spec-writer` with the blocker to revise the brief (see Rules).
3. Re-run every advisor that ran in Stage 3, plus any the revised brief's Scope block calls for, on the revised brief, `story.md` and `research.md`. Their replies replace `advisories.md`.
4. One more `spec-writer` pass folds `advisories.md` into the brief.
5. Hold stop 2 in full.
6. Re-run the affected area and every later one.

A spec blocker raised in a Stage 7 pass uses the same rows, this procedure and the same respec budget. The correction unit spent for that pass stays spent.

## Stage 5: Verify

Read `references/outcome-table.md`, `references/decisions-record.md` and `references/ci-jobs-by-area.md` in full before this stage.

`test-verifier` gets `story.md`, `brief.md`, the `build-*.md` files and `advisories.md` if present. It runs the jobs the CI jobs by area table (`references/ci-jobs-by-area.md`) gives the diff's areas. Write `verify.md` and make one commit.

A run gets one FORMAT-ONLY pass: append the FORMAT-ONLY entry (Decisions record, `references/decisions-record.md`), then have the area builder run the formatter, commit, and re-verify.

## Stage 6: Validate

Read `references/outcome-table.md` in full before this stage.

Runs after every Stage 5 that does not Halt; Stage 7 consumes both reports.

Write `diff.patch` (the branch against `main`) and `changed-files.txt` fresh before every run. `implementation-validator` gets `story.md`, `brief.md`, the `build-*.md` files, `verify.md`, `advisories.md`, `diff.patch` and `changed-files.txt`. Also tell it to check each skipped area against the final diff (DTOs, controllers, `Helpers/`; this check applies to code areas only), and that an API change cannot pass without the assistant step or a stated reason. For a docs-only diff, the skipped-area check expects no changes under the code-area paths (Stage 3) and no paths outside the docs allowlist and the root files the brief names. Write `validation.md`.

## Stage 7: Correct

Read `references/outcome-table.md`, `references/decisions-record.md` and `references/resume-halt-start-over.md` in full before this stage.

Triggers: every Outcome table row (`references/outcome-table.md`) whose destination is `loop: Stage 7`. One pass covers every trigger present and spends one unit of the correction budget (on a resumed run, see Resume after a budget Halt). Skipped when no trigger is present.

Send every trigger present to the area builder, with the verifier's diagnosis for a code failure; a failure in the `assistant` job goes to `assistant-builder`, even when the Scope block does not list `assistant`; Must fix findings in docs files go to the `docs` agent with the same prompt. For a probable bug, pass the test code, the expected behavior and its source from `verify.md`; the builder restores the test together with the fix. Write the builder's reply over its `build-<area>.md`, commit, then repeat stages 5 and 6.

## Stage 8: Finish, stop 3

Read `references/outcome-table.md`, `references/decisions-record.md`, `references/resume-halt-start-over.md` and `references/implementation-notes.md` in full before this stage.

Draft the implementation notes (`references/implementation-notes.md`) from the run files only; the Decisions section and the PR body's skip reasons come from `decisions.md`, with repeated identical lines collapsed and a skip reported only for an area the final Scope block does not list. With an issue number, re-read `blocked_by` as in Stage 0 step 4. Show any open blocker not listed in a **proceed anyway** entry in `decisions.md` together with the review, and ask the same **proceed anyway** / **Stop** question before the Yes/No question. Record a **proceed anyway** here and add it to the notes' Decisions before they are shown. **Stop** applies the halt commit (see Halt in `references/resume-halt-start-over.md`) and pushes and posts nothing. If the read fails, say so and stop.

Show the notes at **stop 3** with the validator report, skipped areas, the gate results and every item the Outcome table (`references/outcome-table.md`) marks as reported or shown at stop 3, then ask (see Rules) whether to open the PR, offering **Yes** and **No**. Record the answer, before step 1 on Yes.

On **No**, post nothing and apply the halt commit (see Halt in `references/resume-halt-start-over.md`); nothing else on the branch changes. On **Yes**, in this order:

1. Push the branch. If the push fails, report it and the branch name and stop: nothing is posted and no PR is opened.
2. With an issue number, post the notes as one issue comment whose first line is `<!-- implementation-notes -->`; find an existing comment by that marker and update it in place on a re-run. Without an issue, the notes go at the end of the PR body. If the post fails, report it and stop; the push stays.
3. Open a PR against `main`; if an open PR for the branch exists, update its body in place instead. The body has: summary, gate results, every item the Outcome table (`references/outcome-table.md`) marks as reported or puts in the PR body, the skip reasons, `Closes #N` and a link to the notes comment. It has no list of changed files. If this fails, report it and stop.
4. Print "Review with: `/pr-triage <N>`" using the PR number. When the Scope block says the UI changes, also print "UI changed: run `/ux-test PR#<N>`". Never run either yourself.
5. Delete the run folder last, only after the PR is open and step 4 has printed.

A failure in steps 1 to 3 is not a Halt: keep the run folder. Re-running resumes at this stage and asks stop 3 again; on Yes the push is a no-op if already pushed.
