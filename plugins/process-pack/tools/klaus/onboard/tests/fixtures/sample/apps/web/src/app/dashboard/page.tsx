import { Button } from '@sample/ui'
import { ActivityFeed } from './_components/ActivityFeed'

export default function DashboardPage() {
  return (
    <div>
      <ActivityFeed projectId="p1" />
      <Button variant="outline" onClick={() => {}}>
        Refresh
      </Button>
    </div>
  )
}
