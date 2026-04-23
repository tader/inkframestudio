import { describe, expect, it } from "vitest";
import { SAMPLE_DATA, SAMPLE_PROJECT } from "../../render-core/src/index.js";
import { normalizeProject } from "../../render-core/src/themes.js";
import type {
  HomeAssistantConnectionSettings,
  OpenEpaperLinkAccessPointSettings,
  Project,
  RenderData
} from "../../render-core/src/types.js";
import { AssignmentScheduler } from "./assignment-scheduler.js";

class FakeStorage {
  constructor(private readonly project: Project) {}

  async listProjects(): Promise<Array<Pick<Project, "id">>> {
    return [{ id: this.project.id }];
  }

  async getProject(): Promise<Project> {
    return this.project;
  }

  async getHomeAssistantSettings(): Promise<HomeAssistantConnectionSettings> {
    return {
      host: "https://ha.local",
      token: "token",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    };
  }

  async getOpenEpaperLinkAccessPointSettings(): Promise<OpenEpaperLinkAccessPointSettings> {
    return { url: "http://ap.local" };
  }
}

class FakeHomeAssistantClient {
  hasConfiguredConnection(): boolean {
    return true;
  }

  async resolveProjectData(): Promise<RenderData> {
    return SAMPLE_DATA;
  }
}

class FakeAccessPointClient {
  uploads: string[] = [];

  hasConfiguredConnection(): boolean {
    return true;
  }

  async uploadImage(_settings: OpenEpaperLinkAccessPointSettings, mac: string): Promise<void> {
    this.uploads.push(mac);
  }
}

function scheduledApProject(): Project {
  const normalized = normalizeProject(SAMPLE_PROJECT);
  const baseDisplay = normalized.devices?.[0];
  const baseAssignment = normalized.deviceAssignments?.[0];
  if (!baseDisplay || !baseAssignment) {
    throw new Error("Sample project missing default display assignment");
  }
  const display = {
    ...baseDisplay,
    providerKind: "openepaperlink-ap" as const,
    providerRef: "00000219BC483B18",
    managed: true,
    virtual: false,
    metadata: { mac: "00000219BC483B18" }
  };
  const assignment = {
    ...baseAssignment,
    displayId: display.id,
    schedule: {
      enabled: true,
      intervalMinutes: 15
    }
  };
  return normalizeProject({
    ...normalized,
    devices: [display],
    deviceAssignments: [assignment]
  });
}

describe("assignment scheduler", () => {
  it("skips scheduled uploads when image hash did not change", async () => {
    const project = scheduledApProject();
    const storage = new FakeStorage(project);
    const ap = new FakeAccessPointClient();
    let now = 0;
    const scheduler = new AssignmentScheduler(
      storage,
      new FakeHomeAssistantClient(),
      ap,
      async () => undefined,
      30_000,
      () => now
    );

    await scheduler.tickNow();
    expect(ap.uploads).toHaveLength(0);

    now = 15 * 60_000;
    await scheduler.tickNow();
    expect(ap.uploads).toHaveLength(1);

    now = 30 * 60_000;
    await scheduler.tickNow();
    expect(ap.uploads).toHaveLength(1);

    const statuses = await scheduler.getProjectStatuses(project);
    expect(statuses[0]?.lastResult).toBe("skipped_unchanged");
  });

  it("forces upload even when hash is unchanged", async () => {
    const project = scheduledApProject();
    const storage = new FakeStorage(project);
    const ap = new FakeAccessPointClient();
    let now = 0;
    const scheduler = new AssignmentScheduler(
      storage,
      new FakeHomeAssistantClient(),
      ap,
      async () => undefined,
      30_000,
      () => now
    );

    await scheduler.tickNow();
    now = 15 * 60_000;
    await scheduler.tickNow();
    expect(ap.uploads).toHaveLength(1);

    const result = await scheduler.forceUpdate(project, project.deviceAssignments?.[0]?.id ?? "");
    expect(result.updated).toBe(true);
    expect(ap.uploads).toHaveLength(2);
  });
});
