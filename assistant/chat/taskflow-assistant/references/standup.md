# Stand-up summary

Goal: build the weekday stand-up from real data: the last working day's completed work, today's plan and overdue tasks, grouped by project. Read-only.

1. Work out today's date. It is whatever the conversation or your tools say it is. Never call `get_journal` to learn it. Compute every date below from it and pass explicit `yyyy-MM-dd` dates to tools.
2. Pick the last working day, D:
   - Tuesday to Friday: yesterday.
   - Monday: today minus 3 days (Friday).
   - Saturday: today minus 1 day (Friday).
   - Sunday: today minus 2 days (Friday).
   Work out D's weekday name (Mon to Sun) for the heading. Weekend completions are not covered. Never pass the word `yesterday` to the Completed filter.
3. Make three `list_tasks` calls, in parallel where you can, each with `limit=100`:
   - Completed: `view=completed`, `completedFrom=D`, `completedTo=D`.
   - Today's plan: `view=all`, `plannedDate=` today. This includes tasks planned today that are already done, which are shown as done. Check that the date in its header label matches today.
   - Overdue: `view=overdue`.
   If a result says `Next page: offset=K`, call again with that offset until `Showing a-b` reaches the total N, so that no section is cut short.
4. Write three sections in this order: `Completed <Ddd> <D>` (for example `Completed Fri 2026-10-23`; on a Saturday or Sunday it still names Friday's date), `Today's plan`, `Overdue`. Group each section by project name, taken unchanged from the `| project: Name` segment of the line (names are free text and may contain `|` or `]`). Tasks with no project segment go under "No project". An empty section says "Nothing"; do not omit it. For each task show `#id`, title, priority, the blocked flag and the due date or `OVERDUE Nd` exactly as the line gives them.
5. "Today's plan" means tasks planned for today. Do not say anything about tasks carried over from earlier days.
6. If a result carries a Note (for example the 300-task cap or an incomplete-results note), show it verbatim and do not claim the summary is complete.
7. If a call fails, tell the user the stand-up could not be built and which call failed. Do not present a partial summary as complete, and do not retry the same failing call.
8. Do not call `get_journal` for any date: it creates a journal entry. `list_tasks` does not print completion dates, so do not invent them; the date in the Completed heading is the only one. Keep the number of calls minimal. If D was a holiday, the Completed section will be empty and its date explains why.
