export interface FieldProps {
  /** Use when: the value changes. Not for: reading the value on submit. */
  onChange?: (value: string) => void
  label: string
}

export function Field({ label, onChange }: FieldProps) {
  return <input aria-label={label} onChange={(e) => onChange?.(e.target.value)} />
}
