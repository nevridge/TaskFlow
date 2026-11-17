# Run file check

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to. Stage numbers refer to `SKILL.md`.

The run file check is Stage 3 step 4. The orchestrator itself reads `brief.md` and `research.md` once against the stage rules, after the last `spec-writer` pass and before stop 2 is decided. Advisor files (`advisories-ux.md`, `advisories-claude.md`) are not read. The check runs when stop 2 is presented or skipped, so a resumed run that reaches stop 2 with no recorded stop 2 decision runs it too.

## What counts as a contradiction

A contradiction is a statement about pipeline mechanics (routing, stops, which agent builds which area, who writes which file) that conflicts with one of these stage rules:

- the Rules block of `SKILL.md`;
- Stage 4's area and builder rules in `SKILL.md`;
- the area definitions in `template-brief.md` (The areas).

A run file that accurately restates a stage rule is not a contradiction. Only a statement that conflicts with one counts. Statements about the code, the feature or the tests are not checked here.

- **Contradiction (the #551 run):** `research.md` said "Route the edits to the owner's own change, not to the `docs` agent." This conflicts with Stage 4: the `docs` area is built by a general-purpose agent with the `docs` prompt, and the orchestrator never implements.
- **Not a contradiction:** "The `docs` area is built by a general-purpose agent with the `docs` prompt in Stage 4." This restates Stage 4 accurately.

## When a contradiction is found

- **No contradiction:** the check changes nothing. Stop 2 is skipped or held exactly as Stage 3 says.
- **Hold:** stop 2 is held, even for a groomed issue whose stop 1 was skipped. This is a separate condition from the agents' `Open questions:` counts, which are not changed or added to.
- **Listing:** at stop 2, show each contradiction as a plain-text item with the brief: quote the statement, name the file it is in, and name the stage rule it breaks.
- **Record:** append one `decisions.md` entry per held stop 2 naming the file and the rule, for example "stop 2 held: brief.md contradicts <rule>" (or `research.md`, or both files).
- **Both stops already held** (a run that is not groomed, or a contradicted groomed run): the contradictions join the normal stop 2 list, with no extra prompt.
- Stop 1 is never held by this check.

## After the hold

Stop 2 then runs its normal loop (answers, **Changes requested** re-runs) to **Approved**. The hold is not a fourth option in the closing question: the owner's route on is **Changes requested** with feedback, so the re-run removes the statement, or **Approved** if the owner accepts it.

The check is not repeated after a re-run, so it does not re-trigger on fixed text. A contradiction introduced by a later re-run is therefore not caught by this check; the owner accepted this at grooming.

Run files are deleted after the PR opens, so the `decisions.md` entry is the only lasting record of a caught contradiction.
