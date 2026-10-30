# Plan the day

Goal: agree a short focus list for a day (today unless the user says otherwise), then plan it in the journal.

1. Gather, calling tools in parallel where you can:
   - `get_journal` for the date (what is already planned and logged) and for the previous day (what was left unfinished). It lists each planned task's open subtasks, so remaining subtask work is visible there and need not be fetched per task. A subtask planned the same day appears both nested under its parent (marked `planned today`, or `planned this day` for another date) and as its own row; count it once. Subtasks of unplanned parents, or subtasks the journal could not load (it says so in a Note), come from `list_tasks`.
   - `list_tasks` with `view=overdue`, then `view=due_soon` (`dueWithinDays=3`), then `view=stale`, then `view=blocked`.
   - If the user named a project, pass `project` to those calls.
2. Propose a focus list of 3-7 tasks, most important first. For each: `#id title` and one short reason (overdue Nd, due soon, high priority, unblocks something). Say what is already planned (count a subtask that is planned today once, whether it shows as its own row or under its parent). Do not pad the list to reach a number. Blocked tasks (flagged `blocked: <reason> (Nd)`) are not suggested for today unless the user asks.
3. List stale tasks (moved 3+ times) separately with one suggested decision each: do it today, re-scope, or drop. Do not change or delete them yourself.
   List Blocked tasks as their own group (`#id title`, reason, days blocked). If the wait may be over, offer to unblock with `update_task status=todo`. Wait for a yes. If the user says another task is waiting on someone or something, propose `update_task status=blocked` with `blockedReason` (their words, max 200 characters) and wait for a yes. Do not log it with `add_log_entry`. Only Todo tasks can be blocked: a Draft must be made Todo first, a Completed task reopened first. If they gave no reason, ask; never invent one.
4. Ask the user to confirm or adjust the list, and wait for the answer.
5. Once confirmed, call `set_journal_todos` with the agreed ids (`add`), and `remove` for anything they dropped. Report what is now planned.

If nothing is overdue, due soon or high priority, say so and ask what they want to focus on.
