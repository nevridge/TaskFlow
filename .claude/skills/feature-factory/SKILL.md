---
name: feature-factory
description: Builds a TaskFlow feature from a GitHub issue to a pull request through specialist subagents, with three human approval stops (story, brief, final review); only the last is never skipped.
argument-hint: "[issue-number]"
disable-model-invocation: true
---

You are the feature-factory orchestrator of a multi-agent pipeline with three approval stops, the first two skippable only under Stages 2 and 3. **Never implement code yourself**: you write only `decisions.md`, `diff.patch` and `changed-files.txt`, with two exceptions: `story.md`, only as a verbatim copy of a groomed issue body that stands (Stage 2); and line 1 of `research.md`, only when it reads exactly `Branch: none`, replaced with the real branch (Stage 1). Every other run file is written by its agent from a template (`references/run-folder.md`). Agents receive file paths and read them; do not paste earlier output into prompts.

`story-writer`, `codebase-researcher` and `spec-writer` are user-level agents. If any is missing, stop at its stage, name it, and resume from the run files once it is installed. Every other agent named below is a project agent. `docs` has no agent file: a general-purpose agent builds it from the prompt in Stage 4.

## Rules

- The three stops are exactly the ones below. Stops 1 and 2 are skipped only as Stages 2 and 3 say, and never because an answer seems obvious; stop 3 is never skipped and has no override.
- One shared correction budget of 2 for the whole run, and one respec budget of 1.
- Spec blockers from a builder go back to `spec-writer`, never to another builder.
- When the Outcome table (`references/outcome-table.md`) and stage prose disagree, the table wins.
- Every agent prompt, the `docs` prompt included, carries absolute `Output path:` and `Template path:` on their own lines and states no reply format. The output is the run file a stage names; the template is the `references/template-*.md` file it names. Pipe each reply to `node .claude/skills/feature-factory/check-reply.mjs <template-path> <expected-output-path>` (the reply on standard input). On exit 0, route on its `Status` by the Outcome table. A failed check or `WRITE_FAILED` gets one re-ask, then Halt. Never write an agent's file beyond the exceptions above.
- Every `git add` is plain `git add -A`; `.feature-factory/` and `.playwright-mcp/` are gitignored.
- Every decision put to the owner uses the AskUserQuestion tool (or a plain-text list if it is unavailable). Free-form questions stay as plain text.
- The orchestrator itself asks every owner question and runs every commit, reset, branch checkout, push and GitHub post. Never delegate these to an agent: agents cannot ask the owner questions and never commit.

## Run folder

`.feature-factory/<issue-number-or-slug>/` is the run folder. `references/run-folder.md` gives its files, who writes each, the template for each, and how the stage is inferred from the files and `git log` (there is no state file). `decisions.md` is append-only; the Decisions record (`references/decisions-record.md`) says what is appended and when.

## Reference files

After a compaction, re-read `SKILL.md` and the reference files the current stage or stop names. `SKILL.md` must stay at or under 5,000 tokens, checked as at or under 18,000 bytes with `wc -c SKILL.md`, because after a compaction only the first 5,000 tokens of a skill are re-attached.

Read each file in full when a stage says to:

- [references/preflight.md](references/preflight.md): Stage 0, the preflight steps.
- [references/run-folder.md](references/run-folder.md): the run folder layout. The `references/template-*.md` files are the agents' templates, one per run file, named in the stage that uses each.
- [references/outcome-table.md](references/outcome-table.md): the Outcome table, which gives the outcome of every agent Status value and lists the report-only sections.
- [references/decisions-record.md](references/decisions-record.md): the Decisions record.
- [references/resume-halt-start-over.md](references/resume-halt-start-over.md): the Halt-commit rule, the Start over rule, Halt and the Resume rules.
- [references/ci-jobs-by-area.md](references/ci-jobs-by-area.md): the CI jobs by area table.
- [references/implementation-notes.md](references/implementation-notes.md): the sections of the implementation notes.
- [references/run-file-check.md](references/run-file-check.md): the run file check before stop 2.

Read `references/resume-halt-start-over.md` in full before any Halt and before a budget check on a resumed run (Resume after a budget Halt).

## Stage 0: Preflight

Read `references/preflight.md`, `references/run-folder.md`, `references/decisions-record.md` and `references/resume-halt-start-over.md` in full before this stage. The steps of this stage are in `references/preflight.md`.

## Stage 1: Research

Read `references/outcome-table.md` in full before this stage.

`codebase-researcher` gets the feature description (the issue body when there is one), each path it names as moved, renamed, deleted or reassigned to another area (do not predict others), the branch name and the `git rev-parse HEAD` value. `Output path:` is `research.md`; `Template path:` is `references/template-research.md`, which holds the coverage list and the no-questions instruction. A re-run repeats that instruction in the prompt.

A groomed, not started folder (`references/run-folder.md`, read it in full): run `git diff --name-only <commit>..HEAD` with line 2's commit.

- Non-empty list: run `codebase-researcher` as above, also passing the recorded commit and the list.
- Empty list: do not run it; replace line 1 with the real branch yourself.
- `git diff` fails: run it in full as for a new run.

## Stage 2: Story, then stop 1

Once `research.md` is written, read `references/decisions-record.md` in full before this stage.

An issue is **groomed** when its first non-blank line begins `> Groomed` and the body has `## Acceptance Criteria`, `## Edge Cases` and `## Out of Scope` headings.

- Groomed and not contradicted: the issue body is the story; copy it verbatim to `story.md` yourself, with no `story-writer` call, and skip stop 1 (record the skip).
- Groomed but contradicted (`research.md` shows a referenced entity, endpoint or schema missing or restructured): flag that and run `story-writer` once before stop 1 with the groomed story as context; the run is then not groomed, so hold stops 1 and 2 and record no skip.
- Otherwise: `story-writer` gets `research.md`; hold **stop 1**.

Every `story-writer` prompt has `Output path:` `story.md` and `Template path:` `references/template-story.md`.

## Stage 3: Brief, then stop 2

Read `references/outcome-table.md`, `references/decisions-record.md`, `references/template-brief.md` and `references/run-file-check.md` in full before this stage.

1. `spec-writer` gets `story.md`, `research.md` and `grooming.md` (read only if it exists). `Output path:` is `brief.md`; `Template path:` is `references/template-brief.md`, which holds the Scope block and the area definitions. If the brief's Scope block is missing, re-ask once.
2. Advisors, by the Scope block: `ux-advisor` when the UI changes, `claude-integration-advisor` when `assistant` is listed. Launch them together, in parallel; neither reads the other's output. Both get the draft brief, `story.md` and `research.md`. Each writes its own file: `ux-advisor` writes `advisories-ux.md` from `references/template-advisories-ux.md`, and `claude-integration-advisor` writes `advisories-claude.md` from `references/template-advisories-claude.md`. `NO_UI_WORK` writes no file. No advisor applies to `docs`.
3. One more `spec-writer` pass folds the advisor files into the brief: its prompt names both and `grooming.md` and says to read each only if it exists. `Output path:` is `brief.md` again.
4. Before stop 2 is decided, read `brief.md` and `research.md` yourself, once, against the stage rules (not the advisor files).

**Stop 2** is skipped only for a groomed issue whose stop 1 was skipped, when the last `spec-writer` block and every advisor block have `Open questions: 0` and step 4 found no contradiction (`references/run-file-check.md`). A `docs` area never causes an owner question about which agent builds it.

## Stops 1 and 2

Read `references/decisions-record.md` and `references/resume-halt-start-over.md` in full before each stop, and `references/run-file-check.md` before stop 2.

Present the story or brief. List every open question. Put each question with discrete answers to the owner through AskUserQuestion (see Rules): 2 to 4 options per question, at most 4 questions per call, batched across calls when there are more. Re-run the agent with the answers and repeat until no open questions remain. Then ask (see Rules), offering **Approved**, **Changes requested** and **Rejected**.
- **Changes requested:** take the owner's free-text feedback from the tool's "Other" answer; if none was given, ask a follow-up plain-text prompt for it. Re-run with the feedback and present again.
- **Rejected:** apply the halt commit (see Halt in `references/resume-halt-start-over.md`) and stop.
- **On Resume:** apply Stops 1 and 2 on Resume in `references/resume-halt-start-over.md`.

## Stage 4: Build

Read `references/outcome-table.md` and `references/decisions-record.md` in full before this stage.

One builder per area the Scope block lists, in dependency order: `backend-builder` (api, regenerates the client), `frontend-builder` (web), `assistant-builder` (assistant), then `docs`. An area not listed is skipped. Each builder gets `brief.md`, `research.md` and the earlier `build-<area>.md` files. `Output path:` is `build-<area>.md` (`build-docs.md` for `docs`); `Template path:` is `references/template-build.md`. The `frontend-builder` and `assistant-builder` prompts also name `advisories-ux.md` and `advisories-claude.md` and say to read each only if it exists.

The `docs` agent prompt:

- Implement the docs part of the approved brief; do not redesign it.
- Allowlist: root `docs/**`, `.claude/skills/**`, `.claude/agents/**`, `.claude/rules/**` and `*.md` files outside `docs/`, excluding anything under `TaskFlow.Api*/`, `TaskFlow.Contracts/`, `TaskFlow.Mcp.Integration.Tests/`, `TaskFlow.Web/`, `assistant/` and `.github/`; plus `.gitignore` when the brief names it (root build files are api: `references/template-brief.md`), never a path in the next bullet.
- Never touch `.claude/settings*.json`, `.claude/hooks/**`, `.github/**`, compose files, `.env`, any source or test file, or any other area.
- Do not run `git add`, `git commit` or `git push`.
- The `Output path:` and `Template path:` lines. Read the template and write your report only to the output path, the one file you may write outside the allowlist; Read an existing file there first, because Write refuses otherwise.
- Follow the template's section for the `docs` agent: it gives the js-yaml check and how to reply.

Check each reply, then make one commit after each area.

**Respec procedure** (the `loop: Stage 3` rows of the Outcome table, `references/outcome-table.md`), in this order:

1. Record the spend (stage and reason).
2. Run `spec-writer` with the blocker and `grooming.md` (read only if it exists) to revise the brief (see Rules).
3. Delete both advisor files, then re-run every advisor that ran in Stage 3, plus any the revised brief's Scope block calls for, on the revised brief, `story.md` and `research.md`. Each writes its own file.
4. One more `spec-writer` pass folds the advisor files into the brief, as in Stage 3 (`grooming.md` named too).
5. Read `brief.md` and `research.md` yourself against the stage rules, as `references/run-file-check.md` (read in full first) says for a respec.
6. Hold stop 2 in full.
7. Re-run the affected area and every later one.

A spec blocker raised in a Stage 7 pass uses the same rows, this procedure and the same respec budget. The correction unit spent for that pass stays spent.

## Stage 5: Verify

Read `references/outcome-table.md`, `references/decisions-record.md` and `references/ci-jobs-by-area.md` in full before this stage.

`test-verifier` gets `story.md`, `brief.md`, the `build-*.md` files and both advisor files, each read only if it exists. `Output path:` is `verify.md`; `Template path:` is `references/template-verify.md`. It runs the jobs the CI jobs by area table (`references/ci-jobs-by-area.md`) gives the diff's areas. Check the reply and make one commit.

A run gets one FORMAT-ONLY pass: append the FORMAT-ONLY entry (Decisions record, `references/decisions-record.md`), then have the area builder run the formatter, commit, and re-verify.

## Stage 6: Validate

Read `references/outcome-table.md` in full before this stage.

Runs after every Stage 5 that does not Halt; Stage 7 consumes both reports.

Write `diff.patch` (the branch against `main`) and `changed-files.txt` fresh before every run. `implementation-validator` gets `story.md`, `brief.md`, the `build-*.md` files, `verify.md`, both advisor files and `grooming.md` (each read only if it exists), `diff.patch` and `changed-files.txt`. `Output path:` is `validation.md`; `Template path:` is `references/template-validation.md`. For a docs-only diff, the validator's Scope check expects no changes under the code-area paths (`references/template-brief.md`) and no paths outside the docs allowlist and `.gitignore` when the brief names it.

## Stage 7: Correct

Read `references/outcome-table.md`, `references/decisions-record.md` and `references/resume-halt-start-over.md` in full before this stage.

Triggers: every Outcome table row (`references/outcome-table.md`) whose destination is `loop: Stage 7`. One pass covers every trigger present and spends one unit of the correction budget (resumed run: Resume after a budget Halt, `references/resume-halt-start-over.md`). Skipped when no trigger is present.

Send every trigger present to the area builder, with the verifier's diagnosis for a code failure; a failure in the `assistant` job goes to `assistant-builder`, even when the Scope block does not list `assistant`; Must fix findings in docs files go to the `docs` agent with the same prompt; a stop 3 answer's handoff is in the Outcome table. For a probable bug, pass the test code, the expected behavior and its source from `verify.md`; the builder restores the test together with the fix. The builder reads its `build-<area>.md` and rewrites it. Check the reply, commit, then repeat stages 5 and 6.

## Stage 8: Finish, stop 3

Read `references/outcome-table.md`, `references/decisions-record.md`, `references/resume-halt-start-over.md`, `references/implementation-notes.md` and `references/preflight.md` in full before this stage.

First apply Owner changes at Stage 8 (`references/resume-halt-start-over.md`): a dirty tree is committed and re-verified before the blocker question.

Draft the implementation notes (`references/implementation-notes.md`) from the run files only; the Decisions section and the PR body's skip reasons come from `decisions.md`, with repeated identical lines collapsed and a skip reported only for an area the final Scope block does not list. With an issue number, re-read `blocked_by` as in Stage 0 step 4 in `references/preflight.md`. Show any open blocker not listed in a **proceed anyway** entry in `decisions.md` together with the review, and ask the same **proceed anyway** / **Stop** question before the Yes/No question. Record a **proceed anyway** here and add it to the notes' Decisions before they are shown. **Stop** applies the halt commit (see Halt in `references/resume-halt-start-over.md`) and pushes and posts nothing. If the read fails, say so and stop.

Show the notes at **stop 3** with the validator report, skipped areas, the gate results and every item the Outcome table (`references/outcome-table.md`) marks as reported or shown at stop 3, then ask (see Rules) whether to open the PR, offering **Yes** and **No**, plus the third answer when the Outcome table's stop 3 row offers it. Record the answer, before step 1 on Yes. After a Yes and before step 1, apply that check again; a dirty tree pushes nothing and reopens stop 3.

On **No**, post nothing and apply the halt commit (see Halt in `references/resume-halt-start-over.md`); nothing else on the branch changes. On **Yes**, in this order:

1. Push the branch. If the push fails, report it and the branch name and stop: nothing is posted and no PR is opened.
2. With an issue number, post the notes as one issue comment whose first line is `<!-- implementation-notes -->`; find an existing comment by that marker and update it in place on a re-run. Without an issue, the notes go at the end of the PR body. If the post fails, report it and stop; the push stays.
3. Open a PR against `main`; if an open PR for the branch exists, update its body in place instead. The body has: summary, gate results, every item the Outcome table (`references/outcome-table.md`) marks as reported or puts in the PR body, the skip reasons, `Closes #N` and a link to the notes comment. It has no list of changed files. If this fails, report it and stop.
4. Print "Review with: `/pr-triage <N>`" using the PR number. When the Scope block says the UI changes, also print "UI changed: run `/ux-test PR#<N>`". Never run either yourself.
5. Delete the run folder last, only after the PR is open and step 4 has printed.

A failure in steps 1 to 3 is not a Halt: keep the run folder. Re-running resumes at this stage and asks stop 3 again; on Yes the push is a no-op if already pushed.
