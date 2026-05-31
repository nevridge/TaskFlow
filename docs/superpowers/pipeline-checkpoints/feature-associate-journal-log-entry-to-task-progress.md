Stage: backend-complete
Backend agent ID: a4ac7a05beb869653
API contract:
  POST /api/v1/JournalEntries/{entryId}/logs
    Request: { content: string, taskItemId?: int | null }
    Response 201: JournalLogEntryResponseDto { id, content, journalEntryId, createdAt, updatedAt, taskItemId, linkedTaskTitle, linkedTaskDeleted }
    Errors: 400 (invalid content or non-existent taskItemId), 404 (entry not found)

  PUT /api/v1/JournalEntries/{entryId}/logs/{id}
    Request: { content: string, taskItemId?: int | null }
    Response 200: JournalLogEntryResponseDto
    Errors: 400, 404

  GET endpoints unchanged in route; now include taskItemId, linkedTaskTitle, linkedTaskDeleted in response.

Files modified:
  TaskFlow.Api/Models/JournalLogEntry.cs
  TaskFlow.Api/Data/TaskDbContext.cs
  TaskFlow.Api/DTOs/CreateJournalLogEntryDto.cs
  TaskFlow.Api/DTOs/UpdateJournalLogEntryDto.cs
  TaskFlow.Api/DTOs/JournalLogEntryResponseDto.cs
  TaskFlow.Api/Controllers/V1/JournalLogEntriesController.cs
  TaskFlow.Api/Repositories/JournalLogEntryRepository.cs
  TaskFlow.Api/Validators/JournalLogEntryValidator.cs
  TaskFlow.Api/Migrations/20260531000000_AddJournalLogTaskLink.cs (new)
  TaskFlow.Api/Migrations/20260531000000_AddJournalLogTaskLink.Designer.cs (new)
  TaskFlow.Api/Migrations/TaskDbContextModelSnapshot.cs
  TaskFlow.Api.Tests/Controllers/V1/JournalLogEntriesControllerV1Tests.cs
  TaskFlow.Api.Tests/Repositories/JournalLogEntryRepositoryTests.cs
  TaskFlow.Api.Tests/Validators/JournalLogEntryValidatorTests.cs
