import https from "node:https";
import type {
  DiscoveredDisplayCandidate,
  EntityCatalogEntry,
  EntityState,
  HomeAssistantConnectionSettings,
  HomeAssistantConnectionStatus,
  Project,
  QueryDefinition,
  QueryResult,
  RenderData
} from "../../render-core/src/types.js";
import { SAMPLE_DATA } from "../../render-core/src/sample-project.js";
import { emptyQueryResult } from "../../render-core/src/resolve.js";

function supervisorToken(): string | undefined {
  return process.env.SUPERVISOR_TOKEN;
}

function hasConfiguredConnection(settings: HomeAssistantConnectionSettings): boolean {
  if (settings.mode === "supervisor") {
    return Boolean(supervisorToken());
  }
  return Boolean(settings.host && settings.token);
}

function toEntityCatalogEntry(entity: {
  entity_id: string;
  attributes?: Record<string, unknown>;
}): EntityCatalogEntry {
  return {
    entityId: entity.entity_id,
    friendlyName: String(entity.attributes?.friendly_name ?? entity.entity_id),
    domain: entity.entity_id.split(".")[0] ?? "",
    unit:
      typeof entity.attributes?.unit_of_measurement === "string"
        ? entity.attributes.unit_of_measurement
        : undefined
  };
}

function wsUrlFromBase(settings: HomeAssistantConnectionSettings): string {
  if (settings.mode === "supervisor" || settings.useSupervisorProxy) {
    return "ws://supervisor/core/websocket";
  }
  const base = settings.host.replace(/\/$/, "");
  return `${base.replace(/^http/i, "ws")}/api/websocket`;
}

function looksLikeOpenEpaperLink(value: unknown): boolean {
  return /openepaperlink|epaper|e-?paper/i.test(String(value ?? ""));
}

function unavailableRenderData(project: Project): RenderData {
  return {
    now: new Date().toISOString(),
    entities: {},
    queries: Object.fromEntries(project.queries.map((query) => [query.id, emptyQueryResult(query.kind)]))
  };
}

function isTlsCertificateError(error: unknown): boolean {
  const code =
    (error as { code?: string } | undefined)?.code ??
    (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "DEPTH_ZERO_SELF_SIGNED_CERT";
}

function normalizeHomeAssistantError(error: unknown, path: string): Error {
  if (isTlsCertificateError(error)) {
    return new Error(
      `Home Assistant TLS certificate rejected on ${path}. Enable "Allow insecure TLS" for self-signed certificates.`
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

export class HomeAssistantClient {
  hasConfiguredConnection(settings: HomeAssistantConnectionSettings): boolean {
    return hasConfiguredConnection(settings);
  }

  private buildBaseUrl(settings: HomeAssistantConnectionSettings): string {
    if (settings.mode === "supervisor" || settings.useSupervisorProxy) {
      return "http://supervisor/core/api";
    }
    return `${settings.host.replace(/\/$/, "")}/api`;
  }

  private buildHeaders(settings: HomeAssistantConnectionSettings, initHeaders?: HeadersInit): HeadersInit {
    const token = settings.mode === "supervisor" || settings.useSupervisorProxy ? supervisorToken() : settings.token;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(initHeaders ?? {})
    };
  }

  private async fetchJson<T>(
    settings: HomeAssistantConnectionSettings,
    path: string,
    init?: RequestInit
  ): Promise<T> {
    if (settings.allowInsecureTls && this.buildBaseUrl(settings).startsWith("https://")) {
      return this.fetchJsonInsecure<T>(settings, path, init);
    }
    const response = await fetch(`${this.buildBaseUrl(settings)}${path}`, {
      ...init,
      headers: this.buildHeaders(settings, init?.headers)
    }).catch((error) => {
      throw normalizeHomeAssistantError(error, path);
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      const error = new Error(
        `Home Assistant request failed with ${response.status} on ${path}${details ? `: ${details.slice(0, 160)}` : ""}`
      );
      (error as Error & { status?: number; path?: string }).status = response.status;
      (error as Error & { status?: number; path?: string }).path = path;
      throw error;
    }
    return (await response.json()) as T;
  }

  private async fetchJsonInsecure<T>(
    settings: HomeAssistantConnectionSettings,
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = new URL(`${this.buildBaseUrl(settings)}${path}`);
    const method = init?.method ?? "GET";
    const headers = this.buildHeaders(settings, init?.headers) as Record<string, string>;
    const body =
      typeof init?.body === "string" || init?.body instanceof Uint8Array
        ? init.body
        : undefined;

    return await new Promise<T>((resolve, reject) => {
      const request = https.request(
        url,
        {
          method,
          headers,
          rejectUnauthorized: false
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
              const error = new Error(
                `Home Assistant request failed with ${response.statusCode ?? 500} on ${path}${text ? `: ${text.slice(0, 160)}` : ""}`
              );
              (error as Error & { status?: number; path?: string }).status = response.statusCode;
              (error as Error & { status?: number; path?: string }).path = path;
              reject(error);
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      request.on("error", (error) => reject(normalizeHomeAssistantError(error, path)));
      if (body) {
        request.write(body);
      }
      request.end();
    });
  }

  private async callWebSocket<T>(
    settings: HomeAssistantConnectionSettings,
    type: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const token = settings.mode === "supervisor" || settings.useSupervisorProxy ? supervisorToken() : settings.token;
    const socket = new WebSocket(wsUrlFromBase(settings));
    let requestId = 1;
    return await new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        try {
          socket.close();
        } catch {
          // ignore close errors
        }
      };
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", access_token: token ?? "" }));
          return;
        }
        if (message.type === "auth_invalid") {
          cleanup();
          reject(new Error(String(message.message ?? "Home Assistant WebSocket auth failed")));
          return;
        }
        if (message.type === "auth_ok") {
          socket.send(JSON.stringify({ id: requestId, type, ...payload }));
          return;
        }
        if (message.type === "result" && Number(message.id) === requestId) {
          cleanup();
          if (!message.success) {
            const error = message.error as { message?: string } | undefined;
            reject(new Error(error?.message ?? `Home Assistant WebSocket ${type} failed`));
            return;
          }
          resolve(message.result as T);
        }
      });
      socket.addEventListener("error", () => {
        cleanup();
        reject(new Error(`Home Assistant WebSocket ${type} failed`));
      });
      socket.addEventListener("open", () => {
        requestId = 1;
      });
    });
  }

  async testConnection(settings: HomeAssistantConnectionSettings): Promise<HomeAssistantConnectionStatus> {
    if (!hasConfiguredConnection(settings)) {
      return {
        ok: false,
        mode: settings.mode,
        message: "Connection settings are incomplete",
        authError: false,
        networkError: false
      };
    }
    try {
      const config = await this.fetchJson<Record<string, unknown>>(settings, "/config");
      return {
        ok: true,
        mode: settings.mode,
        message: "Connected to Home Assistant",
        serverVersion: String(config.version ?? "")
      };
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      return {
        ok: false,
        mode: settings.mode,
        message: error instanceof Error ? error.message : "Unknown connection error",
        authError: status === 401 || status === 403,
        networkError: status === undefined
      };
    }
  }

  async resolveProjectData(
    project: Project,
    settings: HomeAssistantConnectionSettings
  ): Promise<RenderData> {
    if (!hasConfiguredConnection(settings)) {
      return unavailableRenderData(project);
    }

    const entityStateList = await this.fetchJson<
      Array<{ entity_id: string; state: string; attributes: Record<string, unknown>; last_changed: string }>
    >(settings, "/states");

    const entities: Record<string, EntityState> = Object.fromEntries(
      entityStateList.map((value) => [
        value.entity_id,
        {
          entityId: value.entity_id,
          state: value.state,
          attributes: value.attributes ?? {},
          lastChanged: value.last_changed
        }
      ])
    );

    const queries = Object.fromEntries(
      await Promise.all(
        project.queries.map(async (query) => {
          try {
            return [query.id, await this.resolveQuery(settings, query)] as const;
          } catch (error) {
            console.warn(
              `Query ${query.id} failed for ${query.kind}: ${error instanceof Error ? error.message : String(error)}`
            );
            return [query.id, emptyQueryResult(query.kind)] as const;
          }
        })
      )
    );

    return {
      now: new Date().toISOString(),
      entities,
      queries
    };
  }

  async listEntities(settings: HomeAssistantConnectionSettings): Promise<EntityCatalogEntry[]> {
    if (!hasConfiguredConnection(settings)) {
      return [];
    }

    const entityStateList = await this.fetchJson<
      Array<{ entity_id: string; attributes: Record<string, unknown> }>
    >(settings, "/states");

    return entityStateList
      .map(toEntityCatalogEntry)
      .sort((left, right) => left.entityId.localeCompare(right.entityId));
  }

  async discoverOpenEpaperDisplays(settings: HomeAssistantConnectionSettings): Promise<DiscoveredDisplayCandidate[]> {
    if (!hasConfiguredConnection(settings)) {
      return [];
    }

    type EntityRegistryResult = {
      entities: Array<{
        ei: string;
        di?: string;
        pl?: string;
        en?: string;
      }>;
    };

    type DeviceRegistryEntry = {
      id: string;
      name?: string;
      name_by_user?: string;
      manufacturer?: string;
      model?: string;
      identifiers?: Array<[string, string]>;
    };

    const [devices, entityRegistry] = await Promise.all([
      this.callWebSocket<DeviceRegistryEntry[]>(settings, "config/device_registry/list"),
      this.callWebSocket<EntityRegistryResult>(settings, "config/entity_registry/list_for_display")
    ]);

    const entitiesByDevice = new Map<string, EntityRegistryResult["entities"]>();
    for (const entity of entityRegistry.entities ?? []) {
      if (!entity.di) {
        continue;
      }
      const entries = entitiesByDevice.get(entity.di) ?? [];
      entries.push(entity);
      entitiesByDevice.set(entity.di, entries);
    }

    return devices
      .filter((device) => {
        const deviceEntities = entitiesByDevice.get(device.id) ?? [];
        return (
          looksLikeOpenEpaperLink(device.manufacturer) ||
          looksLikeOpenEpaperLink(device.model) ||
          device.identifiers?.some(([domain, identifier]) => looksLikeOpenEpaperLink(domain) || looksLikeOpenEpaperLink(identifier)) ||
          deviceEntities.some((entity) => looksLikeOpenEpaperLink(entity.pl) || looksLikeOpenEpaperLink(entity.ei))
        );
      })
      .map((device) => {
        const deviceEntities = entitiesByDevice.get(device.id) ?? [];
        const heightEntity = deviceEntities.find((entity) => /height/i.test(entity.ei));
        const widthEntity = deviceEntities.find((entity) => /width/i.test(entity.ei));
        let suggestedDisplayTypeId: string | undefined;
        if (widthEntity && heightEntity) {
          suggestedDisplayTypeId = `${widthEntity.ei}:${heightEntity.ei}`;
        }
        return {
          id: device.id,
          name: String(device.name_by_user ?? device.name ?? device.model ?? device.id),
          providerKind: "openepaperlink",
          providerRef: device.id,
          suggestedDisplayTypeId,
          metadata: {
            manufacturer: device.manufacturer,
            model: device.model,
            entityIds: deviceEntities.map((entity) => entity.ei)
          }
        } satisfies DiscoveredDisplayCandidate;
      });
  }

  private async resolveQuery(
    settings: HomeAssistantConnectionSettings,
    query: QueryDefinition
  ): Promise<QueryResult> {
    if (query.kind === "calendar_range") {
      const entityId = String(query.params.entityId ?? "");
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const items = await this.fetchJson<Array<Record<string, unknown>>>(
        settings,
        `/calendars/${entityId}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
      );
      return { kind: query.kind, items };
    }

    if (query.kind === "history_range") {
      const entityId = String(query.params.entityId ?? "");
      const hours = Number(query.params.hours ?? 12);
      const end = new Date();
      const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
      const history = await this.fetchJson<Array<Array<{ last_changed: string; state: string }>>>(
        settings,
        `/history/period/${encodeURIComponent(start.toISOString())}?filter_entity_id=${encodeURIComponent(entityId)}&end_time=${encodeURIComponent(end.toISOString())}&minimal_response`
      );
      const points =
        history[0]?.map((entry) => ({
          timestamp: entry.last_changed,
          value: Number(entry.state)
        })) ?? [];
      return { kind: query.kind, points };
    }

    if (query.kind === "entity") {
      const entityId = String(query.params.entityId ?? "");
      const entity = await this.fetchJson<{
        entity_id: string;
        state: string;
        attributes: Record<string, unknown>;
      }>(settings, `/states/${entityId}`);
      const attributeValue = entity.attributes?.value;
      return {
        kind: query.kind,
        value:
          typeof attributeValue === "string" ||
          typeof attributeValue === "number" ||
          typeof attributeValue === "boolean" ||
          attributeValue === null
            ? attributeValue
            : entity.state ?? null
      };
    }

    if (query.kind === "template_derived") {
      const sourceQueryId = String(query.params.sourceQueryId ?? "");
      const items = SAMPLE_DATA.queries[sourceQueryId]?.items ?? [];
      return {
        kind: query.kind,
        value: items.length,
        meta: { count: items.length }
      };
    }

    return emptyQueryResult(query.kind);
  }
}
