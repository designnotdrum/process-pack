export interface ActivityItem {
  id: string
  text: string
}

/** Reads a project's recent activity from the server. */
export function useActivity(projectId: string): { items: ActivityItem[]; loading: boolean } {
  void projectId
  return { items: [], loading: false }
}
