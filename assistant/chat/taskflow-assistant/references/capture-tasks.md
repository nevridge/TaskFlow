# Capture tasks from notes

Goal: turn the user's notes, meeting minutes or rough list into well-formed tasks, created only after they confirm.

1. Call `list_projects` so tasks can be matched to real projects, and `list_tasks` (default view) to spot duplicates of tasks that already exist.
2. Extract the concrete action items. Each becomes a task with:
   - a short imperative title (max 100 characters),
   - `project` only when the notes make it clear and the project exists,
   - `priority` and `dueDate` only when the notes say so ("urgent", "by Friday"); otherwise leave them out. Convert relative dates to `yyyy-MM-dd`.
3. Show the proposed tasks as a compact table (title, project, priority, due). Flag possible duplicates (`#id`), notes you left out because they were not actionable, and anything you were unsure about.
4. Ask the user to confirm or edit. Ask about missing details only when they matter (for example an unknown project), and ask once, not per task.
5. After confirmation, call `create_tasks` once with the full list. Report the created ids and any task that failed, with the reason. If the report flags a `! Possible duplicate`, tell the user which task it matches and that the new task was still created; if it says "Duplicate check skipped", tell the user that duplicates were not checked. Do not delete anything unprompted. Tasks cannot be created as blocked: create items that are waiting on someone or something as Todo.
   Then propose `update_task status=blocked` (or `update_tasks` to block several at once) with `blockedReason` (the notes' words, max 200 characters) for each, and wait for a yes. Do not log it with `add_log_entry`. Only Todo tasks can be blocked. If the notes give no reason, ask; never invent one.
6. Offer to plan any of them for today with `set_journal_todos`. Do not do it unprompted.
