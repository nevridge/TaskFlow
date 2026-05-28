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
- **Agent type** — human-readable label: `codebase-researcher`, `spec-writer`, `backend-feature-implementer`, or `implementation-validator`
- **Output label** — what the agent was asked to produce: `research findings`, `Technical Brief`, `implementation`, or `validation report`

---

## Step A — Detect Open Questions

Scan the agent's full output for a section headed "Open Questions" or equivalent.

- **No section found, or section is empty:** announce "No open questions — proceeding." and exit this gate.
- **Section found with items:** continue to Step B.

---

## Step B — Present Questions

Announce: "Open Questions Gate — [agent-type] returned [N] open question(s). Resolving before proceeding."

Present the questions clearly, numbered, preserving any context or sub-options the agent included:

```
Open Question 1: [Question text]
  Agent context: [Any tradeoff or background the agent noted]

Open Question 2: [Question text]
  Agent context: [Any tradeoff or background the agent noted]
```

Then ask the user using `AskUserQuestion`:

- **Question:** "How would you like to handle these open questions?"
- **Options:**
  - "Answer them now" — user will provide decisions in the next message
  - "Discuss some first" — user wants to talk through tradeoffs before deciding
  - "Accept agent defaults" — trust whatever assumptions the agent already stated

---

## Step C — Collect Answers

### If "Answer them now"

Re-present the questions as a numbered list and ask the user to reply with one decision per question. Wait for their response.

Once all answers are received, compile a resolution summary:

```
Resolved Answers:
1. [Brief question label]: [User's answer]
2. [Brief question label]: [User's answer]
```

Proceed to Step D.

---

### If "Discuss some first"

Ask: "Which question would you like to discuss first?"

Engage in focused discussion — explain tradeoffs, surface codebase implications, reference prior research findings if relevant. One question at a time. When the user decides, note the answer and ask: "Any other questions to discuss, or ready to submit all answers?"

Once all questions are resolved, compile the resolution summary as above. Proceed to Step D.

---

### If "Accept agent defaults"

Announce: "Accepting agent's stated defaults for all open questions. Proceeding without revision."

Exit this gate. Continue the pipeline using the original unrevised output.

---

## Step D — Send Answers Back to Agent

Announce: "Sending resolved answers back to [agent-type] for finalization."

Use `SendMessage` with the agent's ID to continue the **same agent** (do not launch a new one — the existing agent retains full context of its prior output). The message must be:

```
The user has resolved the open questions listed in your output. Please revise your [output label] to incorporate these decisions. Only update the sections affected by the answers below — do not change anything else.

RESOLVED QUESTIONS:
[Paste the resolution summary from Step C verbatim]

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

**Maximum two additional revision cycles.** If the output is still not approved after two extra rounds, stop and surface this message: "Revision cycles exhausted — human review of the [agent-type] output is required before the pipeline can continue."

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
Present questions to user
        ↓
User choice:
  "Accept defaults" → exit gate (no revision)
  "Answer now" / "Discuss first"
        ↓
Collect all answers
        ↓
SendMessage → same agent → revised output
        ↓
User approves revised output?
  "Approved"        → exit gate → continue pipeline
  "Still has issues" → one more revision cycle (max 2)
  "Rejected"        → stop pipeline
```

---

## Rules

- **Never skip this gate when open questions exist.** Unresolved questions passed to the next stage cause spec drift and implementation surprises.
- **Never fabricate answers on the user's behalf.** Only the user's stated decisions go back to the agent. If the user skips, pass only what the agent already stated as its own default.
- **Always use `SendMessage`, not a new agent launch.** The existing agent retains its full output in context; a new agent would start cold.
- **Pass user answers verbatim.** Do not paraphrase in ways that alter meaning or intent.
- **One question at a time in discussion mode.** Keep focused — this is a decision gate, not a design session.
- **If the revised output introduces new open questions** not present in the original, treat them as a fresh invocation of this gate before proceeding.
- **The gate has no opinion on the answers.** Present tradeoffs when asked, but do not advocate for one option over another unless the user explicitly asks "what do you think?"
