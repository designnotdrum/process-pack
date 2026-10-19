import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta = { component: Button, args: { children: 'Save' } } satisfies Meta<typeof Button>

export default meta

export const Default: StoryObj<typeof meta> = {}
