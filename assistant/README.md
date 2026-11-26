# TaskFlow MCP server

Lives in the `assistant/` folder of the [TaskFlow](https://github.com/nevridge/TaskFlow) repo. Run the commands below from that folder.

A local stdio MCP server (`src/TaskFlow.Mcp`, C# / .NET 11, `ModelContextProtocol` 2.4.0) over the TaskFlow REST API, used from Claude Desktop and Claude Code. It helps you manage your own work tasks and projects, from any folder.

Local use only: it talks to your Docker TaskFlow stack (`http://localhost:8081` by default) and has no auth, hosting or deployment story.

## Requirements

- The .NET 11 runtime on `PATH` (`dotnet`).
- Claude Desktop and/or Claude Code.
- A running TaskFlow with the **Projects API** (TaskFlow PR [#221](https://github.com/nevridge/TaskFlow/pull/221)) and the journal update fix ([#224](https://github.com/nevridge/TaskFlow/pull/224); without it, `update_journal` with `summary` returns a 500 on days that have planned tasks). Both are merged to `main`. Start it with `docker compose up -d --build` in the TaskFlow repo.

## Install: build

```powershell
./build.ps1   # publishes the server into mcp/bin (gitignored)
```

Rebuild after server changes.

Stop running servers first: disable `taskflow` in `/mcp` and quit Claude Desktop. The `/mcp` toggle is recorded per project, so also disable it in, or close, Claude Code sessions open in other projects. Enable it again after the build.

If a server is still running, the build stops and lists each blocking process id and its parent. A blocked or failed build leaves the old `mcp/bin` in place.

## Install: Claude Desktop

1. **Quit Claude Desktop completely** (tray icon > Quit). It rewrites its config while running, so the script refuses to edit it while the app is open. Quitting also stops the server process Claude Desktop started, which would otherwise block the build.
2. Register the server: `./scripts/install-claude-desktop.ps1` (add `-ApiUrl http://host:port` if TaskFlow is not on `localhost:8081`; `-DryRun` previews, `-Uninstall` removes). It merges a `taskflow` entry into `%APPDATA%\Claude\claude_desktop_config.json`, keeps your other settings and saves a timestamped backup next to it.
3. Start Claude Desktop. In a chat, the **+** menu's connectors list should show `taskflow` with 22 tools. If not, open **Settings > Developer** in Claude Desktop (log locations differ between the Microsoft Store and installer versions; on the Store version no MCP log files appeared under `%APPDATA%\Claude\logs`). You can also confirm the app started the server with `Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" | Where-Object CommandLine -match 'TaskFlow.Mcp.dll'`.

## Install: Claude Code

```powershell
claude mcp add taskflow --scope user --env TASKFLOW_API_URL=http://localhost:8081 -- dotnet C:\code\TaskFlow\assistant\mcp\bin\TaskFlow.Mcp.dll
```

The path is for a clone at `C:\code\TaskFlow`, and the URL is the default; adjust either if yours differs. A blank or malformed URL falls back to the default.

Check it: `claude mcp list` should show `taskflow` as connected, and `claude mcp get taskflow` shows the stored command, args and env.

To change the URL or path, run `claude mcp remove taskflow --scope user`, then add it again. Adding a name that already exists in the same scope fails, and a `taskflow` entry in local or project scope takes precedence over the user-scope one.

## Both registrations

- The standalone CLI does not read `claude_desktop_config.json`, so Claude Code needs its own `claude mcp add`.
- The desktop app also loads its `claude_desktop_config.json` servers into local Code tab sessions, so such a session sees two definitions named `taskflow`. **Both must hold the same API URL**, or a session could read and write a different TaskFlow instance from the one you expect.
- Claude Desktop keeps its own URL: re-run `./scripts/install-claude-desktop.ps1` with `-ApiUrl` to change it.

## Tools

Twenty-two tools, deliberately consolidated around workflows rather than one per endpoint. Tasks, projects, areas and goals are referred to by name; ids are returned for follow-up calls.

Claude Code names the tools `mcp__taskflow__<tool>`.

| Area | Tools |
|---|---|
| Areas | `list_areas` (display order; project counts include archived projects), `save_area` (create / rename), `delete_area` (`moveToArea`, `newAreaName` or `leaveProjectsWithoutArea`, with `confirmed`) |
| Projects | `list_projects`, `save_project` (create / rename / archive; `area` takes an area name or id, omit to keep it, empty string or `none` to remove it), `project_status` |
| Goals | `list_goals` (a project's goals: Now, Next in order, Parked, Done and Dropped, with counts), `save_goal` (create / edit, status changes, `position` among Next goals), `swap_now`, `delete_goal` (with `confirmed`) |
| Tasks | `list_tasks` (views: open, overdue, due_soon, stale, unassigned, today, blocked, completed, all; `completedFrom`, `completedTo`, `plannedDate`; `goal`; paging; concise/detailed), `get_task`, `create_tasks` (batch, partial failures reported, possible-duplicate warnings, `goal`), `update_task` (merge, complete/reopen, project move, `goal`, start with `status=inprogress`, block/unblock with `blockedReason`, plan on a day with `journalDate`), `update_tasks` (up to 25 updates in one call, same fields as `update_task`, failures reported per item), `delete_task`, `add_task_note` |
| Journal | `get_journal` (creates the day's entry if missing; shows a parent with an open subtask planned that day as an uncounted `Context:` line, with the subtasks beneath it; unplanned subtasks via `list_tasks`; log lines read `[task #id | Project | Priority]`), `set_journal_todos` (several tasks, and the only way to remove planning), `add_log_entry`, `update_journal` (`summary` replaces; `append=true` adds after the existing summary; `note` adds a note) |
| Review | `weekly_review` (read-only) |

Behaviors worth knowing:

- Areas group projects, and `list_projects` and `project_status` show each project's area. `delete_area` takes an area's id or exact name (not a partial name). It deletes an area with no projects immediately, even with `confirmed=false`. For an area with projects (archived ones count) it deletes nothing until a call has both `confirmed=true` and one of `moveToArea`, `newAreaName` or `leaveProjectsWithoutArea=true`; otherwise it returns the project list. `confirmed` is asserted by the model, so the permission prompt is the only check the model does not control.
- Goals live inside a project, and a project has at most one Now goal. While it has one, a task in a Next or Parked goal cannot be started or completed, and an InProgress subtask cannot be moved into the project of a parent whose goal is Next or Parked (`TASK_GOAL_NOT_NOW`). `swap_now` makes another goal Now and moves the old one to the top of Next; it is refused while the Now goal has tasks in progress (`GOAL_NOW_HAS_INPROGRESS_TASKS`). A goal with open tasks cannot be set to done or dropped (`GOAL_HAS_OPEN_TASKS`). For these codes the error also names the tasks (up to 20) or the Now goal.
- `save_goal` creates when `goal` is omitted (status next or now only; titles may repeat, so repeating the call makes a second goal) and otherwise edits, keeping omitted fields. `position` is 1-based among Next goals and is applied after the save; if that step fails, the error says the goal was saved. `delete_goal` takes an id or exact title. It deletes a goal with no tasks immediately, even with `confirmed=false`; otherwise it needs `confirmed=true`, and the tasks stay in the project with no goal.
- `goal` on `create_tasks`, `update_task` and `update_tasks` is a title or id within the task's project (`none` removes it on update and means no goal on create). Omitting it keeps the goal, but moving a task to another project clears it and giving it a parent takes the parent's goal; a subtask's goal cannot be set directly. `update_task` rejects a Done or Dropped goal, or a goal a subtask cannot take, before writing anything. If `create_tasks` creates a task but cannot assign the goal, the task stays on its `+` line with a warning. `update_task` writes fields, then project, then goal, except that joining the Now goal or leaving a goal goes first when neither project nor parent changes, so "move to Now and start" works in one call. A failure after an earlier write says what was saved and what to retry. `list_tasks` takes `goal` with `project`, or `goal=none` for Unsorted tasks.
- The TaskFlow task `PUT` is full-replace; `update_task` reads the task, merges your changes and sends the full body. With a `project`, it resolves the project before saving, so an unknown or ambiguous project changes nothing; if assigning fails after the save, the error says the task fields were saved and to retry only the project change.
- `create_tasks` flags a new task whose title equals an existing open or done task (ignoring case and extra spaces), or an earlier task in the same call, with `! Possible duplicate of #id "Title" (open|done)`. The task is still created. The check is best-effort: if existing tasks cannot be read, tasks are created anyway and the report ends with "Duplicate check skipped". Matching is exact after normalizing, not fuzzy.
- `update_journal` with `append=true` reads the day's summary and saves it plus a blank line plus the new text; it fails without saving when the total would exceed 10000 characters. It reads then writes, so an edit made in between (for example in the web app) is overwritten, and a retried append adds the text twice.
- `update_tasks` runs each item like `update_task`. Items are independent; if the API cannot be reached, the remaining items are reported as not attempted. If an item's project or goal change fails after something was saved, its `x` line says so and names what remains; retry only that.
- Statuses are Draft, Todo, InProgress, Blocked and Completed. Only a Todo task can be started, only a Todo or InProgress task can be blocked, and tasks cannot be created as Blocked. Detailed output shows `Started: <date> UTC` when the API reports a start time. Blocked tasks still count as open and are shown as `blocked: <reason> (Nd)`; `project_status` and `weekly_review` list them in their own group.
- `update_task` re-sends the task's status on every PUT, so a Blocked task stays Blocked. An omitted `blockedReason` keeps the stored reason; an empty string clears it (the task stays Blocked); `status=todo` on a Blocked task unblocks it (InProgress is restored only if the goal rule allows it, otherwise the task becomes Todo), and on an InProgress task moves it back to Todo.
- `update_task` / `update_tasks` accept `journalDate` (`today`, `tomorrow` or `yyyy-MM-dd`, today or later) to plan a task on a day in the same call; it is separate from `dueDate`. Omitting it leaves the planned day unchanged, and update cannot un-plan a task (use `set_journal_todos` with `remove`). `yesterday` is rejected locally and earlier dates by the API, and a task with open subtasks cannot be planned (Blocked counts as open), so plan its subtasks instead; a completed task cannot be planned onto a different day. The reported planned day is read back from the API; if it cannot be confirmed, the result says so.
- TaskFlow refuses some changes with a rule code: planning a task with open subtasks (`TASK_PLAN_HAS_OPEN_SUBTASKS`), an open child under a Completed parent (`TASK_PARENT_COMPLETED_NOT_ALLOWED`), changing the status of a parent with open subtasks (`TASK_PARENT_STATUS_DERIVED`), and planning a completed task onto a different day (`TASK_PLAN_COMPLETED_NOT_ALLOWED`). The error shows the API message and code plus one line of next-step guidance; in `update_tasks`, `create_tasks` and `set_journal_todos` the other items still go through.
- Your local UTC offset is sent with writes, because the API's "past day" rules depend on it.
- API errors (`code` + `message`, validation lists) are returned to Claude as tool errors so it can recover. Server 5xx errors are summarized without leaking stack traces.
- The API has no filtering or paging, so views, paging and aggregation happen in the server. Results are compact by default to stay under Claude Code's MCP output limits (warning at 10k tokens, cap 25k).

## Develop

```powershell
dotnet test --solution TaskFlow.Assistant.sln
dotnet format TaskFlow.Assistant.sln --verify-no-changes
```

Tests stub the HTTP layer; a reflection test also guards the tool surface (exact tool set, every tool and parameter described, read-only/destructive flags).

## Building features with feature-factory

Run `/feature-factory <issue-number>` from the repo; see [`.claude/skills/feature-factory/SKILL.md`](../.claude/skills/feature-factory/SKILL.md).
