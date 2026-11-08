export const MAX_TASK_ID = 2147483647

/**
 * Parses search input as a task ID: "42", "#42", " 42 ", "042" -> 42.
 * Returns null for anything else (empty, "0", "#", "4a2", "-5", "4.2", "#4 2", above MAX_TASK_ID).
 */
export function parseTaskId(input: string): number | null {
  const m = /^#?(\d+)$/.exec(input.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_TASK_ID ? n : null
}
