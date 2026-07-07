Stage: backend-complete
Backend agent ID: a8f44767d02ab8922
API contract: TaskItemResponseDto (returned from GET/POST/PUT /api/v1/TaskItems, GET /api/v1/JournalEntries/{entryId}/todos) no longer includes ChildCount in the JSON payload — only ChildTaskCount is present. This field is now populated correctly and consistently everywhere the DTO is constructed, including the journal-todos endpoint (previously silently defaulted to 0 there). No other shape or endpoint changes.
Files modified:
- TaskFlow.Api/DTOs/TaskItemResponseDto.cs (removed ChildCount property)
- TaskFlow.Api/Controllers/V1/TaskItemsController.cs (MapTaskItemResponseAsync computes count once)
- TaskFlow.Api/Controllers/V1/JournalTodosController.cs (MapTodo now sets ChildTaskCount = children.Count)
- TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs (5 new tests incl. permanent reflection guard)
- TaskFlow.Api.Tests/Controllers/V1/JournalTodosControllerV1Tests.cs (2 new tests)
Commit: f15c0ef
