export interface AsyncFieldProps {
  label: string
  onSave: (value: string) => Promise<void>
  onChange: (value: string) => void
  load: () => Promise<string[]>
  format: (value: number) => string
}

export function AsyncField({ label, onSave, onChange, load, format }: AsyncFieldProps) {
  return (
    <label>
      {label}
      <input onChange={() => onChange(format(1))} onBlur={() => onSave('x').then(() => load())} />
    </label>
  )
}
