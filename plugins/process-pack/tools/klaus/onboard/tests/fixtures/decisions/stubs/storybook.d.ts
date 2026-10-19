// A few lines of Storybook's types, so the fixture does not need Storybook installed.
// Like Storybook's, StoryObj makes `args` required when the component has a required prop that
// the meta gives no value to.
declare module '@storybook/react' {
  type PropsOf<C> = C extends (props: infer P) => unknown ? P : never
  type Missing<P, Given> = P extends unknown ? { [K in keyof P as {} extends Pick<P, K> ? never : K extends Given ? never : K]: P[K] } : never
  export type Meta<C> = { component?: C; args?: Partial<PropsOf<C>> }
  export type StoryObj<M> = M extends { component?: infer C; args?: infer A }
    ? { args?: Partial<PropsOf<C>> } & (Missing<PropsOf<C>, keyof A> extends infer R ? ({} extends R ? {} : { args: R }) : never)
    : never
}
