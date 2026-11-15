# Outcome table

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to. Stage numbers refer to `SKILL.md`.

## Contents

- [How the rows apply](#how-the-rows-apply)
- [The table](#the-table): 62 rows, grouped by source in this order: orchestrator (the Scope block), codebase-researcher, the builders, the docs agent, test-verifier, implementation-validator, ux-advisor, claude-integration-advisor, orchestrator (the correction budget)

## How the rows apply

Every agent reply value has a row, and each row has exactly one destination: `continue`, `loop: Stage N` or `Halt`. Stage prose points to the table and does not restate outcomes.

- Every row a reply matches applies, and a `Halt` row applies first. `Halt` is defined in `resume-halt-start-over.md`: read that file in full before applying a `Halt` row.
- Budget is what the row spends, recorded before the pass runs. A row that spends a budget applies while that budget has a unit left; otherwise the "budget spent" row applies. On a resumed run, see Resume after a budget Halt in `resume-halt-start-over.md`.
- Rows with the budget `1 correction` are the Stage 7 triggers. They share one pass and one unit (Stage 7).
- "Reported" means shown at stop 3, listed in the implementation notes under Possible issues and listed in the PR body.
- The js-yaml rows cover edits to any file under `.claude/agents/`, `.claude/skills/` or `.claude/rules/`. A file with no frontmatter (its first line is not `---`) needs no check and counts as `not needed`, except an agent file or a `SKILL.md`, which must have frontmatter.

## The table

| Source | Reply value (label exactly as emitted) | Outcome | Destination | Budget |
|---|---|---|---|---|
| orchestrator | Stage 3: the Scope block is still missing after one re-ask | The brief cannot be scoped. | Halt | none |
| codebase-researcher | A reply with a `### Relevant Files` heading | Written to `research.md`. | continue | none |
| codebase-researcher | A reply with no `### Relevant Files` heading (a question), first time | Not written to `research.md`. Re-run the researcher once with the no-questions instruction repeated. | loop: Stage 1 | none |
| codebase-researcher | A reply with no `### Relevant Files` heading again, after the re-run | Not written to `research.md`. | Halt | none |
| backend-builder, frontend-builder, assistant-builder | **Spec blockers**, respec budget remaining | Respec procedure (Stage 4). | loop: Stage 3 | 1 respec |
| backend-builder, frontend-builder, assistant-builder | **Spec blockers**, respec budget spent | No respec is left. | Halt | none |
| backend-builder, frontend-builder, assistant-builder, docs agent | **Files changed** | Recorded in `build-<area>.md`. | continue | none |
| backend-builder, frontend-builder, assistant-builder | `Gates: green` | Recorded in `build-<area>.md`. | continue | none |
| backend-builder, frontend-builder, assistant-builder | `Gates: red (<commands>)` | The area is committed and Stages 5 and 6 run first. | loop: Stage 7 | 1 correction |
| backend-builder | `Client regeneration: FAILED (API did not start or /health failed)` | The client cannot be regenerated. | Halt | none |
| backend-builder | `Client regeneration: FAILED (reason)`, any other reason | The client cannot be regenerated. | Halt | none |
| backend-builder | `Client regeneration: ran` or `Client regeneration: not needed` | Recorded in `build-<area>.md`. | continue | none |
| backend-builder | **API contract** | Recorded in `build-<area>.md` for the later builders. | continue | none |
| frontend-builder | **Client status**, **User-visible change** | Recorded in `build-<area>.md`. | continue | none |
| frontend-builder | `Dependencies added outside the brief: <names>` | The validator's scope check judges it. | continue | none |
| frontend-builder | `Dependencies added outside the brief: none` | Nothing to judge. | continue | none |
| frontend-builder, assistant-builder | `advisory_deviations` (entries, or `advisory_deviations: none`) | Entries go in the notes under Advisor deviations. | continue | none |
| assistant-builder | `ENVIRONMENT FAILURE (reason)` under Verification results | The area cannot be verified. | Halt | none |
| assistant-builder | **Plugin and chat sync** | Recorded in `build-<area>.md`. | continue | none |
| docs agent | **Spec blockers**, respec budget remaining | Respec procedure (Stage 4). | loop: Stage 3 | 1 respec |
| docs agent | **Spec blockers**, respec budget spent | No respec is left. | Halt | none |
| docs agent | js-yaml `passed` | Recorded in `build-docs.md`. | continue | none |
| docs agent | js-yaml `parse error fixed` | Recorded in `build-docs.md`. | continue | none |
| docs agent | js-yaml `not needed` | No file under `.claude/agents/`, `.claude/skills/` or `.claude/rules/` was edited, or every file edited there has no frontmatter and is not an agent file or a `SKILL.md`. | continue | none |
| docs agent | js-yaml `check could not run` | The edited `.claude` files are unchecked. | Halt | none |
| test-verifier | Pass | Stage 6 runs. | continue | none |
| test-verifier | `FORMAT-ONLY`, with no FORMAT-ONLY entry in `decisions.md` | The run's one formatter pass (Stage 5). | loop: Stage 5 | none |
| test-verifier | `FORMAT-ONLY`, with a FORMAT-ONLY entry in `decisions.md` | Treated as a Code failure. | loop: Stage 7 | 1 correction |
| test-verifier | `NO GATES APPLICABLE` | Stage 6 runs. | continue | none |
| test-verifier | `ENVIRONMENT FAILURE` | The gates cannot run. | Halt | none |
| test-verifier | A reply that the story or brief is missing | Nothing was verified. | Halt | none |
| test-verifier | Code failure | Stage 6 runs first. | loop: Stage 7 | 1 correction |
| test-verifier | `COVERAGE BELOW THRESHOLD` | Reported. Not a Code failure. | continue | none |
| test-verifier | `UNTESTABLE` | Reported. | continue | none |
| test-verifier | `NOT COVERED` | Reported. | continue | none |
| test-verifier | A covered line of the AC coverage report; **Tests added** | Recorded in `verify.md`. | continue | none |
| test-verifier | **Bugs or gaps found**, a `bug:` item | Sent to the area builder with the verifier's description. Stage 6 runs first. | loop: Stage 7 | 1 correction |
| test-verifier | **Bugs or gaps found**, a `gap:` item | Reported. | continue | none |
| test-verifier | `probable bug` | Stage 6 runs first. | loop: Stage 7 | 1 correction |
| test-verifier | `unclear` | Goes in the notes under Possible issues. | continue | none |
| implementation-validator | `NO SPEC` | The validator had no story or brief. | Halt | none |
| implementation-validator | PASS | Nothing to correct. | continue | none |
| implementation-validator | CONDITIONAL PASS | Its Should fix findings go in the PR body. | continue | none |
| implementation-validator | FAIL, with a Must fix finding not marked `[?]` | Correction pass. | loop: Stage 7 | 1 correction |
| implementation-validator | FAIL, with every Must fix finding marked `[?]` | Shown at stop 3 for the owner to decide. | continue | none |
| implementation-validator | A **Must fix** finding not marked `[?]` | Correction pass. | loop: Stage 7 | 1 correction |
| implementation-validator | A **Should fix** finding | Not reworked. Goes in the PR body as a residual finding. | continue | none |
| implementation-validator | **Plan deviations** | Go in the notes under Plan deviations. | continue | none |
| implementation-validator | A finding marked `[?]`, in any section | Not reworked. Shown at stop 3 for the owner to decide. | continue | none |
| ux-advisor | `NO_UI_WORK` | Adds nothing to `advisories.md`. | continue | none |
| ux-advisor | FRONTEND_GUIDANCE, STYLE_ADDITIONS, BACKEND_IMPLICATIONS, ACCESSIBILITY_NOTES, TESTING_CRITERIA, DESIGN_RATIONALE | Written to `advisories.md`. | continue | none |
| ux-advisor | DESIGN_CONFLICTS | Written to `advisories.md`. Stop 2 is held and shows it. | continue | none |
| ux-advisor | DEPENDENCY_PROPOSALS | Written to `advisories.md`. Stop 2 is held and shows it as "Proposed dependency (needs approval)". | continue | none |
| claude-integration-advisor | Recommendations (**should** or **consider**) | Written to `advisories.md`. | continue | none |
| claude-integration-advisor | `UNVERIFIED` on a recommendation | A lead, not an instruction. A validator Should fix at most. | continue | none |
| claude-integration-advisor | Conflicts with brief, with any entry | Written to `advisories.md`. Stop 2 is held and shows it. | continue | none |
| claude-integration-advisor | Conflicts with brief, `None` | Nothing to show. | continue | none |
| claude-integration-advisor | Out of scope | Goes in the notes under Follow-up candidates. | continue | none |
| claude-integration-advisor | Docs consulted | Written to `advisories.md`. | continue | none |
| claude-integration-advisor | Source health, every line OK | Written to `advisories.md`. | continue | none |
| claude-integration-advisor | Source health with a Failed, Moved or Topic missing line, and its `SOURCE LIST NEEDS UPDATE: <entry>` prefix | Written to `advisories.md`. Stop 2 is held and shows it. | continue | none |
| orchestrator | The correction budget is spent and a Stage 7 trigger remains | No correction pass is left. | Halt | none |
