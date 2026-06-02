---
name: explore-then-build
description: Orchestrates a full feature build using five subagents in sequence: branch check → codebase-researcher → spec-writer → human approval → backend-builder → frontend-builder → implementation-validator. Trigger with phrases like "build a feature", "implement this", "ship a feature", or "feature factory".
---

# Explore-Then-Build Skill

This skill runs a structured, gated pipeline for shipping a feature safely. Follow every step in order. Do not skip steps or combine them.

## When This Skill Applies

Trigger when the user asks to build, implement, or ship a feature. Key phrases: "build a feature", "implement this", "ship a feature", "feature factory", "let's build", "implement [feature name]".

---

## Step 1 — Branch Check, Disclosure, and Creation

Announce: "Step 1/8 — Checking branch status."

**Branch handling:** Check the current branch. If already on a feature or bugfix branch, proceed. If on `main`, derive a branch name from the user's feature description — convert it to lowercase, replace spaces with hyphens, strip non-alphanumeric characters, and truncate to 40 characters. Prefix with `feature/`. Pass the derived name as a literal string to the git command (do not use a shell variable for the branch name):

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"
```

If already on a feature branch, announce "Already on feature branch: [branch name]. Proceeding." and skip the checkout.

If on `main`, run the checkout with the literal branch name derived above (substitute the actual name in place of the placeholder — do not use `$VARIABLE` syntax):

```bash
git checkout -b "feature/the-actual-derived-name-here"
echo "✓ Created and switched to branch: feature/the-actual-derived-name-here"
```

If branch creation fails (non-zero exit), stop and ask the user to manually create a branch or stash uncommitted changes before retrying.

---

## Step 2 — Map the Codebase (codebase-researcher)

Announce: "Step 2/8 — Mapping the codebase with codebase-researcher."

In the agent prompt, pass any relevant information from the `CLAUDE.md` that might be needed for codebase research, such as architecture overview, coding conventions, and any notes on the existing code structure.

Launch the `codebase-researcher` agent with the user's feature description as the question. Ask it to identify:
- Relevant files grouped by role (backend and frontend separately)
- Existing patterns and conventions for each layer
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

Announce: "Step 3/8 — Writing the technical spec with spec-writer."

In the agent prompt, pass any relevant information from the `CLAUDE.md` that might be needed for technical specification.

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

**Save spec checkpoint:** Write the finalized Technical Brief to `docs/superpowers/pipeline-checkpoints/[branch-name]-spec.md`. Replace `[branch-name]` with the actual branch name. This allows the pipeline to be resumed from Step 5 if the session is interrupted.

---

## Step 4 — Human Spec Approval (GATE)

Announce: "Step 4/8 — Spec Approval Gate."

Ask the user: **"Does this spec look good to proceed with implementation? Reply with: (1) Approved, (2) Changes needed — describe them, or (3) Rejected."**

Use `AskUserQuestion` with three options: "Approved", "Changes needed", "Rejected".

**If Approved:** proceed to Step 5.

**If Changes needed:** summarize the requested changes, re-launch `spec-writer` with the original inputs plus the change requests, run the `open-questions-gate` on the revised output, present the revised spec, and repeat this gate.

**If Rejected:** stop the pipeline. Summarize what was explored in Steps 2–3 (key files found, patterns identified, risks noted) so the work is not lost. Do not proceed to implementation.

---

## Step 5 — Implement the Backend (backend-builder)

Announce: "Step 5/8 — Implementing the backend with backend-builder."

In the agent prompt, pass any relevant information from the `CLAUDE.md` that might be needed for backend implementation, such as architecture overview, coding conventions, and any notes on the existing backend structure.

Launch the `backend-builder` agent. Pass it:
- The approved Technical Brief (full text)
- The codebase-researcher findings (relevant backend file paths, patterns, similar examples)

Wait for the agent to complete and return a summary of what was built, including the **API contract summary** (new/changed endpoints, request/response shapes, status codes).

**After the agent returns:** invoke the `open-questions-gate` skill with:
- Agent output: the implementation summary
- Agent ID: from the result
- Agent type: `backend-builder`
- Output label: `backend implementation summary`

Do not proceed to Step 6 until the gate exits.

**Record the backend-builder agent ID** returned at the end of the agent result (format: `agentId: <id>`). Store it as `BACKEND_AGENT_ID`. This ID is required for the Step 7 fix loop.

**Review and commit the backend implementation:**

Run the following to show the user what the agent changed:

```bash
git add -A
git diff --staged --stat
git diff --staged
```

Present the diff output to the user, then ask using `AskUserQuestion`:

- **Question:** "Review the backend changes above. Ready to commit?"
- **Options:**
  - "Commit these changes"
  - "I need to make adjustments first — hold the pipeline"

If "I need to make adjustments first": pause. Do not commit. Wait for the user to indicate they are done with their adjustments, then re-run `git diff --staged` and re-ask.

If "Commit these changes":

```bash
git commit -m "feat: implement backend for [feature name]"
```

Announce the commit hash. If `git diff --staged` showed nothing (the agent committed its own changes), announce "Backend agent committed its own changes — no additional commit needed." and continue.

**Save backend checkpoint:** Append to `docs/superpowers/pipeline-checkpoints/[branch-name]-progress.md`:

```
Stage: backend-complete
Backend agent ID: [BACKEND_AGENT_ID value]
API contract: [paste the API contract summary]
Files modified: [list files changed by the backend-builder]
```

---

## Step 5.5 — Build Verification Gate

Only do this step if the backend implementation included any code changes. If there were no changes, skip this step and proceed to Step 6.

Announce: "Step 5.5/8 — Verifying backend builds and tests pass before proceeding to frontend."

Run the backend build:

```bash
dotnet build
```

If the build fails: stop the pipeline. Display the full build error output. Ask using `AskUserQuestion`:

- **Question:** "The backend build failed. How would you like to proceed?"
- **Options:**
  - "Send errors to backend-builder for fixes"
  - "I'll fix it manually — hold the pipeline"
  - "Abort the pipeline"

If "Send errors to backend-builder for fixes": use `SendMessage` to `BACKEND_AGENT_ID` with the full build output and the instruction "The backend build failed after your implementation. Please fix the build errors below. Return a summary of what you changed." Then re-run this verification step.

If "I'll fix it manually": pause. Wait for the user to confirm the build is clean before re-running this verification step.

If "Abort the pipeline": stop immediately.

If the build succeeds, run the tests:

```bash
dotnet test --no-build
```

If tests fail: stop the pipeline, display the test failure output, and present the same three options above (substituting test failure output for build errors).

If both build and tests pass: announce "Backend verified ✓ — proceeding to frontend implementation." and continue to Step 6.

---

## Step 6 — Implement the Frontend (frontend-builder)

Announce: "Step 6/8 — Implementing the frontend with frontend-builder."

**First, ask the user explicitly** using `AskUserQuestion`:

- **Question:** "Does this feature require any frontend or UI changes?"
- **Options:**
  - "Yes — implement the frontend"
  - "No — backend only, skip to Step 7"

If "No — backend only": announce "Skipping frontend implementation — backend-only feature." and proceed directly to Step 7.

In the agent prompt, pass any relevant information from the `CLAUDE.md` that might be needed for frontend implementation, such as architecture overview, coding conventions, and any notes on the existing frontend structure.

If "Yes — implement the frontend": launch the `frontend-builder` agent. Pass it:
- The approved Technical Brief (full text)
- The codebase-researcher findings (relevant frontend file paths, patterns, similar examples)
- The API contract summary from the backend-builder (the new/changed endpoints, request/response shapes, status codes)

Wait for the agent to complete and return a summary of what was built.

**After the agent returns:** invoke the `open-questions-gate` skill with:
- Agent output: the implementation summary
- Agent ID: from the result
- Agent type: `frontend-builder`
- Output label: `frontend implementation summary`

Do not proceed to Step 7 until the gate exits.

**Record the frontend-builder agent ID** returned at the end of the agent result. Store it as `FRONTEND_AGENT_ID`. This ID is required for the Step 7 fix loop.

**Review and commit the frontend implementation:**

Run the following to show the user what the agent changed:

```bash
git add -A
git diff --staged --stat
git diff --staged
```

Present the diff output to the user, then ask using `AskUserQuestion`:

- **Question:** "Review the frontend changes above. Ready to commit?"
- **Options:**
  - "Commit these changes"
  - "I need to make adjustments first — hold the pipeline"

If "I need to make adjustments first": pause. Do not commit. Wait for the user to indicate they are done with their adjustments, then re-run `git diff --staged` and re-ask.

If "Commit these changes":

```bash
git commit -m "feat: implement frontend for [feature name]"
```

Announce the commit hash. If `git diff --staged` showed nothing, announce "Frontend agent committed its own changes — no additional commit needed." and continue.

**Save frontend checkpoint:** Append to `docs/superpowers/pipeline-checkpoints/[branch-name]-progress.md`:

```
Stage: frontend-complete
Frontend agent ID: [FRONTEND_AGENT_ID value]
Files modified: [list files changed by the frontend-builder]
```

---

## Step 7 — Validate the Implementation (implementation-validator)

Announce: "Step 7/8 — Validating with implementation-validator."

Launch the `implementation-validator` agent. Pass it:
- The approved Technical Brief as the spec document
- The list of files created or modified by the backend-builder
- The list of files created or modified by the frontend-builder (if Step 6 ran)

Wait for the agent to return its Spec Compliance Review Report.

**After the agent returns:** invoke the `open-questions-gate` skill with:
- Agent output: the full Spec Compliance Review Report
- Agent ID: from the result
- Agent type: `implementation-validator`
- Output label: `validation report`

Do not proceed to the CRITICAL findings check or Step 8 until the gate exits.

**If the report contains CRITICAL findings:**

Announce: "CRITICAL issues found — sending back for fixes."

For each CRITICAL finding, determine which layer it belongs to:

- **Backend CRITICAL findings** → use `SendMessage` to `BACKEND_AGENT_ID` (do NOT launch a new agent — the existing agent retains its full implementation context). The message must be:

  ```
  The implementation-validator has found CRITICAL issues in your backend implementation. Please fix them now. Do not change anything unrelated to these findings.

  CRITICAL FINDINGS:
  [Paste the backend CRITICAL findings from the validator report verbatim]

  FULL VALIDATOR REPORT (for context):
  [Paste the full validator report]

  Return a summary of every file you changed and what you fixed.
  ```

- **Frontend CRITICAL findings** → use `SendMessage` to `FRONTEND_AGENT_ID` (do NOT launch a new agent). The message must be:

  ```
  The implementation-validator has found CRITICAL issues in your frontend implementation. Please fix them now. Do not change anything unrelated to these findings.

  CRITICAL FINDINGS:
  [Paste the frontend CRITICAL findings from the validator report verbatim]

  FULL VALIDATOR REPORT (for context):
  [Paste the full validator report]

  Return a summary of every file you changed and what you fixed.
  ```

After receiving fix confirmation from the builder(s), re-launch `implementation-validator` with the same spec and the updated file lists. Run the `open-questions-gate` on the new validator output before evaluating findings.

Repeat this loop a maximum of **two times**. If CRITICAL findings remain after two fix cycles, stop and surface all findings to the user with a clear statement: "Automated fix cycles exhausted. Human review required before proceeding."

**If the report contains only IMPORTANT or MINOR findings (no CRITICALs):** proceed to Step 8, surfacing the findings alongside the final review request.

---

## Step 8 — Final Human Review (GATE)

Announce: "Step 8/8 — Final Review and PR Preparation."

Present to the user:
- A summary of what was built (backend files created/modified, frontend files created/modified)
- The validator's findings (severity counts and any IMPORTANT/MINOR items)
- The proposed next action: open a PR
- The current feature branch name

Use `AskUserQuestion`: **"Implementation is complete. How would you like to proceed?"** with options: "Open a PR", "I have feedback — hold on", "Reject and discard".

**If Open a PR:** Run the following sequence. Stop if any command fails.

First, check for any uncommitted changes left by the validation fix cycle:

```bash
git add -A
git diff --staged --stat
git diff --staged
```

If `git diff --staged` shows any changes, present them to the user and ask using `AskUserQuestion`:

- **Question:** "These changes were made during the validation fix cycle. Review above — ready to commit?"
- **Options:**
  - "Commit these changes"
  - "I need to make adjustments first — hold the pipeline"

If adjustments needed: pause until the user confirms. Then re-run `git diff --staged` and re-ask.

Once committed (or if there was nothing to commit), show the full commit list and push:

```bash
git log --oneline origin/main..HEAD
```

Present the log to the user so they can see every commit that will be included in the PR. Then push:

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
```

Then create the PR with a description summarising the feature, the files changed, and the validator findings.

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
backend-builder → [open-questions-gate]
      ↓
frontend-builder → [open-questions-gate]  ← skipped for backend-only features
      ↓
implementation-validator → [open-questions-gate]
      ↓
[CRITICAL loop if needed, routed to backend-builder or frontend-builder, gate on each re-validation]
      ↓
[HUMAN FINAL REVIEW GATE]
      ↓
git push + PR
```

## Rules

- Always announce which step you are on before launching each agent or running a command.
- **Gate enforcement is mandatory.** After every agent returns (Steps 2, 3, 5, 6, 7), you MUST invoke `open-questions-gate` before doing anything else. Announce "Running open-questions-gate for [agent-type]" in your response — this announcement is the visible audit trail that the gate ran. If you are about to proceed to the next step and you cannot find this announcement in your recent output for the previous step, stop and run the gate now. The gate exits in one line when there are no questions; there is no cost to running it unnecessarily.
- Never skip the human gates at Steps 4 and 8.
- Never merge or combine two agent launches into one message.
- Always pass the full spec text to both the builders and the validator — never summarise it.
- Always use the finalized (post-gate) agent output when passing findings forward to the next stage.
- If any agent returns an error or produces no output, stop and tell the user what failed before continuing.
- If any Bash command fails, stop and ask the user to resolve the issue before proceeding.
- Checkpoint files are written to `docs/superpowers/pipeline-checkpoints/`. If resuming an interrupted pipeline, read the most recent checkpoint file for that branch to reconstruct pipeline state before continuing.
