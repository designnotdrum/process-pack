import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as look from '../decisions-look.mjs'

test('a colour is named in the words a person uses', () => {
  const names = [
    [[255, 255, 255, 1], 'white'],
    [[0, 0, 0, 1], 'black'],
    [[37, 99, 235, 1], 'blue'],
    [[254, 226, 226, 1], 'pale red'],
    [[17, 24, 39, 1], 'dark blue'],
    [[128, 128, 128, 1], 'grey'],
    [[229, 231, 235, 1], 'light grey'],
    [[22, 163, 74, 1], 'green'],
    [[0, 0, 0, 0], 'transparent'],
  ]
  for (const [rgba, name] of names) assert.equal(look.colorName(rgba), name, JSON.stringify(rgba))
})

test('class names are read into plain traits, and a variant such as hover is left out', () => {
  const traits = look.classTraits(['inline-flex', 'rounded-md', 'bg-white', 'shadow', 'h-10', 'px-4', 'hover:bg-red-500', 'font-semibold', 'text-sm', 'border'])
  assert.deepEqual(traits, { background: 'a white background', corners: 'rounded corners', shadow: 'a shadow', height: 'about 40px tall', border: 'a border', weight: 'semibold text', size: 'small text' })
})

test('theme colours and numbered shades are named without guessing', () => {
  assert.equal(look.classTraits(['bg-blue-600']).background, 'a blue background')
  assert.equal(look.classTraits(['bg-red-100']).background, 'a pale red background')
  assert.equal(look.classTraits(['bg-gray-900']).background, 'a dark grey background')
  assert.equal(look.classTraits(['bg-primary']).background, "a background from the theme (primary)")
  assert.equal(look.classTraits(['bg-transparent']).background, 'no background')
  assert.equal(look.classTraits(['rounded-none']).corners, 'square corners')
  assert.equal(look.classTraits(['rounded-full']).corners, 'fully round corners')
  assert.equal(look.classTraits(['shadow-none']).shadow, 'no shadow')
  assert.equal(look.classTraits(['text-white']).color, 'white text')
})

test('the class-name difference is one sentence, naming each side, with at most three things', () => {
  const sentence = look.describeClassDifference(['rounded-md', 'bg-blue-600', 'shadow-none', 'h-6'], ["rounded-full", 'bg-white', 'shadow', 'h-8', 'border', 'font-bold'], "the shared UI package's Switch", "the web app's own Switch")
  assert.equal(sentence, "The shared UI package's Switch has a blue background and rounded corners, and is about 24px tall; the web app's own Switch has a white background and fully round corners, and is about 32px tall.")
})

test('a trait only one side writes is reported when its absence is plain, such as a shadow', () => {
  const sentence = look.describeClassDifference(['shadow-md'], [], 'the shared one', 'the other one')
  assert.equal(sentence, 'The shared one has a shadow; the other one has no shadow.')
  assert.equal(look.describeClassDifference(['bg-white'], [], 'a', 'b'), null, 'a missing background cannot be called anything')
})

test('class names that say the same thing give no sentence', () => {
  assert.equal(look.describeClassDifference(['rounded-md', 'p-2'], ['rounded-md', 'p-4'], 'a', 'b'), null)
})

test('the measured difference compares what was drawn and names each side', () => {
  const blue = { w: 44, h: 24, bg: [37, 99, 235, 1], color: [255, 255, 255, 1], radius: 9999, borderWidth: 0, shadow: false, fontSize: 14, fontWeight: 500 }
  const pale = { w: 56, h: 32, bg: [255, 255, 255, 1], color: [17, 24, 39, 1], radius: 6, borderWidth: 1, shadow: true, fontSize: 14, fontWeight: 500 }
  const sentence = look.describeMeasuredDifference(blue, pale, "the shared UI package's Switch", "the web app's own Switch")
  assert.equal(sentence, "The shared UI package's Switch has a blue background and white text, and is 24px tall; the web app's own Switch has a white background and dark blue text, and is 32px tall.")
})

test('two looks that match on what is measured say only that, and do not call the components the same', () => {
  const a = { w: 100, h: 40, bg: [37, 99, 235, 1], color: [255, 255, 255, 1], radius: 6, borderWidth: 0, shadow: false, fontSize: 14, fontWeight: 500 }
  const b = { ...a, w: 102, h: 41 }
  assert.equal(look.describeMeasuredDifference(a, b, 'the shared one', 'the other one'), 'Look at the picture. Colour, corners, border and shadow measure the same, which does not cover what each one shows.')
})

test('a difference in corners, borders and shadows is said when colours and size match', () => {
  const a = { w: 100, h: 40, bg: [37, 99, 235, 1], color: [255, 255, 255, 1], radius: 6, borderWidth: 0, shadow: false, fontSize: 14, fontWeight: 500 }
  const b = { ...a, radius: 0, borderWidth: 1, shadow: true }
  assert.equal(look.describeMeasuredDifference(a, b, 'the shared one', 'the other one'), 'The shared one has rounded corners, no border and no shadow; the other one has square corners, a border and a shadow.')
})

test('the sentences make no claim about accessibility', () => {
  const a = { w: 100, h: 40, bg: [255, 255, 255, 1], color: [200, 200, 200, 1], radius: 6, borderWidth: 0, shadow: false, fontSize: 14, fontWeight: 500 }
  const b = { ...a, color: [0, 0, 0, 1], bg: [0, 0, 0, 1], fontSize: 20 }
  for (const text of [look.describeMeasuredDifference(a, b, 'a', 'b'), look.describeClassDifference(['text-gray-300', 'bg-white'], ['text-black', 'bg-black'], 'a', 'b')]) assert.doesNotMatch(String(text), /accessib|WCAG|contrast|legible|readable/i)
})
