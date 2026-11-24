# Run file check

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to. Stage numbers refer to `SKILL.md`.

The run file check is Stage 3 step 4 and step 5 of the Stage 4 Respec procedure. The orchestrator itself reads `brief.md` and `research.md` once against the stage rules, after the last `spec-writer` pass and before stop 2 is decided. Advisor files (`advisories-ux.md`, `advisories-claude.md`) are not read. In Stage 3 the check runs when stop 2 is presented or skipped, so a resumed run that reaches stop 2 with no recorded stop 2 decision and no `stop 2 held` entry runs it too; once a Stage 3 hold is recorded, Stage 3 does not run the check again. The respec check (see "On a respec" below) runs on every respec, even when stop 2 was held before.

## What counts as a contradiction

A contradiction is a statement about pipeline mechanics (routing, stops, which agent builds which area, who writes which file) that conflicts with one of these stage rules:

- the opening paragraph of `SKILL.md` (the orchestrator never implements, and which files it writes);
- the Rules block of `SKILL.md`;
- the stop rules in Stages 2 and 3 of `SKILL.md`;
- Stage 4's area and builder rules in `SKILL.md`;
- the area definitions in `template-brief.md` (The areas).

A run file that accurately restates a stage rule is not a contradiction. Only a statement that conflicts with one counts. Statements about the code, the feature or the tests are not checked here.

- **Contradiction (the #551 run):** `research.md` said "Route the edits to the owner's own change, not to the `docs` agent." This conflicts with Stage 4: the `docs` area is built by a general-purpose agent with the `docs` prompt, and the orchestrator never implements.
- **Not a contradiction:** "The `docs` area is built by a general-purpose agent with the `docs` prompt in Stage 4." This restates Stage 4 accurately.

## One-run exceptions

- In a pipeline-editing run (`self-edit.md`), when a contradiction is a stage rule the change itself relaxes, the stop 2 listing offers the owner **Grant a one-run exception** for that item.
- A recorded grant (`decisions-record.md`) resolves the matching contradiction, matched by the rule the entry names: it is not listed again, adds no "stop 2 held" entry, and is not found again on a respec.
- An ungranted one is still a contradiction and holds stop 2 as before.
- The orchestrator never grants it, and stop 3 offers none.

## When a contradiction is found

- **No contradiction:** the check changes nothing. Stop 2 is skipped or held exactly as Stage 3 says.
- **Hold:** stop 2 is held, even for a groomed issue whose stop 1 was skipped. This is a separate condition from the agents' `Open questions:` counts, which are not changed or added to.
- **Listing:** at stop 2, show each contradiction as a plain-text item with the brief: quote the statement, name the file it is in, and name the stage rule it breaks.
- **Record:** append one `decisions.md` entry per held stop 2 naming the file and the rule, for example "stop 2 held: brief.md contradicts <rule>" (or `research.md`, or both files).
- **Both stops already held** (a run that is not groomed, or a groomed run that `research.md` contradicted at Stage 2): the contradictions join the normal stop 2 list, with no extra prompt.
- Stop 1 is never held by this check.

## After the hold

Stop 2 then runs its normal loop (answers, **Changes requested** re-runs) to **Approved**. The hold is not a fourth option in the closing question: the owner's route on is **Changes requested** with feedback, so the re-runs below remove the statement, or **Approved** if the owner accepts it.

On **Changes requested** after a hold, the agents that re-run depend on the held file:

- **`research.md` held, or both files held:** re-run `codebase-researcher` first, then `spec-writer`.
- **Only `brief.md` held:** re-run only `spec-writer`, with the owner's feedback and the listed contradictions.

The `codebase-researcher` prompt is the Stage 1 prompt (the feature description, the named paths and the no-questions instruction), and it also quotes the contradicted statement and names the rule it breaks. It passes the branch name and the current `git rev-parse HEAD` value, so lines 1 and 2 of `research.md` stay correct, and no recorded commit or changed-file list, so the template's re-check section does not apply and the whole file is rewritten (the agent reads the existing file first). It says to state nothing about pipeline mechanics. The researcher gets only the named contradiction, not the owner's feedback. `spec-writer` then re-runs on the rewritten `research.md` with the owner's feedback and the listed contradictions. Stop 2 shows the rewritten brief and continues its normal loop to **Approved**.

A failed researcher re-run uses the existing Outcome table rows (the `codebase-researcher` `BLOCKED` rows and the every-agent re-ask and `WRITE_FAILED` rows); there is no new row. The re-run those rows call for happens here, at the same stop, not as a return to Stage 1. The re-run spends no respec or correction budget, and the existing **Changes requested** `decisions.md` entry covers it.

**Approved** with a `research.md` contradiction still present needs nothing extra: no builder prompt text is added, because routing comes from the brief's Scope block and `research.md` never overrides a stage rule (`template-brief.md`).

The check is not repeated after these **Changes requested** re-runs at stop 2, so it does not re-trigger on fixed text. A contradiction introduced by such a re-run is therefore not caught at stop 2; the owner accepted this at grooming.

## On a respec

Step 5 of the Stage 4 Respec procedure runs the check on the revised `brief.md` and on `research.md`, after the advisor fold (when one ran) and before stop 2 is held in full. It runs on every respec, even when stop 2 was held by the check before. A contradiction is listed at stop 2 and recorded exactly as in "When a contradiction is found": quote, file and rule in the listing, and one `decisions.md` entry "stop 2 held: <file> contradicts <rule>". A contradiction the owner accepted earlier is found and listed again; no marker for accepted contradictions is kept. The stop 2 loop and the re-runs above then apply as for a Stage 3 hold.

Run files are deleted after the PR opens, so the `decisions.md` entry is the only lasting record of a caught contradiction.
