# taskflow-assistant

A [Claude Code](https://code.claude.com) plugin that helps you manage your **own work tasks and projects** in a local [TaskFlow](https://github.com/nevridge/TaskFlow) instance. It works from any folder, in the terminal and in the Claude Code desktop app.

It bundles:

- **An MCP server** (`src/TaskFlow.Mcp`, C# / .NET 10, stdio) wrapping the TaskFlow REST API.
- **An agent**, `work-task-assistant`, for delegated task work.
- **Four skills** for interactive workflows (all user-invoked, nothing runs on its own):

| Command | What it does |
|---|---|
| `/taskflow-assistant:plan-my-day [date or project]` | Reviews the journal, overdue/due-soon/stale tasks, proposes a focus list, plans what you confirm |
| `/taskflow-assistant:capture-tasks [notes]` | Turns notes into tasks (project, priority, due date), creates them after you confirm |
| `/taskflow-assistant:weekly-review [from] [to]` | Summarizes the week and drafts a status update |
| `/taskflow-assistant:journal-log [what happened]` | Logs progress to the journal, linked to the right task |

Local use only: it talks to your Docker TaskFlow stack (`http://localhost:8081` by default) and has no auth, hosting or deployment story.

## Requirements

- Claude Code (checked with 2.1.292) and the .NET 10 runtime on `PATH` (`dotnet`).
- A running TaskFlow with the **Projects API** (TaskFlow PR [#221](https://github.com/nevridge/TaskFlow/pull/221) or later). Start it with `docker compose up -d` in the TaskFlow repo.

## Install

```powershell
./build.ps1                                   # publishes the server into plugin/bin (gitignored)
claude plugin marketplace add C:\code\taskflow-assistant
claude plugin install taskflow-assistant@taskflow-assistant   # user scope: every project, CLI and desktop app
```

Add the marketplace from the **local path** (as above). Claude Code then loads the plugin in place, so the published `plugin/bin` is found and your edits apply on the next session or `/reload-plugins`. A copy installed from GitHub would not contain `plugin/bin`.

The API URL comes from the plugin's `api_url` setting (default `http://localhost:8081`), which is passed to the server as `TASKFLOW_API_URL`. A blank or malformed value falls back to the default. Change it with `/plugin configure taskflow-assistant`.

Check it: `claude mcp list` should show `plugin:taskflow-assistant:taskflow ... Connected`.

## Tools

Fourteen tools, deliberately consolidated around workflows rather than one per endpoint. Tasks and projects are referred to by name; ids are returned for follow-up calls.

| Area | Tools |
|---|---|
| Projects | `list_projects`, `save_project` (create / rename / archive), `project_status` |
| Tasks | `list_tasks` (views: open, overdue, due_soon, stale, unassigned, today, completed, all; paging; concise/detailed), `get_task`, `create_tasks` (batch, partial failures reported), `update_task` (merge, complete/reopen, project move), `delete_task`, `add_task_note` |
| Journal | `get_journal` (creates the day's entry if missing), `set_journal_todos`, `add_log_entry`, `update_journal` |
| Review | `weekly_review` (read-only) |

Behaviors worth knowing:

- The TaskFlow task `PUT` is full-replace; `update_task` reads the task, merges your changes and sends the full body.
- Your local UTC offset is sent with writes, because the API's "past day" rules depend on it.
- API errors (`code` + `message`, validation lists) are returned to Claude as tool errors so it can recover. Server 5xx errors are summarized without leaking stack traces.
- The API has no filtering or paging, so views, paging and aggregation happen in the server. Results are compact by default to stay under Claude Code's MCP output limits (warning at 10k tokens, cap 25k).

## Develop

```powershell
dotnet test TaskFlow.Assistant.sln
dotnet format TaskFlow.Assistant.sln --verify-no-changes
claude plugin validate ./plugin
claude plugin validate .                      # the marketplace
claude --plugin-dir ./plugin                  # try it for one session without installing
```

Tests stub the HTTP layer; a reflection test also guards the tool surface (exact tool set, every tool and parameter described, read-only/destructive flags).

## Known issues

- `update_journal` with `summary` fails with a 500 when the day has planned tasks. This is a TaskFlow API bug (`JournalEntryRepository.UpdateAsync` re-inserts the entry's todo join rows), not the MCP server. Adding **notes** works. Until it is fixed in TaskFlow, prefer notes.
- Subagents cannot ask questions mid-run, so the agent proposes and reports rather than confirming; the interactive confirm-then-write flows live in the skills.

## Sources

Built from the official docs, checked 2026-10-09 against Claude Code 2.1.292:

- Plugins: <https://code.claude.com/docs/en/plugins>, [manifest reference](https://code.claude.com/docs/en/plugins-reference), [create](https://code.claude.com/docs/en/plugins/create), [loading](https://code.claude.com/docs/en/plugins/loading), [create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [Subagents](https://code.claude.com/docs/en/sub-agents), [Skills](https://code.claude.com/docs/en/skills), [MCP](https://code.claude.com/docs/en/mcp)
- MCP C# SDK: <https://github.com/modelcontextprotocol/csharp-sdk> (`ModelContextProtocol` 2.2.0; docs/concepts)
- Tool design: Anthropic, [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)

Deliberate choices and deviations:

- Skills use `disable-model-invocation: true`: they write data, and keeping them out of Claude's context until invoked keeps the plugin's always-on cost small (~360 tokens, per `claude plugin details`).
- Plugin-bundled MCP tools are named `mcp__plugin_taskflow-assistant_taskflow__<tool>` (verified); the agent and skills use that form. The agent's `tools` uses the server-level name.
- Only `McpException` messages reach the model (the SDK replaces other exceptions with a generic message), so every API failure is translated to one.
