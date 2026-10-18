export interface SwitchProps {
  /** Called when the switch flips. */
  onFlip?: () => void
}

/** Use when: the user turns one setting on or off and sees it take effect at once. */
export function Switch({ onFlip }: SwitchProps) {
  return <button role="switch" onClick={onFlip} />
}
