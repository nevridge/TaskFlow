# Template: story.md

Written by `story-writer` in Stage 2 of feature-factory. Write the file at the prompt's `Output path:` in the form below, then reply with your status block.

Allowed status: DONE, NEEDS_INPUT, BLOCKED, WRITE_FAILED
No-file status: BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7, and a hold status wins over `DONE`. Here: `BLOCKED`, then `NEEDS_INPUT`, then `DONE`. `WRITE_FAILED` applies only when the write itself fails.

## Status values

- `DONE`: the story is written and has no open questions. `Open questions: 0`.
- `NEEDS_INPUT`: the story is written and has an `## Open Questions` section. `Open questions:` is the number of questions in it.
- `BLOCKED`: an input is missing. Write no file, reply `Output: none` and put what is missing in `Summary`.
- `WRITE_FAILED`: the write to the output path failed. Reply `Output: none` and put the reason in `Summary`.

## Rules

- Acceptance criteria are numbered and written as Given / When / Then.
- `## Open Questions` exists only when there is at least one question, one numbered item per question.
- Delete an empty section. Never write None as a section body.

## File layout

```markdown
## User Story

As a <role>, I want <capability>, so that <benefit>.

## Acceptance Criteria

1. **Given** <context>, **when** <action>, **then** <result>.

## Edge Cases

## Out of Scope

## Open Questions
```
