Stage: backend-complete
Backend agent ID: a64696b52636f692b
API contract: No API contract change. Same endpoint, request, and response shape for the add-journal-todo endpoint. Only behavioral change: requests with TimezoneOffsetMinutes outside [-720, 840] now fail FluentValidation and return 400 Bad Request instead of proceeding to the repository's past-day calculation. null and in-range values are unaffected.
Files modified:
- TaskFlow.Api/Validators/AddJournalTodoDtoValidator.cs
- TaskFlow.Api.Tests/Validators/AddJournalTodoDtoValidatorTests.cs
Commit: 12b3c30
