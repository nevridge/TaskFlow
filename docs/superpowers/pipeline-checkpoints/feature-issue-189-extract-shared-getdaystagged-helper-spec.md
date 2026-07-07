# Technical Brief: Extract Shared GetDaysTagged Helper

**Date:** 2026-07-05
**Status:** Approved

## 1. Overview

`TaskItemsController` and `JournalTodosController` each contain a byte-for-byte identical private static method, `GetDaysTagged(DateOnly? firstTaggedDate, DateOnly? currentJournalDate)`, which computes the number of days a task has been tagged in the journal. This is a pure code-deduplication refactor: extract the logic into a single shared static helper class and update both controllers to call it, with zero change to behavior, request/response contracts, or the database schema.

## 2. User Story

```
As a maintainer of the TaskFlow.Api codebase,
I want the DaysTagged calculation to live in exactly one place,
So that future changes to the formula only need to be made once, and the two controllers stay in sync by construction.
```

Acceptance criteria:
1. A single public static helper method exists that computes `DaysTagged` given a nullable `firstTaggedDate` and a nullable `currentJournalDate`, with logic identical to the current duplicated implementations.
2. `TaskItemsController.cs` no longer contains a private `GetDaysTagged` method; its call site calls the new shared helper instead.
3. `JournalTodosController.cs` no longer contains a private `GetDaysTagged` method; its call site calls the new shared helper instead.
4. All existing tests pass unchanged, including `JournalTodosControllerV1Tests.GetAll_ShouldComputeDaysTagged_ForChildIndependently`, which asserts `DaysTagged == 3` for `firstTaggedDate = 2026-05-08`, `currentJournalDate = 2026-05-10`.
5. No API response shape, HTTP status code, or DTO field changes as a result of this refactor.
6. A minimal dedicated unit test class for the new helper exists, covering: both dates present (normal case), `firstTaggedDate` null, `currentJournalDate` null, both null.

## 3. Data Model Changes

None.

## 4. Backend Changes

### 4a. New/Modified Endpoints

None — internal refactor only. `GET /api/v1/TaskItems` and `GET /api/v1/JournalEntries/{entryId}/todos` continue to return `TaskItemResponseDto` with identical `DaysTagged` values.

### 4b. Repository Changes

None.

### 4c. Validation

None.

### 4d. Service Registration / Extensions

None — the new helper is a plain static class (like `TaskFlow.Api.Providers.JsonSerializerOptionsProvider`), not DI-registered.

**New helper class** — following the existing `Providers/` convention for standalone static utility classes (there is no `Helpers/`, `Utils/`, or `Common/` folder in the project today; this introduces the first `Helpers/` folder):

`TaskFlow.Api/Helpers/DaysTaggedHelper.cs`

```csharp
namespace TaskFlow.Api.Helpers;

public static class DaysTaggedHelper
{
    public static int GetDaysTagged(DateOnly? firstTaggedDate, DateOnly? currentJournalDate)
    {
        if (!firstTaggedDate.HasValue || !currentJournalDate.HasValue)
        {
            return 0;
        }

        return Math.Max(0, currentJournalDate.Value.DayNumber - firstTaggedDate.Value.DayNumber + 1);
    }
}
```

Call site updates:
- `TaskItemsController.cs`: change `DaysTagged = GetDaysTagged(item.FirstTaggedDate, currentJournalDate)` to `DaysTagged = DaysTaggedHelper.GetDaysTagged(item.FirstTaggedDate, currentJournalDate)`. Add `using TaskFlow.Api.Helpers;`.
- `JournalTodosController.cs`: change `DaysTagged = GetDaysTagged(task.FirstTaggedDate, entryDate)` to `DaysTagged = DaysTaggedHelper.GetDaysTagged(task.FirstTaggedDate, entryDate)`. Add `using TaskFlow.Api.Helpers;`.

## 5. Frontend Changes

None. No API contract change — `TaskItemResponseDto.DaysTagged` (`int`) is populated identically before and after.

## 6. Tests Required

### 6a. Backend Tests

- `JournalTodosControllerV1Tests.GetAll_ShouldComputeDaysTagged_ForChildIndependently` — existing, must pass unchanged.
- `TaskItemsControllerV1Tests` — existing DTO-shape assertions must continue to pass unchanged.
- New: `TaskFlow.Api.Tests/Helpers/DaysTaggedHelperTests.cs` (mirrors `Providers/JsonSerializerOptionsProviderTests.cs` convention):
  - `GetDaysTagged_ShouldReturnPositiveCount_WhenBothDatesPresentAndCurrentIsAfterFirstTagged` — `firstTaggedDate = 2026-05-08`, `currentJournalDate = 2026-05-10` → expect `3`.
  - `GetDaysTagged_ShouldReturnZero_WhenFirstTaggedDateIsNull`
  - `GetDaysTagged_ShouldReturnZero_WhenCurrentJournalDateIsNull`
  - `GetDaysTagged_ShouldReturnZero_WhenBothDatesAreNull`
  - `GetDaysTagged_ShouldReturnOne_WhenBothDatesAreEqual` (boundary case: same day → `Max(0, 0 + 1) = 1`)

### 6b. Frontend Tests

Not applicable.

### 6c. Coverage Impact

Net-neutral to slightly positive for the 75% backend line-coverage gate.

## 7. Files That Will Change

**New files:**
- `TaskFlow.Api/Helpers/DaysTaggedHelper.cs`
- `TaskFlow.Api.Tests/Helpers/DaysTaggedHelperTests.cs`

**Modified files:**
- `TaskFlow.Api/Controllers/V1/TaskItemsController.cs` — remove private `GetDaysTagged`; update call site; add `using TaskFlow.Api.Helpers;`.
- `TaskFlow.Api/Controllers/V1/JournalTodosController.cs` — remove private `GetDaysTagged`; update call site; add `using TaskFlow.Api.Helpers;`.

## 8. Risks & Concerns

1. Subtle behavioral difference introduced during extraction — mitigated by copying the method body verbatim and relying on existing + new tests.
2. Namespace/using collisions — mitigated by fully qualifying `DaysTaggedHelper.GetDaysTagged(...)` at call sites.
3. `DaysTagged` is a plain `int`, not a string enum — no PascalCase enum-casing gotcha applies.
4. `dotnet format --verify-no-changes` (CI-enforced) could flag formatting in the new file/edited controllers — run `dotnet format` locally before PR.

## 9. Open Questions

None (resolved during pipeline: naming/location `Helpers/DaysTaggedHelper.cs` approved by user).

## 10. Implementation Order

1. Create `TaskFlow.Api/Helpers/DaysTaggedHelper.cs`, copied verbatim from either controller.
2. Create `TaskFlow.Api.Tests/Helpers/DaysTaggedHelperTests.cs` with the five test cases; run filtered test to confirm correctness in isolation.
3. Update `JournalTodosController.cs`: add using, remove private method, update call site; run filtered test to confirm `GetAll_ShouldComputeDaysTagged_ForChildIndependently` passes.
4. Update `TaskItemsController.cs`: add using, remove private method, update call site; run filtered test to confirm no regressions.
5. Run full suite (`dotnet test`) and `dotnet format --verify-no-changes`.
