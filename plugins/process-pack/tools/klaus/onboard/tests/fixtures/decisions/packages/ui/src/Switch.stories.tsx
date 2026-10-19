import type { Meta, StoryObj } from '@storybook/react'
import { Switch } from './index'

const meta = { component: Switch, args: { checked: true, label: 'On' } } satisfies Meta<typeof Switch>

export default meta

export const Default: StoryObj<typeof meta> = {}
