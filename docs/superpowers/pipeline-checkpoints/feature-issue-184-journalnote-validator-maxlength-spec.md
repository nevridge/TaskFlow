# Technical Brief: JournalNoteValidator MaximumLength(2000) Cleanup

**Date:** 2026-07-05
**Status:** Draft
**Author:** Spec Writer Agent

## 1. Overview

`JournalNoteValidator` currently only enforces `NotEmpty()` on `JournalNote.Content`, unlike its two sibling validators (`NoteValidator`, `JournalLogEntryValidator`), which both cap content at 2000 characters. Since `JournalNote.Content` maps to an unbounded SQLite `TEXT` column, this inconsistency lets journal notes grow arbitrarily large while functionally identical `Note` and `JournalLogEntry` content is capped. This is a one-line validation-parity fix plus a corresponding test correction — no schema, DTO, controller, or frontend changes are in scope.

## 2. User Story

```
As a TaskFlow user,
I want journal note content to be capped at the same 2000-character limit as task notes and journal log entries,
So that journal notes behave consistently with sibling content fields and cannot grow unbounded.
```

Acceptance criteria:
1. Submitting a `JournalNote` with `Content` longer than 2000 characters fails validation with error message `"Content must not exceed 2000 characters."` on the `Content` property.
2. Submitting a `JournalNote` with `Content` of exactly 2000 characters passes validation (no `Content` errors).
3. Existing `NotEmpty` behavior (empty/whitespace content fails with `"Content is required."`) is unchanged.
4. The pre-existing test `Validate_ShouldPass_WhenContentExceeds2000Chars` (which currently asserts the old, incorrect unbounded behavior) is corrected — not deleted, not left failing.

## 3. Data Model Changes

No data model changes required. `JournalNote.Content` (`TaskFlow.Api/Models/JournalNote.cs`, line 6: `public required string Content { get; set; }`) remains an unbounded `string` mapped to `TEXT` in SQLite. The 2000-character cap is enforced only at the FluentValidation layer, matching how `Note.Content` and `JournalLogEntry.Content` are already capped without any corresponding `HasMaxLength` in EF configuration. No migration is needed.

## 4. Backend Changes

### 4a. New/Modified Endpoints

No endpoint changes. This validator is invoked wherever `JournalNote` create/update requests are validated (existing journal note endpoints in the journal controller); behavior at those endpoints changes only in that a request with `Content` over 2000 characters will now return `400 Bad Request` with a validation error instead of succeeding. No new status codes are introduced — `400` was already a possible response for empty/whitespace content.

### 4b. Repository Changes

None. This is a validation-layer-only change; no repository methods or queries are affected.

### 4c. Validation

Modify `TaskFlow.Api/Validators/JournalNoteValidator.cs` to add a `MaximumLength(2000)` rule to the existing `RuleFor(n => n.Content)` chain, matching `NoteValidator` and `JournalLogEntryValidator` exactly:

```csharp
public class JournalNoteValidator : AbstractValidator<JournalNote>
{
    public JournalNoteValidator()
    {
        RuleFor(n => n.Content)
            .NotEmpty().WithMessage("Content is required.")
            .MaximumLength(2000).WithMessage("Content must not exceed 2000 characters.");
    }
}
```

This is the only production code change for this issue.

### 4d. Service Registration / Extensions

None. `JournalNoteValidator` is already auto-discovered via `AddValidatorsFromAssemblyContaining` — no registration change needed.

## 5. Frontend Changes

No frontend changes are in scope for this issue. `npm run gen:api` does not need to be re-run since no controller/endpoint contract changes (the validator is an internal FluentValidation rule; the OpenAPI schema for `JournalNote` request bodies is unaffected). `src/api/journal.ts` requires no manual edits for this change. A frontend `maxLength` attribute on the notes textarea (in `NotesSection.tsx` or equivalent) would be a reasonable UX follow-up but is explicitly out of scope per the issue.

## 6. Tests Required

### 6a. Backend Tests

File: `TaskFlow.Api.Tests/Validators/JournalNoteValidatorTests.cs`

1. **Correct the existing false-negative test.** Replace:
   ```csharp
   Validate_ShouldPass_WhenContentExceeds2000Chars()
   ```
   (currently asserts `result.IsValid.Should().BeTrue()` for a 2001-char string — this documents pre-fix, incorrect behavior) with:
   ```csharp
   Validate_ShouldFail_WhenContentExceedsMaxLength()
   ```
   asserting, mirroring `NoteValidatorTests`:
   ```csharp
   var note = new JournalNote { Content = new string('x', 2001), JournalEntryId = 1 };
   var result = await _validator.ValidateAsync(note);
   result.IsValid.Should().BeFalse();
   result.Errors.Should().Contain(e =>
       e.PropertyName == "Content" &&
       e.ErrorMessage == "Content must not exceed 2000 characters.");
   ```
2. **Add boundary test** `Validate_ShouldPass_WhenContentIsExactly2000Characters()`:
   ```csharp
   var note = new JournalNote { Content = new string('x', 2000), JournalEntryId = 1 };
   var result = await _validator.ValidateAsync(note);
   result.IsValid.Should().BeTrue();
   result.Errors.Should().BeEmpty();
   ```

The existing tests `Validate_ShouldPass_WhenContentProvided`, `Validate_ShouldFail_WhenContentIsEmpty`, and `Validate_ShouldFail_WhenContentIsWhitespace` require no changes.

### 6b. Frontend Tests

Not applicable — no frontend code changes in this issue.

### 6c. Coverage Impact

Negligible impact on the 75% backend line coverage gate. The change adds one fluent-validation call (already exercised by the corrected/added tests) to an already-tested validator class. No new branches of meaningful complexity are introduced.

## 7. Files That Will Change

**New files:**
- None.

**Modified files:**
- `TaskFlow.Api/Validators/JournalNoteValidator.cs` — add `.MaximumLength(2000).WithMessage("Content must not exceed 2000 characters.")` to the `RuleFor(n => n.Content)` chain.
- `TaskFlow.Api.Tests/Validators/JournalNoteValidatorTests.cs` — invert/rename `Validate_ShouldPass_WhenContentExceeds2000Chars` to `Validate_ShouldFail_WhenContentExceedsMaxLength` (asserting failure + exact message), and add `Validate_ShouldPass_WhenContentIsExactly2000Characters` boundary test.

**Auto-generated (do not manually edit):**
- Not applicable — no API contract change, `npm run gen:api` does not need to be run for this issue.

## 8. Risks & Concerns

1. **Risk:** The existing test `Validate_ShouldPass_WhenContentExceeds2000Chars` will fail immediately once the validator change is merged, if the test is not updated in the same commit/PR.
   **Likelihood:** High (certain, if steps are done out of order).
   **Mitigation:** Make the validator change and the test correction in the same commit so CI never sees a red state between them.

2. **Risk:** Any existing journal notes already persisted in the database (dev/prod SQLite) with `Content` longer than 2000 characters will not be retroactively affected (validation is enforced only on new writes), so pre-existing over-length rows could still exist and later fail validation if re-saved (e.g., via an update flow that re-validates the full entity).
   **Likelihood:** Low (unbounded growth was only theoretically possible; unlikely any real journal note exceeds 2000 chars given typical usage).
   **Mitigation:** No action required for this issue; note this as a documentation footnote only if it becomes relevant during manual QA.

3. **Risk:** Enum/casing concerns — not applicable. This change touches only string-length validation on a `Content` field, not any status/enum field, so the PascalCase enum gotcha does not apply here.

4. **Risk:** Journal API hand-written module (`src/api/journal.ts`) sync concern — not applicable. This is a backend-only validation change with no new/modified endpoint signature, so no `src/api/journal.ts` update is triggered.

## 9. Open Questions

None — the issue and codebase-researcher findings are complete and unambiguous. This is a strictly scoped, backend-only, one-rule validator fix with a corresponding test fix.

## 10. Implementation Order (Suggested)

1. Add `.MaximumLength(2000).WithMessage("Content must not exceed 2000 characters.")` to `RuleFor(n => n.Content)` in `TaskFlow.Api/Validators/JournalNoteValidator.cs`.
2. In `TaskFlow.Api.Tests/Validators/JournalNoteValidatorTests.cs`, rename/invert `Validate_ShouldPass_WhenContentExceeds2000Chars` to `Validate_ShouldFail_WhenContentExceedsMaxLength`, updating its assertions to expect failure with the exact error message.
3. Add the new boundary test `Validate_ShouldPass_WhenContentIsExactly2000Characters` to the same test file.
4. Run `dotnet test --filter "FullyQualifiedName~JournalNoteValidatorTests"` to confirm all four tests pass.
5. Run full `dotnet test` and `dotnet format --verify-no-changes` before opening the PR against `main`.
