import type { ReactNode } from 'react'

export interface BadgeProps {
  children: ReactNode
  tone?: 'info' | 'danger'
}

export function Badge({ children, tone = 'info' }: BadgeProps) {
  return (
    <span className="inline-flex rounded-md bg-blue-600 px-2 text-xs font-medium text-white" data-tone={tone}>
      {children}
    </span>
  )
}
