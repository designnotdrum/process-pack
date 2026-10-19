// The shape of framer-motion's types that Klaus depends on. Its element props rebuild React's
// attributes with a mapped type over a key list, so every attribute becomes a new property that
// points at no declaration.
import type { ButtonHTMLAttributes } from 'react'

interface MotionProps {
  animate?: string
}
type AttributesWithoutMotionProps<T> = { [K in Exclude<keyof T, keyof MotionProps>]?: T[K] }
export type HTMLMotionProps = AttributesWithoutMotionProps<ButtonHTMLAttributes<HTMLButtonElement>> & MotionProps

export declare const motion: { button: (props: HTMLMotionProps) => JSX.Element }
