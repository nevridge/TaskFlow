# Run folder

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to. This is the one place the layout is stated.

`.feature-factory/<issue-number-or-slug>/` is the run folder. It is gitignored. Each file has one writer, and each agent-written file has one template in this folder (`references/`).

| File | Writer | Template |
|---|---|---|
| `research.md` | `codebase-researcher`; the orchestrator edits only line 1 of a groomed, not started one (Rules) | `template-research.md` |
| `grooming.md` | `/groom-issue` (nevridge/dotfiles#37), never the orchestrator | none (written outside this repo) |
| `story.md` | `story-writer`; or the orchestrator, only as a verbatim copy of a groomed issue body that stands | `template-story.md` (none for the groomed copy) |
| `brief.md` | `spec-writer` | `template-brief.md` |
| `advisories-ux.md` | `ux-advisor` | `template-advisories-ux.md` |
| `advisories-claude.md` | `claude-integration-advisor` | `template-advisories-claude.md` |
| `build-<area>.md` (`build-docs.md` for `docs`) | the area builder or the `docs` agent | `template-build.md` |
| `verify.md` | `test-verifier` | `template-verify.md` |
| `validation.md` | `implementation-validator` | `template-validation.md` |
| `decisions.md`, `diff.patch`, `changed-files.txt` | orchestrator | none |

## Rules

- `research.md` line 1 is `Branch: <name>` and line 2 is `Commit: <sha>`. The orchestrator passes both values in the Stage 1 prompt (the branch name, also for a branch used as is, and the `git rev-parse HEAD` value) and the researcher writes them. Preflight reads the `Branch:` line, so after the reply check the orchestrator reads line 1: a line that is not `Branch: <the name it passed>` counts as a failed check.
- The orchestrator writes only `decisions.md`, `diff.patch` and `changed-files.txt`, with two exceptions: `story.md`, only as a verbatim copy of a groomed issue body that stands (Stage 2); and line 1 of `research.md`, only when it reads exactly `Branch: none`, replaced with the real branch (Stage 1). It writes no other agent file and no other part of one, also not after a failed check or a `WRITE_FAILED` reply.
- `advisories-ux.md` and `advisories-claude.md` are the two advisor files. Each exists only when its advisor ran and did not return `NO_UI_WORK`. Every reader copes with a missing advisor file: a prompt names both, and the agent reads each only if it exists.
- An agent that runs again rewrites its file: it reads the existing file first, then writes the whole file.

## Groomed, not started

A run folder is **groomed, not started** when `research.md` line 1 is exactly `Branch: none` and line 2 is `Commit: <sha>`. `/groom-issue` (nevridge/dotfiles#37) writes it ahead of a run: it holds `research.md` and may hold `grooming.md`. This folder state is separate from a **groomed** issue (Stage 2: a body whose first non-blank line begins `> Groomed`); never call the folder just "groomed".

- **Line 1 and 2 reads.** Every read of line 1 or line 2 of `research.md` (the `Branch: none` check, a `Branch:` comparison, the `Commit:` value) first trims one trailing `\r`, because files may have CRLF line endings on Windows.
- **Folder-name parse.** A folder name made only of digits is the issue number. Any other name has no parseable issue number.
- **`grooming.md`** holds the owner's grooming questions and answers. It is optional context only: a prompt that names it says to read it only if it exists, and it is never read for stops, budgets, blocker coverage or the stage.
- **Not a started run.** Stage 0 treats the folder as no run folder for steps 2 and 3 in `preflight.md` (no Resume or Start over offer, and the `Branch:` comparison is never applied). Step 5 in `preflight.md` sweeps it only when its issue is closed. Step 6 in `preflight.md` creates the branch and keeps `research.md` and `grooming.md`. The only way to force a fresh research run is to delete the folder by hand.
- **The line 1 edit** (Stage 1, empty changed-file list) replaces only line 1 with `Branch: <real branch>` and keeps the file's line ending (CRLF stays CRLF); line 2 stays at the recorded commit. It is not recorded in `decisions.md`. If the edit fails, stop and report it. Once line 1 holds the real branch, by this edit or by the researcher's rewrite, the folder is a normal started run.

## Prompts and replies

Every agent prompt carries these two lines, each on its own line, with absolute paths, and states no reply format:

```text
Output path: <absolute path of the run file>
Template path: <absolute path of the template>
```

The agent reads the template, writes the one file and replies with four lines: `Status:`, `Output:`, `Open questions:` and `Summary:`. The orchestrator pipes the reply to `node .claude/skills/feature-factory/check-reply.mjs <template-path> <expected-output-path>` from the repo root and routes on `Status` by the Outcome table (`outcome-table.md`) only when the script exits 0. The script prints what is wrong on standard error; use that text in the one re-ask.

## State

`decisions.md` is append-only: one line per entry, holding a date, the stage or gate, and the decision. The Decisions record (`decisions-record.md`) says what is appended and when.

There is no state file: the stage is inferred from which files exist and from `git log`. `decisions.md` does not set the stage; it is read only for these checks: stops 1 and 2 on Resume, budgets, the FORMAT-ONLY count and blocker coverage. A stage that makes a commit (a build area, verify, a correction pass) is finished only when its commit is in `git log`; a `build-<area>.md` without that commit, or one holding a `## Spec blockers` section, means the area runs again.
