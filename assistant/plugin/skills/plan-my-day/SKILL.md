---
name: plan-my-day
description: Plan a day in TaskFlow. Reviews the journal, overdue and due-soon tasks and stale work, proposes a focus list, and plans the tasks you confirm.
argument-hint: "[date or project]"
disable-model-invocation: true
allowed-tools: mcp__plugin_taskflow-assistant_taskflow__get_journal mcp__plugin_taskflow-assistant_taskflow__list_tasks mcp__plugin_taskflow-assistant_taskflow__list_projects mcp__plugin_taskflow-assistant_taskflow__project_status
---

Plan the user's day in TaskFlow. Optional argument: a date (default today) or a project name: $ARGUMENTS

1. Gather, in parallel where you can:
   - `get_journal` for the date (what is already planned and logged), and `get_journal` for the previous day to see what was left unfinished.
   - `list_tasks` with `view=overdue`, then `view=due_soon` (dueWithinDays 3), then `view=stale`.
   - If a project was named, add `project` to those calls.
2. Propose a focus list of 3-7 tasks, most important first. For each give: `#id title`, and one short reason (overdue Nd, due soon, high priority, unblocks something). Mention anything already planned. Do not add tasks the user did not need to do today just to fill the list.
3. List stale tasks (moved 3+ times) separately and suggest one decision each: do it today, re-scope, or drop. Do not change or delete them yourself.
4. Ask the user to confirm or adjust the list. Wait for their answer.
5. Once confirmed, call `set_journal_todos` with the agreed ids (and `remove` for anything they dropped). Report what is now planned.

Keep the whole exchange short. If there is nothing overdue, due soon or high priority, say so and ask what they want to focus on instead.
