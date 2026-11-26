# CLAUDE.md

## Commands

- Run from `assistant/`. Verify with `dotnet test --solution TaskFlow.Assistant.sln` (Microsoft.Testing.Platform, selected by the root `global.json`) and `dotnet format TaskFlow.Assistant.sln --verify-no-changes`. Name the solution; `dotnet` alone is ambiguous.
- Under Git Bash, prefix commands that pass `/p:` MSBuild properties with `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"`.

`TaskFlowApiClient` and `ApiModels` are hand-written against `TaskFlow.Api/` one folder up, not generated.
