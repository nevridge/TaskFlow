# CLAUDE.md

TaskFlow is a personal task and daily journal app: a .NET 10 REST API (`TaskFlow.Api`) and a React frontend (`TaskFlow.Web`), self-hosted via Docker and Portainer. Production runs at `taskflow.skalaforge.com`; a push to `main` deploys it automatically.

## Commands

- Frontend type-check: `cd TaskFlow.Web && npm run type-check`. This is what CI runs; plain `npx tsc --noEmit` checks nothing because `tsconfig.json` is solution-style.
- Single backend test (Microsoft.Testing.Platform): `dotnet test --project TaskFlow.Api.Tests --filter-method "<Namespace.Class.Method>"`.
- `npm run gen:api` regenerates the typed client from the live OpenAPI spec, so the API must be running.
- Isolated test stack (3200 web / 8280 API, beside the live stack; for feature branches and `/ux-test`): `docker compose -p taskflow-test -f docker-compose.test.yml up -d --build`. `-p taskflow-test` is mandatory on every command, including `down -v`. Rebuild the live stack only from `main`. Details in `docs/DOCKER_CONFIGURATION.md` ("Live vs Test Stack Workflow").
- MCP client against the real API: `dotnet test --project TaskFlow.Mcp.Integration.Tests`

## Assistant (`assistant/`)

The Claude work-assistant MCP server, plugin and Chat skill live in `assistant/`, with their own solution, `Directory.Build.props` and `.editorconfig`. The root solution references the assistant only through `TaskFlow.Mcp.Integration.Tests`. See `assistant/CLAUDE.md`.

## Safe Change Rules

- **Journal carry-forward:** creating or switching to a journal entry must never move tasks. Incomplete tasks carry forward only into the user's own today, derived from the client's timezone offset with no UTC fallback.
- **`docker-compose.yml` volume mappings:** do not modify without confirmation.
- **Generated client:** never hand-edit `src/api/client/` (including `sdk.gen.ts`); run `npm run gen:api`. It regenerates only that folder, so hand-written modules such as `src/api/journal.ts` are updated by hand.
- **Status and priority casing:** API responses are PascalCase (`'Completed'`), requests are camelCase; see `src/lib/task-status.ts`. Remove this line when #428 and #399 land.

## Branches and PRs

- Never commit or push to `main`: work on a branch and open a PR (a hook blocks the obvious cases).
- A PR needs new or updated tests.

## Deployment

The production compose file lives in `nevridge/taskflow-deploy`, not here. `docker-compose.prod.yml` in this repo is a local prod-like harness that differs from production.
