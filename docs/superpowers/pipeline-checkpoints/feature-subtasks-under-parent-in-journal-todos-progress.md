Stage: backend-complete
Backend agent ID: ae8528689660c5766
API contract: No changes — existing GET /api/v1/journal/{entryId}/todos endpoint unchanged; response shape unchanged
Files modified:
  - TaskFlow.Api/Repositories/JournalEntryRepository.cs — AsNoTracking() on GetAllAsync, GetByIdAsync, GetByDateAsync, GetTodosAsync
  - TaskFlow.Api.Tests/Repositories/JournalEntryRepositoryTests.cs — 2 tests migrated InMemory→SQLite, 1 new regression test added

Stage: frontend-complete
Frontend agent ID: ae77efa75abdbe4b3
Files modified:
  - TaskFlow.Web/src/components/journal/TodosSection.tsx — remove button condition fixed: !childIsFuture → child.currentJournalDate === isoDate
  - TaskFlow.Web/src/components/journal/TodosSection.test.tsx — 7 new tests: null/undefined/past-dated child no remove button, same-day child has remove button, edit child path, empty children array
