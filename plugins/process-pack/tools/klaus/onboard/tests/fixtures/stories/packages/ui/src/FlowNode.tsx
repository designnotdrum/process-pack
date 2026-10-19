import type { NodeProps } from '@flow/lib'

export interface FlowNodeProps extends NodeProps {
  onSelect?: () => void
}

export function FlowNode({ id, data, onSelect }: FlowNodeProps) {
  return <div onClick={onSelect}>{id}: {data.label}</div>
}
