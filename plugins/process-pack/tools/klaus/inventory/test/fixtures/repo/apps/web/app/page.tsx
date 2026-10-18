import { Button, Dialog } from '@fixture/ui'
import { Banner } from './components/Banner'

// Loaded on demand, as next/dynamic does.
export const loadLazy = () => import('./components/Lazy')

export default function HomePage() {
  return (
    <main>
      <Banner />
      <Dialog open>
        <Button />
      </Dialog>
    </main>
  )
}
