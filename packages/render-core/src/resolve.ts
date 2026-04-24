import { getDisplayProfile } from "./display-profiles.js";
import type {
  Condition,
  EntityState,
  Overlay,
  Project,
  QueryResult,
  RenderData,
  ResolvedProjectState,
  Rule,
  Scenario,
  Screen,
  ValueRef
} from "./types.js";

function parseDate(value: string): Date {
  return new Date(value);
}

function minutesSinceStateChange(entity: EntityState, now: string): number {
  return (parseDate(now).getTime() - parseDate(entity.lastChanged).getTime()) / 60_000;
}

function getValueRef(data: RenderData, ref: ValueRef): number | string | boolean | null | undefined {
  if (ref.type === "literal") {
    return ref.value;
  }
  if (ref.type === "entity_state") {
    return data.entities[ref.entityId]?.state;
  }
  if (ref.type === "entity_attribute") {
    return data.entities[ref.entityId]?.attributes?.[ref.attribute] as number | string | boolean | undefined;
  }
}

export function evaluateCondition(condition: Condition, data: RenderData): boolean {
  switch (condition.kind) {
    case "all":
      return condition.conditions.every((entry) => evaluateCondition(entry, data));
    case "any":
      return condition.conditions.some((entry) => evaluateCondition(entry, data));
    case "not":
      return !evaluateCondition(condition.condition, data);
    case "entity_state":
      return data.entities[condition.entityId]?.state === condition.equals;
    case "entity_matches": {
      const value = data.entities[condition.entityId]?.state ?? "";
      try {
        return new RegExp(condition.pattern, condition.flags).test(String(value));
      } catch {
        return false;
      }
    }
    case "entity_duration_ge": {
      const entity = data.entities[condition.entityId];
      if (!entity || entity.state !== condition.state) {
        return false;
      }
      return minutesSinceStateChange(entity, data.now) >= condition.minutes;
    }
    case "numeric_compare": {
      const left = Number(getValueRef(data, condition.left));
      if (!Number.isFinite(left)) {
        return false;
      }
      if (condition.op === "gt") return left > condition.right;
      if (condition.op === "gte") return left >= condition.right;
      if (condition.op === "lt") return left < condition.right;
      if (condition.op === "lte") return left <= condition.right;
      return left === condition.right;
    }
    case "boolean_compare":
      return Boolean(getValueRef(data, condition.left)) === condition.equals;
    case "is_defined": {
      const defined = getValueRef(data, condition.ref) !== undefined && getValueRef(data, condition.ref) !== null;
      return condition.expected === false ? !defined : defined;
    }
    case "time_between": {
      const now = parseDate(data.now);
      const weekday = now.getDay();
      if (condition.weekdays && !condition.weekdays.includes(weekday)) {
        return false;
      }
      const minutes = now.getHours() * 60 + now.getMinutes();
      const [startHour, startMinute] = condition.start.split(":").map(Number);
      const [endHour, endMinute] = condition.end.split(":").map(Number);
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;
      if (start <= end) {
        return minutes >= start && minutes <= end;
      }
      return minutes >= start || minutes <= end;
    }
  }
}

export function applyScenario(baseData: RenderData, scenario?: Scenario): RenderData {
  if (!scenario) {
    return baseData;
  }
  return {
    now: scenario.frozenNow ?? baseData.now,
    entities: {
      ...baseData.entities,
      ...(scenario.entityOverrides ?? {})
    },
    queries: {
      ...baseData.queries,
      ...(scenario.queryOverrides ?? {})
    }
  };
}

function pickDefaultScreen(project: Project, displayProfileId: string): Screen {
  const screen = project.screens.find(
    (candidate) => candidate.displayProfileId === displayProfileId && candidate.default
  );
  if (!screen) {
    throw new Error(`No default screen for display profile ${displayProfileId}`);
  }
  return screen;
}

function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((left, right) => right.priority - left.priority);
}

export function resolveProjectState(
  project: Project,
  displayProfileId: string,
  baseData: RenderData,
  scenarioId?: string
): ResolvedProjectState {
  const displayProfile = getDisplayProfile(displayProfileId);
  const scenario = project.scenarios.find((candidate) => candidate.id === scenarioId);
  const data = applyScenario(baseData, scenario);

  let activeScreen = pickDefaultScreen(project, displayProfileId);
  if (scenario?.forcedScreenId) {
    const forced = project.screens.find((candidate) => candidate.id === scenario.forcedScreenId);
    if (forced) {
      activeScreen = forced;
    }
  } else {
    const candidateRules = sortRules(
      project.screens
        .filter((screen) => screen.displayProfileId === displayProfileId)
        .flatMap((screen) => screen.rules.filter((rule) => rule.scope === "screen_activation"))
    );
    for (const rule of candidateRules) {
      if (!evaluateCondition(rule.condition, data)) {
        continue;
      }
      if (rule.action.type !== "activate_screen") {
        continue;
      }
      const action = rule.action;
      const target = project.screens.find((screen) => screen.id === action.screenId);
      if (target) {
        activeScreen = target;
        break;
      }
    }
  }

  let activeOverlay: Overlay | undefined;
  if (scenario?.forcedOverlayId) {
    activeOverlay = project.overlays.find((candidate) => candidate.id === scenario.forcedOverlayId);
  } else {
    const overlayRules = sortRules(
      activeScreen.rules.filter((rule) => rule.scope === "overlay_activation")
    );
    for (const rule of overlayRules) {
      if (!evaluateCondition(rule.condition, data)) {
        continue;
      }
      if (rule.action.type !== "activate_overlay") {
        continue;
      }
      const action = rule.action;
      const overlay = project.overlays.find((candidate) => candidate.id === action.overlayId);
      if (overlay) {
        activeOverlay = overlay;
        break;
      }
    }
  }

  const widgets = project.widgets.filter(
    (widget) => widget.screenId === activeScreen.id || widget.overlayId === activeOverlay?.id
  );

  return {
    displayProfile,
    activeScreen,
    activeOverlay,
    widgets,
    data
  };
}

export function emptyQueryResult(kind: string): QueryResult {
  return { kind, items: [], points: [], meta: {} };
}
