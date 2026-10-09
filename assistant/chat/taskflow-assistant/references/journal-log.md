# Log progress to the journal

Goal: record what happened as journal log lines, linked to the right task when it is clear which one.

1. Split the user's input into separate past-tense log lines: one idea each, plain language, max 2000 characters. Do not embellish.
2. For each line, find the task it is about: check the day's planned tasks (`get_journal`) first, then `list_tasks`. Link it (`taskId`) only when exactly one task clearly matches; otherwise leave it unlinked and say so.
3. Call `add_log_entry` for each line (today by default; pass `date` if the user named another day).
4. If the user also says a task is finished or changed, mention it and offer `update_task` rather than doing it silently.
5. Confirm with the entries added and the tasks they were linked to.
