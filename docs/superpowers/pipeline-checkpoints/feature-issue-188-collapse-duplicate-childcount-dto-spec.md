# Technical Brief: Remove Duplicate `ChildCount`/`ChildTaskCount` Field and Double-Fetch in Task Response DTO

**Date:** 2026-07-05
**Status:** Approved
**Author:** Spec Writer Agent

## 1. Overview

`TaskItemResponseDto` currently exposes two identically-valued integer fields — `ChildCount` and `ChildTaskCount` — both populated from the same computation in `TaskItemsController.MapTaskItemResponseAsync`. On the `Get(id)`, `Create`, and `Update` code paths (which don't have a pre-computed `childCounts` dictionary), this causes the full-table-scan helper `GetChildTaskCountAsync` to execute twice per request for no reason. This is a tech-debt cleanup: remove the dead `ChildCount` field end-to-end (DTO, controller, frontend types) and compute the count exactly once per item. As part of this PR, `JournalTodosController.MapTodo` will also be updated to populate `ChildTaskCount` (currently always defaults to `0` there), closing a related pre-existing gap so that `ChildTaskCount` is populated correctly everywhere `TaskItemResponseDto` is constructed. No behavior change is intended for any other consumer, since nothing in the frontend reads `.childCount`.

## 2. User Story

```
As a backend maintainer,
I want the redundant ChildCount field and its duplicate computation removed from TaskItemResponseDto,
So that task detail/list requests don't waste a full-table scan computing a value that's never consumed, and the API surface only exposes the field the frontend actually uses.
```

Acceptance criteria:
1. `TaskItemResponseDto` no longer declares a `ChildCount` property; `ChildTaskCount` remains.
2. `MapTaskItemResponseAsync` computes the child count exactly once per item (via the existing `childCounts` dictionary when supplied, otherwise a single call to `GetChildTaskCountAsync`), and assigns it only to `ChildTaskCount`.
3. All four call sites (`GetAll`, `Get`, `Create`, `Update`) continue to return correct, previously-observed `ChildTaskCount` values — verified by test and manual check.
4. `JournalTodosController.MapTodo` populates `ChildTaskCount` correctly (equal to the number of child todos) instead of leaving it at the default `0`.
5. Frontend `TaskItemViewModel` (`useTasks.ts`) and `TaskRowModel` (`TaskListRow.tsx`) no longer declare `childCount?: number`; `childTaskCount?: number` remains.
6. `src/api/client/types.gen.ts` / `sdk.gen.ts` are regenerated via `npm run gen:api` against a running backend that includes this change, and no longer contain `childCount`.
7. `dotnet test` and `npm run test -- --run` both pass with no `ChildCount`/`childCount` references remaining anywhere in source (excluding this brief and commit history), and the permanent regression-guard test (section 6a) passes.
8. Manual smoke check: task list view, task detail view, and journal todo view all display correct child counts for a parent task with children.

## 3. Data Model Changes

No data model changes required. `ChildCount`/`ChildTaskCount` are computed, request-scoped DTO fields — they are never persisted to the database, never mapped from an EF Core entity property, and have no corresponding column or migration. This is a DTO-only change; **no EF Core migration is needed** (no `dotnet ef migrations add ...` step applies here).

## 4. Backend Changes

### 4a. New/Modified Endpoints

No new endpoints and no route/method/status-code changes. The response shape of these existing endpoints changes only by removal of the `childCount` JSON property (its value was always identical to `childTaskCount`), and — for the journal todos endpoint — by `childTaskCount` becoming populated instead of always `0`:

- `GET /api/v1/TaskItems` (`GetAll`) — response array items lose `childCount`; `childTaskCount` unchanged.
- `GET /api/v1/TaskItems/{id}` (`Get`) — response loses `childCount`; `childTaskCount` unchanged, now computed once instead of twice.
- `POST /api/v1/TaskItems` (`Create`) — `201 Created` response loses `childCount`; `childTaskCount` unchanged, computed once.
- `PUT /api/v1/TaskItems/{id}` (`Update`) — `200 OK` response loses `childCount`; `childTaskCount` unchanged, computed once.
- `GET /api/v1/JournalEntries/{entryId}/todos` (`JournalTodosController.GetAll`, via `MapTodo`) — response items lose `childCount`; `childTaskCount` now correctly reflects the number of child todos instead of always `0`.

No changes to status codes (`200`, `201`, `400`, `404` remain as-is) or authorization (none is currently applied to either controller).

### 4b. Repository Changes

No repository method signatures change. `ITaskRepository.GetAllAsync()` and `GetByIdAsync()` continue to be used exactly as today. `GetChildTaskCountAsync(int taskId)` (private helper in `TaskFlow.Api/Controllers/V1/TaskItemsController.cs`, line 300) is unchanged in signature/implementation — it is simply invoked once instead of twice per item now.

**Exact refactor** of `MapTaskItemResponseAsync` (currently lines 431-456 of `TaskFlow.Api/Controllers/V1/TaskItemsController.cs`):

```csharp
private async Task<TaskItemResponseDto> MapTaskItemResponseAsync(TaskItem item, IReadOnlyDictionary<int, int>? childCounts = null)
{
    var currentJournalDate = await _repo.GetAssignedJournalDateAsync(item.Id);
    var today = DateOnly.FromDateTime(DateTime.UtcNow);
    var childTaskCount = childCounts?.GetValueOrDefault(item.Id) ?? await GetChildTaskCountAsync(item.Id);

    return new TaskItemResponseDto
    {
        Id = item.Id,
        Title = item.Title,
        Description = item.Description,
        IsComplete = item.IsComplete,
        DueDate = item.DueDate,
        Status = item.Status.ToString(),
        Priority = item.Priority.ToString(),
        ParentTaskItemId = item.ParentTaskItemId,
        CurrentJournalEntryId = item.CurrentJournalEntryId,
        FirstTaggedDate = item.FirstTaggedDate,
        LastMovedDate = await GetLastMovedDateAsync(item.Id),
        IsScheduledFuture = currentJournalDate.HasValue && currentJournalDate.Value > today,
        ChildTaskCount = childTaskCount,
        CurrentJournalDate = currentJournalDate,
        MoveCount = item.MoveCount,
        DaysTagged = GetDaysTagged(item.FirstTaggedDate, currentJournalDate)
    };
}
```

This single private method backs all four `TaskItemsController` call sites (`GetAll` line 38, `Get` line 52, `Create` line 155, `Update` line 280) — no per-call-site changes are needed; the fix is entirely local to this method. The `GetAll` path (which passes a `childCounts` dictionary) is unaffected in behavior — it already avoided the double-scan; it now simply also avoids the *duplicate* field write.

**Exact refactor** of `JournalTodosController.MapTodo` (currently lines 87-110 of `TaskFlow.Api/Controllers/V1/JournalTodosController.cs`), now in scope for this PR:

```csharp
private static TaskItemResponseDto MapTodo(TaskItem task, DateOnly? entryDate)
{
    var children = task.ChildTaskItems
        .Select(c => MapTodo(c, c.CurrentJournalEntry?.Date))
        .ToList();

    return new TaskItemResponseDto
    {
        Id = task.Id,
        Title = task.Title,
        Description = task.Description,
        IsComplete = task.IsComplete,
        DueDate = task.DueDate,
        Status = task.Status.ToString(),
        Priority = task.Priority.ToString(),
        ParentTaskItemId = task.ParentTaskItemId,
        CurrentJournalEntryId = task.CurrentJournalEntryId,
        FirstTaggedDate = task.FirstTaggedDate,
        MoveCount = task.MoveCount,
        CurrentJournalDate = entryDate,
        DaysTagged = GetDaysTagged(task.FirstTaggedDate, entryDate),
        ChildTaskCount = children.Count,
        Children = children.Count > 0 ? children : null,
    };
}
```

`children.Count` (the already-mapped recursive child list, computed once at line 89-91) is used directly rather than adding a second query/count — this keeps the fix a single-computation change, consistent with the rest of this brief, and avoids introducing an extra `task.ChildTaskItems.Count()` call when `children` already reflects that same collection.

### 4c. Validation

No new FluentValidation rules. This change does not touch request validation — `ChildCount`/`ChildTaskCount` are response-only fields, never part of a request DTO (`CreateTaskItemDto`, `UpdateTaskItemDto`, `AddJournalTodoDto`).

### 4d. Service Registration / Extensions

No changes to `Extensions/`. No new cross-cutting concern is introduced.

## 5. Frontend Changes

### 5a. API Client

`npm run gen:api` **must** be re-run after the backend change described in section 4 is deployed and reachable (the generator introspects a live OpenAPI spec). Ordering matters:
1. Merge/deploy the backend DTO change first (or run the API locally with the change via `dotnet run --project TaskFlow.Api`).
2. Run `cd TaskFlow.Web && npm run gen:api` against that running instance.
3. Confirm `src/api/client/types.gen.ts` no longer declares `childCount?: number | string;` (currently at line 110) and that `childTaskCount?: number | string;` (currently line 111) is retained.

This feature does not touch journal-*entry* endpoints in `src/api/journal.ts` (hand-written, not touched by `gen:api`); the `JournalTodosController` fix affects only the auto-generated `TaskItemResponseDto` shape consumed via `src/api/client/`, so `src/api/journal.ts` requires no manual update.

### 5b. Components

- **Modify** `TaskFlow.Web/src/components/TaskListRow.tsx`: remove `childCount?: number` (line 12) from the `TaskRowModel` type; keep `childTaskCount?: number` (line 13). No render-logic changes — neither field is currently read in this component's JSX.
- **No changes** to `TaskFlow.Web/src/pages/TaskDetailPage.tsx` — its only consumption of either field is `task.childTaskCount ?? 0` at line 114, which is unaffected.

### 5c. Hooks / Data Fetching

- **Modify** `TaskFlow.Web/src/hooks/useTasks.ts`: remove `childCount?: number` (line 21) from the `TaskItemViewModel` type; keep `childTaskCount?: number` (line 22). No query key, fetcher, or mutation logic changes — this is a type-only edit. Since `TaskItemViewModel = TaskItemResponseDto & { ... }`, once `sdk.gen`'s regenerated `types.gen.ts` drops `childCount` from `TaskItemResponseDto`, the hand-added intersection field must be dropped too or it will silently resurrect an unused optional prop.

### 5d. Routing

No routing changes.

### 5e. Styling Notes

No styling changes. This is not a journal-page UI feature (only a backend journal-todo mapping fix); no `.journal-page` CSS specificity concerns apply.

## 6. Tests Required

### 6a. Backend Tests

In `TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs` (no existing test currently asserts on either field, per codebase research — these are net-new additions, not rewrites):

- `TaskItemsControllerV1Tests` — `Get_ReturnsChildTaskCount_ComputedOnce` — mock `ITaskRepository.GetAllAsync()` (or whatever the repo abstraction backing `GetChildTaskCountAsync` calls) with `Moq`, verify it is invoked exactly once (`_mockRepo.Verify(r => r.GetAllAsync(), Times.Once)` or equivalent) when handling `Get(id)` for an item with children, to lock in the "single computation" behavior and prevent regression to a double-fetch.
- `TaskItemsControllerV1Tests` — `Get_ResponseDto_DoesNotExposeChildCount_ReflectionGuard` — **required, permanent**: reflection-based assertion that `typeof(TaskItemResponseDto).GetProperty("ChildCount")` is `null` (e.g., `typeof(TaskItemResponseDto).GetProperty("ChildCount").Should().BeNull()`), while `GetProperty("ChildTaskCount")` is not null. This is a permanent regression guard against the field being re-added later, not an optional/nice-to-have.
- `TaskItemsControllerV1Tests` — `Create_ReturnsCorrectChildTaskCount` — verify `ChildTaskCount` on the `201 Created` payload matches the actual child count for a freshly created parent/child pair.
- `TaskItemsControllerV1Tests` — `Update_ReturnsCorrectChildTaskCount` — verify `ChildTaskCount` on the `200 OK` payload after an update, for a task with existing children.
- `TaskItemsControllerV1Tests` — `GetAll_ChildTaskCount_MatchesDictionaryLookup` — confirm the `GetAll` path (which already passes `childCounts`) still produces correct `ChildTaskCount` values post-refactor (regression guard, since the shared private method is being edited).

In `TaskFlow.Api.Tests/Controllers/V1/JournalTodosControllerV1Tests.cs` (create if it does not already exist, or add to the existing file if one is found during implementation):

- `JournalTodosControllerV1Tests` — `GetAll_MapTodo_ReturnsCorrectChildTaskCount` — set up a parent todo with two child `TaskItem`s linked via `ChildTaskItems`, call `GetAll` for the journal entry, and assert the returned parent todo's `ChildTaskCount` equals `2` (not the previous default of `0`).
- `JournalTodosControllerV1Tests` — `GetAll_MapTodo_LeafTodoHasZeroChildTaskCount` — a todo with no children should have `ChildTaskCount == 0` and `Children == null`.

### 6b. Frontend Tests

- `TaskFlow.Web/src/hooks/useTasks.test.ts` — add/update a test asserting `TaskItemViewModel` objects constructed in tests do not require/reference a `childCount` field (primarily a type-level check enforced by `tsc --noEmit`; add a runtime assertion only if a test currently constructs a fixture object with `childCount` — codebase research found none referencing it, so no rewrite is strictly needed, but confirm via `npx tsc --noEmit` that no test fixture spreads a `childCount` prop that would now fail structural typing under `exactOptionalPropertyTypes`, if enabled).
- `TaskFlow.Web/src/components/TaskListRow.test.tsx` — add a regression test rendering a row with only `childTaskCount` set (no `childCount`) confirming existing display behavior (e.g., child progress badge / count rendering, if any) is unaffected. Per findings, no current test renders on either field, so this is a new test, not a rewrite.
- Run `npx tsc --noEmit` as part of verification — this is the primary safety net for a type-only removal, since TypeScript will flag any remaining reference to `.childCount` across the frontend.

### 6c. Coverage Impact

This is a net reduction in code (one duplicate line removed from `MapTaskItemResponseAsync`) combined with one new assignment line in `JournalTodosController.MapTodo`, plus two duplicate type declarations removed from frontend. No new branches are introduced. Adding the backend tests in 6a (the "invoked once" verification, the permanent reflection guard, and the new `JournalTodosControllerV1Tests` cases) adds coverage rather than risking it. Expect coverage percentage to hold steady or improve slightly; unlikely to jeopardize the 75% backend / 80% frontend CI gates.

## 7. Files That Will Change

**New files:**
- `TaskFlow.Api.Tests/Controllers/V1/JournalTodosControllerV1Tests.cs` — only if no such test file currently exists; otherwise this becomes a modified file (verify during implementation).

**Modified files:**
- `TaskFlow.Api/DTOs/TaskItemResponseDto.cs` — remove `public int ChildCount { get; set; }` (line 19); keep `ChildTaskCount`.
- `TaskFlow.Api/Controllers/V1/TaskItemsController.cs` — refactor `MapTaskItemResponseAsync` (lines 431-456) to compute the child count once into a local variable and assign only `ChildTaskCount`.
- `TaskFlow.Api/Controllers/V1/JournalTodosController.cs` — update `MapTodo` (lines 87-110) to set `ChildTaskCount = children.Count`.
- `TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs` — add tests per section 6a, including the required permanent reflection-based regression guard.
- `TaskFlow.Api.Tests/Controllers/V1/JournalTodosControllerV1Tests.cs` — add/update tests per section 6a for the `MapTodo` fix.
- `TaskFlow.Web/src/hooks/useTasks.ts` — remove `childCount?: number` (line 21) from `TaskItemViewModel`.
- `TaskFlow.Web/src/components/TaskListRow.tsx` — remove `childCount?: number` (line 12) from `TaskRowModel`.
- `TaskFlow.Web/src/hooks/useTasks.test.ts` / `TaskFlow.Web/src/components/TaskListRow.test.tsx` — add tests per section 6b.

**Auto-generated (do not manually edit):**
- `TaskFlow.Web/src/api/client/types.gen.ts` — `childCount?: number | string;` (currently line 110) removed automatically once `npm run gen:api` is re-run against the updated backend.
- `TaskFlow.Web/src/api/client/sdk.gen.ts` — regenerated alongside `types.gen.ts`; no direct `childCount` reference expected here but regenerate together per convention.

## 8. Risks & Concerns

1. **Risk:** `TaskItemResponseDto` is a shared response shape used by both `TaskItemsController.MapTaskItemResponseAsync` and `JournalTodosController.MapTodo`. Removing `ChildCount` is safe for both (neither controller's other usages reference it), but any future code that reflects over all properties of `TaskItemResponseDto` (e.g., a generic serializer test or a "no unexpected null properties" test) could break if it enumerated `ChildCount` explicitly.
   **Likelihood:** Low
   **Mitigation:** Grep for `nameof(TaskItemResponseDto` and `.ChildCount` across the whole solution before merging to confirm no other reflection-based or explicit references exist.

2. **Risk:** Frontend enum/field casing gotcha is not directly applicable here since `ChildTaskCount`/`childTaskCount` is a plain integer, not a status enum — but this DTO also carries `Status`/`Priority` string fields (PascalCase from `.ToString()`). Any test fixture touched incidentally during this cleanup must continue using PascalCase (`'Completed'`, not `'completed'`) if fixture objects are edited.
   **Likelihood:** Low
   **Mitigation:** Do not touch `Status`/`Priority` fixtures as part of this change; scope edits strictly to `childCount`/`ChildCount`.

3. **Risk:** `gen:api` regeneration requires a running backend with the change already applied; if a developer regenerates against a stale (pre-change) local API instance, `types.gen.ts` will still contain `childCount`, silently reintroducing the dead field and masking the fix.
   **Likelihood:** Medium
   **Mitigation:** Explicitly sequence the work per section 5a — merge/run backend change first, then regenerate, and diff `types.gen.ts` before committing to confirm `childCount` is gone.

4. **Risk:** Fixing `JournalTodosController.MapTodo` to populate a previously-always-`0` `ChildTaskCount` is a behavior change (not purely a dead-code removal) for any journal-view UI that happens to read `childTaskCount` on todo items. Per codebase research, no current frontend code reads `childTaskCount` on journal todo items specifically (`TaskDetailPage.tsx` is the only consumer, and it's on the task-detail path, not the journal-todo path) — but this should be re-verified during implementation in case a journal component renders it that wasn't caught in the original research pass.
   **Likelihood:** Low
   **Mitigation:** Grep the journal-related components (`src/pages/JournalPage*`, `src/components/Journal*`) for `childTaskCount` usage before merging; if found, confirm the newly-correct (non-zero) value doesn't produce an unexpected UI change, and note it in the PR description as an intentional fix rather than a regression.

5. **Risk (resolved):** Whether an external consumer depends on the `childCount` JSON key. Confirmed: no known external consumer exists (single self-hosted primary user, no public API contract). This is a non-issue and requires no further confirmation or mitigation.

## 9. Open Questions

None remain. All three previously open questions have been resolved:
1. `JournalTodosController.MapTodo` gap — resolved: fix is in scope for this PR (see sections 4b, 6a, 7, 10).
2. Reflection-based regression guard — resolved: required, permanent addition (see section 6a).
3. External consumer dependency on `childCount` — resolved: no known external consumer; safe to remove (see section 8, risk 5).

## 10. Implementation Order (Suggested)

1. Update `TaskFlow.Api/DTOs/TaskItemResponseDto.cs` to remove `ChildCount`.
2. Refactor `MapTaskItemResponseAsync` in `TaskFlow.Api/Controllers/V1/TaskItemsController.cs` to compute the count once (per section 4b).
3. Fix `MapTodo` in `TaskFlow.Api/Controllers/V1/JournalTodosController.cs` to set `ChildTaskCount = children.Count` (per section 4b).
4. Add/update backend tests: `TaskItemsControllerV1Tests.cs` (including the required permanent reflection-guard test) and `JournalTodosControllerV1Tests.cs` (per section 6a); run `dotnet test` and `dotnet format --verify-no-changes`.
5. Merge/run the backend change locally (`dotnet run --project TaskFlow.Api`), then run `cd TaskFlow.Web && npm run gen:api` to regenerate `types.gen.ts`/`sdk.gen.ts`; diff to confirm `childCount` is gone and no other unrelated changes leaked in.
6. Update `TaskFlow.Web/src/hooks/useTasks.ts` and `TaskFlow.Web/src/components/TaskListRow.tsx` to drop `childCount?: number`.
7. Add/update frontend tests (section 6b); run `npx tsc --noEmit` and `npm run test -- --run --coverage`.
8. Grep journal-related frontend components for any `childTaskCount` usage (per section 8, risk 4) to confirm the now-correct journal-todo count doesn't surface an unexpected UI change.
9. Manually verify task list view, task detail view, and journal todo view all show correct child counts (per acceptance criterion 8).
10. Open PR on a `bugfix/` branch (per repo convention), referencing issue #188, noting both the DTO cleanup and the `JournalTodosController.MapTodo` fix are included in this single PR.
