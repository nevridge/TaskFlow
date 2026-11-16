# Template: advisories-ux.md

Written by `ux-advisor` in Stage 3 of feature-factory (pipeline mode). Write the file at the prompt's `Output path:` in the form below, then reply with your status block.

Allowed status: DONE, NEEDS_INPUT, NO_UI_WORK, BLOCKED, WRITE_FAILED
No-file status: NO_UI_WORK, BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7, and a hold status wins over `DONE`. Here: `BLOCKED`, then `NEEDS_INPUT`, then `DONE`. `NO_UI_WORK` is exclusive: it never combines with another value. `WRITE_FAILED` applies only when the write itself fails.

## Status values

- `DONE`: the file is written and has neither a `### DESIGN_CONFLICTS` nor a `### DEPENDENCY_PROPOSALS` section. `Open questions: 0`.
- `NEEDS_INPUT`: the file is written and has a `### DESIGN_CONFLICTS` or a `### DEPENDENCY_PROPOSALS` section. `Open questions:` is the total number of entries in those two sections.
- `NO_UI_WORK`: the feature has no frontend work. Write no file and reply `Output: none` with `Open questions: 0`.
- `BLOCKED`: an input is missing (the draft brief). Write no file, reply `Output: none` and put what is missing in `Summary`.
- `WRITE_FAILED`: the write to the output path failed. Reply `Output: none` and put the reason in `Summary`.

## Rules

- Use the section headers below, in this order.
- Delete an empty section. Never write None as a section body. This covers every section, `### STYLE_ADDITIONS` and `### BACKEND_IMPLICATIONS` included.
- `### DESIGN_CONFLICTS` and `### DEPENDENCY_PROPOSALS` hold one numbered item per entry, so the entries can be counted.
- Mark each recommendation **should** or **consider**, cite the URL for search-based guidance, and mark anything you cannot verify `UNVERIFIED`.

## File layout

```markdown
### FRONTEND_GUIDANCE

### DESIGN_CONFLICTS

### STYLE_ADDITIONS

### BACKEND_IMPLICATIONS

### ACCESSIBILITY_NOTES

### TESTING_CRITERIA

### DESIGN_RATIONALE

### DEPENDENCY_PROPOSALS
```

## Section contents

- `FRONTEND_GUIDANCE`: interaction patterns, components, layout and keyboard behavior, described by behavior and contract, with shortcut collisions checked.
- `DESIGN_CONFLICTS`: only directions the brief explicitly asks for that conflict with the design philosophy, each with the closest aligned alternative.
- `STYLE_ADDITIONS`: new style values needed.
- `BACKEND_IMPLICATIONS`: data or API needs that extend what the brief specifies.
- `ACCESSIBILITY_NOTES`: only what is directly relevant. Non-blocking.
- `TESTING_CRITERIA`: UX acceptance criteria for the verifier (interactions, state transitions, keyboard and optimistic behavior). Do not repeat the story's functional ACs.
- `DESIGN_RATIONALE`: one or two sentences per major decision.
- `DEPENDENCY_PROPOSALS`: per proposal, the gap; why nothing existing covers it; the recommended package and one alternative; evidence (latest version and release date, license, size, React and Tailwind compatibility, maintenance), `UNVERIFIED` where unverifiable; the cost of building by hand; your recommendation. `FRONTEND_GUIDANCE` must still hold if the package is not adopted.
