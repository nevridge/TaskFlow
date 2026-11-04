import { isCompleted } from '@/lib/task-status'

export interface ParentTaskOption {
  id: number
  title: string
  /** Stored status (PascalCase). Never the status derived from open subtasks. */
  status?: string | null
}

/** Reason shown on a gated Add subtask control. */
export const COMPLETED_PARENT_ADD_SUBTASK_HINT = "Completed tasks can't take new subtasks"

/** Visible option text; the "(completed)" suffix is based on the stored status. */
export function parentOptionLabel(parent: Pick<ParentTaskOption, 'title' | 'status'>): string {
  return isCompleted(parent.status) ? `${parent.title} (completed)` : parent.title
}

/** A Completed parent is disabled in a picker unless it is the current selection. */
export function isParentOptionDisabled(parent: Pick<ParentTaskOption, 'id' | 'status'>, selectedId: string): boolean {
  return isCompleted(parent.status) && String(parent.id) !== selectedId
}
