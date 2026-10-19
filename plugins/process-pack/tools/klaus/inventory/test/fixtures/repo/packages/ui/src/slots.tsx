import type { ReactNode } from 'react'

/** A mapped type with no declaration for its props too, but the repo wrote it. */
export type SlotsProps = Record<'title' | 'footer', ReactNode>

export function Slots({ title, footer }: SlotsProps) {
  return (
    <section>
      {title}
      {footer}
    </section>
  )
}
