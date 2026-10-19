export interface SwitchProps {
  checked: boolean
  onChange?: () => void
  label?: string
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button className="inline-flex h-8 w-14 items-center rounded-md border bg-white shadow" role="switch" aria-checked={checked} onClick={onChange}>
      {label}
    </button>
  )
}
