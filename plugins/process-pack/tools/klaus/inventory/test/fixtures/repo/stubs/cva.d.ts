// The shape of class-variance-authority's types that Klaus depends on: variants become
// optional props typed as the union of their option names.
declare module 'class-variance-authority' {
  type StringToBoolean<T> = T extends 'true' | 'false' ? boolean : T

  export type VariantProps<T extends (...args: never) => unknown> = Omit<NonNullable<Parameters<T>[0]>, 'class' | 'className'>

  export function cva<V extends Record<string, Record<string, string>>>(
    base: string,
    config: { variants: V; defaultVariants?: { [K in keyof V]?: keyof V[K] } },
  ): (props?: { [K in keyof V]?: StringToBoolean<keyof V[K]> | null | undefined }) => string
}
