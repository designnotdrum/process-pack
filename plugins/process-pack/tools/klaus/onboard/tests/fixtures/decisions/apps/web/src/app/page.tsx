import { Badge as AppBadge } from '@/components/Badge'
import { Card } from '@/components/Card'
import { Badge, Tooltip } from '@sample/ui'

export default function HomePage() {
  return (
    <Card title="Home">
      <Tooltip label="Hello">
        <Badge>New</Badge>
      </Tooltip>
      <AppBadge>Beta</AppBadge>
    </Card>
  )
}
