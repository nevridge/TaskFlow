---
name: plan-my-day
description: Plan a day in TaskFlow. Reviews the journal, overdue and due-soon tasks and stale work, proposes a focus list, and plans the tasks you confirm.
argument-hint: "[date or project]"
disable-model-invocation: true
allowed-tools: mcp__plugin_taskflow-assistant_taskflow__get_journal mcp__plugin_taskflow-assistant_taskflow__list_tasks mcp__plugin_taskflow-assistant_taskflow__list_projects mcp__plugin_taskflow-assistant_taskflow__project_status
---

Plan the user's day in TaskFlow. Optional argument: a date (default today) or a project name: $ARGUMENTS

1. Gather, in parallel where you can:
   - `get_journal` for the date (what is already planned and logged), and `get_journal` for the previous day to see what was left unfinished. It lists each planned task's open subtasks, so remaining subtask work is visible there and need not be fetched per task. A subtask planned the same day appears both nested under its parent (marked `planned today`, or `planned this day` for another date) and as its own row; count it once. Subtasks of unplanned parents, or subtasks the journal could not load (it says so in a Note), come from `list_tasks`. get_journal log lines for linked tasks read [task #id | Project | Priority], leave out the project when the task has none, show [task #id, deleted] for a deleted task and a bare [task #id] when the task could not be looked up, so read the project and priority from the line instead of calling list_tasks for them.
   - `list_tasks` with `view=overdue`, then `view=due_soon` (dueWithinDays 3), then `view=stale`, then `view=blocked`. To see tasks planned on a day other than the one get_journal already covers, call list_tasks with plannedDate=yyyy-MM-dd (or tomorrow, yesterday), adding view=all to include done tasks; do not call it for a day you already read with get_journal.
   - If a project was named, add `project` to those calls.
2. Propose a focus list of 3-7 tasks, most important first. For each give: `#id title`, and one short reason (overdue Nd, due soon, high priority, unblocks something). Mention anything already planned (count a subtask that is planned today once, whether it shows as its own row or under its parent). Do not add tasks the user did not need to do today just to fill the list. Blocked tasks (flagged `blocked: <reason> (Nd)`) are not suggested for today unless the user asks.
3. List stale tasks (moved 3+ times) separately and suggest one decision each: do it today, re-scope, or drop. Do not change or delete them yourself.
   List Blocked tasks as their own group (`#id title`, reason, days blocked). If the wait may be over, offer to unblock with `update_task status=todo`. Wait for a yes. If the user says another task is waiting on someone or something, propose `update_task status=blocked` with `blockedReason` (their words, max 200 characters) and wait for a yes. Do not log it with `add_log_entry`. Only Todo tasks can be blocked: a Draft must be made Todo first, a Completed task reopened first. If they gave no reason, ask; never invent one.
4. Ask the user to confirm or adjust the list. Wait for their answer.
5. Once confirmed, call `set_journal_todos` with the agreed ids (and `remove` for anything they dropped). Report what is now planned. If the user also wants several tasks changed (re-date, unblock, re-prioritize), use one `update_tasks` call with an item per task instead of repeated `update_task` calls.

Keep the whole exchange short. If there is nothing overdue, due soon or high priority, say so and ask what they want to focus on instead.
