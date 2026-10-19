export interface ProbeProps {
  reading: number
}

export function Probe({ reading }: ProbeProps) {
  return <output>{reading}</output>
}
