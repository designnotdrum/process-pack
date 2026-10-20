import type { ReactNode } from 'react'

export interface BadgeProps {
  children: ReactNode
  tone?: 'info' | 'danger'
}

export function Badge({ children, tone = 'info' }: BadgeProps) {
  return (
    <span className="inline-flex rounded-full bg-red-100 px-3 text-sm font-semibold text-red-800" data-tone={tone}>
      {children}
    </span>
  )
}
