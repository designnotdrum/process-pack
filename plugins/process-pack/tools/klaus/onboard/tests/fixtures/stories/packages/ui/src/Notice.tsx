export type NoticeProps = { kind: 'text'; text: string } | { kind: 'count'; count: number }

export function Notice(props: NoticeProps) {
  return <p>{props.kind === 'text' ? props.text : props.count}</p>
}
