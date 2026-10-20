import type { ReactNode } from 'react'

export interface CardProps {
  children: ReactNode
  title?: string
}

export function Card({ children, title }: CardProps) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  )
}
