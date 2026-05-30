---
name: open-questions-gate
description: Reusable gate invoked after any agent completes. Detects an Open Questions section in the agent output, presents each question to the user for discussion or direct answer, sends the resolved answers back to the SAME agent via SendMessage, and gates pipeline progression until the user approves the revised output.
---

# Open Questions Resolution Gate

A reusable gate that intercepts agent output containing unresolved questions, resolves them with the user, and only releases the pipeline once the user approves the finalized output. Invoke this gate after any agent completes — before presenting the output for final approval or passing it to the next stage.

## When This Gate Applies

Invoke this gate after any agent completes if its output contains an "Open Questions" section (or similar heading: "Questions", "Unresolved Questions", "Decisions Needed", "Clarifications") with one or more items listed. If no such section exists, or the section is explicitly empty, announce "No open questions — proceeding." and exit the gate immediately.

---

## Required Context

Before entering this gate, you must have in context:

- **Agent output** — the full text the agent returned
- **Agent ID** — the identifier returned at the end of the agent result (format: `agentId: <id>`)
- **Agent type** — human-readable label: `codebase-researcher`, `spec-writer`, `backend-builder`, `frontend-builder`, or `implementation-validator`
- **Output label** — what the agent was asked to produce: `research findings`, `Technical Brief`, `implementation`, or `validation report`

---

## Step A — Detect Open Questions

Scan the agent's full output for a section headed "Open Questions" or equivalent.

- **No section found, or section is empty:** announce "No open questions — proceeding." and exit this gate.
- **Section found with items:** continue to Step B.

---

## Step B — Resolve Questions One by One

Count the items listed under the Open Questions heading in the agent output. This is N — the total number of questions to resolve.

Announce: "Open Questions Gate — [agent-type] returned [N] open question(s). Resolving now."

First, offer the up-front escape hatch using `AskUserQuestion`:

- **Question:** "How would you like to handle [N] open question(s) from the [agent-type]?"
- **Options:**
  - "Resolve them one by one" — step through each question interactively
  - "Accept all agent defaults" — trust whatever assumptions the agent stated

If "Accept all agent defaults": see the **Accept Defaults Rule** in the Rules section and exit this gate.

If "Resolve them one by one": proceed through each question in sequence.

**For each question (loop: Question 1 of N, Question 2 of N, …):**

Display the question and its context as plain text before the `AskUserQuestion` call:

```
Question [n] of [total]: [Full question text from agent output]
Agent context: [Tradeoff or background the agent noted, if any — omit line if none]
```

Then call `AskUserQuestion`:

- **Question:** "[Full question text from agent output]"
- **Options:** Use the explicit choices the agent listed in its output for this question, if any. If the agent listed no choices, use:
  - "Yes"
  - "No"
  - "Tell me more before I decide"
  - "Accept agent default for this question"

If the user selects "Accept agent default for this question": record the agent's stated default for that question (from the agent context line) as the answer, and advance to the next question.

If the user selects "Tell me more before I decide": explain the tradeoff in your next message (cite codebase implications if relevant), then re-present the same `AskUserQuestion` with its original options. Do not advance to the next question until a non-"Tell me more" option is selected.

Once the user selects a final answer, record it — noting whether it was an explicit choice or "Accept agent default for this question" — and advance to the next question.

After all [N] questions are resolved:

- **If ALL answers were "Accept agent default for this question":** apply the **Accept Defaults Rule** (see Rules section) — exit this gate without revision.
- **If ANY answer was an explicit choice:** compile the resolution summary including only the explicit answers (do not include questions left at agent default — the agent's output already reflects those choices):

```
Resolved Answers:
1. [Brief question label]: [User's explicit answer]
2. [Brief question label]: [User's explicit answer]
```

Proceed to Step D. (There is no Step C — it was consolidated into this step.)

---

## Step D — Send Answers Back to Agent

Announce: "Sending resolved answers back to [agent-type] for finalization."

Use `SendMessage` with the agent's ID to continue the **same agent** (do not launch a new one — the existing agent retains full context of its prior output). The message must be:

```
The user has resolved the open questions listed in your output. Please revise your [output label] to incorporate these decisions. Only update the sections affected by the answers below — do not change anything else.

RESOLVED QUESTIONS:
[Paste the resolution summary compiled in Step B verbatim]

Return the complete revised [output label] with these decisions reflected.
```

Wait for the agent to return its revised output.

---

## Step E — Approval of Revised Output

Present the revised output to the user. Briefly note what changed: which open questions were resolved and what decisions were incorporated.

Then ask using `AskUserQuestion`:

- **Question:** "Does this revised output look good to proceed?"
- **Options:**
  - "Approved — proceed" — exit gate, resume pipeline
  - "Still has issues" — user will describe what remains wrong; loop once more
  - "Rejected — stop pipeline" — halt; do not proceed to the next stage

---

### If "Approved"

Announce: "[Agent-type] output finalized. Resuming pipeline."

Exit the gate. Pass the revised output forward to the next pipeline step.

---

### If "Still has issues"

Ask the user to describe what is still wrong. Compile the new feedback (treating it as additional answers or corrections) and send another `SendMessage` to the same agent with the updated instructions.

Present the result and repeat Step E.

**Maximum revision cycles by agent type:**
- `spec-writer`: 5 cycles — specs often need multiple rounds of design feedback
- `codebase-researcher`: 3 cycles
- `backend-builder` or `frontend-builder`: 2 cycles — fixes should be targeted
- `implementation-validator`: 2 cycles

If the applicable cap is reached, stop and surface: "Revision cycles exhausted — human review of the [agent-type] output is required before the pipeline can continue."

---

### If "Rejected"

Announce: "Pipeline stopped at [agent-type] stage — user rejected the output."

Summarise what was explored and what remained unresolved, so context is preserved for a future attempt. Do not proceed to the next pipeline step.

---

## Gate Flow

```
Agent output received
        ↓
Open Questions present?
  No  → exit gate immediately
  Yes ↓
AskUserQuestion: "Accept all agent defaults" or "Resolve them one by one"
  "Accept all agent defaults" → warn if early stage → exit gate (no revision)
  "Resolve them one by one"  ↓
For each question:
  AskUserQuestion with agent options (or fallback: Yes/No/Tell me more/Accept default)
  "Tell me more" → explain tradeoff → re-present same question
  Final answer recorded (explicit or default) → advance to next question
        ↓
All questions resolved:
  All answers = agent default → Apply Accept Defaults Rule → exit gate (no revision)
  Any answer = explicit       → compile explicit Resolved Answers summary
        ↓
SendMessage → same agent → revised output
        ↓
User approves revised output?
  "Approved"         → exit gate → continue pipeline
  "Still has issues" → one more revision cycle (up to agent-type cap)
  "Rejected"         → stop pipeline
```

---

## Rules

### Accept Defaults Rule

When the user selects "Accept all agent defaults" (Step B up-front escape), or when ALL per-question answers resolve as "Accept agent default for this question" (every question resolved via the default option with no explicit choices made): announce "Accepting agent's stated defaults. Proceeding without revision." Do not send answers back to the agent. Exit this gate and continue the pipeline using the original unrevised output.

**Early-stage risk:** When accepting defaults for a `codebase-researcher` or `spec-writer` output, display this warning before exiting the gate: "Warning: defaults accepted at this stage propagate to the backend-builder, frontend-builder, and implementation-validator. If an assumption is wrong, it may not surface until the final validation stage." Then exit normally. Do not block — this is informational only.

- **Never skip this gate when open questions exist.** Unresolved questions passed to the next stage cause spec drift and implementation surprises.
- **Never fabricate answers on the user's behalf.** Only explicit user decisions go back to the agent. Questions where the user accepted the agent default are not included in the resolution summary — the agent's output already reflects those choices.
- **Always use `SendMessage`, not a new agent launch.** The existing agent retains its full output in context; a new agent would start cold.
- **Pass user answers verbatim.** Do not paraphrase in ways that alter meaning or intent.
- **One question at a time in discussion mode.** Keep focused — this is a decision gate, not a design session.
- **If the revised output introduces new open questions** not present in the original, treat them as a fresh invocation of this gate before proceeding.
- **The gate has no opinion on the answers.** Present tradeoffs when asked, but do not advocate for one option over another unless the user explicitly asks "what do you think?"
