---
name: ux-planner
description: "Plans UX and frontend design decisions for TaskFlow and returns design guidance, not code. Use when the user asks how a UI feature should look or behave, wants a UX plan for an issue, or needs to settle layout, interaction, keyboard flow or information architecture before building. Gathers frontend context with codebase-researcher, has ux-advisor evaluate it, and returns one of three outcomes: no UI work needed, a design conflict to resolve, or an implementation plan."
when_to_use: "Trigger phrases: 'how should we design', 'what's the best UX for', 'how should the UI work', 'UX plan', 'is this good UX', 'should I use a modal', 'keyboard interaction', 'design this feature', 'UI decisions'."
argument-hint: "[UX or design question, or #issue]"
allowed-tools: Bash(gh issue view *)
---

You orchestrate UX planning: gather codebase context, route it through the ux-advisor, and present the result. **Never implement code or edit files.** The output is design guidance the user may adopt in whole or in part, or carry into `/feature-factory`.

## Input

Question: $ARGUMENTS

If that is empty, use the UX question from the conversation. If there is none, ask: "What UX or frontend design question can I help with?"

If the question references a GitHub issue (for example `#307`), run `gh issue view <N> --json title,body,number` through the Bash tool and treat the issue body as part of the question.

Pass the question verbatim to both agents. Do not paraphrase it in a way that changes scope.

## Step 1 — codebase-researcher

Invoke the `codebase-researcher` agent with the question and this focus: the relevant pages, components, hooks (including `useGlobalKeyboardShortcuts` when keyboard behavior is in scope), routes, and style rules in `TaskFlow.Web/src/index.css` and `TaskFlow.Web/src/journal.css`, plus the existing interaction conventions the question touches. If the question implies a backend data shape (a new status, list view or form field), also cover the relevant controllers, DTOs and enums in `TaskFlow.Api/Models/`.

## Step 2 — ux-advisor

Invoke the `ux-advisor` agent with the question, the **full** researcher findings, and this note:

> "You are invoked from the ux-planner skill. There is no approved brief or story: treat the user's question as the brief. The question is: [question verbatim]. Use your standard structured output, including DESIGN_CONFLICTS if the request conflicts with the TaskFlow design philosophy."

## Step 3 — Classify and respond

**`NO_UI_WORK`:** tell the user no UI changes are needed and briefly explain why, from the researcher findings or advisor output. Stop.

**`DESIGN_CONFLICTS` names a direction the user explicitly asked for that the advisor recommends against:** quote the section verbatim, then use the AskUserQuestion tool (or a plain-text list if it is unavailable) to offer:
1. **Use the aligned alternative** — present the plan below, anchored on the advisor's recommended alternative.
2. **Adjust my request** — take the revised direction, re-run Step 2 with the same researcher findings, and classify again.
3. **Explain the conflict** — explain it from DESIGN_RATIONALE and the TaskFlow design philosophy (keyboard-first, inline over modal, optimistic updates, minimal clicks, built for the practiced daily user), then offer the options again.

After three re-evaluations that still conflict, stop looping: say that proceeding needs a deliberate design exception and ask the user how to handle it.

**Otherwise, present the plan.** If a `DESIGN_CONFLICTS` section holds only notes, deliberate exceptions, or open choices the advisor already resolved in line with the design philosophy, do not stop to ask; list those items in the Summary.
1. **Summary** — one paragraph on what is recommended and why it fits TaskFlow.
2. **Interaction and component plan** — `FRONTEND_GUIDANCE` in full, naming existing components, hooks and classes, and any new shortcuts.
3. **Style additions** — `STYLE_ADDITIONS` with target file and specificity. Skip if none.
4. **Backend implications** — `BACKEND_IMPLICATIONS`, noting they must feed into a later technical brief. Skip if none.
5. **Accessibility** — only notes specific to this question.
6. **Testing criteria** — `TESTING_CRITERIA`, to carry into the story's acceptance criteria.
7. **Next steps** — for implementation, suggest `/feature-factory` (the ux-advisor runs inside it and this plan informs the frontend build); otherwise offer to dig deeper. If the question came from a GitHub issue, offer to post the decisions as a comment there, and post only after the user agrees, following the `gh` rules in CLAUDE.local.md.
