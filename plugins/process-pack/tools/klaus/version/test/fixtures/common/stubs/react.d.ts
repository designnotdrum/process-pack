// The parts of React's types that the fixture components use, so the fixtures need no install.
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [name: string]: any
  }
}

declare module 'react' {
  export type ReactNode = string | number | boolean | null | undefined | JSX.Element
  export type Ref<T> = ((instance: T | null) => void) | { current: T | null } | null
  export type ForwardedRef<T> = ((instance: T | null) => void) | { current: T | null } | null
  export interface RefAttributes<T> {
    ref?: Ref<T>
  }
  export interface HTMLAttributes<T> {
    className?: string
    style?: Record<string, string | number>
    children?: ReactNode
    id?: string
    title?: string
    onClick?: (event: unknown) => void
  }
  export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    name?: string
    value?: string
  }
  export type PropsWithoutRef<P> = P extends unknown ? ('ref' extends keyof P ? Omit<P, 'ref'> : P) : P
  export interface ForwardRefExoticComponent<P> {
    (props: P): JSX.Element | null
    displayName?: string
  }
  export function forwardRef<T, P = {}>(render: (props: P, ref: ForwardedRef<T>) => JSX.Element | null): ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>>
  export type ElementRef<C> = C extends ForwardRefExoticComponent<infer P> ? (P extends RefAttributes<infer T> ? T : never) : never
  export type ComponentPropsWithoutRef<C> = C extends ForwardRefExoticComponent<infer P> ? PropsWithoutRef<P> : C extends (props: infer P) => unknown ? P : {}
}
