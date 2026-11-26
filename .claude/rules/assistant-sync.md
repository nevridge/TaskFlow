---
paths:
  - TaskFlow.Api/**
  - assistant/**
  - TaskFlow.Contracts/**
---

# Keep the README tool list in sync

When an MCP tool is added, removed or renamed, or its parameters or behavior change (including through an API or `TaskFlow.Contracts` change), update the tool list in `assistant/README.md` in the same change. `TaskFlowApiClient` and `ApiModels` are hand-written against `TaskFlow.Api/`, so an API change ships with its client change in one PR. A reflection test guards the tool surface; update it deliberately. A `TaskFlow.Contracts/` change (error codes, status, priority) also needs the assistant solution to build, because `TaskFlow.Assistant.sln` builds Contracts. `ErrorCodeCoverageTests` asserts that every `ErrorCodes` value has a ToolGuard guidance string or a justified `NoMessageNeeded` entry; update both in the same change.
