# CI jobs by area

Read in full by the feature-factory orchestrator when a stage in `../SKILL.md` says to, and by `backend-builder`, `frontend-builder`, `assistant-builder` and `test-verifier` before they run gates.

`.github/workflows/ci.yml` is the source for every command and threshold; this table only says who runs each job. For which CI job runs for a diff, this table wins. The Outcome table (`outcome-table.md`) still decides how each reply is routed.

| ci.yml job | Owner | Runs when | Note |
|---|---|---|---|
| `lint` | api | the diff touches api | `dotnet format TaskFlow.sln`; `TaskFlow.sln` also covers root build files |
| `build` | api | the diff touches api | `dotnet build TaskFlow.sln`; `TaskFlow.sln` also covers root build files |
| `test` | api | the diff touches api | `TaskFlow.Api.Tests`, with the coverage threshold; holds `ContractsProjectTests` |
| `mcp-integration` | test-verifier | the diff touches api (including `TaskFlow.Contracts/` and `TaskFlow.Mcp.Integration.Tests/`) or assistant | `TaskFlow.Mcp.Integration.Tests` references `TaskFlow.Api` and the assistant MCP project |
| `assistant` | assistant | the diff touches assistant or `TaskFlow.Contracts/` | run from `assistant/`; `TaskFlow.Assistant.sln` builds `TaskFlow.Contracts` and its tests assert on it |
| `taskflow-web` | web | the diff touches web | run from `TaskFlow.Web/` |
| `smoke-test` | CI-only | never run by builders or the verifier | runs `docker compose up -d` and `down -v` against the default compose project, which locally is the live stack; CLAUDE.md says to rebuild the live stack only from `main` and that `-p taskflow-test` is mandatory |
