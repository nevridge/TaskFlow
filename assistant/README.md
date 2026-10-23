# taskflow-assistant

Helps you manage your **own work tasks and projects** in a local [TaskFlow](https://github.com/nevridge/TaskFlow) instance, from any folder. One MCP server, two ways to use it:

| Where | How | Section |
|---|---|---|
| **Claude Desktop, Chat** | MCP server registered in `claude_desktop_config.json` + one uploaded skill | [Claude Desktop (Chat)](#claude-desktop-chat) |
| **Claude Code** (terminal, IDE extensions, the desktop app's Code tab where available) | A Claude Code plugin: MCP server + agent + four slash-command skills | [Claude Code plugin](#claude-code-plugin) |

A Claude Code plugin does **not** load in Chat: Chat ignores a plugin's local MCP servers, agents and `bin/` executables (see the [plugin support table](https://claude.com/docs/plugins/platform-support)), so Chat needs the separate setup below.

## Claude Desktop (Chat)

Needs the .NET 10 runtime on `PATH`, Claude Desktop, and TaskFlow running with the Projects API.

1. Publish the server: `./build.ps1`
2. **Quit Claude Desktop completely** (tray icon > Quit). It rewrites its config while running, so the script refuses to edit it while the app is open.
3. Register the server: `./scripts/install-claude-desktop.ps1` (add `-ApiUrl http://host:port` if TaskFlow is not on `localhost:8081`; `-DryRun` previews, `-Uninstall` removes). It merges a `taskflow` entry into `%APPDATA%\Claude\claude_desktop_config.json`, keeps your other settings and saves a timestamped backup next to it.
4. Start Claude Desktop. In a chat, the **+** menu's connectors list should show `taskflow` with 14 tools. If not, open **Settings > Developer** in Claude Desktop (log locations differ between the Microsoft Store and installer versions; on the Store version no MCP log files appeared under `%APPDATA%\Claude\logs`). You can also confirm the app started the server with `Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" | Where-Object CommandLine -match 'TaskFlow.Mcp.dll'`.
5. Package and upload the skill: `./scripts/package-chat-skill.ps1`, then in Claude Desktop go to **Customize > Skills > + > Upload a skill** and choose `dist/taskflow-assistant-skill.zip`.

Chat applies the skill automatically when your request fits ("plan my day", "turn these notes into tasks", "draft my weekly update"); there are no slash commands in Chat. Skills need code execution enabled for your account; if your organization disables it, paste `chat/taskflow-assistant/SKILL.md` into a Project's instructions instead. The skill lives in `chat/taskflow-assistant/` and mirrors the plugin's four skills, restricted to the frontmatter keys Chat accepts.

## Claude Code plugin

A [Claude Code](https://code.claude.com) plugin for the terminal and IDEs.

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
- A running TaskFlow with the **Projects API** (TaskFlow PR [#221](https://github.com/nevridge/TaskFlow/pull/221)) and the journal update fix ([#224](https://github.com/nevridge/TaskFlow/pull/224); without it, `update_journal` with `summary` returns a 500 on days that have planned tasks). Both are merged to `main`. Start it with `docker compose up -d --build` in the TaskFlow repo.

## Install

```powershell
./build.ps1                                   # publishes the server into plugin/bin (gitignored)
claude plugin marketplace add C:\code\taskflow-assistant
claude plugin install taskflow-assistant@taskflow-assistant   # user scope: every project in Claude Code
```

This is for Claude Code only. The Chat part of Claude Desktop does not read it; use the [Chat setup](#claude-desktop-chat).

Add the marketplace from the **local path** (as above). Claude Code then loads the plugin in place, so the published `plugin/bin` is found and your edits apply on the next session or `/reload-plugins`. A copy installed from GitHub would not contain `plugin/bin`.

The API URL comes from the plugin's `api_url` setting (default `http://localhost:8081`), which is passed to the server as `TASKFLOW_API_URL`. A blank or malformed value falls back to the default. Change it with `/plugin configure taskflow-assistant`.

Check it: `claude mcp list` should show `plugin:taskflow-assistant:taskflow ... Connected`.

## Tools

Fourteen tools, deliberately consolidated around workflows rather than one per endpoint. Tasks and projects are referred to by name; ids are returned for follow-up calls.

| Area | Tools |
|---|---|
| Projects | `list_projects`, `save_project` (create / rename / archive), `project_status` |
| Tasks | `list_tasks` (views: open, overdue, due_soon, stale, unassigned, today, blocked, completed, all; paging; concise/detailed), `get_task`, `create_tasks` (batch, partial failures reported), `update_task` (merge, complete/reopen, project move, block/unblock with `blockedReason`), `delete_task`, `add_task_note` |
| Journal | `get_journal` (creates the day's entry if missing), `set_journal_todos`, `add_log_entry`, `update_journal` |
| Review | `weekly_review` (read-only) |

Behaviors worth knowing:

- The TaskFlow task `PUT` is full-replace; `update_task` reads the task, merges your changes and sends the full body.
- Statuses are Draft, Todo, Blocked and Completed. Only a Todo task can be blocked, and tasks cannot be created as Blocked. Blocked tasks still count as open and are shown as `blocked: <reason> (Nd)`; `project_status` and `weekly_review` list them in their own group.
- `update_task` re-sends the task's status on every PUT, so a Blocked task stays Blocked. An omitted `blockedReason` keeps the stored reason; an empty string clears it (the task stays Blocked); `status=todo` unblocks.
- Blocked support needs the TaskFlow API change [#311](https://github.com/nevridge/TaskFlow/issues/311) deployed. Plugin 0.2.0 ships prompts that rely on it, so do not publish or tag this release until #311 is live on your API. The server is published with `build.ps1` into `plugin/bin`, so the plugin version and the server ship together.
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

### Building features with feature-factory

Open Claude Code in this repo (on `main` it creates a `feature/` branch for you; otherwise use a `feature/` or `bugfix/` branch) and ask it to build a feature, or run `/feature-factory <issue-number>`. It walks the issue through research, story, brief, documentation advisors, build, verification and a PR, with three approval stops (story, brief, final review). A story groomed with `/groom-issue` skips the story stop. An open dependency on another repo's issue or PR (for example a TaskFlow API change) stops the run until you say "proceed anyway".

It needs the user-level agents `story-writer`, `codebase-researcher` and `spec-writer` in `~/.claude/agents/`. The skill is `.claude/skills/feature-factory/SKILL.md` and its agents are in `.claude/agents/`.

## Known issues

- Subagents cannot ask questions mid-run, so the agent proposes and reports rather than confirming; the interactive confirm-then-write flows live in the skills.

## Sources

Built from the official docs, checked 2026-10-09 against Claude Code 2.1.292:

- Plugins: <https://code.claude.com/docs/en/plugins>, [manifest reference](https://code.claude.com/docs/en/plugins-reference), [create](https://code.claude.com/docs/en/plugins/create), [loading](https://code.claude.com/docs/en/plugins/loading), [create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [Subagents](https://code.claude.com/docs/en/sub-agents), [Skills](https://code.claude.com/docs/en/skills), [MCP](https://code.claude.com/docs/en/mcp)
- Claude Desktop Chat: [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [MCPB](https://github.com/modelcontextprotocol/mcpb) (not used: a config-file entry was chosen over a one-click extension), [plugin support by surface](https://claude.com/docs/plugins/platform-support), [Using Skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
- MCP C# SDK: <https://github.com/modelcontextprotocol/csharp-sdk> (`ModelContextProtocol` 2.2.0; docs/concepts)
- Tool design: Anthropic, [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)

Deliberate choices and deviations:

- Skills use `disable-model-invocation: true`: they write data, and keeping them out of Claude's context until invoked keeps the plugin's always-on cost small (~360 tokens, per `claude plugin details`).
- Plugin-bundled MCP tools are named `mcp__plugin_taskflow-assistant_taskflow__<tool>` (verified); the agent and skills use that form. The agent's `tools` uses the server-level name.
- Only `McpException` messages reach the model (the SDK replaces other exceptions with a generic message), so every API failure is translated to one.
