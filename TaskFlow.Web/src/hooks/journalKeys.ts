// Kept in its own module so useTasks.ts can invalidate journal keys without a
// circular import (useJournal.ts already imports from useTasks.ts).
export const journalKeys = {
  all: ['journal'] as const,
  todos: (entryId: number) => ['journal', entryId, 'todos'] as const,
  notes: (entryId: number) => ['journal', entryId, 'notes'] as const,
  logUpdate: (entryId: number) => ['journal', entryId, 'log-update'] as const,
}
