import { Hero } from '@/marketing/Hero'
import { PrimaryButton } from '@sample/ui'

export default function HomePage() {
  return <Hero title="Plan the work" subtitle="One place for every project" actions={<PrimaryButton onClick={() => {}}>Get started</PrimaryButton>} />
}
