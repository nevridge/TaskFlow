# Implementation notes

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to.

Five sections: **Decisions**, **Plan deviations** (the validator's three groups, copied as they stand), **Advisor deviations** (the `advisory_deviations` with reasons from `frontend-builder` and `assistant-builder`, the only builders that report them), **Possible issues** (the verifier's unclear probes and every item the Outcome table (`outcome-table.md`) marks as reported) and **Follow-up candidates** (exactly three sources: the story's Out of Scope section, the integration advisor's out-of-scope ideas in `advisories.md`, and any `SOURCE LIST NEEDS UPDATE` line; an idea from the advisor's list appears here only, not under Advisor deviations; builders' other out-of-scope advice stays under Advisor deviations). List candidates; never open issues.
