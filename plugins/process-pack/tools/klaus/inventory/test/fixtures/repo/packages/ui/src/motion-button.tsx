import type { ComponentProps } from 'react'
import { motion } from 'motion/react'

export type MotionButtonProps = ComponentProps<typeof motion.button> & {
  hasIcon?: boolean
  /** The repo declares its own `title`, so it is listed even though the DOM has one. */
  title?: string
}

/** Use when: a button needs to animate as it appears. */
export function MotionButton({ hasIcon, ...props }: MotionButtonProps) {
  return <motion.button {...props} data-icon={hasIcon} />
}

/** A second component in the family, with no props of its own. */
export function MotionButtonGroup(props: ComponentProps<typeof motion.button>) {
  return <motion.button {...props} />
}
