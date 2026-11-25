/**
 * Where a drag would insert, as a gap index from 0 (above the first row) to `rows.length` (below the last):
 * the number of rows whose midpoint is above the pointer.
 */
export function insertionIndex(pointerY: number, rows: ReadonlyArray<{ top: number; height: number }>): number {
  return rows.filter(row => pointerY > row.top + row.height / 2).length
}

/** Final position of the row at `from` when dropped into gap `insertion`. Equal to `from` means no move. */
export function targetIndex(from: number, insertion: number): number {
  return insertion > from ? insertion - 1 : insertion
}

/** Copy of `list` with the item at `from` moved to position `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
