/**
 * WCAG 2.x contrast checks over a repo's design tokens, read from the real
 * token file rather than a copy of its values, so a token that regresses
 * fails the check the moment it changes.
 *
 * Ported from Meridian's packages/ui/src/lib/contrast.ts. That version reads
 * opaque hex only. This one also reads rgb(), hsl(), bare shadcn HSL
 * triplets ("222 47% 11%"), and oklch(), because shadcn on Tailwind v4
 * writes oklch tokens. Like the original, it refuses any color with alpha
 * rather than guessing: a ratio for a color nobody renders is the silent
 * pass this check exists to prevent.
 *
 * No dependencies. Copied into a consuming repo by the design-onboard skill,
 * together with design-tokens-contrast.test.mjs.
 */

const SRGB_LINEAR_THRESHOLD = 0.03928;
const WCAG_CONTRAST_OFFSET = 0.05;
const MAX_VAR_DEPTH = 10;

function refuseAlpha(value) {
  throw new Error(`contrast: expected an opaque color, got "${value}"`);
}

function hexToRgb(value) {
  const digits = value.slice(1);
  if (digits.length === 4 || digits.length === 8) refuseAlpha(value);
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(digits)) {
    throw new Error(`contrast: expected an opaque 3- or 6-digit hex color, got "${value}"`);
  }
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Splits "a b c / d" or "a, b, c, d" into channel strings, refusing alpha. */
function channels(inner, original) {
  const [main, alpha] = inner.split("/");
  const parts = main.trim().split(/[\s,]+/).filter(Boolean);
  const alphaPart = alpha ?? parts[3];
  if (alphaPart !== undefined) {
    const a = alphaPart.trim();
    const isOpaque = a === "1" || a === "100%" || a === "1.0";
    if (!isOpaque) refuseAlpha(original);
  }
  if (parts.length < 3) throw new Error(`contrast: cannot read "${original}"`);
  return parts.slice(0, 3);
}

function number(part, percentScale = 1) {
  if (part === "none") return 0;
  if (part.endsWith("%")) return (Number.parseFloat(part) / 100) * percentScale;
  if (part.endsWith("deg")) return Number.parseFloat(part);
  return Number.parseFloat(part);
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(hue / 60);
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function gammaEncode(linear) {
  const v = Math.min(1, Math.max(0, linear));
  return (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
}

/** oklch to sRGB, per CSS Color 4 (oklch to oklab to linear sRGB), clamped to the sRGB gamut. */
function oklchToRgb(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gammaEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gammaEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gammaEncode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Parses one resolved color value into [r, g, b] on a 0 to 255 scale. */
export function parseColor(raw) {
  const value = raw.trim();
  if (value.startsWith("#")) return hexToRgb(value);
  const fn = /^(rgba?|hsla?|oklch)\((.*)\)$/i.exec(value);
  if (fn) {
    const kind = fn[1].toLowerCase();
    const [p0, p1, p2] = channels(fn[2], value);
    if (kind.startsWith("rgb")) return [number(p0, 255), number(p1, 255), number(p2, 255)];
    if (kind.startsWith("hsl")) return hslToRgb(number(p0), number(p1), number(p2));
    return oklchToRgb(number(p0), number(p1), number(p2));
  }
  const triplet = /^(-?[\d.]+(?:deg)?)\s+([\d.]+%)\s+([\d.]+%)$/.exec(value);
  if (triplet) return hslToRgb(number(triplet[1]), number(triplet[2]), number(triplet[3]));
  throw new Error(`contrast: cannot read "${raw}" as a color`);
}

function toLinear(channel) {
  const v = channel / 255;
  return v <= SRGB_LINEAR_THRESHOLD ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio between two [r, g, b] colors. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + WCAG_CONTRAST_OFFSET) / (Math.min(la, lb) + WCAG_CONTRAST_OFFSET);
}

/**
 * Which theme a block belongs to, from its selector and the selectors of
 * every block around it. Returns null for blocks that declare no theme.
 */
function themeOf(stack) {
  const inDarkMedia = stack.some((s) => /prefers-color-scheme\s*:\s*dark/.test(s));
  const selector = stack.at(-1).trim();
  const dataTheme = /^\[data-theme=["']?([\w-]+)["']?\]$/.exec(selector);
  if (dataTheme) return dataTheme[1];
  if (selector === ".dark" || selector === ":root.dark" || selector === "html.dark") return "dark";
  if (selector === ":root" || selector === "html" || selector.startsWith("@theme")) {
    return inDarkMedia ? "dark" : "root";
  }
  return null;
}

/**
 * Reads every custom property per theme. The "root" theme is :root, html,
 * and Tailwind v4 @theme blocks. Every other theme starts from root's values
 * with its own declarations layered on top, the way the cascade composes
 * them at runtime. Later declarations win.
 */
export function parseThemes(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const own = new Map();
  const stack = [];
  let text = "";
  for (const ch of source) {
    if (ch === "{") {
      stack.push(text.trim());
      text = "";
    } else if (ch === "}") {
      const theme = stack.length ? themeOf(stack) : null;
      if (theme) {
        if (!own.has(theme)) own.set(theme, new Map());
        for (const m of text.matchAll(/--([\w-]+)\s*:\s*([^;]+);?/g)) {
          own.get(theme).set(m[1], m[2].trim());
        }
      }
      stack.pop();
      text = "";
    } else {
      text += ch;
    }
  }
  const root = own.get("root") ?? new Map();
  const themes = { root };
  for (const [name, vars] of own) {
    if (name === "root") continue;
    themes[name] = new Map([...root, ...vars]);
  }
  return themes;
}

/** Follows var(--x) chains (with optional fallbacks) to a literal value. */
export function resolveToken(vars, token, depth = 0) {
  if (depth > MAX_VAR_DEPTH) throw new Error(`--${token}: var() chain is circular or too deep`);
  const raw = vars.get(token);
  if (raw === undefined) throw new Error(`--${token} is not declared in this theme`);
  const ref = /^var\(\s*--([\w-]+)\s*(?:,\s*(.+))?\)$/.exec(raw.trim());
  if (!ref) return raw.trim();
  if (!vars.has(ref[1]) && ref[2] !== undefined) return ref[2].trim();
  return resolveToken(vars, ref[1], depth + 1);
}

const bare = (name) => name.replace(/^--/, "");

/**
 * Checks each pair in each theme. Never throws: an unreadable or missing
 * token is a failed result with the reason in its message.
 */
export function checkPairs(themes, pairs) {
  const results = [];
  for (const [theme, vars] of Object.entries(themes)) {
    for (const { fg, bg, min } of pairs) {
      const name = `${theme} ${fg} on ${bg} >= ${min}`;
      try {
        const fgValue = resolveToken(vars, bare(fg));
        const bgValue = resolveToken(vars, bare(bg));
        const ratio = contrastRatio(parseColor(fgValue), parseColor(bgValue));
        const shown = ratio.toFixed(2);
        results.push({
          theme,
          name,
          ratio,
          pass: ratio >= min,
          message: `${theme}: ${fg} (${fgValue}) on ${bg} (${bgValue}) is ${shown}, needs ${min}`,
        });
      } catch (error) {
        results.push({ theme, name, ratio: null, pass: false, message: `${theme}: ${error.message}` });
      }
    }
  }
  return results;
}
