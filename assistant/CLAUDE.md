# CLAUDE.md

## Commands

- Run from `assistant/`. Verify with `dotnet test --solution TaskFlow.Assistant.sln` (Microsoft.Testing.Platform, selected by the root `global.json`) and `dotnet format TaskFlow.Assistant.sln --verify-no-changes`. Name the solution; `dotnet` alone is ambiguous.
- After changing `plugin/**` or `chat/**`, also run `claude plugin validate ./plugin` and `claude plugin validate .`. CI does not run these (they need the Claude Code CLI), so they are a manual gate.
- `build.ps1` only publishes the server into `plugin/bin` for the plugin to run. It is not a check.
- Use Bash for `git`, `gh` and `dotnet`. Under Git Bash, prefix commands that pass `/p:` MSBuild properties with `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"`.

## Keep these in sync

Every workflow under `plugin/skills/` (`plugin/skills/*/SKILL.md`) has a matching file in `chat/taskflow-assistant/references/` (`*.md`), so each workflow exists twice. When an MCP tool name, parameter or behavior changes, update both sets, `plugin/agents/work-task-assistant.md`, `chat/taskflow-assistant/SKILL.md` and the README tool list in the same change. A reflection test guards the tool surface; update it deliberately.

## The TaskFlow API is in the same repo

`TaskFlowApiClient` and `ApiModels` are hand-written against `TaskFlow.Api/` one folder up, not generated. A feature that needs an API change can ship the API change and the client change in one PR; otherwise check the linked TaskFlow issue or PR before building on it. This folder has its own solution and `Directory.Build.props`; the root `CLAUDE.md` covers the rest of the repo.
