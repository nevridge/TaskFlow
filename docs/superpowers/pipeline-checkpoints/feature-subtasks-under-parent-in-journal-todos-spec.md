# Technical Brief: Fix EF Core Identity Map Bug in GetTodosAsync (Subtask Nesting Broken)

**Date:** 2026-06-03
**Status:** Approved
**Branch:** feature/subtasks-under-parent-in-journal-todos

## 1. Overview

PR #172 introduced subtask nesting in the journal todos list, but post-merge verification confirmed the feature is completely broken at runtime. The root cause is an EF Core identity map collision in `GetTodosAsync`: when both a parent `TaskItem` and its child `TaskItem` are linked to the same `JournalEntry` via the `JournalEntryTaskItem` join table, EF Core deduplicates both rows to the same tracked object instance. The child's scalar FK properties (`ParentTaskItemId`, `CurrentJournalEntryId`) read as `null` on the shared instance, causing the nesting logic in `JournalTodosController.GetAll` to collapse entirely — every task appears as an orphaned root item and no children are ever rendered. The fix is a one-line `.AsNoTracking()` call on each of the four read methods in `JournalEntryRepository`, with corresponding test infrastructure adjustments to ensure the regression scenario is covered properly. All callers of these methods are confirmed read-only; no write path is affected.

## 2. User Story

As a journal user, I want subtasks to appear nested under their parent task in the journal todos list, so that I can see the hierarchical relationship between tasks without manual deduction.

**Acceptance criteria:**
1. When a parent `TaskItem` and one or more of its children are both linked to the same `JournalEntry`, the GET response lists only the parent at the root level; children appear in the parent's `Children` array.
2. When a child `TaskItem` is linked to the same `JournalEntry` as its parent, the child does not also appear as a standalone root-level todo.
3. When a child `TaskItem` is linked to a different `JournalEntry` than its parent (or not linked at all), it still appears correctly nested under the parent if the parent is present, and its `CurrentJournalDate` reflects the child's own entry date (or `null`).
4. When only a parent is linked (no child linked to any entry), children with `null` `CurrentJournalEntryId` still appear nested under the parent in the response.
5. A `TaskItem` whose `ParentTaskItemId` is not `null` but whose parent is not in the current entry's todo list is excluded from the root list (orphan suppression continues to work).
6. No change to API contract: response shape, route, HTTP status codes, and field names are unchanged.

## 3. Data Model Changes

No data model changes required. The bug is exclusively in the query layer. No data corruption occurred in production — no migration or data cleanup is needed.

## 4. Backend Changes

### 4a. New/Modified Endpoints
No endpoint changes.

### 4b. Repository Changes

**File:** `TaskFlow.Api/Repositories/JournalEntryRepository.cs`

Add `.AsNoTracking()` to all four read methods immediately after the `DbSet` reference, before any `.Include()` calls. Applies to entire query (all include chains).

- `GetTodosAsync` (~line 112) — primary fix; add comment explaining identity map collision prevention
- `GetAllAsync` (~line 14) — same fix; affects Todos + LogEntries chains
- `GetByIdAsync` (~line 23) — same fix
- `GetByDateAsync` (~line 31) — same fix

Add comment above each: `// Read-only query: AsNoTracking prevents identity map collisions on ChildTaskItems when both a parent and its child are linked to the same JournalEntry.`

**Write methods (`AddAsync`, `UpdateAsync`, `DeleteAsync`, `AddTodoAsync`, `RemoveTodoAsync`, `TodoExistsAsync`) must NOT be changed.**

### 4c. Validation / Extensions
No changes required.

## 5. Frontend Changes

None. Backend-only fix. API contract unchanged. `src/api/journal.ts` and `sdk.gen.ts` need no updates.

## 6. Tests Required

### InMemory vs. SQLite note
The EF Core InMemory provider does not reproduce the identity map collision. Regression tests for this bug **must use `CreateSqliteContext()`**.

### Tests to migrate (InMemory → SQLite)
- `GetTodosAsync_ShouldIncludeChildTaskItems_WhenParentIsInEntry`
- `GetTodosAsync_ShouldIncludeCurrentJournalEntry_OnChildTaskItems`

Use `await using var _ = connection; await using var __ = context;` disposal pattern.

### New test
**`GetTodosAsync_ShouldNestChild_WhenBothParentAndChildLinkedToSameEntry`** (SQLite)
- Setup: create JournalEntry; create parent TaskItem and child TaskItem with `ParentTaskItemId = parent.Id`; call `AddTodoAsync` for both against same entry
- Assert 1: returned list has exactly one root-level item (the parent)
- Assert 2: `parentTodo.ChildTaskItems` contains exactly one entry with `Id == child.Id`
- Assert 3: child's `ParentTaskItemId` is not null and equals `parent.Id`

### Controller tests
No changes needed — all 16 tests in `JournalTodosControllerV1Tests.cs` use Moq and don't exercise EF Core.

## 7. Files That Will Change

- `TaskFlow.Api/Repositories/JournalEntryRepository.cs` — `.AsNoTracking()` on 4 read methods
- `TaskFlow.Api.Tests/Repositories/JournalEntryRepositoryTests.cs` — 2 tests migrated to SQLite + 1 new test added

## 8. Implementation Order

1. Write regression test first (red phase) — confirm it fails without the fix
2. Apply `.AsNoTracking()` fix to `GetTodosAsync`
3. Verify new test goes green
4. Apply fix to `GetAllAsync`, `GetByIdAsync`, `GetByDateAsync`
5. Migrate two existing InMemory tests to SQLite
6. `dotnet test` — all passing
7. Coverage check ≥75%
8. Push + PR referencing identity map root cause and post-merge verification report
