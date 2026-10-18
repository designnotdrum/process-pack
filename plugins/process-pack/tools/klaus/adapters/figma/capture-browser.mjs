/**
 * Code that runs inside the browser page, to read a story's computed styles.
 *
 * Playwright sends each function to the page as text, so every function here
 * stands alone: it may use nothing from this file's scope. They return plain
 * data, which capture.mjs turns into a component spec.
 *
 * The values are the browser's computed styles, not the CSS files. The CSS
 * files can disagree with what is drawn: on the Meridian Button they say an 8px
 * radius, and Tailwind's rounded-md makes the browser draw 6px.
 */

/** Names of the custom properties the page's style sheets declare, minus Tailwind's own. */
export function listCustomProperties() {
  const names = new Set();
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.style) {
        for (const property of rule.style) if (property.startsWith("--") && !property.startsWith("--tw-")) names.add(property);
      }
      if (rule.cssRules) visit(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // A style sheet from another origin cannot be read. Its names are not needed.
    }
  }
  return [...names];
}

/**
 * Reads the first element the story drew as a tree of boxes, text and icons.
 *
 * Which token a colour comes from is found by changing each candidate token on
 * the page and seeing which colours move. This works when two tokens hold the
 * same colour, which reading the value alone cannot tell apart.
 *
 * @param {{ candidates: string[], withTokens: boolean, maxDepth: number, maxNodes: number,
 *   rootSelector?: string, useHost?: boolean, bind?: boolean }} arg
 *   rootSelector is where to start, "#storybook-root" by default. useHost reads the host itself
 *   instead of its first child, which is how a whole page is read. bind false skips the search
 *   for tokens, which is slow on a page with hundreds of elements.
 */
export function readStory(arg) {
  // A button fades its colours in. Read the end values, not a frame of the fade.
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(freeze);
  // Used to ask the page whether a custom property is a colour.
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  try {
    return read(arg);
  } finally {
    // A page that fails halfway must not stay frozen for the next story.
    freeze.remove();
    probe.remove();
  }

  function read({ candidates, withTokens, maxDepth, maxNodes, rootSelector = "#storybook-root", useHost = false, bind = true }) {
    const host = document.querySelector(rootSelector);
    const rootElement = host ? (useHost ? host : host.firstElementChild) : null;
    if (!rootElement) return { error: `Nothing was drawn inside ${rootSelector}.` };

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    /** Any computed colour as [r, g, b, a], with r, g and b from 0 to 255 and a from 0 to 1. */
    function colorOf(css) {
      const text = String(css).trim();
      if (text === "transparent") return [0, 0, 0, 0];
      const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?\s*\)$/.exec(text);
      if (match) {
        const alpha = match[4] === undefined ? 1 : match[5] ? Number(match[4]) / 100 : Number(match[4]);
        return [Math.round(match[1]), Math.round(match[2]), Math.round(match[3]), Math.round(alpha * 1000) / 1000];
      }
      // Other colour syntaxes: let the canvas turn them into sRGB.
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = text;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2], Math.round((data[3] / 255) * 1000) / 1000];
    }

    const number = (value) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const round = (value) => Math.round(value * 100) / 100;

    // The colour tokens: each candidate that the page can draw as a colour.
    const rootStyle = getComputedStyle(document.documentElement);
    const tokens = [];
    for (const name of bind ? candidates : []) {
      const raw = rootStyle.getPropertyValue(name).trim();
      if (raw === "") continue;
      let kind = "plain";
      if (/^-?[\d.]+(deg)?[ ,]+[\d.]+%[ ,]+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(raw)) kind = "hsl";
      else if (/^\d+[ ,]+\d+[ ,]+\d+$/.test(raw)) kind = "rgb";
      const syntax = kind === "hsl" ? `hsl(var(${name}))` : kind === "rgb" ? `rgb(var(${name}))` : `var(${name})`;
      // background-color is not inherited, so a value that is not a colour computes to transparent.
      probe.style.backgroundColor = "";
      probe.style.backgroundColor = syntax;
      const computed = colorOf(getComputedStyle(probe).backgroundColor);
      if (computed[3] === 0) continue;
      tokens.push({ name, kind, syntax, rgba: computed });
    }
    // What the story drew.
    const watched = [];
    let count = 0;

    function textBox(textNode, parentElement, parentStyle) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      watched.push(parentElement);
      const lineHeight = parentStyle.lineHeight === "normal" ? number(parentStyle.fontSize) * 1.2 : number(parentStyle.lineHeight);
      return {
        kind: "text",
        text: textNode.data.replace(/\s+/g, " ").trim(),
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.width),
        h: round(rect.height),
        family: parentStyle.fontFamily,
        weight: number(parentStyle.fontWeight),
        size: number(parentStyle.fontSize),
        lineHeight: round(lineHeight),
        letterSpacing: parentStyle.letterSpacing === "normal" ? 0 : round(number(parentStyle.letterSpacing)),
        decoration: parentStyle.textDecorationLine,
        transform: parentStyle.textTransform,
        color: colorOf(parentStyle.color),
        watchIndex: watched.length - 1,
      };
    }

    function iconBox(svg, style) {
      const rect = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);
      clone.setAttribute("width", String(round(rect.width)));
      clone.setAttribute("height", String(round(rect.height)));
      const [r, g, b] = colorOf(style.color);
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      return {
        kind: "svg",
        html: clone.outerHTML.replace(/currentColor/gi, hex),
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.width),
        h: round(rect.height),
      };
    }

    function box(element, depth) {
      count += 1;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      watched.push(element);
      const node = {
        kind: "box",
        tag: element.tagName.toLowerCase(),
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.width),
        h: round(rect.height),
        display: style.display,
        direction: style.flexDirection,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        gap: [round(number(style.rowGap)), round(number(style.columnGap))],
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((v) => round(number(v))),
        borderWidth: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map((v) => round(number(v))),
        borderStyle: style.borderTopStyle,
        borderColor: colorOf(style.borderTopColor),
        radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map((v) => round(number(v))),
        background: colorOf(style.backgroundColor),
        backgroundImage: style.backgroundImage !== "none",
        opacity: number(style.opacity),
        clip: style.overflowX !== "visible" || style.overflowY !== "visible",
        watchIndex: watched.length - 1,
        children: [],
      };
      for (const child of element.childNodes) {
        if (count >= maxNodes) break;
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.data.trim() === "") continue;
          const leaf = textBox(child, element, style);
          if (leaf) node.children.push(leaf);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const childStyle = getComputedStyle(child);
        if (childStyle.display === "none" || childStyle.visibility === "hidden") continue;
        if (child.tagName.toLowerCase() === "svg") {
          count += 1;
          node.children.push(iconBox(child, childStyle));
          continue;
        }
        if (depth < maxDepth) node.children.push(box(child, depth + 1));
      }
      return node;
    }

    const tree = box(rootElement, 1);

    // Which token each colour comes from.
    const properties = [
      ["background", "backgroundColor"],
      ["border", "borderTopColor"],
      ["color", "color"],
    ];
    const before = watched.map((element) => {
      const style = getComputedStyle(element);
      return properties.map(([, property]) => style[property]);
    });
    const found = watched.map(() => ({}));
    const sentinel = { hsl: "123 87% 45%", rgb: "12 200 34", plain: "rgb(12, 200, 34)" };
    const holders = [document.documentElement, ...watched];
    for (const token of tokens) {
      for (const holder of holders) holder.style.setProperty(token.name, sentinel[token.kind], "important");
      watched.forEach((element, index) => {
        const style = getComputedStyle(element);
        properties.forEach(([key, property], column) => {
          if (style[property] !== before[index][column]) (found[index][key] ??= []).push(token.name);
        });
      });
      for (const holder of holders) holder.style.removeProperty(token.name);
    }
    // A palette step such as --gray-500 is behind a semantic token such as --muted. Prefer the semantic one,
    // and among those the last declared, which is the one nearest the component.
    const pick = (names) => {
      if (!names) return null;
      const semantic = names.filter((name) => !/-\d{2,3}$/.test(name));
      return (semantic.length > 0 ? semantic : names).at(-1);
    };
    const attach = (node) => {
      if (node.watchIndex !== undefined) {
        const names = found[node.watchIndex];
        node.bind = { background: pick(names.background), border: pick(names.border), color: pick(names.color) };
        delete node.watchIndex;
      }
      if (node.children) node.children.forEach(attach);
    };
    attach(tree);

    return { tree, classes: [...rootElement.classList], tokens: withTokens ? tokens : undefined };
  }
}

/**
 * Finds icons a story draws inside elements that look like the component's root.
 * An element looks like the root when it has every class in the signature.
 *
 * @param {{ signature: string[] }} arg
 * @returns {Array<{ html: string, w: number, h: number, position: "leading" | "trailing", gap: number }>}
 */
export function findIcons({ signature }) {
  const found = [];
  if (signature.length < 2) return found;
  for (const element of document.querySelectorAll("#storybook-root *")) {
    if (!signature.every((name) => element.classList.contains(name))) continue;
    const style = getComputedStyle(element);
    const children = [...element.childNodes].filter((n) => n.nodeType === Node.ELEMENT_NODE || n.data.trim() !== "");
    children.forEach((child, index) => {
      if (child.nodeType !== Node.ELEMENT_NODE || child.tagName.toLowerCase() !== "svg") return;
      const rect = child.getBoundingClientRect();
      const clone = child.cloneNode(true);
      clone.setAttribute("width", String(Math.round(rect.width * 100) / 100));
      clone.setAttribute("height", String(Math.round(rect.height * 100) / 100));
      const match = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(child).color);
      const hex = match ? `#${[1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, "0")).join("")}` : "#000000";
      found.push({
        html: clone.outerHTML.replace(/currentColor/gi, hex),
        w: Math.round(rect.width * 100) / 100,
        h: Math.round(rect.height * 100) / 100,
        position: index === 0 ? "leading" : "trailing",
        gap: Math.round((parseFloat(style.flexDirection.startsWith("column") ? style.rowGap : style.columnGap) || 0) * 100) / 100,
        loading: String(element.getAttribute("class") ?? "").includes("loading") || element.hasAttribute("aria-busy"),
      });
    });
  }
  return found;
}
