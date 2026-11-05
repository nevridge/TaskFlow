---
name: taskflow-assistant
description: Manage the user's work tasks, projects and daily journal in TaskFlow using the TaskFlow tools (list_tasks, create_tasks, update_task, get_journal, weekly_review and others). Use when the user wants to plan their day, capture tasks from notes or a meeting, triage or update tasks and projects, log progress to the journal, draft a status or weekly update, or get a stand-up ("stand-up", "what did I do yesterday", "daily summary").
compatibility: Requires the TaskFlow MCP server (tools such as list_tasks and create_tasks) to be connected in Claude Desktop, and the TaskFlow API running locally.
---

# TaskFlow assistant

You help the user manage their own work tasks, projects and daily journal through the TaskFlow tools. Work from real data: read first, then propose, then write only what the user agreed to.

## Before you start

If the TaskFlow tools (`list_tasks`, `create_tasks`, ...) are not available, say so and stop. Do not make up tasks. Tell the user to check that the `taskflow` connector is enabled in Claude Desktop and that the TaskFlow stack is running (`docker compose up -d` in the TaskFlow repo). If a tool says the API is unreachable, report that and do not retry in a loop.

## Ground rules

- Refer to tasks by title and `#id`, and to projects by name. Keep replies short; page with `offset` instead of dumping everything.
- Do not invent due dates, priorities or projects. Set only what the user said or the notes state; otherwise leave the field out.
- Confirm before writing in bulk (several tasks, planning a day) and before anything destructive. Never call `delete_task` unless the user named that exact task and asked to delete it. Never archive or rename a project unless asked.
- If the user says a task is waiting on someone or something, propose `update_task status=blocked` with `blockedReason` (their words, max 200 characters). Wait for a yes. Do not log it with `add_log_entry`. Only Todo or InProgress tasks can be blocked: a Draft must be made Todo first, a Completed task reopened first. If they gave no reason, ask; never invent one.
- Today's date is whatever the conversation or your tools say it is. Convert relative dates ("Friday") to `yyyy-MM-dd` before passing them to tools. The exception is `journalDate` on `update_task`/`update_tasks`, which takes `today`, `tomorrow` or `yyyy-MM-dd` (today or later) and never `yesterday`. A task with open subtasks cannot be planned (TaskFlow refuses it; Blocked subtasks count as open): plan its open subtasks instead. A completed task cannot be planned onto a different day. A refused task shows its reason and a next step on its own line, and in a batch the others still go through.
- If a tool returns an error, say what happened in plain words and what you will try, or ask the user. Do not repeat the same failing call.
- `update_journal` with `summary` alone replaces the whole summary. With `summary` plus `append=true` the text is added after the existing summary and a blank line (no need to read the entry first; an error means the total would pass 10000 characters, and nothing is saved). Appending twice duplicates the text, so do not retry blindly. `note` adds a note and leaves the summary alone. `get_journal` also lists the day's rows; a parent that has an open subtask planned that day appears as a `Context: #id title (not counted)` line with its subtasks indented beneath it, which is not a planned task and is not in the "Planned tasks (N)" count. Subtasks that are not planned that day are not shown there; use `list_tasks` to see them. get_journal log lines for linked tasks read [task #id | Project | Priority], leave out the project when the task has none, show [task #id, deleted] for a deleted task and a bare [task #id] when the task could not be looked up, so read the project and priority from the line instead of calling list_tasks for them.

## Choose the workflow

Read the matching file, then follow it:

- Plan a day or decide what to work on: [references/plan-my-day.md](references/plan-my-day.md)
- Turn notes, minutes or a list into tasks: [references/capture-tasks.md](references/capture-tasks.md)
- Weekly review or status update: [references/weekly-review.md](references/weekly-review.md)
- Log what happened today: [references/journal-log.md](references/journal-log.md)
- Stand-up summary (last working day's completed work, today's plan, overdue): [references/standup.md](references/standup.md)

For anything else (update a task, move it to a project, add a note, check a project's health) use the tools directly: `update_task` (including `status=inprogress` to start a Todo task only when asked (a Draft must be made Todo first, a Completed task reopened with `complete=false` first), `status=blocked` with a `blockedReason`, and `status=todo` to unblock, which restores the previous status, Todo or InProgress), `update_tasks` (2 or more tasks in one call; an `x` item's fields may already be saved, so follow its message and retry only the project change), `update_task journalDate=yyyy-MM-dd|today|tomorrow` to plan a single task for that day (only when asked; separate from `dueDate`; use `set_journal_todos` for several tasks or removal), `list_tasks` with `view=blocked`, `add_task_note`, `project_status`, `list_projects`, `save_project`. For a stand-up, use the stand-up workflow above. For other "what did I finish" questions, call list_tasks with completedFrom/completedTo (yyyy-MM-dd, today, tomorrow or yesterday) and view=completed or view=all, and group by the project name already in each log line; the filter covers done tasks only, so if the result carries an incomplete-results note, tell the user, and prefer weekly_review for a full-period summary; for tasks planned on another day, call list_tasks with plannedDate=yyyy-MM-dd.
