# Template: verify.md

Written by `test-verifier` in Stage 5 of feature-factory. Write the file at the prompt's `Output path:` in the form below, then reply with your status block.

Allowed status: DONE, FORMAT_ONLY, CODE_FAILURE, ENVIRONMENT_FAILURE, BLOCKED, WRITE_FAILED
No-file status: BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7. Here: the Halt values (`BLOCKED`, `ENVIRONMENT_FAILURE`), then `FORMAT_ONLY`, then `CODE_FAILURE`, then `DONE`. `WRITE_FAILED` applies only when the write itself fails.

## Status values

- `DONE`: every gate passed, or no gate applies. When no gate applies, the file carries the fixed line `Gates: none applicable` as the first line under `## Verification results`.
- `FORMAT_ONLY`: only the format check failed.
- `CODE_FAILURE`: a code failure (a compile error, failing test or lint violation in production code), or any item starting `bug:`, or any item starting `probable bug:`.
- `ENVIRONMENT_FAILURE`: a missing SDK or CLI, or a command that cannot run for reasons unrelated to the code. Write the file with what you ran and give the reason in `Summary`.
- `BLOCKED`: the story or the brief is missing. Write no file, reply `Output: none` and put what is missing in `Summary`.
- `WRITE_FAILED`: the write to the output path failed. Reply `Output: none` and put the reason in `Summary`.

`Open questions:` is always 0. Coverage below the threshold, an `UNTESTABLE` or `NOT COVERED` line, a `gap:` item and an `unclear:` item never change the status.

## Rules

- Use the sections below, in this order.
- Delete an empty section. Never write None as a section body.
- A prefix (`bug:`, `gap:`, `probable bug:`, `unclear:`) counts only at the start of an item, in its own section. Start every item in those two sections with its prefix.

## File layout

```markdown
## Verification results

| Command | Result | Key numbers |
|---|---|---|

## Coverage below threshold

## AC coverage report

## Tests added

## Bugs or gaps found

## Probable bugs and possible issues
```

## Section contents

- `## Verification results`: a table of each command, its result class and key numbers, with coverage against the threshold. With no gate to run, the fixed line `Gates: none applicable` and no table.
- `## Coverage below threshold`: only when coverage is still short after the one top-up attempt: the number and the threshold.
- `## AC coverage report`: one line per AC and edge case of the story, in one of these forms (markers: `✅` covered, `⚠️` NOT COVERED, `➖` UNTESTABLE):
  - `✅ AC 3 → File.Test.Name (new)`
  - `✅ AC 4 → File.Test.Name (already exists in X — not duplicated)`
  - `⚠️ AC 5 → NOT COVERED: reason`
  - `➖ AC 6 → UNTESTABLE: reason`
  - On a docs-only diff, each AC is `➖ AC n → UNTESTABLE (docs-only): prompt-only change, no gates apply`.
  - On a diff of only `.github/**` (including `*.md` there), each AC is `➖ AC n → UNTESTABLE: CI runs it on the PR`, with `Gates: none applicable`.
  - Every covered line cites the test file and name relied on. The only unverified outcomes are `UNTESTABLE` (cannot be automated, with the reason) and `NOT COVERED` (no test exists). "Not verified" because the story was not read is not allowed.
  - End the section by listing the test bodies you opened.
- `## Tests added`: files and test names.
- `## Bugs or gaps found`: production issues you saw but did not fix. Each item starts `bug:` or `gap:`. A bug contradicts the story, brief or a stated invariant; a gap is anything else.
- `## Probable bugs and possible issues`: each item starts `probable bug:` (then the test code, expected behavior and source) or `unclear:` (then the scenario and why the spec is silent).
