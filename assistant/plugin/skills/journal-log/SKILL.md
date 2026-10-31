---
name: journal-log
description: Log progress to today's TaskFlow journal from what you tell Claude, linking each entry to the right task when it is clear which one.
argument-hint: "[what happened]"
disable-model-invocation: true
allowed-tools: mcp__plugin_taskflow-assistant_taskflow__list_tasks mcp__plugin_taskflow-assistant_taskflow__get_journal
---

Add log entries to the TaskFlow journal. What to log: $ARGUMENTS

1. Break the input into separate, past-tense log lines (one idea each, plain language, max 2000 characters). Do not embellish.
2. For each line, find the task it is about: check the day's planned tasks (`get_journal`) first, then `list_tasks`. Link it (`taskId`) only when exactly one task clearly matches; otherwise leave it unlinked and say so. get_journal log lines for linked tasks read [task #id | Project | Priority], leave out the project when the task has none, show [task #id, deleted] for a deleted task and a bare [task #id] when the task could not be looked up, so read the project and priority from the line instead of calling list_tasks for them.
3. Call `add_log_entry` for each line (today by default; use `date` if the user named another day). Do not log "waiting on X" lines this way; handle them as in step 4.
4. If the user also says a task is finished or changed, mention that and offer `update_task` (or `update_tasks` when several tasks change) rather than doing it silently. If the user says a task is waiting on someone or something, propose `update_task status=blocked` with `blockedReason` (their words, max 200 characters). Wait for a yes. Do not log it with `add_log_entry`. Only Todo or InProgress tasks can be blocked: a Draft must be made Todo first, a Completed task reopened first. If they gave no reason, ask; never invent one.
5. Confirm with the entries added and the tasks they were linked to. To add a wrap-up to the day's summary, call `update_journal` with `summary` and `append=true`: it is added after the existing summary (no need to read it first), which is otherwise replaced. Appending twice duplicates the text, so do not retry blindly.
