import type { DisplayType, Project, RenderData, ScriptLibraryEntry } from "./types.js";
import type { ScopeContext, ScopeValue, TemplateFilterHandler } from "./layout-meta.js";

export interface ScriptHelperContext {
  locale: string;
  scope: ScopeContext;
  globals: ScopeContext;
  shared: ScopeContext;
  warn: (message: string) => void;
}

export interface ScriptNodeContext {
  locale: string;
  scope: ScopeContext;
  globals: ScopeContext;
  bindings: ScopeContext;
  helpers: Record<string, (...args: ScopeValue[]) => ScopeValue>;
  shared: ScopeContext;
  warn: (message: string) => void;
}

export interface ProjectScriptRuntime {
  filters: Record<string, (value: ScopeValue, args: ScopeValue[], context: ScriptHelperContext) => ScopeValue>;
  helpers: Record<string, (...args: ScopeValue[]) => ScopeValue>;
  shared: ScopeContext;
  executeScriptNode: (source: string, context: ScriptNodeContext) => ScopeContext | undefined;
  warnings: string[];
}

type ProjectScriptRuntimeFactory = (project: Project) => ProjectScriptRuntime | undefined;

let runtimeFactory: ProjectScriptRuntimeFactory | undefined;

export function installProjectScriptRuntimeFactory(factory?: ProjectScriptRuntimeFactory): void {
  runtimeFactory = factory;
}

function cloneScopeValue<T>(value: T): T {
  return structuredClone(value);
}

export function createRenderGlobals(project: Project, data: RenderData, displayType: DisplayType): ScopeContext {
  return {
    now: String(data.now ?? ""),
    today: String(data.now ?? "").slice(0, 10),
    locale: String(project.locale ?? "en-US"),
    display: cloneScopeValue({
      id: displayType.id,
      width: displayType.width,
      height: displayType.height,
      palette: displayType.palette,
      rotation: displayType.rotation
    }),
    project: {
      id: project.id,
      name: project.name
    }
  };
}

function wrapProjectFilter(
  name: string,
  filter: (value: ScopeValue, args: ScopeValue[], context: ScriptHelperContext) => ScopeValue,
  globals: ScopeContext,
  warnings: string[],
  shared: ScopeContext
): TemplateFilterHandler {
  return (value, args, context) => {
    try {
      return filter(value, args, {
        locale: context.locale ?? "en-US",
        scope: cloneScopeValue(context.scope ?? {}),
        globals: cloneScopeValue(globals),
        shared: cloneScopeValue(shared),
        warn: (message) => warnings.push(`[filter:${name}] ${message}`)
      });
    } catch (error) {
      warnings.push(`[filter:${name}] ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
}

export interface ActiveRenderScripting {
  globals: ScopeContext;
  filters: Record<string, TemplateFilterHandler>;
  helpers: Record<string, (...args: ScopeValue[]) => ScopeValue>;
  shared: ScopeContext;
  executeScriptNode: (source: string, scope: ScopeContext, bindings: ScopeContext, locale: string) => ScopeContext | undefined;
  warnings: string[];
}

export function createActiveRenderScripting(
  project: Project,
  data: RenderData,
  displayType: DisplayType
): ActiveRenderScripting {
  const warnings: string[] = [];
  const globals = createRenderGlobals(project, data, displayType);
  const runtime = runtimeFactory?.(project);
  const shared = cloneScopeValue(runtime?.shared ?? {});
  const filters = Object.fromEntries(
    Object.entries(runtime?.filters ?? {}).map(([name, filter]) => [
      name,
      wrapProjectFilter(name, filter, globals, warnings, shared)
    ])
  );
  const helpers = runtime?.helpers ?? {};
  const executeScriptNode = (source: string, scope: ScopeContext, bindings: ScopeContext, locale: string) => {
    if (!runtime) {
      return undefined;
    }
    try {
      return runtime.executeScriptNode(source, {
        locale,
        scope: cloneScopeValue(scope),
        globals: cloneScopeValue(globals),
        bindings: cloneScopeValue(bindings),
        helpers,
        shared: cloneScopeValue(shared),
        warn: (message) => warnings.push(`[script] ${message}`)
      });
    } catch (error) {
      warnings.push(`[script] ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  for (const warning of runtime?.warnings ?? []) {
    warnings.push(warning);
  }
  return {
    globals,
    filters,
    helpers,
    shared,
    executeScriptNode,
    warnings
  };
}

export function normalizeScriptLibraryEntries(entries: ScriptLibraryEntry[] | undefined): ScriptLibraryEntry[] {
  return (entries ?? [])
    .filter((entry) => entry && typeof entry.name === "string")
    .map((entry) => ({
      name: entry.name.trim(),
      source: String(entry.source ?? "")
    }))
    .filter((entry) => entry.name.length > 0);
}
