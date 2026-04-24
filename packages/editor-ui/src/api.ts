import type {
  DiscoveredDisplayCandidate,
  DisplayProfile,
  EntityCatalogEntry,
  FontOption,
  ProviderDomain,
  IconDefinition,
  ProviderConnectionStatus,
  ProviderDescriptor,
  ProviderInstance,
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
  dataSourceMessage?: string;
  scriptWarnings?: string[];
  pngBase64: string;
}

export type LayoutInspectionPreviewResponse = LayoutInspectionResult;

export interface LayoutPreviewBundleResponse {
  preview: PreviewResponse;
  inspection?: LayoutInspectionPreviewResponse;
}

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

const V2_API_BASE = "/api/v2";

export function fetchProfiles(): Promise<DisplayProfile[]> {
  return requestJson(`${V2_API_BASE}/display-profiles`);
}

export function fetchIcons(): Promise<IconDefinition[]> {
  return requestJson(`${V2_API_BASE}/icons`);
}

export function fetchFonts(): Promise<FontOption[]> {
  return requestJson(`${V2_API_BASE}/fonts`);
}

export function importFont(filename: string, base64: string): Promise<{ id: string; label: string; variant: string }> {
  return requestJson(`${V2_API_BASE}/fonts/import`, {
    method: "POST",
    body: JSON.stringify({ filename, base64 })
  });
}

export async function deleteFont(id: string): Promise<void> {
  await fetch(`${V2_API_BASE}/fonts/${id}`, {
    method: "DELETE"
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
  });
}

export function rescanFonts(): Promise<FontOption[]> {
  return requestJson(`${V2_API_BASE}/fonts/rescan`, {
    method: "POST"
  });
}

export function updateFontMetadata(id: string, allowedPixelSizes: number[]): Promise<FontOption | null> {
  return requestJson(`${V2_API_BASE}/fonts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ allowedPixelSizes })
  });
}

export async function fetchProviderKinds(): Promise<ProviderDescriptor[]> {
  const payload = await requestJson<ProviderDescriptor[] | { providerKinds?: ProviderDescriptor[]; provider_kinds?: ProviderDescriptor[] }>(`${V2_API_BASE}/provider-kinds`);
  return Array.isArray(payload) ? payload : payload.providerKinds ?? payload.provider_kinds ?? [];
}

export function fetchProviderInstances(): Promise<ProviderInstance[]> {
  return requestJson(`${V2_API_BASE}/provider-instances`);
}

export function createProviderInstance(instance: Omit<ProviderInstance, "id"> & { id?: string }): Promise<ProviderInstance> {
  return requestJson(`${V2_API_BASE}/provider-instances`, {
    method: "POST",
    body: JSON.stringify(instance)
  });
}

export function saveProviderInstance(instance: ProviderInstance): Promise<ProviderInstance> {
  return requestJson(`${V2_API_BASE}/provider-instances/${instance.id}`, {
    method: "PUT",
    body: JSON.stringify(instance)
  });
}

export async function deleteProviderInstance(id: string): Promise<void> {
  await fetch(`${V2_API_BASE}/provider-instances/${id}`, {
    method: "DELETE"
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
  });
}

export function testProviderInstance(id: string, instance?: Partial<ProviderInstance>): Promise<ProviderConnectionStatus> {
  return requestJson(`${V2_API_BASE}/provider-instances/${id}/test`, {
    method: "POST",
    body: JSON.stringify(instance ?? {})
  });
}

export function fetchProviderEntities(id: string): Promise<EntityCatalogEntry[]> {
  return requestJson(`${V2_API_BASE}/provider-instances/${id}/entities`);
}

function providerById(instances: ProviderInstance[], providerId: string): ProviderInstance | undefined {
  return instances.find((instance) => instance.providerId === providerId);
}

export function fetchProjects(): Promise<Array<Pick<Project, "id" | "name" | "version">>> {
  return requestJson(`${V2_API_BASE}/projects`);
}

export function fetchProject(id: string): Promise<Project> {
  return requestJson(`${V2_API_BASE}/projects/${id}`);
}

export async function fetchDiscoveredDisplays(projectId: string, providerInstanceId?: string): Promise<DiscoveredDisplayCandidate[]> {
  let effectiveProviderInstanceId = providerInstanceId;
  if (!effectiveProviderInstanceId) {
    const instances = await fetchProviderInstances();
    effectiveProviderInstanceId = providerById(instances, "openepaperlink-ap")?.id;
  }
  if (!effectiveProviderInstanceId) {
    return [];
  }
  return requestJson(`${V2_API_BASE}/projects/${projectId}/displays/discover?providerInstanceId=${encodeURIComponent(effectiveProviderInstanceId)}`);
}

export function saveProject(project: Project): Promise<Project> {
  return requestJson(`${V2_API_BASE}/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify(project)
  });
}

export function fetchAssignmentSchedules(projectId: string): Promise<AssignmentScheduleStatusResponse[]> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/assignment-schedules`);
}

export function forceAssignmentUpdate(
  projectId: string,
  assignmentId: string,
  project?: Project
): Promise<AssignmentForceUpdateResponse> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/assignments/${assignmentId}/force-update`, {
    method: "POST",
    body: JSON.stringify(project ? { project } : {})
  });
}

export function fetchLiveData(projectId: string): Promise<RenderData> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/live-data`);
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
  return requestJson(`${V2_API_BASE}/projects/${projectId}/font-specimens`, {
    method: "POST",
    body: JSON.stringify({ displayProfileId, sampleText, project, minSize, maxSize, familyId, includeAllSizes })
  });
}

export function fetchLayoutPreview(
  projectId: string,
  layoutId: string,
  popupLayoutId: string | undefined,
  project: Project
): Promise<PreviewResponse> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/layout-preview`, {
    method: "POST",
    body: JSON.stringify({ layoutId, popupLayoutId, project })
  });
}

export function fetchLayoutPreviewBundle(
  projectId: string,
  layoutId: string,
  popupLayoutId: string | undefined,
  project: Project,
  expandCompoundRefs = false
): Promise<LayoutPreviewBundleResponse> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/layout-preview`, {
    method: "POST",
    body: JSON.stringify({ layoutId, popupLayoutId, project, includeInspection: true, expandCompoundRefs })
  });
}

export function fetchDevicePreview(
  projectId: string,
  displayId: string,
  project: Project
): Promise<PreviewResponse> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/device-preview`, {
    method: "POST",
    body: JSON.stringify({ displayId, project })
  });
}

export function fetchThemePreview(
  projectId: string,
  themeId: string,
  displayTypeId: string,
  project: Project
): Promise<PreviewResponse> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/theme-preview`, {
    method: "POST",
    body: JSON.stringify({ themeId, displayTypeId, project })
  });
}

export function publishProject(projectId: string, displayProfileId: string, scenarioId?: string): Promise<{ published: boolean; hash: string }> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/publish`, {
    method: "POST",
    body: JSON.stringify({ displayProfileId, scenarioId })
  });
}

export function uploadDeviceImage(
  projectId: string,
  displayId: string,
  project: Project,
  dither = 0
): Promise<{ uploaded: boolean; hash: string; width: number; height: number; dataSourceMessage?: string }> {
  return requestJson(`${V2_API_BASE}/projects/${projectId}/devices/${displayId}/upload`, {
    method: "POST",
    body: JSON.stringify({ project, dither })
  });
}

export function uploadPreviewToDisplayProvider(
  providerInstanceId: string,
  mac: string,
  width: number,
  height: number,
  pngBase64: string,
  dither = 0
): Promise<{ uploaded: boolean; mac: string; width: number; height: number }> {
  return requestJson(`${V2_API_BASE}/provider-instances/${providerInstanceId}/upload-preview`, {
    method: "POST",
    body: JSON.stringify({ mac, width, height, pngBase64, dither })
  });
}

export async function uploadPreviewToOpenEpaperLinkAccessPoint(
  mac: string,
  width: number,
  height: number,
  pngBase64: string,
  dither = 0
): Promise<{ uploaded: boolean; mac: string; width: number; height: number }> {
  const instances = await fetchProviderInstances();
  const instance = providerById(instances, "openepaperlink-ap");
  if (!instance) {
    throw new Error("No OpenEPaperLink provider configured");
  }
  return uploadPreviewToDisplayProvider(instance.id, mac, width, height, pngBase64, dither);
}
