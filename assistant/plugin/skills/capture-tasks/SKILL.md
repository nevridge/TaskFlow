---
name: capture-tasks
description: Turn pasted notes, meeting minutes or a rough list into well-formed TaskFlow tasks. Proposes the tasks with project, priority and due date, then creates them after you confirm.
argument-hint: "[notes to capture]"
disable-model-invocation: true
allowed-tools: mcp__plugin_taskflow-assistant_taskflow__list_projects mcp__plugin_taskflow-assistant_taskflow__list_tasks
---

Capture tasks from the user's notes into TaskFlow. Notes may be in the argument or in the previous message: $ARGUMENTS

1. Call `list_projects` so you can match tasks to real projects, and `list_tasks` (open) to spot duplicates of tasks that already exist.
2. Extract the concrete action items. Each becomes a task with:
   - a short imperative title (max 100 characters),
   - `project` only when the notes make it clear and it exists in `list_projects`,
   - `priority` and `dueDate` only when the notes say so ("urgent", "by Friday"); otherwise leave them out. Convert relative dates to `yyyy-MM-dd` using today's date.
3. Show the proposed tasks as a compact table (title, project, priority, due) and flag: possible duplicates (`#id`), items you left out because they were not actionable, and anything you were unsure about.
4. Ask the user to confirm or edit. Ask about missing details only when they matter (for example an unknown project), and ask once, not per task.
5. After confirmation, call `create_tasks` once with the full list. Report the created ids, and any task that failed with its reason. If the report flags a `! Possible duplicate`, tell the user which task it matches and that the new task was still created; if it says "Duplicate check skipped", tell the user that duplicates were not checked. Do not delete anything unprompted. Tasks cannot be created as blocked: create items that are waiting on someone or something as Todo.
   Then propose `update_task status=blocked` (or `update_tasks` to block several at once) with `blockedReason` (the notes' words, max 200 characters) for each, and wait for a yes. Do not log it with `add_log_entry`. Only Todo tasks can be blocked. If the notes give no reason, ask; never invent one.
6. Offer to plan any of them for today with `set_journal_todos`. Do not do it unprompted.
