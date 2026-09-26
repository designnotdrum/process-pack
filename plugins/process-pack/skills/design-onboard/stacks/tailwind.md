# Stack reference: Tailwind and shadcn

Covers Next.js, Vite, Astro, or any web app styled with Tailwind, with or without shadcn/ui.

## How to detect it

The `tailwind` entry in `stacks.json`: a `tailwind.config.*` file at the app root, or `tailwindcss` in a `package.json` dependency list. Tailwind v4 projects often have no config file, so the dependency check is the one that usually matches.

Tell v3 from v4 by the installed `tailwindcss` major version. A v4 project imports Tailwind in CSS with `@import "tailwindcss";`.

UI files are the entry's `ui_globs` (`.tsx`, `.jsx`, `.css`, `.html`), minus the shared `exclude_globs`.

## Where tokens go

Tokens are CSS custom properties in the app's global stylesheet (`app/globals.css` in a Next.js App Router app, `src/app/globals.css` with a `src/` directory, `src/index.css` in Vite). One block per theme:

```css
:root {
  --background: oklch(0.99 0 0);
  --foreground: oklch(0.2 0.01 250);
  --primary: oklch(0.45 0.12 250);
  --primary-foreground: oklch(0.99 0 0);
}

.dark {
  --background: oklch(0.16 0.01 250);
  --foreground: oklch(0.96 0 0);
}
```

Those values are an example of the shape, not a palette. The real values come from DESIGN.md.

- **Tailwind v4:** map each token to a utility in an `@theme inline` block, for example `--color-background: var(--background);`. That makes `bg-background` and `text-foreground` exist.
- **Tailwind v3:** map each token in `tailwind.config` under `theme.extend.colors`, for example `background: "var(--background)"`.
- **shadcn/ui:** its `init` writes this same structure. Replace its default values with DESIGN.md's, keep its token names so its components pick them up, and add any semantic tokens DESIGN.md defines (status colors, an AI marker) with a name that says what they mean.

Name tokens for their job (`--destructive`, `--success`), never for their hue (`--red-500`).

## What blocks hardcoded colors

`check-design-tokens.mjs`, from this skill's `assets/web/`. It flags palette classes such as `text-orange-600`, arbitrary color classes such as `bg-[#ff0000]`, hex string literals, and `rgb()`, `hsl()`, `oklch()`, `lab()` and `lch()` values, across all app code. The token file is exempt. A line with `design-tokens-allow: <reason>` is exempt; use it only when Nick approves the literal.

1. Copy `assets/web/check-design-tokens.mjs` to the repo's `scripts/`.
2. Add it to the `lint` script, so it runs wherever lint runs:

   ```json
   "lint": "<existing lint command> && node scripts/check-design-tokens.mjs --tokens app/globals.css"
   ```

   In a monorepo, add it to each app's own `lint` script with that app's token file. Limit it to parts of the repo with `--glob "app/**" --glob "components/**"` if the repo holds vendored UI code that is out of scope.
3. Run it once. Fix every hit in code the onboarding wrote. For hits in code that already existed, fix them or list them as debt tickets when the repo already had UI.

## How contrast is checked

`design-tokens-contrast.mjs` and `design-tokens-contrast.test.mjs`, from `assets/web/`, ported from Meridian's `design-tokens-contrast.test.ts`. The test reads the real token file, so a token that regresses fails the test the moment it changes. It reads hex, `rgb()`, `hsl()`, bare HSL triplets (`222 47% 11%`), and `oklch()`, follows `var()` chains, and refuses colors with alpha instead of guessing.

1. Copy both files to the repo's `scripts/`.
2. Copy `assets/web/contrast-pairs.example.json` to `.process/contrast-pairs.json`. Keep the pairs whose tokens exist. Add one pair for every combination of a text or icon token on a surface token that DESIGN.md defines. Use 4.5 for text, and 3 for large text, icons, and focus rings.
3. Add a script and run it:

   ```json
   "test:contrast": "DESIGN_TOKENS_FILE=app/globals.css node --test scripts/design-tokens-contrast.test.mjs"
   ```

It runs one test per pair per theme, named like `dark --foreground on --background >= 4.5`. A failing test names both colors and the ratio.
