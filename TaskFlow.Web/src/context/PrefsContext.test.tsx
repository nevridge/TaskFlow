import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { PrefsProvider } from './PrefsContext'
import { usePrefs } from './usePrefs'
import { PREFS_KEY } from '@/lib/prefs'

// Node.js 22+ has a broken experimental localStorage on globalThis that
// vitest's jsdom environment cannot override. We stub it with an in-memory
// implementation so PrefsContext's loadPrefs / savePrefs calls work.
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
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('is-dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('is-dark')
})

// Consumer component that exposes all pref values via data-testid spans
function Consumer() {
  const prefs = usePrefs()
  return (
    <div>
      <span data-testid="isDark">{String(prefs.isDark)}</span>
      <span data-testid="theme">{prefs.theme}</span>
      <span data-testid="headerStyle">{prefs.headerStyle}</span>
      <span data-testid="todoSort">{prefs.todoSort}</span>
      <span data-testid="projectStart">{prefs.projectStart}</span>
      <button data-testid="setIsDarkTrue" onClick={() => prefs.setIsDark(true)}>set dark true</button>
      <button data-testid="setIsDarkFalse" onClick={() => prefs.setIsDark(false)}>set dark false</button>
      <button data-testid="setThemeNord" onClick={() => prefs.setTheme('nord')}>set theme nord</button>
      <button data-testid="setThemeDefault" onClick={() => prefs.setTheme('default')}>set theme default</button>
    </div>
  )
}

function renderWithProvider(localStorageInit?: Record<string, unknown>) {
  if (localStorageInit) {
    fakeStorage.setItem(PREFS_KEY, JSON.stringify(localStorageInit))
  }
  return render(
    <PrefsProvider>
      <Consumer />
    </PrefsProvider>,
  )
}

describe('PrefsContext defaults', () => {
  it('default isDark is true when localStorage is empty', () => {
    renderWithProvider()
    expect(screen.getByTestId('isDark').textContent).toBe('true')
  })

  it('default theme is "default"', () => {
    renderWithProvider()
    expect(screen.getByTestId('theme').textContent).toBe('default')
  })

  it('default headerStyle is "stat"', () => {
    renderWithProvider()
    expect(screen.getByTestId('headerStyle').textContent).toBe('stat')
  })

  it('default todoSort is "manual"', () => {
    renderWithProvider()
    expect(screen.getByTestId('todoSort').textContent).toBe('manual')
  })
})

describe('PrefsContext loading from localStorage', () => {
  it('reads isDark=false and theme from localStorage', () => {
    renderWithProvider({ dark: false, theme: 'nord' })
    expect(screen.getByTestId('isDark').textContent).toBe('false')
    expect(screen.getByTestId('theme').textContent).toBe('nord')
  })
})

describe('PrefsContext setIsDark', () => {
  it('setIsDark(false) removes is-dark class from documentElement', () => {
    renderWithProvider()
    act(() => {
      screen.getByTestId('setIsDarkFalse').click()
    })
    expect(document.documentElement.classList.contains('is-dark')).toBe(false)
  })

  it('setIsDark(true) writes dark:true to localStorage', () => {
    renderWithProvider({ dark: false })
    act(() => {
      screen.getByTestId('setIsDarkTrue').click()
    })
    const stored = JSON.parse(fakeStorage.getItem(PREFS_KEY) ?? '{}')
    expect(stored.dark).toBe(true)
  })
})

describe('PrefsContext setTheme', () => {
  it('setTheme("nord") sets data-theme attribute to "nord"', () => {
    renderWithProvider()
    act(() => {
      screen.getByTestId('setThemeNord').click()
    })
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord')
  })

  it('setTheme("default") removes data-theme attribute entirely', () => {
    renderWithProvider({ theme: 'nord' })
    act(() => {
      screen.getByTestId('setThemeDefault').click()
    })
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('usePrefs outside PrefsProvider', () => {
  it('throws an error mentioning PrefsProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/PrefsProvider/)
    spy.mockRestore()
  })
})
