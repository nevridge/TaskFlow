# Template: research.md

Written by `codebase-researcher` in Stage 1 of feature-factory. Write the file at the prompt's `Output path:` in the form below, then reply with your status block.

Allowed status: DONE, BLOCKED, WRITE_FAILED
No-file status: BLOCKED, WRITE_FAILED
Precedence: a Halt status wins over a loop Stage 3 status, then loop Stage 5, then loop Stage 7. Here: `BLOCKED`, then `DONE`. `WRITE_FAILED` applies only when the write itself fails.

## Status values

- `DONE`: the file is written.
- `BLOCKED`: you cannot research without an answer to a question, or an input is missing. Write no file, reply `Output: none` and put the question or the missing input in `Summary`.
- `WRITE_FAILED`: the write to the output path failed. Reply `Output: none` and put the reason in `Summary`.

`Open questions:` is always 0.

## Rules

- Do not ask questions. Record any ambiguity under `### Risks and Missing Information`.
- Report facts about the code. Make no recommendation about pipeline mechanics (routing, stops, which agent builds what); `SKILL.md` and the area definitions in `template-brief.md` settle those.
- Cover: entities, endpoints, DTOs, repositories, validators, test patterns, frontend hooks and components, the assistant tools and the plugin or chat text that describes them, and fragile areas.
- For each path the prompt names as moved, renamed, deleted or reassigned to another area (do not predict others), search the repo for the path and for its file or project name. List every file that names it, solution and project files included, under `### Relevant Files`, each next to the path it references. A named path with no referencing file gets the line "No references found for `<path>`".
- Delete an empty section. Never write None as a section body.

## Re-check of a groomed, not started report

This section applies when the prompt passes a recorded commit and a changed-file list. The file at `Output path:` then already holds a report written at the recorded commit, before the run had a branch (its line 1 is `Branch: none`).

- Inputs from the prompt: the recorded commit, the changed-file list (`git diff --name-only <recorded commit>..HEAD`), the real branch and the current `HEAD` commit.
- Read the existing file first.
- Re-check only what the listed files affect: the files, findings and risks they touch, and any new file in the list that falls under the coverage list above. Keep the rest of the existing report as it is.
- Rewrite the whole file in one write; never edit it in parts. Line 1 is `Branch: <the real branch passed>`, line 2 is `Commit: <the current HEAD passed>`, then the layout below.
- Do not ask questions. Record any gap under `### Risks and Missing Information`. If you reply `BLOCKED`, write nothing, so the existing file stays as it was.

## File layout

Line 1 is `Branch: <name>` and line 2 is `Commit: <sha>`, both copied from the prompt exactly as given. Line 3 is blank. Then these sections, in this order:

```markdown
Branch: <name>
Commit: <sha>

## Research report: <title>

### Relevant Files

### Architecture Summary

### Patterns and Conventions in Use

### Risks and Missing Information
```
