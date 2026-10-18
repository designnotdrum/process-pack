import { forwardRef, type ReactNode } from 'react'

/**
 * Use when: a task needs the user's full attention in a window over the page.
 * Not for: a short yes or no question, use a confirmation instead.
 */
export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }) {
  return <div hidden={!open} onClick={() => onOpenChange?.(false)}>{children}</div>
}

export const DialogContent = forwardRef<HTMLDivElement, { className?: string }>(function DialogContent(props, ref) {
  return <div className={props.className} />
})

export function DialogHeader() {
  return <header />
}

/** Not a component: lower case, so it is not listed. */
export const dialogClassName = 'dialog'
