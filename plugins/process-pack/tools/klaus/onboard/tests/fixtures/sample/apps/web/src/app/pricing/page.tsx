import { Hero } from '@/marketing/Hero'
import { Button, LinkButton } from '@sample/ui'

export default function PricingPage() {
  return (
    <div>
      <Hero title="Pricing" />
      <Button onClick={() => {}}>Buy now</Button>
      <LinkButton href="/contact">Talk to us</LinkButton>
    </div>
  )
}
