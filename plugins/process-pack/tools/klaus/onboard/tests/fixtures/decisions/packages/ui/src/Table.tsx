import type { ReactNode } from 'react'

export interface TableProps {
  children: ReactNode
  dense?: boolean
}

export function Table({ children, dense }: TableProps) {
  return (
    <table className="w-full border-collapse text-sm" data-dense={dense}>
      {children}
    </table>
  )
}
