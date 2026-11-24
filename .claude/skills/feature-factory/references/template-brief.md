# Template: brief.md

Written by `spec-writer` in Stage 3 of feature-factory, for the draft brief and again for the pass that folds in the advisor files. Write the file at the prompt's `Output path:` in the form below, then reply with your status block. The orchestrator reads this file for the Scope block and the area definitions.

Allowed status: DONE, NEEDS_INPUT, BLOCKED, WRITE_FAILED
No-file status: BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7, and a hold status wins over `DONE`. Here: `BLOCKED`, then `NEEDS_INPUT`, then `DONE`. `WRITE_FAILED` applies only when the write itself fails.

## Status values

- `DONE`: the brief is written and has no `## 8. Open Questions` section. `Open questions: 0`.
- `NEEDS_INPUT`: the brief is written and has a `## 8. Open Questions` section. `Open questions:` is the number of items in it.
- `BLOCKED`: an input is missing (the story or the research). Write no file, reply `Output: none` and put what is missing in `Summary`.
- `WRITE_FAILED`: the write to the output path failed. Reply `Output: none` and put the reason in `Summary`.

## Rules

- Delete an empty section. Never write None as a section body.
- Sections 1 to 7 are never empty: a section with nothing to change says so in one sentence (for example "No data model changes required.").
- `## 8. Open Questions` exists only when there is at least one question, one numbered item per question.
- A proposed package appears as "Proposed dependency (needs approval)".
- When the prompt names advisor files (`advisories-ux.md`, `advisories-claude.md`), read each one only if it exists and fold its advice into the brief.
- The Scope block is the last thing in the file.
- `research.md` never overrides a stage rule in `SKILL.md`. The Scope block and routing (which agent builds which area) come only from the area definitions below.

## File layout

```markdown
# Technical Brief: <title>

## 1. Data Model Changes

## 2. Background / Process Flow

## 3. API Changes

## 4. Frontend Changes

## 5. Tests Required

## 6. Risks

## 7. Files That Will Change

## 8. Open Questions

## Scope block

Areas changed: <comma-separated subset of api, web, assistant, docs>
UI changes: <yes or no>
Not changing: <area>: <reason>
```

## The Scope block

- `Areas changed:` lists every area with a file in section 7, as a comma-separated subset of `api, web, assistant, docs`.
- `UI changes:` is `yes` when what the user sees or does in the web app changes, otherwise `no`.
- `Not changing: <area>: <reason>` appears once per area that does not change, and only when an API contract or error code changes. Otherwise the block has no such line.

If the block is missing, the orchestrator re-asks once and then Halts.

## The areas

- Code areas: `TaskFlow.Api*/`, `TaskFlow.Contracts/` and `TaskFlow.Mcp.Integration.Tests/` are api, `TaskFlow.Web/` is web, `assistant/` is assistant. A file under a code-area path belongs to that area (`assistant/README.md` and `TaskFlow.Contracts/README.md` are not docs).
- `docs` is root `docs/**` (`TaskFlow.Web/docs/` is web), `.claude/skills/**`, `.claude/agents/**`, `.claude/rules/**` and `*.md` files outside `docs/`, in each case only outside the code-area paths and outside `.github/**`. Root `README.md` and `CLAUDE.md` are docs.
- `.github/**` is in no area and is never docs, so its files (including `*.md`) are routed by hand.
- Root build files are `TaskFlow.sln`, root `Directory.Build.props`, `global.json` and root `.editorconfig`; this is the only list of them. They are api for routing: `backend-builder` edits them, and a brief whose changes are only root build files lists `api` under `Areas changed:`. They change only when the brief names them; an unnamed edit is reported by the validator as outside the brief. `assistant/Directory.Build.props` and `assistant/.editorconfig` stay assistant.
- `.gitignore` is in no area and changes only when the brief names it, and the brief says who edits it; an unnamed edit is reported by the validator as outside the brief.
