Stage: backend-complete
Backend agent ID: ae8528689660c5766
API contract: No changes — existing GET /api/v1/journal/{entryId}/todos endpoint unchanged; response shape unchanged
Files modified:
  - TaskFlow.Api/Repositories/JournalEntryRepository.cs — AsNoTracking() on GetAllAsync, GetByIdAsync, GetByDateAsync, GetTodosAsync
  - TaskFlow.Api.Tests/Repositories/JournalEntryRepositoryTests.cs — 2 tests migrated InMemory→SQLite, 1 new regression test added
