// The global JSX types the fixture's components are written against. React's own types are in
// `../../dependencies`, which the test copies into node_modules.
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [name: string]: any
  }
}
