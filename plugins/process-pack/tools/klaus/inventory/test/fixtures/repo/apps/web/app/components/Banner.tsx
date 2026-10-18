import { Greeting } from './Greeting'
import { StarIcon } from './icons/star'

/**
 * Use when: the whole app shows one message above the content.
 * Not for: a message about a single item.
 */
export function Banner() {
  return (
    <section>
      <StarIcon />
      <Greeting />
    </section>
  )
}
