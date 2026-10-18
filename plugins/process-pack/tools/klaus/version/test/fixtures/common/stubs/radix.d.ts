// Radix and lucide as the fixture components use them. The props are the ones Dialog sets or passes on.
declare module '@radix-ui/react-slot' {
  import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react'
  export const Slot: ForwardRefExoticComponent<HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement>>
}

declare module '@radix-ui/react-dialog' {
  import type { ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes } from 'react'
  interface ContentProps extends HTMLAttributes<HTMLDivElement> {
    forceMount?: true
    asChild?: boolean
    onInteractOutside?: (event: Event) => void
    onEscapeKeyDown?: (event: KeyboardEvent) => void
  }
  export const Root: (props: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }) => JSX.Element
  export const Trigger: ForwardRefExoticComponent<HTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>>
  export const Close: ForwardRefExoticComponent<HTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>>
  export const Portal: (props: { children?: ReactNode }) => JSX.Element
  export const Overlay: ForwardRefExoticComponent<HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>>
  export const Content: ForwardRefExoticComponent<ContentProps & RefAttributes<HTMLDivElement>>
  export const Title: ForwardRefExoticComponent<HTMLAttributes<HTMLHeadingElement> & RefAttributes<HTMLHeadingElement>>
  export const Description: ForwardRefExoticComponent<HTMLAttributes<HTMLParagraphElement> & RefAttributes<HTMLParagraphElement>>
}

declare module 'lucide-react' {
  export const X: (props: { className?: string }) => JSX.Element
  export const MoreHorizontal: (props: { className?: string }) => JSX.Element
}
