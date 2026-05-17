import { useEffect, useRef } from 'react'
import { usePrefs } from '@/context/usePrefs'
import type { SortMode, HeaderStyle } from '@/lib/prefs'
import { THEMES } from '@/lib/themes'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const {
    isDark,
    theme,
    headerStyle,
    todoSort,
    projectStart,
    autoCompleteParentWhenChildrenDone,
    setIsDark,
    setTheme,
    setHeaderStyle,
    setTodoSort,
    setProjectStart,
    setAutoCompleteParentWhenChildrenDone,
  } = usePrefs()
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (open) drawerRef.current?.focus()
  }, [open])

  return (
    <>
      <div
        className={`settings-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        role="dialog"
        aria-label="Settings"
        aria-modal={open ? 'true' : undefined}
        aria-hidden={!open}
        inert={!open}
        className={`settings-drawer${open ? ' is-open' : ''}`}
        tabIndex={-1}
      >
        <div className="settings-drawer-header">
          <span className="settings-drawer-title">Settings</span>
          <button
            className="settings-drawer-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="settings-drawer-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Journal</h3>

            <DrawerRow label="Header style">
              <SegControl
                options={['stat', 'minimal'] as const}
                value={headerStyle}
                onChange={v => setHeaderStyle(v as HeaderStyle)}
              />
            </DrawerRow>

            <DrawerRow label="Todo sort">
              <SegControl
                options={['manual', 'open first', 'done last'] as const}
                value={todoSort}
                onChange={v => setTodoSort(v as SortMode)}
              />
            </DrawerRow>

            <DrawerRow label="Project day 1">
              <input
                type="date"
                value={projectStart}
                onChange={e => e.target.value && setProjectStart(e.target.value)}
                className="settings-date-input"
              />
            </DrawerRow>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Tasks</h3>

            <DrawerRow label="Auto-complete parent when all subtasks are done">
              <button
                onClick={() => setAutoCompleteParentWhenChildrenDone(!autoCompleteParentWhenChildrenDone)}
                className="settings-toggle"
                style={{ background: autoCompleteParentWhenChildrenDone ? '#34c759' : 'rgba(0,0,0,.15)' }}
                aria-label="Toggle parent auto-complete"
                role="switch"
                aria-checked={autoCompleteParentWhenChildrenDone}
              >
                <span className="settings-toggle-thumb" style={{ left: autoCompleteParentWhenChildrenDone ? 16 : 2 }} />
              </button>
            </DrawerRow>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Appearance</h3>

            <DrawerRow label="Dark mode">
              <button
                onClick={() => setIsDark(!isDark)}
                className="settings-toggle"
                style={{ background: isDark ? '#34c759' : 'rgba(0,0,0,.15)' }}
                aria-label="Toggle dark mode"
                role="switch"
                aria-checked={isDark}
              >
                <span className="settings-toggle-thumb" style={{ left: isDark ? 16 : 2 }} />
              </button>
            </DrawerRow>

            <div className="settings-theme-label">Theme</div>
            <div className="settings-theme-grid">
              {THEMES.map(t => (
                <button
                  key={t.id}
                  className={`settings-theme-swatch${t.id === theme ? ' is-active' : ''}`}
                  title={t.label}
                  aria-label={t.label}
                  aria-pressed={t.id === theme}
                  onClick={() => setTheme(t.id)}
                  style={{
                    background: isDark ? t.bgDark : t.bgLight,
                    borderColor: isDark ? t.accentDark : t.accentLight,
                  }}
                >
                  <span
                    className="settings-theme-swatch-dot"
                    style={{ background: isDark ? t.accentDark : t.accentLight }}
                  />
                  <span className="settings-theme-swatch-name">{t.label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function DrawerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      {children}
    </div>
  )
}

function SegControl<T extends string>({
  options, value, onChange,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="settings-seg">
      {options.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`settings-seg-btn${o === value ? ' is-active' : ''}`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}
