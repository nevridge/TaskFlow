import { useContext } from 'react'
import { PrefsContext } from './PrefsContextDef'
import type { PrefsContextValue } from './PrefsContextDef'

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider')
  return ctx
}
