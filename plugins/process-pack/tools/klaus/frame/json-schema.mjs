/**
 * A small JSON Schema checker for klaus.config.schema.json, so the schema file
 * is the one place the config shape is defined and no dependency is needed.
 *
 * It supports only the keywords the schema uses, and no recursive schemas. A
 * schema that uses another keyword throws, so a keyword is never silently
 * ignored.
 *
 * Error messages name the path and the rule. They never repeat the value, so a
 * secret pasted into the config does not reach a CI log.
 */

// title doubles as the wording of an error: "must be <title>" for pattern, "<title>" for not.
const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description", "default", "examples"]);
const KEYWORDS = new Set([
  "type", "enum", "pattern", "minLength", "maxLength", "minimum", "maximum",
  "items", "minItems", "maxItems", "uniqueItems",
  "properties", "required", "additionalProperties",
  "not", "allOf", "$ref",
]);

const patterns = new Map();

function matchesPattern(pattern, value) {
  if (!patterns.has(pattern)) patterns.set(pattern, new RegExp(pattern));
  return patterns.get(pattern).test(value);
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported $ref "${ref}": only local "#/..." references work.`);
  let node = root;
  for (const part of ref.slice(2).split("/")) {
    node = node?.[part];
  }
  if (node === undefined) throw new Error(`Unresolved $ref "${ref}".`);
  return node;
}

function check(schema, value, path, root, errors) {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) {
      throw new Error(`Unsupported schema keyword "${key}" at ${path}.`);
    }
  }

  if (schema.$ref !== undefined) check(resolveRef(schema.$ref, root), value, path, root, errors);

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${path}: must be ${/^[aeiou]/.test(schema.type) ? "an" : "a"} ${schema.type}.`);
    return;
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}.`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: must be at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: must be at most ${schema.maxLength} characters.`);
    if (schema.pattern !== undefined && !matchesPattern(schema.pattern, value)) {
      errors.push(`${path}: must be ${schema.title ?? `a string matching ${schema.pattern}`}.`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be at most ${schema.maximum}.`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} items.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: allows at most ${schema.maxItems} items.`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) {
      errors.push(`${path}: items must be unique.`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, root, errors));
    }
  }

  if (typeOf(value) === "object") {
    for (const name of schema.required ?? []) {
      if (!(name in value)) errors.push(`${path}: "${name}" is required.`);
    }
    const known = schema.properties ?? {};
    for (const [name, child] of Object.entries(value)) {
      const childPath = path === "(root)" ? name : `${path}.${name}`;
      if (name in known) {
        check(known[name], child, childPath, root, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPath}: is not a setting Klaus knows.`);
      } else if (typeof schema.additionalProperties === "object") {
        check(schema.additionalProperties, child, childPath, root, errors);
      }
    }
  }

  for (const branch of schema.allOf ?? []) check(branch, value, path, root, errors);

  if (schema.not !== undefined) {
    const inner = [];
    check(schema.not, value, path, root, inner);
    if (inner.length === 0) errors.push(`${path}: ${schema.not.title ?? "matches a shape that is not allowed"}.`);
  }
}

/**
 * Checks a value against a schema and returns the problems, empty when valid.
 * @param {object} schema
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateAgainstSchema(schema, value) {
  const errors = [];
  check(schema, value, "(root)", schema, errors);
  return errors;
}
