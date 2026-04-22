import { describe, expect, it } from "vitest";
import { SAMPLE_DATA, SAMPLE_PROJECT } from "../../render-core/src/index.js";
import type { PublishPayload, Publisher } from "./publisher.js";
import { RenderRuntime } from "./runtime.js";

class RecordingPublisher implements Publisher {
  payloads: PublishPayload[] = [];

  async publish(payload: PublishPayload): Promise<void> {
    this.payloads.push(payload);
  }
}

describe("runtime", () => {
  it("skips publishing when the hash did not change", async () => {
    const publisher = new RecordingPublisher();
    const runtime = new RenderRuntime(publisher);

    const first = await runtime.publishIfChanged(SAMPLE_PROJECT, "tri296x128-red", SAMPLE_DATA);
    const second = await runtime.publishIfChanged(SAMPLE_PROJECT, "tri296x128-red", SAMPLE_DATA);

    expect(first.published).toBe(true);
    expect(second.published).toBe(false);
    expect(publisher.payloads).toHaveLength(1);
  });
});
