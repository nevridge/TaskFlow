# Technical Brief: Journal Notes: multiline text and ordered/unordered lists (#226)

**Date:** 2026-10-12
**Status:** Draft (pending human approval)
**Branch:** feature/journal-notes-multiline-and-lists

## 1. Overview
The Journal Notes section (`NotesSection.tsx`, which renders separate `JournalNote` records, not `JournalEntry.Summary`) changes from single-line inputs to textareas. Enter saves and Shift+Enter inserts a newline. Saved notes display with line breaks preserved. Lines beginning with `- ` or `* ` render as bullet lists, and lines beginning with `N. ` render as numbered lists. A small custom parser in `src/lib/` turns the stored plain text into React elements. No new dependency and no `dangerouslySetInnerHTML`. Content is stored as the exact typed text through the existing create and update calls. **No backend, API or schema changes.**

## 2. User Story
As a journal user, I want to write each journal note over multiple lines and have lines starting with `-`/`*` or `1.` shown as bullet and numbered lists, so my daily notes are easier to read and organize.

Acceptance criteria 1-18 are as in GitHub issue #226 (https://github.com/nevridge/TaskFlow/issues/226) and are referenced by number below.

## 3. Data Model Changes
None. `JournalNote.Content` stays a string. Backend validator still enforces `NotEmpty` and `MaximumLength(2000)`. No migration.

## 4. Backend Changes
None. Existing `JournalNotesController` create/update endpoints are used with `{ Content }` bodies. Frontend wrappers and hooks (`useCreateJournalNoteMutation`, `useUpdateJournalNoteMutation`) are unchanged. 2000-char limit enforced by existing `JournalNoteValidator`; UI mirrors it with `maxLength`.

### 4.1 Parser design and edge-case defaults

**New file:** `TaskFlow.Web/src/lib/notes-format.ts`, colocated test `notes-format.test.ts`. Follows `journal-utils.ts` conventions; no React dependency in parsing.

```ts
export type NoteBlock =
  | { type: 'paragraph'; lines: string[] }          // consecutive plain lines
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }

export function parseNoteContent(text: string): NoteBlock[]
```

Renderer is a small `NoteContent` component (separate file `src/components/journal/NoteContent.tsx`):
- paragraph -> `<p className="note-p">`, lines joined by `<br />` (React elements, not `\n`)
- `ul` -> `<ul className="note-list">` with `<li>` children
- `ol` -> `<ol className="note-list">` with `<li>` children
- All text passed as React children, so escaped by React. `<script>alert(1)</script>` and `<b>x</b>` appear literally (AC 9).

**Grammar, applied per line after normalization:**
1. **Normalization.** Replace `\r\n` and lone `\r` with `\n`, split on `\n`, `trimEnd()` every line. Do not trim leading whitespace (indented lines are plain text).
2. **Bullet line.** `/^[-*] (.*)$/`. Exactly one marker char followed by exactly one space, at column 0. Item text is capture `trim()`. A marker with empty item (`- ` becomes `-` after trimEnd) is plain text.
3. **Numbered line.** `/^\d{1,9}\. (.*)$/`. The number is ignored; browser numbers sequentially from 1. No `start` attribute (deliberate simplification: `3.` first still shows as 1).
4. **Everything else** is plain: `-item`, `*bold*`, `1)`, `1.item`, `--- `, `  - nested`, `\t- x`, `-` alone.

**Block grouping:**
- Consecutive bullet lines -> one `ul`; consecutive numbered lines -> one `ol`; consecutive plain lines -> one paragraph with `<br />` between lines (AC 5).
- Mixed types: kind change starts a new block, no nesting. `-` and `*` are the same kind.
- Blank lines separate blocks. Two list items separated by a blank line become two lists of same type (numbered restarts at 1). Multiple blank lines collapse; leading/trailing blanks dropped. Spacing is a small margin (`margin: 0` on `.note-p`/`.note-list`, `* + *` siblings get `margin-top: 4px`).
- Indented/nested/tab items: not supported; plain text.
- `- ` or `* ` followed by text always becomes a bullet (documented behavior).
- Single-line plain note (AC 8): one paragraph, one line, no `<br />`.
- Existing notes parse as plain text unless they start with `- `, `* ` or `N. `; accepted, no migration.
- Empty/whitespace-only input returns `[]`.
- Long notes: `white-space: normal`, `overflow-wrap: anywhere`, no ellipsis, no fixed height, no truncation.
- Max length: `maxLength={2000}` on both textareas, matching backend. UTF-16 code units agree. Browser normalizes textarea `.value` to `\n`.
- Stored text: exactly as typed except existing whole-string `trim()`.

## 5. Frontend Changes

### 5a. API client
No change. `npm run gen:api` not needed. `src/api/journal.ts` unchanged.

### 5b. Components

**Modified: `TaskFlow.Web/src/components/journal/NotesSection.tsx`**

*Add field (AC 1-4):*
- Replace `<input className="add-input">` with `<textarea>`: `rows={1}`, `maxLength={2000}`, placeholder "Add a note… Enter to save, Shift+Enter for new line". Ref becomes `useRef<HTMLTextAreaElement>(null)`. `focusNewNote` unchanged (`inputRef.current?.focus()`); do not rename. `isInputFocused()` already treats TEXTAREA as input so `n` doesn't fire while typing.
- Keep `<form className="add-row" onSubmit={addNote}>`. Handle Enter in `onKeyDown`: if `e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing` then `preventDefault()` and call shared `submitDraft()` directly (not `requestSubmit`, unreliable in jsdom). Shift+Enter unhandled -> browser inserts `\n` (AC 3). Escape keeps behavior: clear draft and blur.
- `addNote` keeps `draft.trim()` and ignores empty.
- Auto-grow: grow to fit content up to a cap via `useLayoutEffect` keyed on value (`el.style.height='auto'; el.style.height=el.scrollHeight+'px'`); CSS cap `max-height: 12em; overflow-y: auto`. Inline helper (or `useAutoGrow`). No height assertions in tests (jsdom scrollHeight 0); guard null ref.

*Edit mode (AC 10-14):*
- Replace `<input className="note-edit">` with `<textarea className="note-edit" maxLength={2000} autoFocus>`. `value={editingText}` is the exact stored text. Caret moved to end on focus.
- `onKeyDown`: Enter w/o shift and not composing -> `preventDefault()` + `commitEdit` (AC 11). Shift+Enter falls through (AC 12). Escape -> `cancelEdit()` (AC 14). `onBlur` -> `commitEdit` (AC 13).
- **Double-fire guard:** `committedRef = useRef(false)`. `startEdit` sets false; `commitEdit` and `cancelEdit` return early if true, else set true. Ensures `updateNote.mutate` at most once per edit session and Escape followed by blur does not save.
- `commitEdit` keeps behavior: trim, mutate only if non-empty and changed.
- Same auto-grow helper.

*Display (AC 5-9):* replace `{note.content}` in `<div className="note-text" onDoubleClick=...>` with `<NoteContent text={note.content} />`.

**New: `TaskFlow.Web/src/components/journal/NoteContent.tsx`** — `Props { text: string }`; `useMemo(parseNoteContent)`; renders blocks per 4.1; keys by block/item index.

### 5c. Hooks
No changes to `useJournal.ts`.

### 5d. Routing
None.

### 5e. Styling (`TaskFlow.Web/src/journal.css`, ~699-733)
All scoped under `.journal-page` (AC 16); use `.journal-page .class` for new/changed rules.
- `.add-input`: `resize: none; font-family: inherit; line-height: 1.4; display: block; max-height: 12em; overflow-y: auto;`
- `.note-text`: remove `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; use `white-space: normal; overflow-wrap: anywhere; min-width: 0;`
- New: `.note-p`, `.note-list { margin: 0 }`, `.note-list { padding-left: 1.25em }`, `ul.note-list { list-style: disc }`, `ol.note-list { list-style: decimal }`, `.note-text > * + * { margin-top: 4px }` (Tailwind preflight resets list styles).
- `.journal-page .note-edit`: `resize: none; font-family: inherit; line-height: 1.4; display: block; width: 100%; max-height: 12em; overflow-y: auto;`
- Keep `.log-entry` row aligned to top (`align-items: flex-start` if currently centered); check existing rule.

## 6. Tests Required

### 6a. Backend: none (existing validator tests cover 2000 boundary).

### 6b. Frontend

**`src/lib/notes-format.test.ts`**: single plain line; multiple plain lines -> one paragraph; `- a`/`* b` -> one `ul`, markers stripped; `1. a`/`2. b` -> one `ol`, starting number ignored; mixed -> `ul` then `ol`; blank line between items -> two lists; multiple blanks collapse, leading/trailing dropped; `-item`, `1)`, `1.item`, `*x*`, `-`, `- ` plain; indented and tab-indented plain; CRLF/CR normalize and trailing whitespace trimmed; `<script>` literal; empty/whitespace -> `[]`; paragraph/list/paragraph order kept.

**`src/components/journal/NoteContent.test.tsx`**: `<script>alert(1)</script>` renders as text, no script element, no `b` element for `<b>x</b>` (AC 9); bullets render list/listitem without marker; numbered renders `ol`; multi-line paragraph renders `<br>`; single plain line like before.

**`NotesSection.test.tsx` updates** (keep `@/hooks/useJournal` mock): replace `getByRole('textbox')` with `getByPlaceholderText(...)` (add) / `getByDisplayValue(...)` (edit) / `getAllByRole('textbox')` where both present.
- Add: Enter creates trimmed note (AC 2); Shift+Enter keeps text with newline, no mutate (AC 3); Enter on whitespace no mutate; Escape clears; field is a TEXTAREA (AC 1); `ref.focusNewNote()` focuses textarea (AC 4).
- Edit: dblclick shows textarea with exact multi-line text incl. markers (AC 10); Enter saves once (AC 11); Shift+Enter does not save (AC 12); change + blur saves (AC 13); change + Escape discards, no update (AC 14); Enter then blur -> mutate exactly once; Escape then blur -> no mutate; unchanged/empty exits with no mutate.
- Display: stored `- a\n- b` renders list items. Delete test unchanged.

Existing JournalPage tests: verify `n` shortcut / `getByRole('textbox')` usage; run full suite.

### 6c. Coverage: new parser/component small and fully tested; frontend >=80% gate should hold.

## 7. Files That Will Change

**New:**
- `TaskFlow.Web/src/lib/notes-format.ts`
- `TaskFlow.Web/src/lib/notes-format.test.ts`
- `TaskFlow.Web/src/components/journal/NoteContent.tsx`
- `TaskFlow.Web/src/components/journal/NoteContent.test.tsx`

**Modified:**
- `TaskFlow.Web/src/components/journal/NotesSection.tsx`
- `TaskFlow.Web/src/components/journal/NotesSection.test.tsx`
- `TaskFlow.Web/src/journal.css`
- `CLAUDE.md` (AC 18): replace "Notes are stored in `JournalEntry.Summary` (debounced PUT on textarea change)" with: "Notes are separate `JournalNote` records (add and edit via textarea: Enter saves, Shift+Enter inserts a newline, double-click to edit), shown with a small formatter (`src/lib/notes-format.ts`) that renders `-`/`*` bullet lists and `1.` numbered lists as React elements."

**Auto-generated untouched:** `src/api/client/sdk.gen.ts`.

## 8. Risks & Concerns
1. Enter vs Shift+Enter and IME composition -> check `!e.shiftKey && !e.nativeEvent.isComposing`.
2. Enter-then-blur double save / Escape-then-blur-on-unmount saving discarded edit -> `committedRef` guard + tests.
3. Two textboxes in DOM during edit makes `getByRole('textbox')` ambiguous -> update queries.
4. Textarea in form doesn't submit on Enter; `requestSubmit` inconsistent in jsdom -> call `submitDraft()` directly.
5. XSS -> React elements only, no `dangerouslySetInnerHTML`, test with `<script>`/`<b>`.
6. CSS: `.note-text` ellipsis, textarea font inheritance, Tailwind preflight list reset -> explicit rules in 5e; use `.journal-page .classname` for anything needing border/background.
7. Existing notes starting with `- `, `* `, `N. ` change appearance -> accepted, note in PR.
8. 2000-char limit: `addNote` clears draft before request completes, so long paste would 400 and lose text -> `maxLength={2000}` on both textareas.
9. Numbering is positional, not typed number -> documented, tested.
10. jsdom `scrollHeight` 0 -> no height assertions, null-ref guard.
11. Enum casing gotcha not applicable.
12. `src/api/journal.ts` manual sync not needed.

## 9. Open Questions
None. Defaults worth a quick check in review: blank line between list items gives two lists; numbered lists renumber from 1; `maxLength` 2000 on both textareas with no counter.

## 10. Implementation Order
1. `notes-format.ts` + tests
2. `NoteContent.tsx` + tests
3. `journal.css`
4. `NotesSection.tsx` (display via `NoteContent`, add textarea, edit textarea with commit guard and auto-grow)
5. `NotesSection.test.tsx`
6. `npx tsc --noEmit` and `npm run test -- --run --coverage`; check `n` shortcut and JournalPage tests
7. `CLAUDE.md`
8. Manual smoke test (light/dark, long notes, paste near 2000 chars); PR from `feature/journal-notes-multiline-and-lists`
