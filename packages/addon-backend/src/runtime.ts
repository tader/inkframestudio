import { renderProject } from "../../render-core/src/renderer.js";
import type { Project } from "../../render-core/src/types.js";
import { rgbaToPngBuffer } from "./png.js";
import type { Publisher } from "./publisher.js";

export class RenderRuntime {
  private readonly lastHashes = new Map<string, string>();

  constructor(private readonly publisher: Publisher) {}

  async publishIfChanged(
    project: Project,
    displayProfileId: string,
    data: Parameters<typeof renderProject>[2],
    scenarioId?: string,
    targetId?: string
  ): Promise<{ published: boolean; hash: string; png: Buffer; activeScreenId: string; activeOverlayId?: string }> {
    const rendered = renderProject(project, displayProfileId, data, scenarioId);
    const png = rgbaToPngBuffer(rendered.width, rendered.height, rendered.rgba);
    const key = `${project.id}:${targetId ?? displayProfileId}`;
    const previousHash = this.lastHashes.get(key);
    if (previousHash === rendered.hash) {
      return {
        published: false,
        hash: rendered.hash,
        png,
        activeScreenId: rendered.activeScreenId,
        activeOverlayId: rendered.activeOverlayId
      };
    }
    await this.publisher.publish({
      projectId: project.id,
      displayProfileId,
      targetId,
      hash: rendered.hash,
      png,
      activeScreenId: rendered.activeScreenId,
      activeOverlayId: rendered.activeOverlayId
    });
    this.lastHashes.set(key, rendered.hash);
    return {
      published: true,
      hash: rendered.hash,
      png,
      activeScreenId: rendered.activeScreenId,
      activeOverlayId: rendered.activeOverlayId
    };
  }
}
