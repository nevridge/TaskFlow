/** Largest count shown literally on the badge; anything at or above it shows as "99+". */
const OPEN_SUBTASK_BADGE_CAP = 99

/**
 * Text for the open-subtask badge on a task row: the visible `text` is capped at "99+", while `label`
 * (tooltip and screen-reader text) always carries the exact count.
 */
export function formatOpenSubtaskLabel(count: number): { text: string; label: string } {
  return {
    text: count > OPEN_SUBTASK_BADGE_CAP ? `${OPEN_SUBTASK_BADGE_CAP}+` : String(count),
    label: `${count} open ${count === 1 ? 'subtask' : 'subtasks'}`,
  }
}
