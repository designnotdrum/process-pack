import type { ReactNode } from 'react'

export interface HeroProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function Hero({ title, subtitle, actions }: HeroProps) {
  return (
    <section className="mx-auto max-w-3xl py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-4 text-lg text-gray-600">{subtitle}</p> : null}
      {actions ? <div className="mt-8 flex justify-center gap-4">{actions}</div> : null}
    </section>
  )
}
