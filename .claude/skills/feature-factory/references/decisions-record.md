# Decisions record

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to. Stage and step numbers refer to `SKILL.md`.

The orchestrator appends one entry to `decisions.md` each time one of these is passed: the preflight blocker answer, the Resume or Start over answer, the keep or reset answer, the wrong-branch answer, each stop's answers and outcome, each stop skipped because the issue was groomed, each skipped area with its reason, the FORMAT-ONLY pass, each budget unit spent, each owner grant of a unit, each **proceed anyway** given at the stop 3 blocker re-check, and the stop 3 answer.

- Stage 0 steps 1 to 5 write nothing, with two exceptions: the orphan sweep (step 5) and the halt commit retry (step 3). Answers given there are held and appended at step 6, once the folder exists, so a preflight Stop writes no file. The wrong-branch answer, asked at step 6, is appended with the other held answers (on Start over, once the new folder exists; see the Start over rule in `resume-halt-start-over.md`). A **Stop** answer ends the run and is never recorded (halt commit retry, preflight blocker, wrong-branch, stop 3 blocker re-check). A **Retry the halt commit** answer is not recorded either. **Rejected** at stop 1 or 2 is recorded as that stop's outcome, because the folder exists by then.
- **Changes requested** at stop 1 or 2: when a round ends, one entry gives the stop, "Changes requested" and a one-line summary of the feedback, not the verbatim text.
- **proceed anyway**: the entry lists the blocker issue numbers it covers.
- A stop 3 answer is a new entry every time it is asked, including on a re-run of Stage 8.
- Budget entries read "Spent respec budget" or "Spent correction budget" (with the stage and the reason), or "Granted one more unit of the <respec|correction> budget". Remaining = cap − spent + granted, with the caps from Rules in `SKILL.md`. Count only budget entries, so a repeated stop 3 answer is never counted. A FORMAT-ONLY pass adds no budget entry; the pass is recorded as its own entry.
- The FORMAT-ONLY entry reads "Stage 5, FORMAT-ONLY pass used (no budget)" and is appended before the formatter runs. A record that holds it has used the run's one pass, so the count survives Resume; Start over (`resume-halt-start-over.md`) deletes the record and resets it.
- If a line is a budget entry but its date, stage or budget cannot be read, say so and ask the owner how much of that budget was spent. Never read it as zero. Other malformed lines are ignored.
