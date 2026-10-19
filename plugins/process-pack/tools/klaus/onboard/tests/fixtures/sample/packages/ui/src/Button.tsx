import type { ReactNode } from 'react'

export interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'solid' | 'outline'
}

/**
 * Use when: the person starts an action, such as saving or sending.
 * Not for: moving to another page, use LinkButton.
 */
export function Button({ children, onClick, disabled, variant = 'solid' }: ButtonProps) {
  return (
    <button
      className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
    >
      {children}
    </button>
  )
}
