# Weekly review and status update

Goal: summarize a period from real data and draft a status update in the user's voice.

1. Call `weekly_review` (default: the last 7 days; pass `from` and `to` as `yyyy-MM-dd` if the user gave a range).
2. For each project that has overdue or stalled work, or that the user named, call `project_status`.
3. Draft the update with these sections, omitting empty ones:
   - **Done**: completed work grouped by project.
   - **Next up**: the most urgent open tasks per project. Tasks with status InProgress (work has started) may appear here.
   - **Blocked**: currently Blocked tasks with their reasons and how long they have been blocked. Do not suggest them as work for today unless asked, and do not report what was blocked or unblocked during the period (the review does not show it). If the user says a task is waiting on someone or something, propose `update_task status=blocked` with `blockedReason` (their words, max 200 characters), wait for a yes, and do not log it with `add_log_entry`.
   - **At risk**: overdue and stalled tasks, each with a one-line suggestion (re-date, split, drop, escalate).
   - **Notes**: anything notable from the journal summaries and logs.
4. Keep to what the data shows. Do not invent accomplishments or reasons for delays; phrase guesses as questions.
5. Offer to save the draft as a journal note (`update_journal` with `note`). Only do it if the user agrees. To add to the day's summary instead, pass `summary` with `append=true`: it is added after the existing summary, which is otherwise replaced. Appending twice duplicates the text, so do not retry blindly.
