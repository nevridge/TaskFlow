Stage: backend-complete
Backend agent ID: a7b2f15f0152b42a5
API contract: No new/changed endpoints. Configuration-only fix — appsettings.Production.json activates existing (unmodified) conditional CORS registration/middleware logic in Program.cs when ASPNETCORE_ENVIRONMENT=Production.
Files modified:
- TaskFlow.Api/appsettings.Production.json (new)
- TaskFlow.Api.Tests/Extensions/CorsServiceExtensionsTests.cs (added GetConfiguredOrigins_WhenLoadedFromProductionAppsettings_ShouldReturnProductionOrigin test)
- docs/DEPLOYMENT.md (updated Configuration Files section)
Commit: ffcf975
Verification: dotnet build succeeded, dotnet test full suite 254/254 passed, dotnet format --verify-no-changes clean.
