export function Combobox({ options }: { options: string[] }) {
  return <select>{options.map((o) => <option key={o}>{o}</option>)}</select>
}

export default Combobox
