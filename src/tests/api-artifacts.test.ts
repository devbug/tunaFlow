import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import * as artifactApi from "@/lib/api/artifacts";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("artifacts API layer", () => {
  it("listArtifacts calls correct command", async () => {
    mockInvoke.mockResolvedValue([]);
    await artifactApi.listArtifacts("conv-1");
    expect(mockInvoke).toHaveBeenCalledWith("list_artifacts", {
      conversationId: "conv-1",
    });
  });

  it("createArtifact with subtaskId", async () => {
    mockInvoke.mockResolvedValue({ id: "a1" });
    await artifactApi.createArtifact({
      conversationId: "conv-1",
      type: "note",
      title: "Art",
      content: "body",
      subtaskId: "st-1",
    });
    expect(mockInvoke).toHaveBeenCalledWith("create_artifact", {
      input: expect.objectContaining({ subtaskId: "st-1" }),
    });
  });

  it("linkArtifactToSubtask", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await artifactApi.linkArtifactToSubtask("a1", "st1");
    expect(mockInvoke).toHaveBeenCalledWith("link_artifact_to_subtask", {
      artifactId: "a1",
      subtaskId: "st1",
    });
  });

  it("deleteArtifact", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await artifactApi.deleteArtifact("a1");
    expect(mockInvoke).toHaveBeenCalledWith("delete_artifact", { id: "a1" });
  });
});
