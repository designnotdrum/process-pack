import { Field } from '@fixture/ui'
import Combobox from '@fixture/ui/combobox'
import { ProjectHeader } from './ProjectHeader'

export default function ProjectsPage() {
  return (
    <main>
      <ProjectHeader />
      <Field label="Search" />
      <Combobox options={[]} />
    </main>
  )
}
