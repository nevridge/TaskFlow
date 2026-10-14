// Kept in its own module so useTasks.ts can invalidate project keys without a
// circular import (useProjects.ts already imports taskKeys from useTasks.ts).
export const projectKeys = {
  all: ['projects'] as const,
  detail: (id: number) => ['projects', id] as const,
  tasks: (id: number) => ['projects', id, 'tasks'] as const,
}
