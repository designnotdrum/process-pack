import type { ComponentProps } from 'react'

export type IconButtonProps = ComponentProps<'button'> & {
  label: string
}

/**
 * Use when: a button shows only an icon and needs a spoken name.
 * Not for: a button with a visible text label, use a Button.
 */
export function IconButton({ label, ...props }: IconButtonProps) {
  return <button aria-label={label} {...props} />
}
