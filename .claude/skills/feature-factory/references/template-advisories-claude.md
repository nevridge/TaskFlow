# Template: advisories-claude.md

Written by `claude-integration-advisor` in Stage 3 of feature-factory. Write the file at the prompt's `Output path:` in the form below, then reply with your status block.

Allowed status: DONE, NEEDS_INPUT, BLOCKED, WRITE_FAILED
No-file status: BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7, and a hold status wins over `DONE`. Here: `BLOCKED`, then `NEEDS_INPUT`, then `DONE`. `WRITE_FAILED` applies only when the write itself fails.

## Status values

- `DONE`: the file is written, it has no `### Conflicts with brief` section, and no `### Source health` line is Failed or Topic missing. `Open questions: 0`.
- `NEEDS_INPUT`: the file is written and it has a `### Conflicts with brief` entry, or a `### Source health` line labelled Failed or Topic missing. `Open questions:` is the number of conflict entries plus the number of Failed and Topic missing lines. A Moved line and the `### Source list needs update` section never give `NEEDS_INPUT`.
- `BLOCKED`: an input is missing (the draft brief). Write no file, reply `Output: none` and put what is missing in `Summary`.
- `WRITE_FAILED`: the write to the output path failed. Reply `Output: none` and put the reason in `Summary`.

## Rules

- Use the sections below, in this order.
- Delete an empty section. Never write None as a section body. `### Conflicts with brief`, `### Out of scope` and `### Source list needs update` are deleted when they have no entry. `### Source health` always has one line per source entry.
- `UNVERIFIED` on a recommendation marks a lead, not an instruction.

## File layout

```markdown
### Recommendations

### Conflicts with brief

### Out of scope

### Docs consulted

### Source health

### Source list needs update
```

## Section contents

- `### Recommendations`: numbered. Each item has the recommendation, why, the source URL, the retrieval date, `UNVERIFIED` where it applies, and **should** or **consider**.
- `### Conflicts with brief`: one numbered item per conflict with the brief, with the source. Do not resolve it.
- `### Out of scope`: useful ideas beyond the brief, one per line.
- `### Docs consulted`: every URL fetched and its retrieval date.
- `### Source health`: one line per source entry of your agent file, with exactly one label:
  - Failed: the one search retry found no page that covers the topics either.
  - Topic missing: say what no longer appears.
  - Moved: give the new URL. Moved means the listed URL led to a different final URL, through a redirect or the one search retry, and the page reached there covers the entry's "Must cover" topics. If the page reached does not cover those topics, the line is Topic missing, not Moved.
  - OK.
  - When more than one label could apply, use this precedence: Failed, then Topic missing, then Moved, then OK.
- `### Source list needs update`: one line per source entry whose health line is not OK (a Moved line included), naming the entry and what to change. Delete the section when every source is OK.
