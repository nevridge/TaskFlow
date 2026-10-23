---
name: weekly-review
description: Review a week (or any date range) in TaskFlow and draft a status update. Summarizes what was completed and added, what is overdue or stalled, per-project progress and journal activity.
argument-hint: "[from] [to] or [project]"
disable-model-invocation: true
allowed-tools: mcp__plugin_taskflow-assistant_taskflow__weekly_review mcp__plugin_taskflow-assistant_taskflow__project_status mcp__plugin_taskflow-assistant_taskflow__list_tasks mcp__plugin_taskflow-assistant_taskflow__list_projects mcp__plugin_taskflow-assistant_taskflow__get_journal
---

Review the user's work in TaskFlow and draft a status update. Optional arguments (a date range as `yyyy-MM-dd` dates, or a project name): $ARGUMENTS

1. Call `weekly_review` (default: the last 7 days; pass `from`/`to` if the user gave a range).
2. For each project that has open overdue or stalled work, or that the user named, call `project_status`.
3. Draft the update in the user's voice with these sections, omitting empty ones:
   - **Done**: completed work grouped by project.
   - **In progress / next**: the most urgent open tasks per project.
   - **Blocked**: currently Blocked tasks with their reasons and how long they have been blocked. Do not suggest them as work for today unless asked, and do not report what was blocked or unblocked during the period (the review does not show it). If the user says a task is waiting on someone or something, propose `update_task status=blocked` with `blockedReason` (their words, max 200 characters), wait for a yes, and do not log it with `add_log_entry`.
   - **At risk**: overdue and stalled tasks, each with a one-line suggestion (re-date, split, drop, escalate).
   - **Notes**: anything notable from the journal summaries and logs.
4. Keep it to what the data shows. Do not invent accomplishments or reasons for delays; mark guesses as questions.
5. Offer to save the draft as a journal note (`update_journal` with `note`). Only do it if the user agrees.
