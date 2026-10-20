import { Badge, Switch, Tooltip } from '@sample/ui'

export default function SettingsPage() {
  return (
    <Tooltip label="Turn on">
      <Switch checked label="Alerts" />
      <Badge>Saved</Badge>
    </Tooltip>
  )
}
