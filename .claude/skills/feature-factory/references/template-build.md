# Template: build-<area>.md

Written in Stages 4 and 7 of feature-factory by `backend-builder` (`build-api.md`), `frontend-builder` (`build-web.md`), `assistant-builder` (`build-assistant.md`) and the `docs` agent (`build-docs.md`). Write the file at the prompt's `Output path:` in the form below, then reply with your status block.

Allowed status: DONE, SPEC_BLOCKER, GATES_RED, CLIENT_REGEN_FAILED, ENVIRONMENT_FAILURE, CHECK_NOT_RUN, BLOCKED, WRITE_FAILED
No-file status: BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7. Here: the Halt values (`BLOCKED`, `CLIENT_REGEN_FAILED`, `ENVIRONMENT_FAILURE`, `CHECK_NOT_RUN`), then `SPEC_BLOCKER`, then `GATES_RED`, then `DONE`. `WRITE_FAILED` applies only when the write itself fails.

## Status values

The line above is the union for all four writers. Use only the values listed for you.

| Status | Who | When |
|---|---|---|
| `DONE` | all | The work is built, the file is written and every check you ran passes. |
| `SPEC_BLOCKER` | all | The file has a `## Spec blockers` section. |
| `GATES_RED` | the three builders | A check you ran still fails. Name each failing check in `## Verification results` and in `Summary`. |
| `CLIENT_REGEN_FAILED` | `backend-builder` | The client could not be regenerated. Give the reason in `## Client regeneration` and in `Summary`. |
| `ENVIRONMENT_FAILURE` | `assistant-builder` | The SDK or the `claude` CLI is missing. Give the reason in `## Verification results` and in `Summary`. |
| `CHECK_NOT_RUN` | the `docs` agent | The js-yaml check could not run. |
| `BLOCKED` | all | An input is missing (the brief). Write no file, reply `Output: none` and put what is missing in `Summary`. |
| `WRITE_FAILED` | all | The write to the output path failed. Reply `Output: none` and put the reason in `Summary`. |

`Open questions:` is always 0.

## Rules

- Use the sections below that apply to you, in this order.
- Delete an empty section. Never write None as a section body.
- When re-invoked, Read the existing file and rewrite it in full, so it describes the area as it now stands.

## File layout

```markdown
## Spec blockers

## Files changed

## Dependencies added outside the brief

## Verification results

## Client regeneration

## API contract

## Client status

## User-visible change

## Plugin and chat sync

## Advisory deviations

## js-yaml check
```

## Section contents

| Section | Who | Contents |
|---|---|---|
| `## Spec blockers` | all | Each blocker: the brief line and why it cannot be built as written. |
| `## Files changed` | all | Each path, created or modified, with one line on what changed. |
| `## Dependencies added outside the brief` | the three builders | Packages you added that the brief does not name. |
| `## Verification results` | all | Each command and its real outcome. |
| `## Client regeneration` | `backend-builder` | `ran`, `not needed` or `FAILED (reason)`, plus the diff check result. Always present. |
| `## API contract` | `backend-builder` | New or changed endpoints (method, path, request, response, status codes), for the later builders. |
| `## Client status` | `frontend-builder` | Generated types and operations you relied on, and hand-written modules you changed. |
| `## User-visible change` | `frontend-builder` | What the user sees and how they interact with it. |
| `## Plugin and chat sync` | `assistant-builder` | The files updated for a tool change, or `not needed`. Always present. |
| `## Advisory deviations` | `frontend-builder`, `assistant-builder` | One entry per deviation from an advisor file: the guidance, the technical reason and what you did instead. |
| `## js-yaml check` | the `docs` agent | Exactly one of `passed`, `parse error fixed`, `not needed`, `check could not run`. Always present. |

## The docs agent

This section is for the `docs` agent only. It has no agent file, so the orchestrator builds its prompt from this section (Stage 4 of `SKILL.md`), and its reply is stated here.

- Implement the docs part of the approved brief; do not redesign it.
- Allowlist: root `docs/**`, `.claude/skills/**`, `.claude/agents/**`, `.claude/rules/**` and `*.md` files outside `docs/`, excluding anything under `TaskFlow.Api*/`, `TaskFlow.Contracts/`, `TaskFlow.Mcp.Integration.Tests/`, `TaskFlow.Web/`, `assistant/` and `.github/`; plus `.gitignore` when the brief names it (root build files are api: `template-brief.md`), never a path in the next bullet.
- Never touch `.claude/settings*.json`, `.claude/hooks/**`, `.github/**`, compose files, `.env`, any source or test file, or any other area.
- Do not run `git add`, `git commit` or `git push`.
- Write your report only to the prompt's `Output path:`, the one file you may write outside the allowlist; Read an existing file there first, because Write refuses otherwise.

After writing the file, reply with only these four lines, in this order.

```text
Status: <a value this template lists for the docs agent>
Output: <the Output path value exactly as the prompt gave it, or none>
Open questions: 0
Summary: <one line>
```

The js-yaml check: after editing any file under `.claude/agents/`, `.claude/skills/` or `.claude/rules/`: `cd TaskFlow.Web`, then via Bash `node -e` with `require('js-yaml').load(<frontmatter text>)`, where the frontmatter text is what lies between the first two `---` lines of the file.

- A file with no frontmatter (its first line is not `---`) needs no check and counts as `not needed`. So does a run that edited no file under those three folders.
- An agent file or a `SKILL.md` must have frontmatter; a missing one is a parse error.
- Fix any parse error before replying, and record `parse error fixed`.
- If `node_modules` or `js-yaml` is missing, record `check could not run` and reply with status `CHECK_NOT_RUN`. Never skip the check silently.
