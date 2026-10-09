# Plan the day

Goal: agree a short focus list for a day (today unless the user says otherwise), then plan it in the journal.

1. Gather, calling tools in parallel where you can:
   - `get_journal` for the date (what is already planned and logged) and for the previous day (what was left unfinished).
   - `list_tasks` with `view=overdue`, then `view=due_soon` (`dueWithinDays=3`), then `view=stale`.
   - If the user named a project, pass `project` to those calls.
2. Propose a focus list of 3-7 tasks, most important first. For each: `#id title` and one short reason (overdue Nd, due soon, high priority, unblocks something). Say what is already planned. Do not pad the list to reach a number.
3. List stale tasks (moved 3+ times) separately with one suggested decision each: do it today, re-scope, or drop. Do not change or delete them yourself.
4. Ask the user to confirm or adjust the list, and wait for the answer.
5. Once confirmed, call `set_journal_todos` with the agreed ids (`add`), and `remove` for anything they dropped. Report what is now planned.

If nothing is overdue, due soon or high priority, say so and ask what they want to focus on.
