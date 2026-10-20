import type { ReactNode } from 'react'

export interface TableProps {
  children: ReactNode
  dense?: boolean
}

export function Table({ children, dense }: TableProps) {
  return (
    <table className="w-full text-left text-xs" data-dense={dense}>
      {children}
    </table>
  )
}
