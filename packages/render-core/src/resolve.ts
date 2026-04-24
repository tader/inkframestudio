import { getDisplayProfile } from "./display-profiles.js";
import { evaluateCondition } from "./condition-eval.js";
import type {
  Overlay,
  Project,
  QueryResult,
  RenderData,
  ResolvedProjectState,
  Rule,
  Scenario,
  Screen
} from "./types.js";

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
