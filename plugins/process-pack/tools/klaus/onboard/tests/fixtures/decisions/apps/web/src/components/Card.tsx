import type { ReactNode } from 'react'

export interface CardProps {
  children: ReactNode
  title?: string
}

export function Card({ children, title }: CardProps) {
  return (
    <section className="rounded-xl bg-gray-50 p-6">
      {title ? <h2 className="text-xl font-bold">{title}</h2> : null}
      {children}
    </section>
  )
}
