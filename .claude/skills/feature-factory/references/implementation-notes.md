# Implementation notes

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to.

Five sections: **Decisions**, **Plan deviations** (the validator's three groups, copied as they stand), **Advisor deviations** (the `advisory_deviations` with reasons from `frontend-builder` and `assistant-builder`, the only builders that report them), **Possible issues** (the verifier's unclear probes and every item the Outcome table (`outcome-table.md`) marks as reported, including each `[?]` finding left when the owner answers Yes at stop 3) and **Follow-up candidates** (exactly three sources: the story's Out of Scope section, the Out of scope section of `advisories-claude.md`, and its Source list needs update section; an idea from the advisor's list appears here only, not under Advisor deviations; builders' other out-of-scope advice stays under Advisor deviations). List candidates; never open issues.
