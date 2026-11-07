---
paths:
  - TaskFlow.Api/**
  - assistant/**
---

# Keep the assistant in sync with the API

Every workflow under `assistant/plugin/skills/` (`*/SKILL.md`) has a matching file in `assistant/chat/taskflow-assistant/references/`, so each workflow exists twice. When an MCP tool name, parameter or behavior changes, or an API change alters what the tools send or receive, update both sets, `assistant/plugin/agents/work-task-assistant.md`, `assistant/chat/taskflow-assistant/SKILL.md` and the README tool list in the same change. `TaskFlowApiClient` and `ApiModels` are hand-written against `TaskFlow.Api/`, so an API change ships with its client change in one PR. A reflection test guards the tool surface; update it deliberately.
