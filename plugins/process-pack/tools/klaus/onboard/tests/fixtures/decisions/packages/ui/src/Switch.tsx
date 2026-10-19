export interface SwitchProps {
  checked: boolean
  onChange?: () => void
  label?: string
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button className="inline-flex h-6 w-11 items-center rounded-full bg-blue-600 shadow-none" role="switch" aria-checked={checked} onClick={onChange}>
      {label}
    </button>
  )
}
