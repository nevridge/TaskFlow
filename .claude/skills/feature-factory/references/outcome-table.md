# Outcome table

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to. Stage numbers refer to `SKILL.md`.

## Contents

- [How the rows apply](#how-the-rows-apply)
- [Part 1: routing rows](#part-1-routing-rows): 41 rows keyed on (source, Status), grouped by source in this order: every agent (the reply check), orchestrator, codebase-researcher, story-writer, spec-writer, the builders, the docs agent, test-verifier, implementation-validator, ux-advisor, claude-integration-advisor
- [Part 2: report-only sections](#part-2-report-only-sections): the sections of each run file that route nothing, and where each is shown

## How the rows apply

Each agent replies with one `Status` value, taken from the `Allowed status:` line of its template. Every (source, Status) pair has a row in Part 1, and each row has exactly one destination: `continue`, `loop: Stage N` or `Halt`. No row depends on a heading or on any other text of a run file. Stage prose points to the table and does not restate outcomes.

- Route a reply only after `check-reply.mjs` exits 0 for it (`run-folder.md`). The first two rows cover a reply that fails the check.
- Each template gives the precedence that picks one Status when several conditions hold. Across the replies of one stage, a `Halt` row applies first, and after it a `loop: Stage 5` row applies before a `loop: Stage 7` row. `Halt` is defined in `resume-halt-start-over.md`: read that file in full before applying a `Halt` row.
- Budget is what the row spends, recorded before the pass runs. A row that spends a budget applies while that budget has a unit left; otherwise the "budget spent" row applies. On a resumed run, see Resume after a budget Halt in `resume-halt-start-over.md`.
- Rows with the budget `1 correction` are the Stage 7 triggers. They share one pass and one unit (Stage 7).
- The `loop: Stage 3` rows use the respec procedure (Stage 4).
- "Stop 2 is held" rows have `Open questions:` above 0. Stop 2 reads that number, never a heading.
- "Reported" means shown at stop 3, listed in the implementation notes under Possible issues and listed in the PR body.

## Part 1: routing rows

| Source | Status | Outcome | Destination | Budget |
|---|---|---|---|---|
| every agent | A reply that fails `check-reply.mjs`, or `WRITE_FAILED`, first time | Re-ask the same stage call once, with the script's message. The orchestrator never writes the file. | loop: the same stage | none |
| every agent | A reply that fails `check-reply.mjs`, or `WRITE_FAILED`, again after the re-ask | The run file is missing or unchecked. The orchestrator never writes the file. | Halt | none |
| orchestrator | Stage 3: the Scope block is still missing after one re-ask | The brief cannot be scoped. | Halt | none |
| orchestrator | The correction budget is spent and a Stage 7 trigger remains | No correction pass is left. | Halt | none |
| codebase-researcher | `DONE` | `research.md` is written. | continue | none |
| codebase-researcher | `BLOCKED`, first time | No file. Re-run the researcher once with the template's no-questions instruction repeated. | loop: Stage 1 | none |
| codebase-researcher | `BLOCKED`, again after the re-run | No file. | Halt | none |
| story-writer | `DONE` | `story.md` is written. | continue | none |
| story-writer | `NEEDS_INPUT` | `story.md` is written. Stop 1 is held and lists its open questions. | continue | none |
| story-writer | `BLOCKED` | No story was written. | Halt | none |
| spec-writer | `DONE` | `brief.md` is written. | continue | none |
| spec-writer | `NEEDS_INPUT` | `brief.md` is written. Stop 2 is held and lists its open questions. | continue | none |
| spec-writer | `BLOCKED` | No brief was written. | Halt | none |
| backend-builder, frontend-builder, assistant-builder | `DONE` | `build-<area>.md` is written and its checks pass. | continue | none |
| backend-builder, frontend-builder, assistant-builder | `SPEC_BLOCKER`, respec budget remaining | Respec procedure (Stage 4). | loop: Stage 3 | 1 respec |
| backend-builder, frontend-builder, assistant-builder | `SPEC_BLOCKER`, respec budget spent | No respec is left. | Halt | none |
| backend-builder, frontend-builder, assistant-builder | `GATES_RED` | The area is committed and Stages 5 and 6 run first. | loop: Stage 7 | 1 correction |
| backend-builder | `CLIENT_REGEN_FAILED` | The client cannot be regenerated. | Halt | none |
| assistant-builder | `ENVIRONMENT_FAILURE` | The area cannot be verified. | Halt | none |
| backend-builder, frontend-builder, assistant-builder | `BLOCKED` | Nothing was built. | Halt | none |
| docs agent | `DONE` | `build-docs.md` is written; the js-yaml check is `passed`, `parse error fixed` or `not needed`. | continue | none |
| docs agent | `SPEC_BLOCKER`, respec budget remaining | Respec procedure (Stage 4). | loop: Stage 3 | 1 respec |
| docs agent | `SPEC_BLOCKER`, respec budget spent | No respec is left. | Halt | none |
| docs agent | `CHECK_NOT_RUN` | The edited `.claude` files are unchecked. | Halt | none |
| docs agent | `BLOCKED` | Nothing was built. | Halt | none |
| test-verifier | `DONE` | Every gate passed, or no gate applies. Stage 6 runs. | continue | none |
| test-verifier | `FORMAT_ONLY`, with no FORMAT-ONLY entry in `decisions.md` | The run's one formatter pass (Stage 5). | loop: Stage 5 | none |
| test-verifier | `FORMAT_ONLY`, with a FORMAT-ONLY entry in `decisions.md` | Treated as `CODE_FAILURE`. | loop: Stage 7 | 1 correction |
| test-verifier | `CODE_FAILURE` | Stage 6 runs first. The failure, each `bug:` item and each `probable bug:` item go to the area builder with the verifier's description. | loop: Stage 7 | 1 correction |
| test-verifier | `ENVIRONMENT_FAILURE` | The gates cannot run. | Halt | none |
| test-verifier | `BLOCKED` | Nothing was verified. | Halt | none |
| implementation-validator | `DONE` | No unmarked Must fix finding. | continue | none |
| implementation-validator | `MUST_FIX` | Correction pass for every Must fix finding not marked `[?]`. | loop: Stage 7 | 1 correction |
| implementation-validator | `BLOCKED` | The validator had no story or brief. | Halt | none |
| ux-advisor | `DONE` | `advisories-ux.md` is written. | continue | none |
| ux-advisor | `NEEDS_INPUT` | `advisories-ux.md` is written. Stop 2 is held and shows its DESIGN_CONFLICTS, and its DEPENDENCY_PROPOSALS as "Proposed dependency (needs approval)". | continue | none |
| ux-advisor | `NO_UI_WORK` | `Output: none`: no file is written. | continue | none |
| ux-advisor | `BLOCKED` | No advice was written. | Halt | none |
| claude-integration-advisor | `DONE` | `advisories-claude.md` is written. | continue | none |
| claude-integration-advisor | `NEEDS_INPUT` | `advisories-claude.md` is written. Stop 2 is held and shows its Conflicts with brief and its Failed and Topic missing Source health lines. | continue | none |
| claude-integration-advisor | `BLOCKED` | No advice was written. | Halt | none |

## Part 2: report-only sections

These sections of the run files route nothing, and none is a Status value. Each is a fixed section of its template, deleted when it is empty.

| File | Section or line | Where it is shown |
|---|---|---|
| `build-*.md` | Dependencies added outside the brief | The validator's scope check judges it. |
| `build-*.md` | Advisory deviations | The notes, under Advisor deviations. |
| `verify.md` | Coverage below threshold | Reported. Not a `CODE_FAILURE`. |
| `verify.md` | `UNTESTABLE` and `NOT COVERED` lines of the AC coverage report | Reported. |
| `verify.md` | `gap:` items of Bugs or gaps found | Reported. |
| `verify.md` | `unclear:` items of Probable bugs and possible issues | The notes, under Possible issues. |
| `validation.md` | The `Verdict:` line (PASS, CONDITIONAL PASS or FAIL) | Shown at stop 3. |
| `validation.md` | A finding marked `[?]`, in any section | Not reworked. Shown at stop 3 for the owner to decide. |
| `validation.md` | Should fix | Not reworked. Shown at stop 3 and goes in the PR body as a residual finding. |
| `validation.md` | Plan deviations | The notes, under Plan deviations. |
| `advisories-claude.md` | Out of scope | The notes, under Follow-up candidates. |
| `advisories-claude.md` | Source list needs update | The notes, under Follow-up candidates. Never holds stop 2. |
| `advisories-claude.md` | A Moved line of Source health | Shown at stop 3. Never holds stop 2. |
