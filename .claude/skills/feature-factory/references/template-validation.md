# Template: validation.md

Written by `implementation-validator` in Stage 6 of feature-factory. Write the file at the prompt's `Output path:` in the form below, then reply with your status block.

Allowed status: DONE, MUST_FIX, BLOCKED, WRITE_FAILED
No-file status: BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7. Here: `BLOCKED`, then `MUST_FIX`, then `DONE`. `WRITE_FAILED` applies only when the write itself fails.

## Status values

- `DONE`: the file is written and no Must fix finding is unmarked. This covers `Verdict: PASS`, `Verdict: CONDITIONAL PASS`, and `Verdict: FAIL` when every Must fix finding is marked `[?]`.
- `MUST_FIX`: the file has at least one Must fix finding not marked `[?]`.
- `BLOCKED`: the story or the brief is missing. Write no file, reply `Output: none` and put what is missing in `Summary`.
- `WRITE_FAILED`: the write to the output path failed. Reply `Output: none` and put the reason in `Summary`.

`Open questions:` is always 0, also when a finding is marked `[?]`.

## Rules

- Line 1 is the verdict line, exactly one of `Verdict: PASS`, `Verdict: CONDITIONAL PASS` (Should fix findings only) or `Verdict: FAIL` (any Must fix finding). The verdict is shown at stop 3; it is not the status.
- A finding marked `[?]` stays in its section, with the mark at the start of the finding.
- Delete an empty section, and delete an empty group under `## Plan deviations`. Never write None as a section body.

## File layout

```markdown
Verdict: <PASS, CONDITIONAL PASS or FAIL>

## Must fix

## Should fix

## Plan deviations

### Reported and confirmed in the diff

### Reported but not in the diff

### In the diff but not reported
```
