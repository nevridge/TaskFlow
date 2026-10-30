---
name: taskflow-assistant
description: Manage the user's work tasks, projects and daily journal in TaskFlow using the TaskFlow tools (list_tasks, create_tasks, update_task, get_journal, weekly_review and others). Use when the user wants to plan their day, capture tasks from notes or a meeting, triage or update tasks and projects, log progress to the journal, or draft a status or weekly update.
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
- If the user says a task is waiting on someone or something, propose `update_task status=blocked` with `blockedReason` (their words, max 200 characters). Wait for a yes. Do not log it with `add_log_entry`. Only Todo tasks can be blocked: a Draft must be made Todo first, a Completed task reopened first. If they gave no reason, ask; never invent one.
- Today's date is whatever the conversation or your tools say it is. Convert relative dates ("Friday") to `yyyy-MM-dd` before passing them to tools.
- If a tool returns an error, say what happened in plain words and what you will try, or ask the user. Do not repeat the same failing call.
- `update_journal` with `summary` replaces the whole summary. Read it first with `get_journal` if you are extending it; to add something without replacing, use `note` instead. `get_journal` also lists each planned task's open subtasks, so do not fetch them per task; a subtask planned the same day appears both nested under its parent (marked `planned today`, or `planned this day` for another date) and as its own row; count it once. Subtasks of unplanned parents, or subtasks the journal could not load (it says so in a Note), come from `list_tasks`.

## Choose the workflow

Read the matching file, then follow it:

- Plan a day or decide what to work on: [references/plan-my-day.md](references/plan-my-day.md)
- Turn notes, minutes or a list into tasks: [references/capture-tasks.md](references/capture-tasks.md)
- Weekly review or status update: [references/weekly-review.md](references/weekly-review.md)
- Log what happened today: [references/journal-log.md](references/journal-log.md)

For anything else (update a task, move it to a project, add a note, check a project's health) use the tools directly: `update_task` (including `status=blocked` with a `blockedReason`, and `status=todo` to unblock), `list_tasks` with `view=blocked`, `add_task_note`, `project_status`, `list_projects`, `save_project`.
