import { useEffect, useRef } from 'react'
import type { SortMode, HeaderStyle } from '@/lib/prefs'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  isDark: boolean
  headerStyle: HeaderStyle
  todoSort: SortMode
  projectStart: string
  onDark: (v: boolean) => void
  onHeaderStyle: (v: HeaderStyle) => void
  onTodoSort: (v: SortMode) => void
  onProjectStart: (v: string) => void
}

export function SettingsDrawer({
  open, onClose,
  isDark, headerStyle, todoSort, projectStart,
  onDark, onHeaderStyle, onTodoSort, onProjectStart,
}: SettingsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Trap focus inside drawer when open
  useEffect(() => {
    if (open) drawerRef.current?.focus()
  }, [open])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`settings-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
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
                onChange={v => onHeaderStyle(v as HeaderStyle)}
              />
            </DrawerRow>

            <DrawerRow label="Todo sort">
              <SegControl
                options={['manual', 'open first', 'done last'] as const}
                value={todoSort}
                onChange={v => onTodoSort(v as SortMode)}
              />
            </DrawerRow>

            <DrawerRow label="Project day 1">
              <input
                type="date"
                value={projectStart}
                onChange={e => e.target.value && onProjectStart(e.target.value)}
                className="settings-date-input"
              />
            </DrawerRow>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Appearance</h3>

            <DrawerRow label="Dark mode">
              <button
                onClick={() => onDark(!isDark)}
                className="settings-toggle"
                style={{ background: isDark ? '#34c759' : 'rgba(0,0,0,.15)' }}
                aria-label="Toggle dark mode"
                role="switch"
                aria-checked={isDark}
              >
                <span className="settings-toggle-thumb" style={{ left: isDark ? 16 : 2 }} />
              </button>
            </DrawerRow>
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
