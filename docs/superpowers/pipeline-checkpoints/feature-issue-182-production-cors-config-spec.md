# Technical Brief: Production CORS Configuration Missing (Issue #182)

**Date:** 2026-07-04
**Status:** Approved

## 1. Overview

The production API config (`TaskFlow.Api/appsettings.json`, since no `appsettings.Production.json` currently exists) has no `Cors` section, and `CorsServiceExtensions.GetConfiguredOrigins()` returns an empty array when the section is absent. Because both `AddCorsPolicy()` registration and the `app.UseCorsPolicy()` middleware call in `Program.cs` are gated on `origins.Length > 0`, CORS middleware is never registered in a real production deployment — cross-origin requests from the frontend silently fail with no `Access-Control-Allow-Origin` header. This fix adds a new `TaskFlow.Api/appsettings.Production.json` file that supplies `Cors:AllowedOrigins` with the production origin, activating the existing (already-correct) CORS logic. No code changes to `CorsServiceExtensions.cs` or `Program.cs` are needed.

## 2. User Story

```
As the TaskFlow frontend running at https://taskflow.skalaforge.com,
I want the production API to respond to cross-origin requests with a valid Access-Control-Allow-Origin header,
So that the browser does not block API calls and the app functions correctly in production.
```

Acceptance criteria:
1. `TaskFlow.Api/appsettings.Production.json` exists and contains a `Cors:AllowedOrigins` array with exactly `["https://taskflow.skalaforge.com"]`.
2. When the API runs with `ASPNETCORE_ENVIRONMENT=Production`, `CorsServiceExtensions.GetConfiguredOrigins()` returns a non-empty array containing `https://taskflow.skalaforge.com`.
3. When running with `ASPNETCORE_ENVIRONMENT=Production`, `builder.Services.AddCorsPolicy(...)` is invoked (not skipped) and `app.UseCorsPolicy()` is invoked, per the existing conditional logic in `Program.cs`.
4. A manual `curl` request with `Origin: https://taskflow.skalaforge.com` against a Production-environment instance of the API returns an `Access-Control-Allow-Origin: https://taskflow.skalaforge.com` response header.
5. No other environment's behavior changes: `appsettings.Development.json`'s existing `Cors:AllowedOrigins` (`http://localhost:5173`, `http://localhost:3000`) is untouched, and the base `appsettings.json` is untouched.
6. All existing tests in `TaskFlow.Api.Tests/Extensions/CorsServiceExtensionsTests.cs` continue to pass unmodified.

## 3. Data Model Changes

None.

## 4. Backend Changes

No changes to `TaskFlow.Api/Extensions/CorsServiceExtensions.cs` and no changes to `Program.cs`. The existing conditional logic (`GetConfiguredOrigins` → length check → `AddCorsPolicy`/`UseCorsPolicy`) is correct as written; it simply has never been fed a non-empty origin list in Production.

The only change is a new **configuration file**:

`TaskFlow.Api/appsettings.Production.json` (new file), following the same JSON shape/indentation as `appsettings.Development.json`:

```json
{
  "Cors": {
    "AllowedOrigins": [
      "https://taskflow.skalaforge.com"
    ]
  }
}
```

Keep this minimal — only the `Cors` section is needed. Do not duplicate `ConnectionStrings`, `OpenTelemetry`, or `Logging` sections from `appsettings.json` here. No `.csproj` or `Dockerfile` changes needed — `Microsoft.NET.Sdk.Web` automatically globs and copies all `appsettings.*.json` files as content on publish.

## 5. Frontend Changes

None. `TaskFlow.Web/openapi-ts.config.ts` already has `baseUrl: false`, so the generated client uses relative paths and never hardcodes an absolute origin — this is the safeguard from the earlier CORS fix (commit `672ec49`) and remains sufficient.

## 6. Tests Required

Existing `TaskFlow.Api.Tests/Extensions/CorsServiceExtensionsTests.cs` (5 tests) requires no changes.

**New test (required):** `GetConfiguredOrigins_WhenLoadedFromProductionAppsettings_ShouldReturnProductionOrigin` — builds an `IConfiguration` via `new ConfigurationBuilder().SetBasePath(...).AddJsonFile("appsettings.json").AddJsonFile("appsettings.Production.json").Build()` (mirroring how `WebApplication.CreateBuilder` layers files) and asserts `CorsServiceExtensions.GetConfiguredOrigins(configuration)` returns exactly `["https://taskflow.skalaforge.com"]`. Use `AppContext.BaseDirectory` combined with a relative path to the sibling `TaskFlow.Api` project directory for `SetBasePath`, consistent with the existing `ProjectReference`. Verify it passes via `dotnet test` from the repo root (matches how CI invokes tests).

A full HTTP integration test (`WebApplicationFactory<Program>`) is out of scope — no such test infrastructure exists yet in `TaskFlow.Api.Tests.csproj`, and adding it would be disproportionate for this fix. End-to-end verification is manual (see Implementation Order step 4).

**No CI changes** — manual curl verification only, no new `ci.yml` smoke-test step.

## 7. Files That Will Change

**New:**
- `TaskFlow.Api/appsettings.Production.json`

**Modified:**
- `docs/DEPLOYMENT.md` — update "Configuration Files" section (~lines 229-233) to reflect that `appsettings.Production.json` now exists, replacing "(optional)" wording.
- `TaskFlow.Api.Tests/Extensions/CorsServiceExtensionsTests.cs` — add the new test.

## 8. Risks & Concerns

1. New `appsettings.Production.json` is silently ignored if `ASPNETCORE_ENVIRONMENT=Production` isn't actually set in the real deploy repo — already confirmed it is; call this out in the PR description anyway.
2. Single-origin list means any future subdomain/`www` variant is silently blocked by CORS — acceptable per confirmed decision, not a blocker.
3. `appsettings.Production.json` could drift from other appsettings files over time — mitigated by keeping it minimal (CORS-only).
4. No enum/PascalCase risk — this fix doesn't touch status/enum fields.
5. Don't conflate with the unrelated hardcoded Seq API key issue (`OpenTelemetry:Header`) — out of scope.
6. The new file-loading test's base-path resolution could be fragile across environments — mitigate with `AppContext.BaseDirectory`-relative path, verify via `dotnet test` from repo root before opening PR.

## 9. Open Questions

None remaining — all resolved:
- CI smoke test: manual verification only, no `ci.yml` changes.
- Configuration-loading test: included in this PR as required.
- `docs/DEPLOYMENT.md` update: bundled into this PR.

## 10. Implementation Order

1. Create `TaskFlow.Api/appsettings.Production.json` with the `Cors:AllowedOrigins` section.
2. Locally verify: `dotnet build`, confirm the file appears in `TaskFlow.Api/bin/Debug/net10.0/`.
3. Add `GetConfiguredOrigins_WhenLoadedFromProductionAppsettings_ShouldReturnProductionOrigin` test; run `dotnet test --filter "FullyQualifiedName~CorsServiceExtensionsTests"`.
4. Manually verify end-to-end: run with `ASPNETCORE_ENVIRONMENT=Production` set, then `curl -i -H "Origin: https://taskflow.skalaforge.com" http://localhost:8080/api/v1/TaskItems` and confirm `Access-Control-Allow-Origin: https://taskflow.skalaforge.com` header is present.
5. Update `docs/DEPLOYMENT.md`'s "Configuration Files" section.
6. Run `dotnet format --verify-no-changes` and full `dotnet test` locally.
7. Open PR against `main` from `feature/issue-182-production-cors-config`, referencing issue #182, with curl verification output in the PR description.

## Context / Scope Notes (not part of original spec-writer output)

- Issue #183 (OTel endpoint) was investigated and closed as already-resolved in real production (verified directly against `nevridge/taskflow-deploy`'s docker-compose.yml). Not part of this branch's scope.
- Follow-up issue #203 opened separately to reconcile the stale `docker-compose.prod.yml` in this repo with the real GitOps deploy repo.
- `docker-compose.prod.yml` and the `nevridge/taskflow-deploy` repo are NOT touched by this fix.
