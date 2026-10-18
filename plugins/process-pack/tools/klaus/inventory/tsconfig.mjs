import fs from 'node:fs'
import path from 'node:path'

/**
 * Finds and parses the tsconfig.json nearest to a file, once per config. Each app in a monorepo
 * carries its own path aliases and JSX settings, so the type checker and the import resolver
 * both need the config of the app a file belongs to, not one global config.
 */
export function createTsconfigLoader(ts, root) {
  const nearest = new Map()
  const parsed = new Map()
  const options = new Map()

  function nearestConfig(dir) {
    if (nearest.has(dir)) return nearest.get(dir)
    const candidate = path.join(dir, 'tsconfig.json')
    let found = null
    if (fs.existsSync(candidate)) found = candidate
    else if (dir !== root && dir !== path.dirname(dir)) found = nearestConfig(path.dirname(dir))
    nearest.set(dir, found)
    return found
  }

  function parse(configPath) {
    if (!parsed.has(configPath)) {
      const read = ts.readConfigFile(configPath, ts.sys.readFile)
      parsed.set(configPath, read.error ? null : ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), {}, configPath))
    }
    return parsed.get(configPath)
  }

  /** Used when a file has no tsconfig above it. Enough for the checker to read plain React code. */
  const fallback = {
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
  }

  return {
    /** The tsconfig path for a file, or null. */
    configFor: (file) => nearestConfig(path.dirname(file)),
    /**
     * Compiler options for a file, with the settings that only matter for emitting removed. The
     * same object comes back for every file of one config, so module resolution caches can key on it.
     */
    optionsFor(file) {
      const configPath = nearestConfig(path.dirname(file))
      const config = configPath && parse(configPath)
      if (!config) return fallback
      if (!options.has(configPath)) {
        options.set(configPath, {
          ...config.options,
          noEmit: true,
          incremental: false,
          composite: false,
          tsBuildInfoFile: undefined,
          plugins: undefined,
          skipLibCheck: true,
        })
      }
      return options.get(configPath)
    },
    /** Ambient declaration files a config includes, so global types resolve like they do in the repo's own build. */
    ambientFilesFor(configPath) {
      const config = configPath && parse(configPath)
      return config ? config.fileNames.filter((f) => f.endsWith('.d.ts') && !f.includes('/node_modules/')) : []
    },
  }
}
