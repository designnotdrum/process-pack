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
 * What the story declares: the names of its args with their types, and whether its children arg is
 * markup rather than text. Storybook's preview keeps the rendered story on window.__STORYBOOK_PREVIEW__.
 * A build without it gives no args, and the label rule keeps its old meaning.
 */
export function storyFacts() {
  const story = window.__STORYBOOK_PREVIEW__?.currentRender?.story;
  const argTypes = story?.argTypes ?? {};
  const children = story?.initialArgs?.children;
  return {
    args: Object.keys(argTypes).map((name) => ({ name, type: argTypes[name]?.type?.name ?? null })),
    childrenIsMarkup: children !== undefined && children !== null && typeof children !== "string" && typeof children !== "number",
  };
}

/**
 * Finds the elements the story's component drew and marks them with data-klaus-part, in order, for
 * readStory. It also marks a closed overlay trigger among them with data-klaus-trigger.
 *
 * The component is the story's own (Storybook's `component`), found in React's fiber tree, so a
 * story decorator's wrapper is not read, and an overlay's content in a portal outside
 * #storybook-root is. Without React or without a component, the parts are the first element the
 * story drew, plus positioned elements outside the story root that are not Storybook's own.
 *
 * A modal draws a backdrop over the whole window. The parts are then what is above the last
 * backdrop: the backdrop and the trigger under it are left out.
 *
 * A part is a trigger when it is itself a closed popup trigger (aria-haspopup or a combobox, with
 * aria-expanded false), which is clicked, or a closed element that has no aria-expanded, such as a
 * tooltip's, which is hovered. A popup trigger deeper inside a part, such as a select in a form,
 * is left closed.
 *
 * @returns {{ via: "component" | "root", parts: number, trigger: "click" | "hover" | null }}
 */
export function markComponent() {
  const notDrawn = ["STYLE", "SCRIPT", "LINK", "META", "TEMPLATE", "NOSCRIPT"];
  for (const old of document.querySelectorAll("[data-klaus-part], [data-klaus-trigger]")) {
    old.removeAttribute("data-klaus-part");
    old.removeAttribute("data-klaus-trigger");
  }
  const host = document.querySelector("#storybook-root");
  if (!host) return { via: "root", parts: 0, trigger: null };

  /** The drawn elements an element stands for: itself, or its children when it has no area of its own. */
  function expand(element, out, depth = 0) {
    if (!element.isConnected || notDrawn.includes(element.tagName) || depth > 20) return out;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return out;
    const rect = element.getBoundingClientRect();
    if (style.display === "contents" || rect.width === 0 || rect.height === 0) {
      for (const child of element.children) expand(child, out, depth + 1);
      return out;
    }
    // Drawn for screen readers only, such as a live region of one clipped pixel.
    if (rect.width <= 1 && rect.height <= 1 && style.overflowX !== "visible") return out;
    out.push(element);
    return out;
  }

  /** The elements React drew for the story's component, in order, through portals too. */
  function fromReact() {
    const component = window.__STORYBOOK_PREVIEW__?.currentRender?.story?.component;
    const key = Object.keys(host).find((name) => name.startsWith("__reactContainer$"));
    // The container keeps the fiber of the first render; the root's current tree is the drawn one.
    const current = key ? host[key]?.stateNode?.current : null;
    if (!component || !current) return null;
    let match = null;
    const stack = [current];
    for (let steps = 0; stack.length > 0 && steps < 200000; steps++) {
      const fiber = stack.pop();
      if (fiber.elementType === component || fiber.type === component) {
        match = fiber;
        break;
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
    if (!match) return null;
    const elements = [];
    // A portal's fiber (tag 4) is not an element. Its children are, wherever they are in the document.
    const walk = (fiber) => {
      for (let child = fiber.child; child; child = child.sibling) {
        if (child.tag !== 4 && child.stateNode?.nodeType === 1) elements.push(child.stateNode);
        else walk(child);
      }
    };
    walk(match);
    return elements;
  }

  function fromRoot() {
    const first = [...host.children].find((element) => !notDrawn.includes(element.tagName) && element.getClientRects().length > 0);
    const storybooks = (element) => element === host || element.id.startsWith("storybook-") || [...element.classList].some((name) => name.startsWith("sb-"));
    const outside = [...document.body.children]
      .filter((element) => !storybooks(element))
      .flatMap((element) => expand(element, []))
      .filter((element) => ["fixed", "absolute"].includes(getComputedStyle(element).position));
    return first ? [first, ...outside] : outside;
  }

  const found = fromReact();
  const via = found && found.length > 0 ? "component" : "root";
  let parts = (via === "component" ? found : fromRoot()).flatMap((element) => expand(element, []));

  const clickable = '[aria-expanded="false"]:is([aria-haspopup]:not([aria-haspopup="false"]), [role="combobox"])';
  const hoverable = ':is(button, a, [role="button"])[data-state="closed"]:not([aria-expanded])';
  const click = parts.find((element) => element.matches(clickable));
  const hover = click ? null : parts.find((element) => element.matches(hoverable));
  (click ?? hover)?.setAttribute("data-klaus-trigger", "");

  const backdrop = (element) => {
    const rect = element.getBoundingClientRect();
    return getComputedStyle(element).position === "fixed" && rect.width >= innerWidth - 1 && rect.height >= innerHeight - 1 && element.children.length === 0 && element.textContent.trim() === "";
  };
  const last = parts.findLastIndex(backdrop);
  if (last >= 0 && last < parts.length - 1) parts = parts.slice(last + 1);
  else parts = parts.filter((element) => !backdrop(element));

  parts.forEach((element, i) => element.setAttribute("data-klaus-part", String(i)));
  return { via, parts: parts.length, trigger: click ? "click" : hover ? "hover" : null };
}

/**
 * Reads what the story drew as a tree of boxes, text and icons: the parts markComponent marked, or
 * the first element the story drew when nothing is marked.
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
    // A story's root can start with a <style> or <script>; the component is the first child that draws.
    const notDrawn = ["STYLE", "SCRIPT", "LINK", "META", "TEMPLATE", "NOSCRIPT"];
    // markComponent marks the component's parts, which can sit outside the story root.
    const marked = useHost ? [] : [...document.querySelectorAll("[data-klaus-part]")].sort((a, b) => Number(a.dataset.klausPart) - Number(b.dataset.klausPart));
    const firstChild = host ? (useHost ? host : [...host.children].find((el) => !notDrawn.includes(el.tagName))) : null;
    const parts = marked.length > 0 ? marked : firstChild ? [firstChild] : [];
    if (parts.length === 0) return { error: `Nothing was drawn inside ${rootSelector}.` };

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
    // What the story drew. Each watched entry is [element, pseudo-element or null], whose colours are traced to tokens.
    const watched = [];
    const watch = (element, pseudo = null) => watched.push([element, pseudo]) - 1;
    let count = 0;
    let truncated = false;

    function textBox(textNode, parentElement, parentStyle) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
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
        watchIndex: watch(parentElement),
      };
    }

    /**
     * The text the browser draws inside an input or a text area: its value, or its placeholder in the
     * placeholder's colour. An input's one line sits in the middle of its content box, so the line is
     * as high as that box.
     */
    function fieldText(element, style, rect) {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (element.tagName === "INPUT" && ["hidden", "checkbox", "radio", "range", "color", "file", "image"].includes(type)) return null;
      const value = element.value ?? "";
      const shown = value !== "" ? (type === "password" ? "•".repeat(value.length) : value) : (element.placeholder ?? "");
      if (shown.trim() === "") return null;
      const pseudo = value === "" ? "::placeholder" : null;
      const ink = pseudo ? getComputedStyle(element, pseudo) : style;
      const sides = (a, b) => number(style[`padding${a}`]) + number(style[`border${a}Width`]) + number(style[`padding${b}`]) + number(style[`border${b}Width`]);
      const left = rect.x + number(style.paddingLeft) + number(style.borderLeftWidth);
      const top = rect.y + number(style.paddingTop) + number(style.borderTopWidth);
      const boxW = Math.max(0, rect.width - sides("Left", "Right"));
      const boxH = Math.max(0, rect.height - sides("Top", "Bottom"));
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const full = context.measureText(shown).width;
      const single = element.tagName === "INPUT";
      const lineHeight = single ? boxH : style.lineHeight === "normal" ? number(style.fontSize) * 1.2 : number(style.lineHeight);
      // A text area wraps its text across its width.
      const lines = single ? 1 : Math.max(1, Math.ceil(full / Math.max(boxW, 1)));
      return {
        kind: "text",
        text: shown.replace(/\s+/g, " ").trim(),
        x: round(left),
        y: round(top),
        w: round(single ? Math.min(boxW, full) : boxW),
        h: round(single ? boxH : Math.min(boxH, lines * lineHeight)),
        family: style.fontFamily,
        weight: number(style.fontWeight),
        size: number(style.fontSize),
        lineHeight: round(lineHeight),
        letterSpacing: style.letterSpacing === "normal" ? 0 : round(number(style.letterSpacing)),
        decoration: ink.textDecorationLine,
        transform: style.textTransform,
        color: colorOf(ink.color),
        watchIndex: watch(element, pseudo),
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
        position: style.position,
        opacity: number(style.opacity),
      };
    }

    /** A box for a rectangle that draws nothing itself, such as the frame around an overlay and its trigger. */
    function emptyBox(x, y, w, h, children) {
      return {
        kind: "box",
        tag: "div",
        x: round(x),
        y: round(y),
        w: round(w),
        h: round(h),
        display: "block",
        position: "static",
        direction: "row",
        alignItems: "normal",
        justifyContent: "normal",
        gap: [0, 0],
        padding: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        borderWidth: [0, 0, 0, 0],
        borderStyle: "none",
        borderColor: [0, 0, 0, 0],
        radius: [0, 0, 0, 0],
        background: [0, 0, 0, 0],
        backgroundImage: false,
        opacity: 1,
        clip: false,
        children,
      };
    }

    function box(element, depth) {
      count += 1;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const node = {
        kind: "box",
        tag: element.tagName.toLowerCase(),
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.width),
        h: round(rect.height),
        display: style.display,
        position: style.position,
        direction: style.flexDirection,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        gap: [round(number(style.rowGap)), round(number(style.columnGap))],
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((v) => round(number(v))),
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].map((v) => round(number(v))),
        borderWidth: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map((v) => round(number(v))),
        borderStyle: style.borderTopStyle,
        borderColor: colorOf(style.borderTopColor),
        radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map((v) => round(number(v))),
        background: colorOf(style.backgroundColor),
        backgroundImage: style.backgroundImage !== "none",
        opacity: number(style.opacity),
        clip: style.overflowX !== "visible" || style.overflowY !== "visible",
        watchIndex: watch(element),
        children: [],
      };
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        const words = fieldText(element, style, rect);
        if (words) node.children.push(words);
        return node;
      }
      readChildren(node, element, style, depth);
      return node;
    }

    /** Reads an element's children into node. A child drawn as display: contents adds its own children in its place. */
    function readChildren(node, element, style, depth) {
      for (const child of element.childNodes) {
        if (count >= maxNodes) {
          truncated = true;
          return;
        }
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.data.trim() === "") continue;
          count += 1;
          const leaf = textBox(child, element, style);
          if (leaf) node.children.push(leaf);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE || notDrawn.includes(child.tagName)) continue;
        const childStyle = getComputedStyle(child);
        if (childStyle.display === "none" || childStyle.visibility === "hidden") continue;
        if (childStyle.display === "contents") {
          readChildren(node, child, childStyle, depth);
          continue;
        }
        if (child.tagName.toLowerCase() === "svg") {
          count += 1;
          node.children.push(iconBox(child, childStyle));
          continue;
        }
        // Drawn for screen readers only: one clipped pixel, such as an sr-only label.
        const rect = child.getBoundingClientRect();
        if (rect.width <= 1 && rect.height <= 1 && childStyle.overflowX !== "visible") continue;
        if (depth < maxDepth) node.children.push(box(child, depth + 1));
        else truncated = true;
      }
    }

    // One part is the component's own box. Several, such as a trigger and its open overlay, sit in a
    // box that draws nothing and holds them all.
    let tree;
    if (parts.length === 1) tree = box(parts[0], 1);
    else {
      const read = parts.map((part) => box(part, 2));
      // What a part draws can reach past its own box, as a panel moved down from its positioned
      // wrapper does. Only a box that clips keeps its children inside it.
      const rects = [];
      const extent = (node) => {
        rects.push(node);
        if (node.kind === "box" && !node.clip) node.children.forEach(extent);
      };
      read.forEach(extent);
      const left = Math.min(...rects.map((n) => n.x));
      const top = Math.min(...rects.map((n) => n.y));
      const right = Math.max(...rects.map((n) => n.x + n.w));
      const bottom = Math.max(...rects.map((n) => n.y + n.h));
      tree = emptyBox(left, top, right - left, bottom - top, read);
    }

    // Which token each colour comes from.
    const properties = [
      ["background", "backgroundColor"],
      ["border", "borderTopColor"],
      ["color", "color"],
    ];
    const styleOf = ([element, pseudo]) => getComputedStyle(element, pseudo);
    const before = watched.map((entry) => {
      const style = styleOf(entry);
      return properties.map(([, property]) => style[property]);
    });
    const found = watched.map(() => ({}));
    const sentinel = { hsl: "123 87% 45%", rgb: "12 200 34", plain: "rgb(12, 200, 34)" };
    const holders = [document.documentElement, ...new Set(watched.map(([element]) => element))];
    for (const token of tokens) {
      // Put back what the page had set itself, so one capture does not change the next.
      const saved = holders.map((holder) => [holder, holder.style.getPropertyValue(token.name), holder.style.getPropertyPriority(token.name)]);
      for (const holder of holders) holder.style.setProperty(token.name, sentinel[token.kind], "important");
      watched.forEach((entry, index) => {
        const style = styleOf(entry);
        properties.forEach(([key, property], column) => {
          if (style[property] !== before[index][column]) (found[index][key] ??= []).push(token.name);
        });
      });
      for (const [holder, value, priority] of saved) {
        if (value === "") holder.style.removeProperty(token.name);
        else holder.style.setProperty(token.name, value, priority);
      }
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

    return { tree, classes: [...parts[0].classList], truncated, tokens: withTokens ? tokens : undefined };
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
