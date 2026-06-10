import type http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { closeDatabase, insertProject, openDatabase } from "../src/db.js";
import { insertMediaTask } from "../src/media-tasks.js";
import { writeProjectFile } from "../src/projects.js";
import { startServer } from "../src/server.js";
import { toolTokenRegistry } from "../src/tool-tokens.js";

const projectsRoot = () => path.join(process.env.OD_DATA_DIR ?? path.join(process.cwd(), ".od"), "projects");

describe("commerce video workflow routes", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    toolTokenRegistry.clear();
    closeDatabase();
  });

  it("initializes a project-level workflow with the P0 stage rail", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Ecommerce video workflow",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/workflow`
    );
    const body = (await response.json()) as {
      workflow?: {
        fileName?: string;
        stages?: Array<{ id: string; status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.workflow?.fileName).toBe("commerce-video.workflow.json");
    expect(body.workflow?.stages).toEqual([
      { id: "materials", label: "Materials", status: "idle" },
      { id: "script", label: "Script", status: "idle" },
      { id: "storyboard", label: "Storyboard", status: "idle" },
      { id: "generation", label: "Generation", status: "idle" },
      { id: "progress", label: "Progress", status: "idle" },
      { id: "export", label: "Export", status: "idle" }
    ]);
  });

  it("writes script and storyboard steps into the workflow file", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Script and storyboard",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const scriptResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/script`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "白色牛仔裙 15 秒带货短片",
          hook: "三秒看懂显瘦秘诀",
          voiceover: "高腰 A 字版型，遮胯又显腿长。",
          sellingPoints: ["高腰显腿长", "A 字版型遮胯", "白色百搭"]
        })
      }
    );
    expect(scriptResponse.status).toBe(200);

    const storyboardResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/storyboard`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shots: [
            {
              visualGoal: "开场展示整身穿搭",
              prompt: "Vertical ecommerce video opening shot of a white denim skirt outfit",
              voiceover: "三秒看懂显瘦秘诀",
              durationSec: 3,
              requiredAssets: ["product_1"]
            },
            {
              visualGoal: "腰线和版型特写",
              prompt: "Close-up of high waist white denim skirt fit and fabric",
              voiceover: "高腰 A 字版型，遮胯又显腿长。",
              durationSec: 4,
              requiredAssets: ["product_1"]
            },
            {
              visualGoal: "日常场景上身",
              prompt: "Lifestyle street scene featuring the product skirt",
              voiceover: "上班通勤和周末出街都能穿。",
              durationSec: 4,
              requiredAssets: ["product_1"]
            }
          ]
        })
      }
    );
    const storyboardBody = (await storyboardResponse.json()) as {
      workflow?: {
        storyboard?: { totalDurationSec?: number; shots?: unknown[] };
        stages?: Array<{ id: string; status: string }>;
      };
    };

    expect(storyboardResponse.status).toBe(200);
    expect(storyboardBody.workflow?.storyboard?.shots).toHaveLength(3);
    expect(storyboardBody.workflow?.storyboard?.totalDurationSec).toBeLessThanOrEqual(15);
    expect(storyboardBody.workflow?.stages?.find((stage) => stage.id === "script")?.status).toBe("done");
    expect(storyboardBody.workflow?.stages?.find((stage) => stage.id === "storyboard")?.status).toBe("done");
  });

  it("persists workflow progress at the project level across fresh reads", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Project-scoped commerce video workflow",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const materialsResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productAssetIds: ["product-white-dress"],
          uploadedFiles: [{ path: "uploads/white-dress-1.jpg", name: "white-dress-1.jpg", kind: "image" }],
          notes: "用户已上传白色无袖翻领连衣裙素材。"
        })
      }
    );
    expect(materialsResponse.status).toBe(200);

    const workflowResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/workflow`
    );
    const body = (await workflowResponse.json()) as {
      workflow?: {
        projectId?: string;
        materials?: { productAssetIds?: string[]; notes?: string };
        stages?: Array<{ id: string; status: string }>;
      };
    };

    expect(workflowResponse.status).toBe(200);
    expect(body.workflow?.projectId).toBe(projectId);
    expect(body.workflow?.materials?.productAssetIds).toEqual(["product-white-dress"]);
    expect(body.workflow?.materials?.notes).toContain("白色无袖翻领连衣裙");
    expect(body.workflow?.stages?.find((stage) => stage.id === "materials")?.status).toBe("done");
    expect(body.workflow?.stages?.find((stage) => stage.id === "script")?.status).toBe("idle");
  });

  it("applies the media generation sandbox gate to commerce video generation", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Sandbox gated commerce video",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const originalSandboxMode = process.env.OD_SANDBOX_MODE;
    process.env.OD_SANDBOX_MODE = "1";
    try {
      const response = await fetch(
        `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "doubao-seedance-2-0-260128" })
        }
      );
      const body = (await response.json()) as { error?: { code?: string } };

      expect(response.status).toBe(401);
      expect(body.error?.code).toBe("TOOL_TOKEN_MISSING");
    } finally {
      if (originalSandboxMode === undefined) delete process.env.OD_SANDBOX_MODE;
      else process.env.OD_SANDBOX_MODE = originalSandboxMode;
    }
  });

  it("rejects generation before materials, script, and storyboard stages are complete", async () => {
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    const project = insertProject(db, {
      id: projectId,
      name: "Strict staged commerce video",
      createdAt: now,
      updatedAt: now
    });
    await writeProjectFile(
      projectsRoot(),
      projectId,
      "commerce-video.workflow.json",
      `${JSON.stringify({
        version: 1,
        projectId,
        fileName: "commerce-video.workflow.json",
        stages: [
          { id: "materials", label: "Materials", status: "done" },
          { id: "script", label: "Script", status: "done" },
          { id: "storyboard", label: "Storyboard", status: "idle" },
          { id: "generation", label: "Generation", status: "idle" },
          { id: "progress", label: "Progress", status: "idle" },
          { id: "export", label: "Export", status: "idle" }
        ],
        materials: { notes: "用户已上传白色无袖翻领连衣裙素材。" },
        script: {
          title: "白色连衣裙 15 秒带货短片",
          hook: "夏季最省心的一条白裙",
          voiceover: "通勤约会都能穿。"
        },
        createdAt: now,
        updatedAt: now
      })}\n`,
      { overwrite: true },
      project?.metadata
    );

    const grant = toolTokenRegistry.mint({
      runId: `run_${randomUUID()}`,
      projectId,
      allowedOperations: ["media:generate"]
    });
    const originalSandboxMode = process.env.OD_SANDBOX_MODE;
    process.env.OD_SANDBOX_MODE = "1";
    try {
      const started = (await startServer({ port: 0, returnServer: true })) as {
        url: string;
        server: http.Server;
      };
      server = started.server;

      const response = await fetch(
        `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/generate`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${grant.token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ model: "doubao-seedance-2-0-260128" })
        }
      );
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; details?: { stageId?: string } };
      };

      expect(response.status).toBe(409);
      expect(body.error?.code).toBe("COMMERCE_VIDEO_STAGE_REQUIRED");
      expect(body.error?.details?.stageId).toBe("storyboard");
      expect(body.error?.message).toContain("基础分镜");
    } finally {
      if (originalSandboxMode === undefined) delete process.env.OD_SANDBOX_MODE;
      else process.env.OD_SANDBOX_MODE = originalSandboxMode;
    }
  });

  it("returns commerce job wait snapshots for recovered media tasks", async () => {
    const now = Date.now() - 5_000;
    const projectId = `project_${randomUUID()}`;
    const taskId = `task_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Commerce wait task",
      createdAt: now,
      updatedAt: now
    });
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: "running",
      surface: "video",
      model: "doubao-seedance-2-0-260128",
      progress: ["commerce generation accepted"],
      startedAt: now,
      updatedAt: now
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(`${started.url}/api/commerce-video/jobs/${encodeURIComponent(taskId)}/wait`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since: 0, timeoutMs: 0 })
    });
    const body = (await response.json()) as {
      status?: string;
      progress?: string[];
      error?: { code?: string };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("interrupted");
    expect(body.progress).toEqual(["commerce generation accepted"]);
    expect(body.error?.code).toBe("DAEMON_RESTART");
  });

  it("serves preview state and finalizes export manifests from the workflow", async () => {
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    const project = insertProject(db, {
      id: projectId,
      name: "Commerce preview export",
      createdAt: now,
      updatedAt: now
    });
    await writeProjectFile(
      projectsRoot(),
      projectId,
      "commerce-video.workflow.json",
      `${JSON.stringify({
        version: 1,
        projectId,
        fileName: "commerce-video.workflow.json",
        stages: [
          { id: "materials", label: "Materials", status: "done" },
          { id: "script", label: "Script", status: "done" },
          { id: "storyboard", label: "Storyboard", status: "done" },
          { id: "generation", label: "Generation", status: "done" },
          { id: "progress", label: "Progress", status: "done" },
          { id: "export", label: "Export", status: "idle" }
        ],
        materials: { productAssetIds: [], uploadedFiles: [] },
        generation: {
          status: "done",
          mediaTaskId: "task-preview",
          model: "doubao-seedance-2-0-260128",
          output: { path: "commerce-video/final.mp4", name: "final.mp4" }
        },
        export: {
          status: "idle",
          previewPath: "commerce-video/final.mp4",
          downloadPath: "commerce-video/final.mp4"
        },
        createdAt: now,
        updatedAt: now
      })}\n`,
      { overwrite: true },
      project?.metadata
    );

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const previewResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/preview`
    );
    const previewBody = (await previewResponse.json()) as { preview?: { path?: string } };
    expect(previewResponse.status).toBe(200);
    expect(previewBody.preview?.path).toBe("commerce-video/final.mp4");

    const exportResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/export`,
      { method: "POST" }
    );
    const exportBody = (await exportResponse.json()) as {
      export?: { status?: string; downloadPath?: string; manifestPath?: string };
      workflow?: { stages?: Array<{ id: string; status: string }> };
    };

    expect(exportResponse.status).toBe(200);
    expect(exportBody.export).toMatchObject({
      status: "done",
      downloadPath: "commerce-video/final.mp4",
      manifestPath: "commerce-video/export-manifest.json"
    });
    expect(exportBody.workflow?.stages?.find((stage) => stage.id === "export")?.status).toBe("done");
  });

  it("rejects export until the task progress stage is complete", async () => {
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    const project = insertProject(db, {
      id: projectId,
      name: "Commerce export gate",
      createdAt: now,
      updatedAt: now
    });
    await writeProjectFile(
      projectsRoot(),
      projectId,
      "commerce-video.workflow.json",
      `${JSON.stringify({
        version: 1,
        projectId,
        fileName: "commerce-video.workflow.json",
        stages: [
          { id: "materials", label: "Materials", status: "done" },
          { id: "script", label: "Script", status: "done" },
          { id: "storyboard", label: "Storyboard", status: "done" },
          { id: "generation", label: "Generation", status: "done" },
          { id: "progress", label: "Progress", status: "running" },
          { id: "export", label: "Export", status: "idle" }
        ],
        materials: { notes: "素材已整理。" },
        script: {
          title: "白色连衣裙 15 秒带货短片",
          hook: "夏季最省心的一条白裙",
          voiceover: "通勤约会都能穿。"
        },
        storyboard: {
          totalDurationSec: 9,
          shots: [
            { id: "shot_1", index: 1, durationSec: 3, visualGoal: "开场", prompt: "Opening shot" },
            { id: "shot_2", index: 2, durationSec: 3, visualGoal: "细节", prompt: "Detail shot" },
            { id: "shot_3", index: 3, durationSec: 3, visualGoal: "收尾", prompt: "CTA shot" }
          ]
        },
        generation: {
          status: "done",
          mediaTaskId: "task-preview",
          model: "doubao-seedance-2-0-260128",
          output: { path: "commerce-video/final.mp4", name: "final.mp4" }
        },
        export: {
          status: "idle",
          previewPath: "commerce-video/final.mp4",
          downloadPath: "commerce-video/final.mp4"
        },
        createdAt: now,
        updatedAt: now
      })}\n`,
      { overwrite: true },
      project?.metadata
    );

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/export`, {
      method: "POST"
    });
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: { stageId?: string } };
    };

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("COMMERCE_VIDEO_STAGE_REQUIRED");
    expect(body.error?.details?.stageId).toBe("progress");
    expect(body.error?.message).toContain("任务进度");
  });
});
