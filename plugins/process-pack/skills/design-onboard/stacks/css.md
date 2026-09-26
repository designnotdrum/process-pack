# Stack reference: plain CSS, Vue, Svelte, Astro

Covers web apps and sites styled with plain CSS or SCSS, including Vue, Svelte, SvelteKit, Astro, and Nuxt projects that do not use Tailwind.

## How to detect it

The `css` entry in `stacks.json`: `vue`, `svelte`, `@sveltejs/kit`, `astro`, or `nuxt` in a `package.json` dependency list, or a `svelte.config.js`, `astro.config.mjs`, `vite.config.*`, or `index.html` at the root. The `tailwind` entry is checked first, so a Tailwind project never lands here.

UI files are the entry's `ui_globs` (`.css`, `.scss`, `.vue`, `.svelte`, `.astro`, `.html`), minus the shared `exclude_globs`.

## Where tokens go

One custom-properties file, `src/styles/tokens.css` unless the repo already has a global stylesheet, imported once at the app's entry. One block per theme, the same shape as the Tailwind reference: `:root` for the default theme, and `.dark` or `[data-theme="dark"]` for the others. If the app follows the system setting, use `@media (prefers-color-scheme: dark) { :root { ... } }`; the contrast check reads that as the dark theme.

Components use `var(--token)` and nothing else for color. Name tokens for their job (`--surface`, `--text-muted`, `--danger`), never for their hue.

## What blocks hardcoded colors

Stylelint with `stylelint.design.json` from this skill's `assets/web/`. It turns on `color-no-hex`, `color-named: "never"`, and `function-disallowed-list` for `rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, and `oklch`. Its `ignoreFiles` exempts `globals.css` and `tokens.css`; change those globs to the repo's real token file.

1. Add Stylelint as a dev dependency, and copy `stylelint.design.json` to the repo root as `.stylelintrc.json`, or merge its rules into an existing Stylelint config.
2. Add it to the `lint` script: `stylelint "src/**/*.{css,scss,vue,svelte,astro}"`. Vue, Svelte, and Astro files need Stylelint's `postcss-html` custom syntax (`customSyntax: "postcss-html"` in an `overrides` entry); plain CSS and SCSS files do not.
3. Colors can also hide in script code (inline styles in Vue or Svelte). Run `check-design-tokens.mjs` from `assets/web/` as well, with `--tokens` pointing at the token file, to catch those.

Stylelint 16 was run against this skill's CSS fixtures on 2026-09-26: it flagged a hex value, `rgb()`, `oklch()`, and the named color `white`, and nothing in a file that used only `var()`.

## How contrast is checked

The same check as the Tailwind reference. Copy `design-tokens-contrast.mjs` and `design-tokens-contrast.test.mjs` from `assets/web/` to `scripts/`, set up `.process/contrast-pairs.json` from the example, and add:

```json
"test:contrast": "DESIGN_TOKENS_FILE=src/styles/tokens.css node --test scripts/design-tokens-contrast.test.mjs"
```
