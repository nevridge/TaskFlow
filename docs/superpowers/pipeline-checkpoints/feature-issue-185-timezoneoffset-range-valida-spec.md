# Technical Brief: Range Validation for `TimezoneOffsetMinutes` in `AddJournalTodoDtoValidator`

**Date:** 2026-07-05
**Status:** Approved (pending human gate)
**Issue:** #185

## 1. Overview

`AddJournalTodoDtoValidator` currently validates only `TaskItemId`, leaving `TimezoneOffsetMinutes` completely unchecked despite it feeding directly into the "today" calculation used by `JournalEntryRepository.AddTodoAsync` to enforce the past-day-not-allowed rule. A garbage value (e.g. `999999`) is silently accepted, shifting `DateTime.UtcNow` by that many minutes and producing a nonsensical "today" that can bypass or falsely trigger the past-day check. This fix adds a bounded range rule matching real-world UTC offsets (UTC-12:00 to UTC+14:00), applied only when a value is supplied, since the field is nullable and `null` legitimately means "no offset, use UTC."

## 2. User Story

```
As an API consumer (the TaskFlow frontend, or any future client) calling the add-journal-todo endpoint,
I want the server to reject clearly invalid TimezoneOffsetMinutes values,
So that the "today" calculation used for the past-day-not-allowed rule can never be corrupted by garbage input.
```

Acceptance criteria:
1. `AddJournalTodoDtoValidator` rejects any `TimezoneOffsetMinutes` value less than `-720` or greater than `840`, with `IsValid == false` and an error on the `TimezoneOffsetMinutes` property.
2. `AddJournalTodoDtoValidator` accepts `-720` and `840` (inclusive boundaries) as valid.
3. `AddJournalTodoDtoValidator` accepts `null` for `TimezoneOffsetMinutes` (unchanged behavior — no offset supplied).
4. `TaskItemId` validation behavior is unchanged (still `GreaterThan(0)`).
5. No changes are made to `CreateTaskItemDto`/`UpdateTaskItemDto` validators — out of scope for this issue.
6. New unit tests cover the failing, passing, and null cases described in Section 6a.
7. `dotnet format --verify-no-changes` and `dotnet test` both pass in CI.

## 3. Data Model Changes

None. Pure validation-layer fix; no entities, migrations, or schema touched.

## 4. Backend Changes

### 4a. New/Modified Endpoints

No endpoint changes. `JournalTodosController.AddTodo()` (the single call site for `AddJournalTodoDto`) is unaffected in route, request/response shape, or status codes — only validation behavior changes. A request with an out-of-range `TimezoneOffsetMinutes` now receives `400 Bad Request` via the standard FluentValidation pipeline.

### 4b. Repository Changes

None. `JournalEntryRepository.AddTodoAsync(int entryId, int taskItemId, int? timezoneOffsetMinutes = null)` is unchanged.

### 4c. Validation

Modify `TaskFlow.Api/Validators/AddJournalTodoDtoValidator.cs`:

```csharp
using FluentValidation;
using TaskFlow.Api.DTOs;

namespace TaskFlow.Api.Validators;

public class AddJournalTodoDtoValidator : AbstractValidator<AddJournalTodoDto>
{
    public AddJournalTodoDtoValidator()
    {
        RuleFor(x => x.TaskItemId).GreaterThan(0).WithMessage("TaskItemId must be greater than 0.");

        RuleFor(x => x.TimezoneOffsetMinutes)
            .InclusiveBetween(-720, 840)
            .WithMessage("TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00).")
            .When(x => x.TimezoneOffsetMinutes.HasValue);
    }
}
```

### 4d. Service Registration / Extensions

None required — validators are auto-discovered via `AddValidatorsFromAssemblyContaining`.

## 5. Frontend Changes

None in scope. No API contract changes; `npm run gen:api` does not need to be re-run.

## 6. Tests Required

### 6a. Backend Tests

Modify `TaskFlow.Api.Tests/Validators/AddJournalTodoDtoValidatorTests.cs`, adding (existing `TaskItemId` tests unchanged):

- `Validate_ShouldFail_WhenTimezoneOffsetMinutesIsOutOfRange` — `[Theory]` with `[InlineData(-721)]`, `[InlineData(841)]`, optionally `[InlineData(999999)]`; asserts `IsValid` false and a single error on `TimezoneOffsetMinutes` with message `"TimezoneOffsetMinutes must be between -720 and 840 (UTC-12:00 to UTC+14:00)."`. Use valid `TaskItemId` (e.g. `1`).
- `Validate_ShouldPass_WhenTimezoneOffsetMinutesIsWithinRange` — `[Theory]` with `[InlineData(-720)]`, `[InlineData(840)]`, `[InlineData(0)]`; asserts `IsValid` true.
- `Validate_ShouldPass_WhenTimezoneOffsetMinutesIsNull` — `[Fact]`; `TimezoneOffsetMinutes = null`, valid `TaskItemId`; asserts `IsValid` true.

Conventions: xUnit `[Theory]`/`[Fact]`, FluentAssertions, async/await via `_validator.ValidateAsync(...)`, Arrange-Act-Assert.

### 6b. Frontend Tests

None required.

### 6c. Coverage Impact

Single `RuleFor` chain (~4 lines), fully exercised by new tests across all branches. Net-positive coverage delta; no risk to 75% backend line-coverage gate.

## 7. Files That Will Change

**Modified files:**
- `TaskFlow.Api/Validators/AddJournalTodoDtoValidator.cs`
- `TaskFlow.Api.Tests/Validators/AddJournalTodoDtoValidatorTests.cs`

No new files, no auto-generated files affected.

## 8. Risks & Concerns

1. **Existing callers sending out-of-range values will now get 400.** Likelihood low — legitimate JS-computed offsets are always within `[-720, 840]` magnitude. No mitigation needed beyond tests.
2. **Scope creep temptation** — `CreateTaskItemDto`/`UpdateTaskItemDto` share the same unvalidated field. Explicitly out of scope for #185; do not touch in this PR.
3. Enum/PascalCase gotcha does not apply — this touches only an `int?` field.

## 9. Open Questions

None.

## 10. Implementation Order

1. Add the `InclusiveBetween(-720, 840)` rule with `.When(...)` to `AddJournalTodoDtoValidator.cs`.
2. Add the three new test methods to `AddJournalTodoDtoValidatorTests.cs`.
3. Run `dotnet test --filter "FullyQualifiedName~AddJournalTodoDtoValidatorTests"`.
4. Run `dotnet format --verify-no-changes`.
5. Run full `dotnet test` suite to confirm no regressions.
