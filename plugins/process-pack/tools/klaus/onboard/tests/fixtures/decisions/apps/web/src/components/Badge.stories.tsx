import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './Badge'

const meta = { component: Badge, args: { children: 'New' } } satisfies Meta<typeof Badge>

export default meta

export const Default: StoryObj<typeof meta> = {}
