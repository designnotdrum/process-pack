// A few lines of React's types, so the fixture does not need React installed. The test copies
// this folder into the fixture's node_modules, because that is where React's types are in a
// real repo and where the inventory tells a repo's props from inherited ones.
export type ReactNode = string | number | boolean | null | undefined | JSX.Element
export function forwardRef<T, P>(render: (props: P, ref: { current: T | null }) => JSX.Element | null): (props: P) => JSX.Element | null

// The attribute interfaces keep React's names and nesting. Their members are a small sample.
export type MouseEventHandler<T> = (event: { currentTarget: T }) => void
export interface AriaAttributes {
  'aria-label'?: string
  'aria-hidden'?: boolean
}
export interface DOMAttributes<T> {
  children?: ReactNode
  onClick?: MouseEventHandler<T>
}
export interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
  className?: string
  id?: string
  title?: string
}
export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
  disabled?: boolean
  type?: 'submit' | 'reset' | 'button'
}
export type ComponentProps<T> = T extends 'button' ? ButtonHTMLAttributes<HTMLButtonElement> : T extends (props: infer P) => unknown ? P : never
