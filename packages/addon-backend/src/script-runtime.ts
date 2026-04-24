import vm from "node:vm";
import { installProjectScriptRuntimeFactory, normalizeScriptLibraryEntries, type ProjectScriptRuntime, type ScriptHelperContext, type ScriptNodeContext } from "../../render-core/src/scripting.js";
import type { Project, ScopeValue } from "../../render-core/src/index.js";

const SCRIPT_TIMEOUT_MS = 50;
const BUILT_IN_FILTER_NAMES = new Set(["format", "keys", "to_json", "count", "downcase", "upcase", "title"]);
const RESERVED_LIBRARY_NAMES = new Set([
  ...BUILT_IN_FILTER_NAMES,
  "now",
  "today",
  "locale",
  "display",
  "project",
  "scope",
  "globals",
  "helpers",
  "shared",
  "bindings",
  "warn",
  "eval",
  "Function",
  "import",
  "Promise"
]);

type PlainScope = Record<string, ScopeValue>;

interface CompiledProjectLibrary {
  context: vm.Context;
  shared: PlainScope;
  warnings: string[];
  helperNames: string[];
  filterNames: string[];
  helperSources: Map<string, string>;
  filterSources: Map<string, string>;
  scriptCache: Map<string, vm.Script>;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function freezeVmValue<T>(value: T): T {
  if (typeof value === "function") {
    return value;
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return deepFreeze(value.map((entry) => freezeVmValue(entry)) as T);
  }
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    next[key] = freezeVmValue(nested);
  }
  return deepFreeze(next as T);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

function frozenClone<T>(value: T): T {
  return deepFreeze(cloneValue(value));
}

function createBaseContext(): vm.Context {
  const contextObject = vm.createContext(Object.create(null));
  Object.assign(contextObject, {
    Math,
    JSON,
    Intl,
    Date,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    console: Object.freeze({
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }),
    eval: undefined,
    Function: undefined,
    AsyncFunction: undefined,
    GeneratorFunction: undefined,
    Promise: undefined,
    setTimeout: undefined,
    clearTimeout: undefined,
    setInterval: undefined,
    clearInterval: undefined
  });
  return contextObject;
}

function compileFunctionSource(
  context: vm.Context,
  source: string,
  label: string
): ((...args: unknown[]) => unknown) | undefined {
  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }
  const script = new vm.Script(`(${trimmed})`, { filename: label });
  const value = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });
  if (typeof value !== "function") {
    throw new Error(`${label} must evaluate to a function`);
  }
  return value as (...args: unknown[]) => unknown;
}

function compileSharedValue(context: vm.Context, source: string): PlainScope {
  const trimmed = source.trim();
  if (!trimmed) {
    return {};
  }
  const candidates = [
    `(${trimmed})`,
    `(function(){ ${trimmed} })()`
  ];
  for (const candidate of candidates) {
    try {
      const value = new vm.Script(candidate, { filename: "project-shared.js" })
        .runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return cloneValue(value as PlainScope);
      }
    } catch {
      continue;
    }
  }
  throw new Error("sharedSource must return an object");
}

function validateLibraryNames(kind: "helper" | "filter", names: string[], warnings: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      warnings.push(`[${kind}:${name}] invalid name`);
      return false;
    }
    if (RESERVED_LIBRARY_NAMES.has(name)) {
      warnings.push(`[${kind}:${name}] reserved name`);
      return false;
    }
    if (seen.has(name)) {
      warnings.push(`[${kind}:${name}] duplicate ignored`);
      return false;
    }
    seen.add(name);
    return true;
  });
}

function buildProjectLibrary(project: Project): CompiledProjectLibrary {
  const warnings: string[] = [];
  const context = createBaseContext();
  const helperEntries = normalizeScriptLibraryEntries(project.scripting?.helpers);
  const filterEntries = normalizeScriptLibraryEntries(project.scripting?.filters);
  const helperNames = validateLibraryNames("helper", helperEntries.map((entry) => entry.name), warnings);
  const filterNames = validateLibraryNames("filter", filterEntries.map((entry) => entry.name), warnings)
    .filter((name) => !BUILT_IN_FILTER_NAMES.has(name));
  const helperSources = new Map(helperEntries.filter((entry) => helperNames.includes(entry.name)).map((entry) => [entry.name, entry.source]));
  const filterSources = new Map(filterEntries.filter((entry) => filterNames.includes(entry.name)).map((entry) => [entry.name, entry.source]));

  for (const [name, source] of helperSources) {
    try {
      compileFunctionSource(context, source, `helper:${name}`);
    } catch (error) {
      warnings.push(`[helper:${name}] ${error instanceof Error ? error.message : String(error)}`);
      helperSources.delete(name);
    }
  }
  for (const [name, source] of filterSources) {
    try {
      compileFunctionSource(context, source, `filter:${name}`);
    } catch (error) {
      warnings.push(`[filter:${name}] ${error instanceof Error ? error.message : String(error)}`);
      filterSources.delete(name);
    }
  }

  let shared: PlainScope = {};
  if (project.scripting?.sharedSource?.trim()) {
    try {
      shared = compileSharedValue(context, project.scripting.sharedSource);
    } catch (error) {
      warnings.push(`[shared] ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    context,
    shared,
    warnings,
    helperNames: [...helperSources.keys()],
    filterNames: [...filterSources.keys()],
    helperSources,
    filterSources,
    scriptCache: new Map()
  };
}

function invokeFunctionSource(
  library: CompiledProjectLibrary,
  source: string,
  filename: string,
  args: unknown[]
): ScopeValue {
  library.context.__args = freezeVmValue(args);
  const script = new vm.Script(`(${source})(...__args)`, { filename });
  const value = script.runInContext(library.context, { timeout: SCRIPT_TIMEOUT_MS });
  delete library.context.__args;
  return cloneValue(value as ScopeValue);
}

function buildHelperInvoker(
  library: CompiledProjectLibrary,
  name: string
): (...args: ScopeValue[]) => ScopeValue {
  const source = library.helperSources.get(name) ?? "";
  return (...args) => invokeFunctionSource(library, source, `helper:${name}.js`, args);
}

function buildFilterInvoker(
  library: CompiledProjectLibrary,
  name: string
): (value: ScopeValue, args: ScopeValue[], context: ScriptHelperContext) => ScopeValue {
  const source = library.filterSources.get(name) ?? "";
  return (value, args, context) => invokeFunctionSource(
    library,
    source,
    `filter:${name}.js`,
    [value, args, {
      locale: context.locale,
      scope: frozenClone(context.scope),
      globals: frozenClone(context.globals),
      shared: frozenClone(context.shared),
      warn: context.warn
    }]
  );
}

function compileScriptNode(library: CompiledProjectLibrary, source: string): vm.Script {
  const cached = library.scriptCache.get(source);
  if (cached) {
    return cached;
  }
  const trimmed = source.trim();
  const candidates = [
    `(function(){ const { scope, globals, bindings, helpers, shared, locale, warn } = __ctx; return (${trimmed}); })()`,
    `(function(){ const { scope, globals, bindings, helpers, shared, locale, warn } = __ctx; ${trimmed} })()`
  ];
  for (const candidate of candidates) {
    try {
      const script = new vm.Script(candidate, { filename: "layout-script.js" });
      library.scriptCache.set(source, script);
      return script;
    } catch {
      continue;
    }
  }
  throw new Error("script node source must be valid JavaScript expression or body");
}

function createRuntime(project: Project): ProjectScriptRuntime | undefined {
  const library = buildProjectLibrary(project);
  const helpers = Object.fromEntries(library.helperNames.map((name) => [name, buildHelperInvoker(library, name)]));
  const filters = Object.fromEntries(library.filterNames.map((name) => [name, buildFilterInvoker(library, name)]));
  return {
    shared: frozenClone(library.shared),
    helpers,
    filters,
    warnings: [...library.warnings],
    executeScriptNode: (source: string, context: ScriptNodeContext) => {
      const helperFacade = Object.fromEntries(
        Object.entries(helpers).map(([name, helper]) => [name, (...args: ScopeValue[]) => helper(...args)])
      );
      library.context.__ctx = freezeVmValue({
        locale: context.locale,
        scope: context.scope,
        globals: context.globals,
        bindings: context.bindings,
        helpers: helperFacade,
        shared: context.shared,
        warn: context.warn
      });
      try {
        const value = compileScriptNode(library, source).runInContext(library.context, { timeout: SCRIPT_TIMEOUT_MS });
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          context.warn("script node must return object");
          return undefined;
        }
        return cloneValue(value as PlainScope);
      } finally {
        delete library.context.__ctx;
      }
    }
  };
}

export function installProjectScriptingRuntime(): void {
  installProjectScriptRuntimeFactory((project) => createRuntime(project));
}
