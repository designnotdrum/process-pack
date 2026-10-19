import type { ReactNode } from 'react'

export interface TooltipProps {
  children: ReactNode
  label: string
  side?: 'top' | 'bottom'
}

export function Tooltip({ children, label, side = 'top' }: TooltipProps) {
  return (
    <span className="relative inline-flex" data-side={side}>
      {children}
      <span className="absolute rounded border bg-white px-3 py-1 text-sm shadow">{label}</span>
    </span>
  )
}
