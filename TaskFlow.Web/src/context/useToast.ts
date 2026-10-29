import { useContext } from 'react'
import { ToastContext } from './ToastContextDef'
import type { ToastContextValue } from './ToastContextDef'

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
