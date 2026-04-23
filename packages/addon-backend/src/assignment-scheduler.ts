import { renderAssignedDisplay } from "../../render-core/src/designer-renderer.js";
import type {
  DeviceAssignment,
  HomeAssistantConnectionSettings,
  OpenEpaperLinkAccessPointSettings,
  Project,
  RenderData
} from "../../render-core/src/types.js";
import { emptyQueryResult } from "../../render-core/src/resolve.js";
import { rgbaToJpegBuffer } from "./jpeg.js";

type SchedulerState = {
  configSignature?: string;
  nextRunAt?: number;
  lastRunAt?: number;
  lastCompletedAt?: number;
  lastResult?: AssignmentScheduleStatus["lastResult"];
  lastError?: string;
  lastHash?: string;
  running?: boolean;
};

export interface AssignmentScheduleStatus {
  assignmentId: string;
  displayId: string;
  enabled: boolean;
  intervalMinutes: number;
  schedulable: boolean;
  running: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastCompletedAt?: string;
  lastResult?: "idle" | "disabled" | "updated" | "skipped_unchanged" | "error";
  lastError?: string;
  lastHash?: string;
}

export interface AssignmentRunResult {
  assignmentId: string;
  displayId: string;
  updated: boolean;
  skipped: boolean;
  hash?: string;
  activeScreenId?: string;
  activeOverlayId?: string;
  message: string;
}

interface ProjectSummarySource {
  listProjects(): Promise<Array<Pick<Project, "id">>>;
  getProject(id: string): Promise<Project>;
  getHomeAssistantSettings(): Promise<HomeAssistantConnectionSettings>;
  getOpenEpaperLinkAccessPointSettings(): Promise<OpenEpaperLinkAccessPointSettings>;
}

interface HomeAssistantDataSource {
  hasConfiguredConnection(settings: HomeAssistantConnectionSettings): boolean;
  resolveProjectData(project: Project, settings: HomeAssistantConnectionSettings): Promise<RenderData>;
}

interface AccessPointUploader {
  hasConfiguredConnection(settings: OpenEpaperLinkAccessPointSettings): boolean;
  uploadImage(
    settings: OpenEpaperLinkAccessPointSettings,
    mac: string,
    image: Uint8Array | ArrayBuffer,
    filename?: string
  ): Promise<void>;
}

function unavailableRenderData(project: Project): RenderData {
  return {
    now: new Date().toISOString(),
    entities: {},
    queries: Object.fromEntries(project.queries.map((query) => [query.id, emptyQueryResult(query.kind)])),
    metaQueries: {}
  };
}

function assignmentScheduleConfig(assignment: DeviceAssignment): { enabled: boolean; intervalMinutes: number } {
  return {
    enabled: Boolean(assignment.schedule?.enabled),
    intervalMinutes: Math.max(1, Math.trunc(Number(assignment.schedule?.intervalMinutes ?? 15) || 15))
  };
}

function toIso(timestamp: number | undefined): string | undefined {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

export class AssignmentScheduler {
  private readonly states = new Map<string, SchedulerState>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(
    private readonly storage: ProjectSummarySource,
    private readonly homeAssistantClient: HomeAssistantDataSource,
    private readonly openEpaperLinkClient: AccessPointUploader,
    private readonly refreshFonts: () => Promise<void>,
    private readonly pollIntervalMs = 30_000,
    private readonly now = () => Date.now()
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tickNow();
    }, this.pollIntervalMs);
    void this.tickNow();
  }

  async tickNow(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const validKeys = new Set<string>();
      for (const summary of await this.storage.listProjects()) {
        const project = await this.storage.getProject(summary.id);
        await this.syncProject(project, validKeys);
      }
      for (const key of Array.from(this.states.keys())) {
        if (!validKeys.has(key)) {
          this.states.delete(key);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async getProjectStatuses(project: Project): Promise<AssignmentScheduleStatus[]> {
    return (project.deviceAssignments ?? []).map((assignment) => this.buildStatus(project, assignment));
  }

  async forceUpdate(project: Project, assignmentId: string): Promise<AssignmentRunResult> {
    await this.refreshFonts();
    return await this.runAssignment(project, assignmentId, true);
  }

  private assignmentKey(projectId: string, assignmentId: string): string {
    return `${projectId}:${assignmentId}`;
  }

  private stateFor(projectId: string, assignmentId: string): SchedulerState {
    const key = this.assignmentKey(projectId, assignmentId);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }
    const created: SchedulerState = {};
    this.states.set(key, created);
    return created;
  }

  private buildStatus(project: Project, assignment: DeviceAssignment): AssignmentScheduleStatus {
    const config = assignmentScheduleConfig(assignment);
    const display = project.devices?.find((entry) => entry.id === assignment.displayId);
    const state = this.stateFor(project.id, assignment.id);
    const schedulable = Boolean(display?.managed && display.providerKind === "openepaperlink-ap");
    return {
      assignmentId: assignment.id,
      displayId: assignment.displayId,
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
      schedulable,
      running: Boolean(state.running),
      nextRunAt: toIso(state.nextRunAt),
      lastRunAt: toIso(state.lastRunAt),
      lastCompletedAt: toIso(state.lastCompletedAt),
      lastResult: state.lastResult,
      lastError: state.lastError,
      lastHash: state.lastHash
    };
  }

  private async syncProject(project: Project, validKeys: Set<string>): Promise<void> {
    for (const assignment of project.deviceAssignments ?? []) {
      const key = this.assignmentKey(project.id, assignment.id);
      validKeys.add(key);
      const config = assignmentScheduleConfig(assignment);
      const display = project.devices?.find((entry) => entry.id === assignment.displayId);
      const state = this.stateFor(project.id, assignment.id);
      const schedulable = Boolean(display?.managed && display.providerKind === "openepaperlink-ap");
      const signature = JSON.stringify({
        enabled: config.enabled,
        intervalMinutes: config.intervalMinutes,
        displayId: assignment.displayId,
        schedulable
      });
      if (state.configSignature !== signature) {
        state.configSignature = signature;
        state.nextRunAt = config.enabled && schedulable
          ? this.now() + config.intervalMinutes * 60_000
          : undefined;
        if (!config.enabled) {
          state.lastResult = state.lastResult === "updated" || state.lastResult === "skipped_unchanged" ? state.lastResult : "disabled";
        } else if (!schedulable) {
          state.lastResult = "error";
          state.lastError = "Scheduling requires a managed OpenEPaperLink AP display.";
        }
      }
      if (!config.enabled || !schedulable || state.running) {
        continue;
      }
      if (!state.nextRunAt) {
        state.nextRunAt = this.now() + config.intervalMinutes * 60_000;
        continue;
      }
      if (state.nextRunAt <= this.now()) {
        await this.runAssignment(project, assignment.id, false);
      }
    }
  }

  private async resolveRenderData(project: Project): Promise<RenderData> {
    const settings = await this.storage.getHomeAssistantSettings();
    if (!this.homeAssistantClient.hasConfiguredConnection(settings)) {
      return unavailableRenderData(project);
    }
    return await this.homeAssistantClient.resolveProjectData(project, settings);
  }

  private async runAssignment(project: Project, assignmentId: string, force: boolean): Promise<AssignmentRunResult> {
    const assignment = project.deviceAssignments?.find((entry) => entry.id === assignmentId);
    if (!assignment) {
      throw new Error(`Unknown assignment ${assignmentId}`);
    }
    const display = project.devices?.find((entry) => entry.id === assignment.displayId);
    if (!display) {
      throw new Error(`Unknown display ${assignment.displayId}`);
    }
    const state = this.stateFor(project.id, assignment.id);
    const config = assignmentScheduleConfig(assignment);
    state.running = true;
    state.lastRunAt = this.now();
    try {
      if (!display.managed) {
        throw new Error("Display is not managed by this tool.");
      }
      if (display.providerKind !== "openepaperlink-ap") {
        throw new Error("Scheduling requires an OpenEPaperLink AP display.");
      }
      const apSettings = await this.storage.getOpenEpaperLinkAccessPointSettings();
      if (!this.openEpaperLinkClient.hasConfiguredConnection(apSettings)) {
        throw new Error("OpenEPaperLink access point URL is not configured.");
      }
      const data = await this.resolveRenderData(project);
      const rendered = renderAssignedDisplay(project, display.id, data);
      if (!force && state.lastHash === rendered.hash) {
        state.lastCompletedAt = this.now();
        state.lastResult = "skipped_unchanged";
        state.lastError = undefined;
        state.nextRunAt = config.enabled
          ? this.now() + config.intervalMinutes * 60_000
          : undefined;
        return {
          assignmentId: assignment.id,
          displayId: display.id,
          updated: false,
          skipped: true,
          hash: rendered.hash,
          activeScreenId: rendered.activeScreenId,
          activeOverlayId: rendered.activeOverlayId,
          message: "Skipped unchanged image."
        };
      }
      const jpeg = await rgbaToJpegBuffer(rendered.width, rendered.height, rendered.rgba);
      await this.openEpaperLinkClient.uploadImage(
        apSettings,
        String(display.metadata?.mac ?? display.providerRef),
        jpeg,
        `${display.providerRef}.jpg`
      );
      state.lastHash = rendered.hash;
      state.lastCompletedAt = this.now();
      state.lastResult = "updated";
      state.lastError = undefined;
      state.nextRunAt = config.enabled
        ? this.now() + config.intervalMinutes * 60_000
        : undefined;
      return {
        assignmentId: assignment.id,
        displayId: display.id,
        updated: true,
        skipped: false,
        hash: rendered.hash,
        activeScreenId: rendered.activeScreenId,
        activeOverlayId: rendered.activeOverlayId,
        message: force ? "Forced update uploaded." : "Scheduled update uploaded."
      };
    } catch (error) {
      state.lastCompletedAt = this.now();
      state.lastResult = "error";
      state.lastError = error instanceof Error ? error.message : String(error);
      state.nextRunAt = config.enabled && !force
        ? this.now() + config.intervalMinutes * 60_000
        : undefined;
      return {
        assignmentId: assignment.id,
        displayId: display.id,
        updated: false,
        skipped: false,
        message: state.lastError
      };
    } finally {
      state.running = false;
    }
  }
}
