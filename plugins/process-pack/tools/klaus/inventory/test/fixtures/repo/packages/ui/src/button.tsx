import { cva, type VariantProps } from 'class-variance-authority'

export const buttonVariants = cva('btn', {
  variants: {
    variant: { default: 'a', outline: 'b' },
    size: { sm: 'c', lg: 'd' },
  },
  defaultVariants: { variant: 'default' },
})

export interface ButtonProps extends VariantProps<typeof buttonVariants> {
  disabled?: boolean
}

/**
 * Use when: the user starts an action.
 * Not for: moving to another page, use a link.
 */
export function Button({ variant, size, disabled }: ButtonProps) {
  return <button className={buttonVariants({ variant, size })} disabled={disabled} />
}
