import type { ReactNode } from 'react'

export function AppProvider({ children }: { children: ReactNode }) {
  return <div>{children}</div>
}
