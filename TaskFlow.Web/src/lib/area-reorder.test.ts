import { describe, it, expect } from 'vitest'
import { insertionIndex, moveItem, targetIndex } from './area-reorder'

const rows = [0, 40, 80].map(top => ({ top, height: 40 }))

describe('area reorder geometry', () => {
  it.each([
    [-10, 0],
    [19, 0],
    [21, 1],
    [61, 2],
    [101, 3],
    [500, 3],
  ])('pointer at %i inserts into gap %i, switching at row midpoints', (y, gap) => {
    expect(insertionIndex(y, rows)).toBe(gap)
  })

  // Off-by-one: gaps above and below the dragged row are both "no move"; gaps further down shift by one.
  it.each([
    [1, 1, 1],
    [1, 2, 1],
    [0, 3, 2],
    [2, 0, 0],
    [0, 2, 1],
  ])('row %i dropped in gap %i ends at position %i', (from, gap, to) => {
    expect(targetIndex(from, gap)).toBe(to)
  })

  it('moves an item either way without mutating the input', () => {
    const list = ['a', 'b', 'c']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b'])
    expect(list).toEqual(['a', 'b', 'c'])
  })
})
