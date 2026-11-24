# CI jobs by area

Read in full by the feature-factory orchestrator when a stage in `../SKILL.md` says to, and by `backend-builder`, `frontend-builder`, `assistant-builder` and `test-verifier` before they run gates.

`.github/workflows/ci.yml` is the source for every command and threshold; this table only says who runs each job. Root build files are listed in `template-brief.md` ("The areas"), the only list of them. For which CI job runs for a diff, this table wins. The Outcome table (`outcome-table.md`) still decides how each reply is routed.

| ci.yml job | Owner | Runs when | Note |
|---|---|---|---|
| `lint` | api | the diff touches api or a root build file | `dotnet format TaskFlow.sln` |
| `build` | api | the diff touches api or a root build file | `dotnet build TaskFlow.sln` |
| `test` | api | the diff touches api or a root build file | `TaskFlow.Api.Tests`, with the coverage threshold; holds `ContractsProjectTests` |
| `mcp-integration` | test-verifier | the diff touches api (including `TaskFlow.Contracts/` and `TaskFlow.Mcp.Integration.Tests/`), a root build file or assistant | `TaskFlow.Mcp.Integration.Tests` references `TaskFlow.Api` and the assistant MCP project |
| `assistant` | assistant | the diff touches assistant, `TaskFlow.Contracts/` or root `global.json` (it selects the assistant's test runner) | run from `assistant/`; `TaskFlow.Assistant.sln` builds `TaskFlow.Contracts` and its tests assert on it |
| `taskflow-web` | web | the diff touches web | run from `TaskFlow.Web/` |
| `smoke-test` | CI-only | never run by builders or the verifier | runs `docker compose up -d` and `down -v` against the default compose project, which locally is the live stack; CLAUDE.md says to rebuild the live stack only from `main` and that `-p taskflow-test` is mandatory |
