import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PREFS_KEY, loadPrefs, savePrefs } from './prefs'

// Node.js 22+ has an experimental localStorage on globalThis that is
// non-functional. Vitest's jsdom environment skips overriding it because
// 'localStorage' in globalThis is already true. We stub it with an in-memory
// implementation so loadPrefs / savePrefs work correctly in tests.
function makeLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
    get length() { return Object.keys(store).length },
    key: (index: number) => Object.keys(store)[index] ?? null,
  }
}

let fakeStorage: ReturnType<typeof makeLocalStorage>

beforeEach(() => {
  fakeStorage = makeLocalStorage()
  vi.stubGlobal('localStorage', fakeStorage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PREFS_KEY', () => {
  it('equals the expected storage key', () => {
    expect(PREFS_KEY).toBe('taskflow_journal_prefs_v1')
  })
})

describe('loadPrefs', () => {
  it('returns empty object when localStorage is empty', () => {
    expect(loadPrefs()).toEqual({})
  })

  it('returns parsed prefs when valid JSON is stored', () => {
    fakeStorage.setItem(PREFS_KEY, JSON.stringify({ dark: true }))
    expect(loadPrefs()).toEqual({ dark: true })
  })

  it('returns empty object when stored value is invalid JSON', () => {
    fakeStorage.setItem(PREFS_KEY, 'not json')
    expect(loadPrefs()).toEqual({})
  })
})

describe('savePrefs', () => {
  it('saves prefs and loadPrefs returns them', () => {
    savePrefs({ dark: false })
    expect(loadPrefs()).toEqual({ dark: false })
  })

  it('merges successive calls', () => {
    savePrefs({ dark: true })
    savePrefs({ theme: 'nord' })
    expect(loadPrefs()).toEqual({ dark: true, theme: 'nord' })
  })
})
