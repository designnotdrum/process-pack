/**
 * The visible difference between two components, in one plain sentence.
 *
 * There are two sources. When both components were drawn from a story, their computed styles are
 * compared (describeMeasuredDifference). Otherwise the class names each one writes are read for the
 * few things a person can see at a glance: colour, size, corners, border and shadow
 * (describeClassDifference). Both give at most three differences, each said the same way for the
 * two sides. Neither says anything about how usable a component is for a particular person.
 */

const NAMES_PALETTE = {
  slate: 'grey', gray: 'grey', zinc: 'grey', neutral: 'grey', stone: 'grey',
  red: 'red', rose: 'red',
  orange: 'orange', amber: 'orange',
  yellow: 'yellow',
  lime: 'green', green: 'green', emerald: 'green',
  teal: 'teal', cyan: 'teal',
  sky: 'blue', blue: 'blue', indigo: 'blue',
  violet: 'purple', purple: 'purple', fuchsia: 'purple',
  pink: 'pink',
}
const THEME_COLOURS = new Set(['primary', 'secondary', 'background', 'foreground', 'card', 'popover', 'muted', 'accent', 'destructive'])

/**
 * A component that writes more class names than this has several parts, and its class names
 * cannot be told apart by part: a background may be the card's or a button's inside it. Beyond
 * this, no sentence is read from them.
 */
export const READABLE_CLASS_COUNT = 12

/** The order differences are reported in. At most three are kept. */
const ORDER = ['background', 'color', 'height', 'corners', 'border', 'shadow', 'weight', 'size', 'decoration']
const MOST = 3

const upperFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const listOf = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** A colour as [r, g, b, a] (0 to 255, alpha 0 to 1) in the words a person uses: white, pale red, dark blue, light grey. */
export function colorName([r, g, b, a = 1]) {
  if (a < 0.05) return 'transparent'
  const [red, green, blue] = [r, g, b].map((v) => v / 255)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const light = (max + min) / 2
  const delta = max - min
  // A colour with almost no spread between its channels is a grey, whatever its saturation works out to.
  if (delta < 0.06) {
    if (light >= 0.97) return 'white'
    if (light <= 0.06) return 'black'
    if (light > 0.8) return 'light grey'
    if (light < 0.25) return 'dark grey'
    return 'grey'
  }
  let hue
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  hue = (hue * 60 + 360) % 360
  const family = hue < 15 || hue >= 345 ? 'red' : hue < 45 ? 'orange' : hue < 70 ? 'yellow' : hue < 165 ? 'green' : hue < 200 ? 'teal' : hue < 255 ? 'blue' : hue < 290 ? 'purple' : 'pink'
  return light > 0.85 ? `pale ${family}` : light < 0.28 ? `dark ${family}` : family
}

/** The name for a palette colour such as `blue-600`, from its shade. */
function paletteName(color, shade) {
  const family = NAMES_PALETTE[color]
  const n = Number(shade)
  if (!family || !Number.isFinite(n)) return null
  if (family === 'grey') return n <= 200 ? 'light grey' : n >= 800 ? 'dark grey' : 'grey'
  return n <= 200 ? `pale ${family}` : n >= 800 ? `dark ${family}` : family
}

/** A colour class's value: `white`, `black`, `blue-600`, or null when it is a theme or odd value. */
function colourOfClass(value) {
  if (value === 'white' || value === 'black') return value
  const found = /^([a-z]+)-(\d{2,3})$/.exec(value)
  return found ? paletteName(found[1], found[2]) : null
}

const SIZES = { xs: 'extra small text', sm: 'small text', base: 'normal-size text', lg: 'large text', xl: 'very large text' }
const WEIGHTS = { bold: 'bold text', extrabold: 'bold text', semibold: 'semibold text', medium: 'medium-weight text', normal: 'regular text', light: 'light text', thin: 'light text' }

/**
 * What a list of class names says about the look, for the few things that can be said plainly. A
 * class with a variant in front of it, such as hover: or md:, says nothing about the default look
 * and is left out. Each trait is a short phrase that follows "has" (or "is", for the height).
 */
export function classTraits(tokens) {
  const traits = {}
  for (const raw of tokens) {
    const token = raw.replace(/^!/, '')
    if (token.includes(':') || token.includes('[') || token.includes('/')) continue
    let found
    if ((found = /^bg-(.+)$/.exec(token))) {
      const value = found[1]
      const named = colourOfClass(value)
      if (value === 'transparent') traits.background = 'no background'
      else if (named) traits.background = `a ${named} background`
      else if (THEME_COLOURS.has(value)) traits.background = `a background from the theme (${value})`
    } else if ((found = /^text-(.+)$/.exec(token))) {
      const value = found[1]
      const named = colourOfClass(value)
      if (SIZES[value]) traits.size = SIZES[value]
      else if (/^[2-9]xl$/.test(value)) traits.size = SIZES.xl
      else if (named) traits.color = `${named} text`
      else if (THEME_COLOURS.has(value)) traits.color = `text from the theme (${value})`
    } else if (token === 'rounded-none') traits.corners = 'square corners'
    else if (token === 'rounded-full') traits.corners = 'fully round corners'
    else if (/^rounded(-(sm|md|lg))?$/.test(token)) traits.corners = 'rounded corners'
    else if (/^rounded-(xl|2xl|3xl)$/.test(token)) traits.corners = 'very rounded corners'
    else if (token === 'shadow-none') traits.shadow = 'no shadow'
    else if (token === 'shadow-sm') traits.shadow = 'a small shadow'
    else if (/^shadow(-(md|inner))?$/.test(token)) traits.shadow = 'a shadow'
    else if (/^shadow-(lg|xl|2xl)$/.test(token)) traits.shadow = 'a large shadow'
    else if (token === 'border-none' || token === 'border-0') traits.border = 'no border'
    else if (token === 'border' || /^border-[1-9]$/.test(token)) traits.border = 'a border'
    else if ((found = /^h-(\d+(?:\.\d+)?)$/.exec(token))) traits.height = `about ${Math.round(Number(found[1]) * 4)}px tall`
    else if ((found = /^font-(bold|extrabold|semibold|medium|normal|light|thin)$/.exec(token))) traits.weight = WEIGHTS[found[1]]
    else if (token === 'underline') traits.decoration = 'underlined text'
    else if (token === 'uppercase') traits.decoration = 'capital letters'
  }
  return traits
}

/** Traits that are plainly absent when a component writes no class for them. */
const ABSENT_WHEN_MISSING = { shadow: 'no shadow', border: 'no border', decoration: null }

/** The sentence for two sets of phrases, each keyed by trait. */
function sentenceOf(nameA, nameB, a, b) {
  const traits = ORDER.filter((trait) => a[trait] !== undefined && b[trait] !== undefined && a[trait] !== b[trait]).slice(0, MOST)
  if (traits.length === 0) return null
  const side = (name, phrases) => {
    const has = traits.filter((t) => t !== 'height').map((t) => phrases[t])
    const is = traits.filter((t) => t === 'height').map((t) => phrases[t])
    const parts = []
    if (has.length > 0) parts.push(`has ${listOf(has)}`)
    if (is.length > 0) parts.push(`is ${is[0]}`)
    return `${name} ${parts.join(', and ')}`
  }
  return `${upperFirst(side(nameA, a))}; ${side(nameB, b)}.`
}

/**
 * One sentence on how two components differ, read from the class names each writes. Null when
 * nothing plain can be said.
 *
 * @param {string[]} keepTokens
 * @param {string[]} dropTokens
 * @param {string} keepName How the first side is named in the sentence.
 * @param {string} dropName
 */
export function describeClassDifference(keepTokens, dropTokens, keepName, dropName) {
  const a = classTraits(keepTokens)
  const b = classTraits(dropTokens)
  // A shadow or a border that one side does not write is not there. A background that one side does not write could be anything.
  for (const [trait, absent] of Object.entries(ABSENT_WHEN_MISSING)) {
    if (!absent) continue
    if (a[trait] !== undefined && b[trait] === undefined) b[trait] = absent
    if (b[trait] !== undefined && a[trait] === undefined) a[trait] = absent
  }
  return sentenceOf(keepName, dropName, a, b)
}

const cornersOf = (look) => (look.radius <= 0.5 ? 'square corners' : look.radius >= Math.min(look.w, look.h) / 2 ? 'fully round corners' : 'rounded corners')

/** The traits of a drawn component, as phrases. */
function measuredTraits(look) {
  const bg = colorName(look.bg)
  return {
    background: bg === 'transparent' ? 'no background' : `a ${bg} background`,
    color: `${colorName(look.color)} text`,
    height: `${Math.round(look.h)}px tall`,
    corners: cornersOf(look),
    border: look.borderWidth > 0 ? 'a border' : 'no border',
    shadow: look.shadow ? 'a shadow' : 'no shadow',
    weight: look.fontWeight >= 600 ? 'bold text' : 'regular text',
    size: `${Math.round(look.fontSize)}px text`,
  }
}

/**
 * One sentence on how two drawn components differ, from their computed styles. Sizes within a few
 * pixels and colours with the same name count as the same. Only colour, corners, border, shadow,
 * text and the height of a control are measured, so "nothing measured" is not "the same".
 *
 * @param {object} a The first side: { w, h, bg, color, radius, borderWidth, shadow, fontSize, fontWeight }.
 * @param {object} b
 */
export function describeMeasuredDifference(a, b, nameA, nameB) {
  const left = measuredTraits(a)
  const right = measuredTraits(b)
  // A tall box is as tall as its content, which says nothing about the design. Only a control-sized one has a height of its own.
  if (Math.abs(a.h - b.h) < 4 || Math.max(a.h, b.h) > 80) delete right.height
  if (Math.abs(a.fontSize - b.fontSize) < 2) delete right.size
  if (colorName(a.bg) === colorName(b.bg)) delete right.background
  if (colorName(a.color) === colorName(b.color)) delete right.color
  for (const trait of Object.keys(left)) if (right[trait] === undefined) delete left[trait]
  return sentenceOf(nameA, nameB, left, right) ?? 'Look at the picture. Colour, corners, border and shadow measure the same, which does not cover what each one shows.'
}
