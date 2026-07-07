Stage: backend-complete
Backend agent ID: a28024d2be5ffabe9
API contract: No API contract changes. Internal refactor only — GET /api/v1/TaskItems and GET /api/v1/JournalEntries/{entryId}/todos continue returning TaskItemResponseDto with identical DaysTagged (int) values.
Files modified:
- TaskFlow.Api/Helpers/DaysTaggedHelper.cs (new)
- TaskFlow.Api.Tests/Helpers/DaysTaggedHelperTests.cs (new)
- TaskFlow.Api/Controllers/V1/TaskItemsController.cs (modified)
- TaskFlow.Api/Controllers/V1/JournalTodosController.cs (modified)
Commit: bbf2045
