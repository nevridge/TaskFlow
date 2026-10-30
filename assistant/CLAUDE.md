# CLAUDE.md

## Commands

- Verify with `dotnet test TaskFlow.Assistant.sln` and `dotnet format TaskFlow.Assistant.sln --verify-no-changes`. Name the solution; `dotnet` alone is ambiguous.
- After changing `plugin/**` or `chat/**`, also run `claude plugin validate ./plugin` and `claude plugin validate .`.
- `build.ps1` only publishes the server into `plugin/bin` for the plugin to run. It is not a check.
- Use Bash for `git`, `gh` and `dotnet`. Under Git Bash, prefix commands that pass `/p:` MSBuild properties with `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"`.

## Keep these in sync

Every workflow under `plugin/skills/` (`plugin/skills/*/SKILL.md`) has a matching file in `chat/taskflow-assistant/references/` (`*.md`), so each workflow exists twice. When an MCP tool name, parameter or behavior changes, update both sets, `plugin/agents/work-task-assistant.md`, `chat/taskflow-assistant/SKILL.md` and the README tool list in the same change. A reflection test guards the tool surface; update it deliberately.

## The TaskFlow API is a separate repo

`TaskFlowApiClient` and `ApiModels` are hand-written against `nevridge/TaskFlow`. A feature that needs an API change there is blocked until that change merges, so check the linked TaskFlow issue or PR first.

## Workflow

- Build features with the `feature-factory` skill. Its commit and PR rules (Conventional Commits, no `Co-Authored-By` trailer, no "Generated with Claude Code" line, `--body-file`) are in `.claude/skills/feature-factory/SKILL.md`, which is the source of truth.
- Never push to `main`; work on `feature/` or `bugfix/` branches and open a PR.
