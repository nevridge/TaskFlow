import { describe, it, expect } from 'vitest'
import { THEMES } from './themes'

describe('THEMES', () => {
  it('has at least one entry', () => {
    expect(THEMES.length).toBeGreaterThan(0)
  })

  it('contains an entry with id === "default"', () => {
    const found = THEMES.find(t => t.id === 'default')
    expect(found).toBeDefined()
  })

  it('every theme has non-empty required fields', () => {
    for (const t of THEMES) {
      expect(t.id).toBeTruthy()
      expect(t.label).toBeTruthy()
      expect(t.accentLight).toBeTruthy()
      expect(t.accentDark).toBeTruthy()
      expect(t.bgLight).toBeTruthy()
      expect(t.bgDark).toBeTruthy()
    }
  })

  it('all id values are unique', () => {
    const ids = THEMES.map(t => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})
