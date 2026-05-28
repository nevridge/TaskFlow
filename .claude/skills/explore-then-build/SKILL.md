---
name: explore-then-build
description: Orchestrates a full feature build using four subagents in sequence: branch check → codebase-researcher → spec-writer → human approval → backend-feature-implementer → implementation-validator. Trigger with phrases like "build a feature", "implement this", "ship a feature", or "feature factory".
---

# Explore-Then-Build Skill

This skill runs a structured, gated pipeline for shipping a feature safely. Follow every step in order. Do not skip steps or combine them.

## When This Skill Applies

Trigger when the user asks to build, implement, or ship a feature. Key phrases: "build a feature", "implement this", "ship a feature", "feature factory", "let's build", "implement [feature name]".

---

## Step 1 — Branch Check and Creation (Bash)

Announce: "Step 1/7 — Checking branch status and creating feature branch."

Run these commands:

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "You are on main. Creating a feature branch..."
  # Generate branch name from feature description
  # Use the user's feature description to create a kebab-case branch name
  FEATURE_NAME=$(echo "$USER_FEATURE_DESCRIPTION" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 -]//g' | tr ' ' '-' | cut -c1-40)
  BRANCH_NAME="feature/$FEATURE_NAME"
  
  git checkout -b "$BRANCH_NAME"
  echo "✓ Created and switched to branch: $BRANCH_NAME"
else
  echo "✓ Already on feature branch: $CURRENT_BRANCH"
  echo "Proceeding with implementation..."
fi
```

If the branch creation fails, stop and ask the user to manually create a branch or stash uncommitted changes.

---

## Step 2 — Map the Codebase (codebase-researcher)

Announce: "Step 2/7 — Mapping the codebase with codebase-researcher."

Launch the `codebase-researcher` agent with the user's feature description as the question. Ask it to identify:
- Relevant files grouped by role
- Existing patterns and conventions
- Similar features already in the codebase
- Any fragile areas the new feature could disturb

Wait for the agent to return its findings before proceeding.

**After the agent returns:** invoke the `open-questions-gate` skill with:
- Agent output: the full research findings
- Agent ID: from the result
- Agent type: `codebase-researcher`
- Output label: `research findings`

Do not proceed to Step 3 until the gate exits (either approved or no open questions found).

---

## Step 3 — Write the Spec (spec-writer)

Announce: "Step 3/7 — Writing the technical spec with spec-writer."

Launch the `spec-writer` agent. Pass it:
- The user's original feature description
- A summary of the codebase-researcher findings (relevant files, patterns, similar features, risks) — use the finalized output from Step 2 (post-gate, if the gate ran)

Wait for the agent to return the full Technical Brief before proceeding.

**After the agent returns:** invoke the `open-questions-gate` skill with:
- Agent output: the full Technical Brief
- Agent ID: from the result
- Agent type: `spec-writer`
- Output label: `Technical Brief`

Do not proceed to Step 4 until the gate exits. Present the finalized Technical Brief (post-gate) to the user for the approval gate below.

---

## Step 4 — Human Spec Approval (GATE)

Announce: "Step 4/7 — Spec Approval Gate."

Ask the user: **"Does this spec look good to proceed with implementation? Reply with: (1) Approved, (2) Changes needed — describe them, or (3) Rejected."**

Use `AskUserQuestion` with three options: "Approved", "Changes needed", "Rejected".

**If Approved:** proceed to Step 5.

**If Changes needed:** summarise the requested changes, re-launch `spec-writer` with the original inputs plus the change requests, run the `open-questions-gate` on the revised output, present the revised spec, and repeat this gate.

**If Rejected:** stop the pipeline. Summarise what was explored in Steps 2–3 (key files found, patterns identified, risks noted) so the work is not lost. Do not proceed to implementation.

---

## Step 5 — Implement the Backend (backend-feature-implementer)

Announce: "Step 5/7 — Implementing with backend-feature-implementer."

Launch the `backend-feature-implementer` agent. Pass it:
- The approved Technical Brief (full text)
- The codebase-researcher findings (relevant file paths, patterns, similar examples)

Wait for the agent to complete and return a summary of what was built.

**After the agent returns:** invoke the `open-questions-gate` skill with:
- Agent output: the implementation summary
- Agent ID: from the result
- Agent type: `backend-feature-implementer`
- Output label: `implementation summary`

Do not proceed to Step 6 until the gate exits.

---

## Step 6 — Validate the Implementation (implementation-validator)

Announce: "Step 6/7 — Validating with implementation-validator."

Launch the `implementation-validator` agent. Pass it:
- The approved Technical Brief as the spec document
- The list of files created or modified by the backend-feature-implementer

Wait for the agent to return its Spec Compliance Review Report.

**After the agent returns:** invoke the `open-questions-gate` skill with:
- Agent output: the full Spec Compliance Review Report
- Agent ID: from the result
- Agent type: `implementation-validator`
- Output label: `validation report`

Do not proceed to the CRITICAL findings check or Step 7 until the gate exits.

**If the report contains CRITICAL findings:**

Announce: "CRITICAL issues found — sending back to backend-feature-implementer for fixes."

Re-launch `backend-feature-implementer` with:
- The original approved spec
- The full validator report, emphasising the CRITICAL findings

Then re-launch `implementation-validator` with the same spec and the updated file list. Run the `open-questions-gate` on the new validator output before evaluating findings.

Repeat this loop a maximum of **two times**. If CRITICAL findings remain after two fix cycles, stop and surface all findings to the user with a clear statement: "Automated fix cycles exhausted. Human review required before proceeding."

**If the report contains only IMPORTANT or MINOR findings (no CRITICALs):** proceed to Step 7, surfacing the findings alongside the final review request.

---

## Step 7 — Final Human Review (GATE)

Announce: "Step 7/7 — Final Review and PR Preparation."

Present to the user:
- A summary of what was built (files created/modified)
- The validator's findings (severity counts and any IMPORTANT/MINOR items)
- The proposed next action: open a PR
- The current feature branch name

Use `AskUserQuestion`: **"Implementation is complete. How would you like to proceed?"** with options: "Open a PR", "I have feedback — hold on", "Reject and discard".

**If Open a PR:** Announce that you are pushing the branch and opening a PR. Run:

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
```

Then create a PR with a description summarising the feature and validator findings.

**If I have feedback:** ask the user to describe the issue. Surface the full validator report and the spec for reference. Ask whether to: (a) fix a specific issue, (b) re-run the validator, or (c) loop back to implementation. Follow the user's direction.

**If Reject and discard:** confirm the user wants to discard. Then summarise what was built and what the validator found, so the context is preserved for a future attempt. Do not delete the branch — leave it for the user to clean up manually if desired.

---

## Pipeline Summary

```
[Branch check]
      ↓
codebase-researcher → [open-questions-gate]
      ↓
spec-writer → [open-questions-gate]
      ↓
[HUMAN SPEC APPROVAL GATE]
      ↓
backend-feature-implementer → [open-questions-gate]
      ↓
implementation-validator → [open-questions-gate]
      ↓
[CRITICAL loop if needed, gate on each re-validation]
      ↓
[HUMAN FINAL REVIEW GATE]
      ↓
git push + PR
```

## Rules

- Always announce which step you are on before launching each agent or running a command.
- Always run the `open-questions-gate` after every agent returns — it exits immediately if there are no open questions, so there is no cost to running it when not needed.
- Never skip the human gates at Steps 4 and 7.
- Never merge or combine two agent launches into one message.
- Always pass the full spec text to both the implementer and the validator — never summarise it.
- Always use the finalized (post-gate) agent output when passing findings forward to the next stage.
- If any agent returns an error or produces no output, stop and tell the user what failed before continuing.
- If any Bash command fails, stop and ask the user to resolve the issue before proceeding.
