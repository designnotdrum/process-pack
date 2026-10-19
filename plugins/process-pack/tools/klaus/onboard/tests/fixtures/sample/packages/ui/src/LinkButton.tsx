import type { ReactNode } from 'react'

export interface LinkButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  href?: string
}

// A button that reads as a link.
export function LinkButton({ children, onClick, disabled, href }: LinkButtonProps) {
  return (
    <a className="inline-flex items-center text-sm font-medium text-blue-600 underline hover:text-blue-800" href={href} onClick={onClick} aria-disabled={disabled}>
      {children}
    </a>
  )
}
