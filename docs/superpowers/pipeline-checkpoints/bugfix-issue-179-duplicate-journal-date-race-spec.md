# Technical Brief: Fix Unhandled DuplicateJournalDateException Race in TaskItemsController

**Date:** 2026-07-04
**Status:** Draft
**Author:** Spec Writer Agent

## 1. Overview

`TaskItemsController.AssignToJournalDateAsync` performs a get-or-create lookup against `IJournalEntryRepository` when a task is created with a `JournalDate`. Under concurrent requests targeting the same not-yet-existing date, `IJournalEntryRepository.AddAsync` throws `DuplicateJournalDateException` on the unique-constraint violation, and this controller has no catch for it — resulting in an unhandled exception and a 500 response, even though the task record itself was already successfully persisted. This fix adds a catch block that re-fetches the now-existing journal entry and completes the task-to-entry link, so task creation succeeds instead of surfacing an error to the caller.

## 2. User Story

```
As a TaskFlow user creating tasks concurrently (e.g., from multiple browser tabs or a flaky client retry),
I want task creation with a journal date to succeed even when two requests race to create the same day's journal entry,
So that I never see a spurious 500 error for an operation that should transparently succeed.
```

Acceptance criteria:
1. When `_journalRepo.AddAsync` throws `DuplicateJournalDateException` inside `AssignToJournalDateAsync`, the exception is caught and does not propagate to the controller action or ASP.NET Core's default error pipeline.
2. On catching the exception, the method re-fetches the journal entry for the same date via `GetByDateAsync` and calls `AddTodoAsync` using the re-fetched entry's `Id` (not the stale/discarded entry reference from the failed `AddAsync` call).
3. `TaskItemsController.Create` still returns `201 Created` (`CreatedAtRoute`) with the task response DTO in this race scenario — the caller sees a normal successful task creation.
4. `AddTodoAsync` is invoked exactly once, with the re-fetched entry's `Id`, the task's `Id`, and the original `timezoneOffsetMinutes` value.
5. `JournalEntriesController.Create`'s existing 409-on-race behavior is unchanged (out of scope — that endpoint's caller explicitly asked to create a journal entry, so a conflict is the correct signal there).

## 3. Data Model Changes

No data model changes required. This is a pure control-flow fix in existing controller code; no new entities, fields, indexes, or migrations are involved.

## 4. Backend Changes

### 4a. New/Modified Endpoints

No new endpoints and no change to the public contract of `POST /api/v1/TaskItems`. The response shape, status codes, and route name (`GetTaskV1`) for `TaskItemsController.Create` are unchanged. The only behavioral change is that a previously-possible 500 response (under the race condition) is eliminated and replaced with the normal 201 success path.

### 4b. Repository Changes

No repository changes. `IJournalEntryRepository.GetByDateAsync`, `AddAsync`, and `AddTodoAsync` are used exactly as they exist today; no new methods or signature changes are needed.

### 4c. Validation

No new FluentValidation rules. This fix is exception-handling/control-flow only.

### 4d. Service Registration / Extensions

No changes to `Extensions/`. No new service registrations are required.

### Exact code change

File: `TaskFlow.Api/Controllers/V1/TaskItemsController.cs`, replacing the private method at lines 397–412.

**Current (buggy) implementation:**
```csharp
private async Task AssignToJournalDateAsync(int taskId, DateOnly journalDate, int? timezoneOffsetMinutes = null)
{
    if (_journalRepo is null)
    {
        return;
    }

    var entry = await _journalRepo.GetByDateAsync(journalDate)
        ?? await _journalRepo.AddAsync(new JournalEntry
        {
            Title = $"Journal {journalDate:MM-dd-yyyy}",
            Date = journalDate,
        });

    await _journalRepo.AddTodoAsync(entry.Id, taskId, timezoneOffsetMinutes);
}
```

**Fixed implementation:**
```csharp
private async Task AssignToJournalDateAsync(int taskId, DateOnly journalDate, int? timezoneOffsetMinutes = null)
{
    if (_journalRepo is null)
    {
        return;
    }

    JournalEntry entry;
    try
    {
        entry = await _journalRepo.GetByDateAsync(journalDate)
            ?? await _journalRepo.AddAsync(new JournalEntry
            {
                Title = $"Journal {journalDate:MM-dd-yyyy}",
                Date = journalDate,
            });
    }
    catch (DuplicateJournalDateException)
    {
        // A concurrent request created the entry for this date between our
        // GetByDateAsync miss and our AddAsync call. The row now exists —
        // re-fetch it and continue attaching the task to it. Unlike
        // JournalEntriesController.Create, the caller here only asked to
        // create a task, so we must not surface a 409 for this race.
        var existing = await _journalRepo.GetByDateAsync(journalDate);
        if (existing is null)
        {
            // Should not happen: the exception only fires on a unique
            // constraint violation, meaning a row for this date was just
            // committed by the concurrent request. Defensive guard only.
            return;
        }

        entry = existing;
    }

    await _journalRepo.AddTodoAsync(entry.Id, taskId, timezoneOffsetMinutes);
}
```

## 5. Frontend Changes

No frontend changes needed. This is a backend-only fix; the public API contract, response shapes, and status codes for `POST /api/v1/TaskItems` are unchanged, so `npm run gen:api` does not need to be re-run and no hand-written API modules (including `src/api/journal.ts`) require updates.

### 5a. API Client
Not applicable — no endpoint contract change.

### 5b. Components
Not applicable — no UI change.

### 5c. Hooks / Data Fetching
Not applicable — no UI change.

### 5d. Routing
Not applicable.

### 5e. Styling Notes
Not applicable.

## 6. Tests Required

### 6a. Backend Tests

Add to `TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs`, alongside the existing `Create_ShouldAssignToJournalDate_WhenJournalDateIsProvided` test (around line 234). Use the `SetupSequence` convention already established in `JournalEntriesControllerV1Tests.Create_ShouldReturnConflict_WhenUniqueRaceOccurs`, but assert success (not conflict) since `TaskItemsController.Create`'s caller only asked to create a task.

```csharp
[Fact]
public async Task Create_ShouldSucceedAndAttachToExistingEntry_WhenJournalDateRaceOccurs()
{
    var targetDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
    var createDto = new CreateTaskItemDto
    {
        Title = "Racy task",
        JournalDate = targetDate
    };

    var createdTask = new TaskItem
    {
        Id = 88,
        Title = "Racy task",
        Status = Status.Todo
    };
    var existingEntry = new JournalEntry { Id = 21, Date = targetDate, Title = "Journal" };

    _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
        .ReturnsAsync(new ValidationResult());
    _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);
    _mockRepo.Setup(r => r.GetByIdAsync(88)).ReturnsAsync(createdTask);

    // First call: no entry exists yet (triggers the AddAsync attempt below).
    // Second call: after the race is caught, the re-fetch finds the entry
    // the concurrent request just committed.
    _mockJournalRepo.SetupSequence(r => r.GetByDateAsync(targetDate))
        .ReturnsAsync((JournalEntry?)null)
        .ReturnsAsync(existingEntry);
    _mockJournalRepo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>()))
        .ThrowsAsync(new DuplicateJournalDateException(targetDate));
    _mockJournalRepo.Setup(r => r.AddTodoAsync(existingEntry.Id, createdTask.Id, null))
        .ReturnsAsync(AddTodoResult.Success);

    var result = await _controller.Create(createDto);

    result.Result.Should().BeOfType<CreatedAtRouteResult>();
    _mockJournalRepo.Verify(r => r.AddTodoAsync(existingEntry.Id, createdTask.Id, null), Times.Once);
    _mockJournalRepo.Verify(r => r.GetByDateAsync(targetDate), Times.Exactly(2));
}
```

Notes on this test:
- `TimezoneOffsetMinutes` is omitted from `createDto`, so the third `AddTodoAsync` argument is `null` — matches the existing `Create_ShouldAssignToJournalDate_WhenJournalDateIsProvided` pattern's use of the two-arg overload; here it's made explicit as `null` since `AssignToJournalDateAsync` always passes `timezoneOffsetMinutes` through. Confirm against the `IJournalEntryRepository.AddTodoAsync` signature — since it has a default parameter (`int? timezoneOffsetMinutes = null`), Moq requires the setup's argument list to match how the SUT actually calls it (three args, third being `null`), which it does since `AssignToJournalDateAsync` explicitly passes `timezoneOffsetMinutes` through.
- This mirrors the naming convention of existing tests in this file (`Create_Should<Outcome>_When<Condition>`).

### 6b. Frontend Tests

Not applicable — backend-only fix with no frontend surface area.

### 6c. Coverage Impact

The new code path (catch block, re-fetch, defensive null guard) is small (roughly 10 new lines) and is fully exercised by the new test, including the exception path and the success path. This should have a negligible-to-positive effect on the 75% backend line coverage gate — no reduction in coverage is expected, and the previously-untested exception branch becomes covered.

## 7. Files That Will Change

**New files:**
- None.

**Modified files:**
- `TaskFlow.Api/Controllers/V1/TaskItemsController.cs` — `AssignToJournalDateAsync` (lines 397–412) wrapped in try/catch for `DuplicateJournalDateException`, re-fetching via `GetByDateAsync` and continuing to `AddTodoAsync` with the re-fetched entry's `Id`.
- `TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs` — new test `Create_ShouldSucceedAndAttachToExistingEntry_WhenJournalDateRaceOccurs`.

**Auto-generated (do not manually edit):**
- None affected — no API contract change, so `src/api/client/sdk.gen.ts` does not need regeneration.

## 8. Risks & Concerns

1. **Risk:** The defensive `existing is null` guard in the catch block is theoretically unreachable (the exception only fires on a unique constraint violation, meaning a row was just committed), but if it ever were null, the method would silently return without linking the task to any journal entry.
   **Likelihood:** Low
   **Mitigation:** Recommend keeping the defensive null check (not a null-forgiving operator `!`) exactly as specified above rather than assuming non-null, since a silent early return is strictly safer than an `Object reference not set` `NullReferenceException` in an edge case triggered by unpredictable race timing. This preserves the invariant that `AssignToJournalDateAsync` never throws and never blocks task creation, at the cost of the task very rarely ending up unlinked from any journal entry. This should not be "fixed" with `!` — do not suppress the null check.

2. **Risk:** `AddTodoAsync`'s own internal race handling (it can return `AddTodoResult.AlreadyLinked`, `PastDayNotAllowed`, etc.) is already ignored by the controller today — this fix does not change that. If the re-fetched entry is for a past day (e.g., the concurrent request's entry commit crossed a day boundary right at midnight), `AddTodoAsync` could still silently no-op.
   **Likelihood:** Low
   **Mitigation:** Explicitly out of scope per the issue and researcher findings — this is a pre-existing, separate concern not introduced or worsened by this fix. Flagging here only for visibility; no action required in this PR.

3. **Risk:** No enum/PascalCase serialization concerns apply to this fix — `DuplicateJournalDateException` and `AddTodoResult` are not exposed to the frontend as string status fields in this code path.
   **Likelihood:** N/A
   **Mitigation:** None needed; noted for completeness per project convention.

4. **Risk:** Since there's no global exception middleware in `Program.cs`, any other unhandled exception type thrown by `_journalRepo.AddAsync` in the future (not just `DuplicateJournalDateException`) would still surface as an unhandled 500 from this method.
   **Likelihood:** Low
   **Mitigation:** Out of scope for this issue — the researcher confirmed this is the only latent instance of the *specific* `DuplicateJournalDateException` bug in the codebase. A broader "should there be global exception middleware" discussion is a separate, larger architectural change and should be tracked as its own issue if desired (see Open Questions).

## 9. Open Questions

None. Per the finalized researcher findings, the scope, exact code location, exception type, repository contract, and test conventions are all confirmed with no ambiguity remaining. One adjacent-but-explicitly-out-of-scope item worth flagging to the product owner (not blocking this fix): whether `TaskItemsController.Create` should surface/log when `AddTodoAsync` returns a non-`Success` result (e.g., `PastDayNotAllowed`) instead of silently ignoring it — this is pre-existing behavior unrelated to issue #179 and should be filed as a separate issue if desired.

## 10. Implementation Order (Suggested)

1. Modify `AssignToJournalDateAsync` in `TaskFlow.Api/Controllers/V1/TaskItemsController.cs` per the exact code change in Section 4.
2. Add the new test `Create_ShouldSucceedAndAttachToExistingEntry_WhenJournalDateRaceOccurs` to `TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs`.
3. Run `dotnet test --filter "FullyQualifiedName~TaskItemsControllerV1Tests"` to confirm the new test passes and no existing tests in the file regress (particularly `Create_ShouldAssignToJournalDate_WhenJournalDateIsProvided` and `Create_ShouldForwardTimezoneOffsetToAddTodoAsync_WhenJournalDateIsToday`, which exercise the non-race happy path through the same method).
4. Run `dotnet format --verify-no-changes` to satisfy CI formatting checks.
5. Run full `dotnet test` with coverage to confirm the 75% line coverage gate is unaffected.
6. Manually verify with two concurrent `POST /api/v1/TaskItems` requests targeting the same new (non-existent) journal date, confirming both return `201 Created` and both tasks end up linked to the same single journal entry (per the issue's manual verification request).
7. Open PR on a `bugfix/` branch (e.g., `bugfix/journal-date-race-task-creation`) referencing issue #179.

---

**Relevant files read during research:**
- `/home/neil_/dev/TaskFlow/TaskFlow.Api/Controllers/V1/TaskItemsController.cs`
- `/home/neil_/dev/TaskFlow/TaskFlow.Api/Controllers/V1/JournalEntriesController.cs`
- `/home/neil_/dev/TaskFlow/TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs`
- `/home/neil_/dev/TaskFlow/TaskFlow.Api/Repositories/AddTodoResult.cs`
- `/home/neil_/dev/TaskFlow/TaskFlow.Api/Models/DuplicateJournalDateException.cs`
