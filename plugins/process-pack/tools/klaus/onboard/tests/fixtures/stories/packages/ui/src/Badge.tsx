export interface BadgeProps {
  label: string
  onDismiss?: () => void
}

export function Badge({ label, onDismiss }: BadgeProps) {
  return <span onClick={onDismiss}>{label}</span>
}
