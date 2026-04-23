import type {
  DiscoveredDisplayCandidate,
  DisplayProfile,
  EntityCatalogEntry,
  FontOption,
  HomeAssistantConnectionSettings,
  HomeAssistantConnectionStatus,
  IconDefinition,
  OpenEpaperLinkAccessPointSettings,
  OpenEpaperLinkAccessPointStatus,
  PreviewDataSource,
  Project,
  RenderData,
  Scenario,
  LayoutInspectionResult
} from "../../render-core/src/types.js";

export interface PreviewResponse {
  width: number;
  height: number;
  hash: string;
  activeScreenId: string;
  activeOverlayId?: string;
  dataSource: PreviewDataSource;
  dataSourceMessage?: string;
  rgba: number[];
}

export type LayoutInspectionPreviewResponse = LayoutInspectionResult;

export interface FontSpecimenResponse {
  families: Array<{
    family: string;
    label: string;
    source: "built-in" | "user";
    allowedPixelSizes?: number[];
    importSource?: "upload" | "dafont";
    sourceUrl?: string;
    previewUrl?: string;
    declaredPixelSize?: number;
    licenseCategory?: string;
    variants: Array<{
      weight: string;
      slope: string;
      variantKey: string;
      tiles: Array<{
        size: number;
        width: number;
        height: number;
        pngBase64: string;
      }>;
    }>;
  }>;
}

export interface DaFontEntry {
  id: string;
  name: string;
  author?: string;
  detailUrl: string;
  downloadUrl: string;
  previewUrl: string;
  pixelSize?: number;
  licenseCategory?: string;
  downloadSizeLabel?: string;
}

export interface DaFontPageResponse {
  page: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  entries: DaFontEntry[];
}

export interface HomeAssistantSettingsResponse extends Omit<HomeAssistantConnectionSettings, "token"> {
  token: string;
  hasToken: boolean;
}

export interface OpenEpaperLinkAccessPointSettingsResponse extends OpenEpaperLinkAccessPointSettings {}

export interface AssignmentScheduleStatusResponse {
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

export interface AssignmentForceUpdateResponse {
  assignmentId: string;
  displayId: string;
  updated: boolean;
  skipped: boolean;
  hash?: string;
  activeScreenId?: string;
  activeOverlayId?: string;
  message: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchProfiles(): Promise<DisplayProfile[]> {
  return requestJson("/api/display-profiles");
}

export function fetchIcons(): Promise<IconDefinition[]> {
  return requestJson("/api/icons");
}

export function fetchFonts(): Promise<FontOption[]> {
  return requestJson("/api/fonts");
}

export function importFont(filename: string, base64: string): Promise<{ id: string; label: string; variant: string }> {
  return requestJson("/api/fonts/import", {
    method: "POST",
    body: JSON.stringify({ filename, base64 })
  });
}

export async function deleteFont(id: string): Promise<void> {
  await fetch(`/api/fonts/${id}`, {
    method: "DELETE"
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
  });
}

export function rescanFonts(): Promise<FontOption[]> {
  return requestJson("/api/fonts/rescan", {
    method: "POST"
  });
}

export function updateFontMetadata(id: string, allowedPixelSizes: number[]): Promise<FontOption | null> {
  return requestJson(`/api/fonts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ allowedPixelSizes })
  });
}

export function fetchDaFontPage(page = 1): Promise<DaFontPageResponse> {
  return requestJson(`/api/dafont?page=${page}`);
}

export function importDaFontFont(entry: DaFontEntry): Promise<FontOption | null> {
  return requestJson("/api/dafont/import", {
    method: "POST",
    body: JSON.stringify(entry)
  });
}

export function fetchHomeAssistantEntities(): Promise<EntityCatalogEntry[]> {
  return requestJson("/api/home-assistant/entities");
}

export function fetchProjects(): Promise<Array<Pick<Project, "id" | "name" | "version">>> {
  return requestJson("/api/projects");
}

export function fetchProject(id: string): Promise<Project> {
  return requestJson(`/api/projects/${id}`);
}

export function fetchDiscoveredDisplays(projectId: string): Promise<DiscoveredDisplayCandidate[]> {
  return requestJson(`/api/projects/${projectId}/displays/discover`);
}

export function saveProject(project: Project): Promise<Project> {
  return requestJson(`/api/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify(project)
  });
}

export function fetchAssignmentSchedules(projectId: string): Promise<AssignmentScheduleStatusResponse[]> {
  return requestJson(`/api/projects/${projectId}/assignment-schedules`);
}

export function forceAssignmentUpdate(
  projectId: string,
  assignmentId: string,
  project?: Project
): Promise<AssignmentForceUpdateResponse> {
  return requestJson(`/api/projects/${projectId}/assignments/${assignmentId}/force-update`, {
    method: "POST",
    body: JSON.stringify(project ? { project } : {})
  });
}

export function fetchHomeAssistantSettings(): Promise<HomeAssistantSettingsResponse> {
  return requestJson("/api/settings/home-assistant");
}

export function fetchOpenEpaperLinkAccessPointSettings(): Promise<OpenEpaperLinkAccessPointSettingsResponse> {
  return requestJson("/api/settings/openepaperlink-access-point");
}

export function saveHomeAssistantSettings(
  settings: Partial<HomeAssistantConnectionSettings> & { replaceToken?: boolean }
): Promise<HomeAssistantSettingsResponse> {
  return requestJson("/api/settings/home-assistant", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export function testHomeAssistantConnection(
  settings: Partial<HomeAssistantConnectionSettings> & { replaceToken?: boolean }
): Promise<HomeAssistantConnectionStatus> {
  return requestJson("/api/settings/home-assistant/test", {
    method: "POST",
    body: JSON.stringify(settings)
  });
}

export function saveOpenEpaperLinkAccessPointSettings(
  settings: Partial<OpenEpaperLinkAccessPointSettings>
): Promise<OpenEpaperLinkAccessPointSettingsResponse> {
  return requestJson("/api/settings/openepaperlink-access-point", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export function testOpenEpaperLinkAccessPointConnection(
  settings: Partial<OpenEpaperLinkAccessPointSettings>
): Promise<OpenEpaperLinkAccessPointStatus> {
  return requestJson("/api/settings/openepaperlink-access-point/test", {
    method: "POST",
    body: JSON.stringify(settings)
  });
}

export function fetchLiveData(projectId: string): Promise<RenderData> {
  return requestJson(`/api/projects/${projectId}/live-data`);
}

export function fetchPreview(
  projectId: string,
  displayProfileId: string,
  scenarioId?: string,
  scenario?: Scenario,
  previewDataSource: PreviewDataSource = "live",
  project?: Project
): Promise<PreviewResponse> {
  return requestJson(`/api/projects/${projectId}/preview`, {
    method: "POST",
    body: JSON.stringify({ displayProfileId, scenarioId, scenario, previewDataSource, project })
  });
}

export function fetchFontSpecimens(
  projectId: string,
  displayProfileId: string,
  sampleText: string,
  project: Project,
  minSize = 4,
  maxSize = 36,
  familyId?: string,
  includeAllSizes = false
): Promise<FontSpecimenResponse> {
  return requestJson(`/api/projects/${projectId}/font-specimens`, {
    method: "POST",
    body: JSON.stringify({ displayProfileId, sampleText, project, minSize, maxSize, familyId, includeAllSizes })
  });
}

export function fetchLayoutPreview(
  projectId: string,
  layoutId: string,
  popupLayoutId: string | undefined,
  previewDataSource: PreviewDataSource,
  project: Project
): Promise<PreviewResponse> {
  return requestJson(`/api/projects/${projectId}/layout-preview`, {
    method: "POST",
    body: JSON.stringify({ layoutId, popupLayoutId, previewDataSource, project })
  });
}

export function fetchLayoutInspectionPreview(
  projectId: string,
  layoutId: string,
  popupLayoutId: string | undefined,
  previewDataSource: PreviewDataSource,
  project: Project,
  expandCompoundRefs = false
): Promise<LayoutInspectionPreviewResponse> {
  return requestJson(`/api/projects/${projectId}/layout-inspection-preview`, {
    method: "POST",
    body: JSON.stringify({ layoutId, popupLayoutId, previewDataSource, project, expandCompoundRefs })
  });
}

export function fetchDevicePreview(
  projectId: string,
  displayId: string,
  previewDataSource: PreviewDataSource,
  project: Project
): Promise<PreviewResponse> {
  return requestJson(`/api/projects/${projectId}/device-preview`, {
    method: "POST",
    body: JSON.stringify({ displayId, previewDataSource, project })
  });
}

export function fetchThemePreview(
  projectId: string,
  themeId: string,
  displayTypeId: string,
  project: Project
): Promise<PreviewResponse> {
  return requestJson(`/api/projects/${projectId}/theme-preview`, {
    method: "POST",
    body: JSON.stringify({ themeId, displayTypeId, project })
  });
}

export function publishProject(projectId: string, displayProfileId: string, scenarioId?: string): Promise<{ published: boolean; hash: string }> {
  return requestJson(`/api/projects/${projectId}/publish`, {
    method: "POST",
    body: JSON.stringify({ displayProfileId, scenarioId })
  });
}

export function uploadDeviceImage(
  projectId: string,
  displayId: string,
  previewDataSource: PreviewDataSource,
  project: Project,
  dither = 0
): Promise<{ uploaded: boolean; hash: string; width: number; height: number; dataSource: PreviewDataSource; dataSourceMessage?: string }> {
  return requestJson(`/api/projects/${projectId}/devices/${displayId}/upload`, {
    method: "POST",
    body: JSON.stringify({ previewDataSource, project, dither })
  });
}

export function uploadPreviewToOpenEpaperLinkAccessPoint(
  mac: string,
  width: number,
  height: number,
  rgba: number[] | Uint8ClampedArray,
  dither = 0
): Promise<{ uploaded: boolean; mac: string; width: number; height: number }> {
  return requestJson("/api/openepaperlink-access-point/upload-preview", {
    method: "POST",
    body: JSON.stringify({ mac, width, height, rgba: Array.from(rgba), dither })
  });
}
