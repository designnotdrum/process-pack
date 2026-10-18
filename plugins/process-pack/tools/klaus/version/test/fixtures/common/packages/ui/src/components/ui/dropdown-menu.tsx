// Stands in for the real dropdown menu, which AnswerNudgeCard renders.
import type { ReactNode } from 'react'

type Part = (props: { children?: ReactNode; className?: string; onSelect?: () => void }) => JSX.Element
export const DropdownMenu: Part = () => null as unknown as JSX.Element
export const DropdownMenuContent: Part = DropdownMenu
export const DropdownMenuItem: Part = DropdownMenu
export const DropdownMenuTrigger: Part = DropdownMenu
