/**
 * A small stand-in for the Figma Plugin API, enough to run the generated code
 * in a test. It keeps a tree of nodes, pages and variables, and it refuses the
 * same things Figma refuses that the generated code could trip on: text
 * written before its font is loaded, and a second current-page switch. As in
 * Figma, every new node starts on the current page.
 */

let counter = 0;

/**
 * Turns a paint bound to a variable into the paint Figma shows: the same paint with the variable's
 * colour now. createFigma sets it. The fake serves one Figma at a time.
 */
let resolvePaint = (paint) => paint;
const nextId = () => `${Math.floor(counter / 100)}:${counter++ % 100}`;

class Node {
  constructor(type, extra = {}) {
    this.id = nextId();
    this.type = type;
    this.name = type.toLowerCase();
    this.children = [];
    this.parent = null;
    this.x = 0;
    this.y = 0;
    this.width = 100;
    this.height = 100;
    this.visible = true;
    // Fills and strokes are stored as written and read back with bound colours resolved, as Figma does.
    for (const key of ["fills", "strokes"]) {
      let stored = [];
      Object.defineProperty(this, key, { enumerable: true, get: () => stored.map(resolvePaint), set: (paints) => (stored = paints) });
    }
    Object.assign(this, extra);
  }

  appendChild(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    node.parent = this;
    this.children.push(node);
  }

  remove() {
    if (this.removed) throw new Error(`The node ${this.id} was already removed.`);
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  findAll(test) {
    const found = [];
    for (const child of this.children) walk(child, (n) => test(n) && found.push(n));
    return found;
  }

  resize(width, height) {
    if (width < 0.01 || height < 0.01) throw new Error("Resize needs a size of at least 0.01.");
    this.width = width;
    this.height = height;
  }

  resizeWithoutConstraints(width, height) {
    this.resize(width, height);
  }

  addComponentProperty(name, type, value) {
    this.properties = { ...this.properties, [name]: { type, value } };
    return `${name}#${this.id}`;
  }
}

/** Every node in a tree, depth first. */
export function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/**
 * @param {object} [options]
 * @param {string[]} [options.pages]
 * @param {Record<string, string[]>} [options.fonts]  Styles per family.
 */
export function createFigma({ pages = ["Button"], fonts = { "DM Sans": ["Regular", "Medium", "Bold"], Inter: ["Regular", "Medium", "Bold"] } } = {}) {
  const loaded = new Set();
  const collections = [];
  const variables = [];
  const root = new Node("DOCUMENT");
  const makePage = (name) => {
    const page = new Node("PAGE", { name });
    page.loadAsync = async () => {};
    root.appendChild(page);
    return page;
  };
  pages.forEach(makePage);

  const onPage = (node) => {
    figma.currentPage.appendChild(node);
    return node;
  };
  const figma = {
    root,
    currentPage: root.children[0],
    calls: { createPage: 0 },
    createPage() {
      figma.calls.createPage += 1;
      return makePage("Page");
    },
    createFrame: () => onPage(new Node("FRAME", { clipsContent: true })),
    createComponent: () => onPage(new Node("COMPONENT")),
    createText() {
      const text = onPage(new Node("TEXT", { characters: "", width: 10, height: 20 }));
      let font = null;
      Object.defineProperty(text, "fontName", {
        get: () => font,
        set(value) {
          if (!loaded.has(`${value.family}/${value.style}`)) throw new Error(`Cannot write to node with unloaded font "${value.family} ${value.style}"`);
          font = value;
        },
      });
      return text;
    },
    createNodeFromSvg(svg) {
      if (typeof svg !== "string" || !svg.startsWith("<svg")) throw new Error("Not an SVG.");
      // Figma wraps the drawing in a frame with a white fill, whatever the markup says.
      const frame = onPage(new Node("FRAME", { name: "svg", width: 24, height: 24, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] }));
      frame.appendChild(new Node("VECTOR", { fills: [], strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] }));
      return frame;
    },
    combineAsVariants(components, parent) {
      const set = new Node("COMPONENT_SET");
      for (const component of components) set.appendChild(component);
      parent.appendChild(set);
      return set;
    },
    async setCurrentPageAsync(page) {
      figma.calls.setCurrentPage = (figma.calls.setCurrentPage ?? 0) + 1;
      if (figma.calls.setCurrentPage > 1) throw new Error("A call may switch the current page once.");
      figma.currentPage = page;
    },
    async listAvailableFontsAsync() {
      return Object.entries(fonts).flatMap(([family, styles]) => styles.map((style) => ({ fontName: { family, style } })));
    },
    async loadFontAsync(font) {
      if (!fonts[font.family]?.includes(font.style)) throw new Error(`The font ${font.family} ${font.style} does not exist.`);
      loaded.add(`${font.family}/${font.style}`);
    },
    variables: {
      async getLocalVariableCollectionsAsync() {
        return collections;
      },
      async getLocalVariablesAsync(type) {
        return variables.filter((v) => !type || v.resolvedType === type);
      },
      createVariableCollection(name) {
        const collection = { id: `VariableCollectionId:${collections.length}`, name, modes: [{ modeId: "m1", name: "Mode 1" }] };
        collection.renameMode = (id, to) => {
          collection.modes.find((m) => m.modeId === id).name = to;
        };
        collections.push(collection);
        return collection;
      },
      createVariable(name, collection, resolvedType) {
        const variable = {
          id: `VariableID:${variables.length}`,
          name,
          resolvedType,
          variableCollectionId: collection.id,
          valuesByMode: {},
          scopes: ["ALL_SCOPES"],
          codeSyntax: {},
          setValueForMode(mode, value) {
            variable.valuesByMode[mode] = value;
          },
          setVariableCodeSyntax(platform, value) {
            variable.codeSyntax[platform] = value;
          },
        };
        variables.push(variable);
        return variable;
      },
      setBoundVariableForPaint(paint, field, variable) {
        return { ...paint, boundVariables: { [field]: { type: "VARIABLE_ALIAS", id: variable.id } } };
      },
    },
  };
  resolvePaint = (paint) => {
    const id = paint.boundVariables?.color?.id;
    const variable = id && variables.find((v) => v.id === id);
    if (!variable) return paint;
    const { r, g, b } = Object.values(variable.valuesByMode)[0];
    return { ...paint, color: { r, g, b } };
  };
  figma.collections = collections;
  figma.variableList = variables;
  figma.page = (name) => root.children.find((p) => p.name === name);
  return figma;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * Runs generated code the way use_figma does: as the body of an async function with `figma` in scope.
 *
 * Trust boundary: `code` must be code the adapter's own codegen produced inside this test suite.
 * The Function constructor runs it with the full privileges of the test process, so never pass it
 * anything else, and keep dynamic execution in this file.
 */
export function runCode(code, figma) {
  return new AsyncFunction("figma", code)(figma);
}
