import { useActivity } from '@/hooks/useActivity'

export function ActivityFeed({ projectId }: { projectId: string }) {
  const { items, loading } = useActivity(projectId)
  if (loading) return <p className="text-sm text-gray-500">Loading activity</p>
  return (
    <ul className="divide-y divide-gray-200">
      {items.map((item) => (
        <li key={item.id} className="py-2 text-sm">
          {item.text}
        </li>
      ))}
    </ul>
  )
}
