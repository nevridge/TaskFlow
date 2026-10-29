import type { ReactElement } from 'react'
import { render as rtlRender } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/context/ToastContext'

/**
 * Journal sections need a QueryClient (for the invalidation closure) and the ToastProvider (the pending-delete
 * queue). `rerender` keeps the wrapper, so the same provider instance survives rerenders.
 */
export function makeProviders(client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Providers({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: makeProviders(), ...options })
}
