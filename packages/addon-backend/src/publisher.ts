export interface PublishPayload {
  projectId: string;
  displayProfileId: string;
  targetId?: string;
  hash: string;
  png: Buffer;
  activeScreenId: string;
  activeOverlayId?: string;
}

export interface Publisher {
  publish(payload: PublishPayload): Promise<void>;
}

export class NoopPublisher implements Publisher {
  async publish(payload: PublishPayload): Promise<void> {
    const summary = {
      projectId: payload.projectId,
      displayProfileId: payload.displayProfileId,
      targetId: payload.targetId,
      hash: payload.hash,
      activeScreenId: payload.activeScreenId,
      activeOverlayId: payload.activeOverlayId
    };
    console.log("noop publish", summary);
  }
}
