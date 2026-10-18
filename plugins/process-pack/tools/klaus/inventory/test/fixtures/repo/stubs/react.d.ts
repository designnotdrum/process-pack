// A few lines of React's types, so the fixture does not need React installed.
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [name: string]: any
  }
}

declare module 'react' {
  export type ReactNode = string | number | boolean | null | undefined | JSX.Element
  export function forwardRef<T, P>(render: (props: P, ref: { current: T | null }) => JSX.Element | null): (props: P) => JSX.Element | null
}
