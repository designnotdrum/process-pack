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
      <span className="absolute rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-md">{label}</span>
    </span>
  )
}
