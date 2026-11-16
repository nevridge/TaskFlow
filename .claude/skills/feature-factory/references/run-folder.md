# Run folder

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to. This is the one place the layout is stated.

`.feature-factory/<issue-number-or-slug>/` is the run folder. It is gitignored. Each file has one writer, and each agent-written file has one template in this folder (`references/`).

| File | Writer | Template |
|---|---|---|
| `research.md` | `codebase-researcher` | `template-research.md` |
| `story.md` | `story-writer`; or the orchestrator, only as a verbatim copy of a groomed issue body that stands | `template-story.md` (none for the groomed copy) |
| `brief.md` | `spec-writer` | `template-brief.md` |
| `advisories-ux.md` | `ux-advisor` | `template-advisories-ux.md` |
| `advisories-claude.md` | `claude-integration-advisor` | `template-advisories-claude.md` |
| `build-<area>.md` (`build-docs.md` for `docs`) | the area builder or the `docs` agent | `template-build.md` |
| `verify.md` | `test-verifier` | `template-verify.md` |
| `validation.md` | `implementation-validator` | `template-validation.md` |
| `decisions.md`, `diff.patch`, `changed-files.txt` | orchestrator | none |

## Rules

- `research.md` line 1 is `Branch: <name>` and line 2 is `Commit: <sha>`. The orchestrator passes both values in the Stage 1 prompt (the branch name, also for a branch used as is, and the `git rev-parse HEAD` value) and the researcher writes them. Preflight reads the `Branch:` line.
- The orchestrator writes `story.md` in one case only: a groomed story that stands, copied verbatim from the issue body. It writes no other agent file, also not after a failed check or a `WRITE_FAILED` reply.
- `advisories-ux.md` and `advisories-claude.md` are the two advisor files. Each exists only when its advisor ran and did not return `NO_UI_WORK`. Every reader copes with a missing advisor file: a prompt names both, and the agent reads each only if it exists.
- An agent that runs again rewrites its file: it reads the existing file first, then writes the whole file.

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
