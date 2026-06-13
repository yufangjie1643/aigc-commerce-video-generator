import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCommerceVideoCli } from "../src/commerce-video-cli.js";

describe("od commerce-video CLI", () => {
  let stdoutWrite: { mockRestore: () => void };
  let stderrWrite: { mockRestore: () => void };
  let stdoutOutput: string[];
  let stderrOutput: string[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let tempDirs: string[];

  beforeEach(() => {
    stdoutOutput = [];
    stderrOutput = [];
    tempDirs = [];
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutOutput.push(String(chunk));
      return true;
    });
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrOutput.push(String(chunk));
      return true;
    });
    fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project_1/commerce-video/workflow")) {
        return jsonResponse({
          workflow: {
            projectId: "project_1",
            fileName: "commerce-video.workflow.json",
            stages: []
          }
        });
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/script")) {
        return jsonResponse({
          workflow: {
            projectId: "project_1",
            script: JSON.parse(String(init?.body)).script ?? JSON.parse(String(init?.body))
          }
        });
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/materials")) {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({
          workflow: {
            projectId: "project_1",
            fileName: "commerce-video.workflow.json",
            materials: { productMaterialIds: body.productMaterials?.map((item: { id?: string }) => item.id ?? "new") }
          },
          productMaterials: body.productMaterials ?? []
        });
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/storyboard")) {
        return jsonResponse({
          workflow: {
            projectId: "project_1",
            storyboard: JSON.parse(String(init?.body))
          }
        });
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/generate")) {
        return jsonResponse(
          {
            taskId: "task_1",
            status: "running",
            workflow: {
              projectId: "project_1",
              generation: JSON.parse(String(init?.body))
            }
          },
          202
        );
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/jobs")) {
        return jsonResponse({
          jobs: [{ taskId: "task_1", status: "running", model: "doubao-seedance-2-0-260128", progress: [] }]
        });
      }
      if (url.endsWith("/api/commerce-video/jobs/task_1/wait")) {
        return jsonResponse({
          taskId: "task_1",
          status: "done",
          progress: ["video render complete"],
          nextSince: 1,
          file: { path: "commerce-video-final.mp4" }
        });
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/preview")) {
        return jsonResponse({
          workflow: { projectId: "project_1" },
          preview: { path: "commerce-video-final.mp4" },
          export: { previewPath: "commerce-video-final.mp4", downloadPath: "commerce-video-final.mp4" }
        });
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/export")) {
        return jsonResponse({
          workflow: { projectId: "project_1" },
          export: {
            status: "done",
            previewPath: "commerce-video-final.mp4",
            downloadPath: "commerce-video-final.mp4",
            manifestPath: "commerce-video/export-manifest.json"
          }
        });
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("prints workflow JSON for a project", async () => {
    const result = await runCommerceVideoCli([
      "workflow",
      "--project",
      "project_1",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(stderrOutput.join("")).toBe("");
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({
      workflow: { projectId: "project_1", fileName: "commerce-video.workflow.json" }
    });
  });

  it("accepts script content from --prompt-file stdin-compatible flags", async () => {
    const result = await runCommerceVideoCli([
      "script",
      "--project",
      "project_1",
      "--title",
      "白色牛仔裙",
      "--hook",
      "三秒显瘦",
      "--prompt",
      "高腰 A 字版型，遮胯又显腿长。",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      title: "白色牛仔裙",
      hook: "三秒显瘦",
      voiceover: "高腰 A 字版型，遮胯又显腿长。"
    });
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({
      workflow: { script: { title: "白色牛仔裙" } }
    });
  });

  it("submits project-local product materials from --materials-file", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "od-commerce-video-cli-"));
    tempDirs.push(tempDir);
    const materialsFile = path.join(tempDir, "materials.json");
    writeFileSync(
      materialsFile,
      JSON.stringify({
        productMaterials: [
          {
            id: "material_1",
            title: "白色牛仔裙",
            product: { sellingPoints: ["高腰显腿长"] }
          }
        ],
        uploadedFiles: [{ path: "uploads/skirt.jpg", name: "skirt.jpg", mime: "image/jpeg" }]
      })
    );

    const result = await runCommerceVideoCli([
      "materials",
      "--project",
      "project_1",
      "--materials-file",
      materialsFile,
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      productMaterials: [{ id: "material_1", title: "白色牛仔裙" }],
      uploadedFiles: [{ path: "uploads/skirt.jpg" }]
    });
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({
      workflow: { materials: { productMaterialIds: ["material_1"] } },
      productMaterials: [{ id: "material_1" }]
    });
  });

  it("requires explicit full automation before generate --follow waits for progress", async () => {
    const result = await runCommerceVideoCli([
      "generate",
      "--project",
      "project_1",
      "--model",
      "doubao-seedance-2-0-260128",
      "--follow",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits storyboard JSON through the staged workflow endpoint", async () => {
    const result = await runCommerceVideoCli([
      "storyboard",
      "--project",
      "project_1",
      "--storyboard-json",
      JSON.stringify({
        shots: [
          { visualGoal: "开场", prompt: "Opening shot" },
          { visualGoal: "细节", prompt: "Detail shot" },
          { visualGoal: "收尾", prompt: "CTA shot" }
        ]
      }),
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.shots).toHaveLength(3);
    const responseBody = JSON.parse(stdoutOutput.join(""));
    expect(responseBody.workflow.storyboard.shots).toHaveLength(3);
    expect(responseBody.workflow.storyboard.shots[0]).toMatchObject({ visualGoal: "开场" });
  });

  it("submits storyboard JSON from a UTF-8 file to avoid shell quoting issues", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "od-commerce-video-cli-"));
    tempDirs.push(tempDir);
    const storyboardFile = path.join(tempDir, "storyboard.json");
    writeFileSync(
      storyboardFile,
      JSON.stringify(
        {
          shots: [
            { visualGoal: "开场白裙特写", prompt: "Opening dress detail" },
            { visualGoal: "腰带金扣细节", prompt: "Gold buckle detail" },
            { visualGoal: "结尾 CTA", prompt: "Final CTA" }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runCommerceVideoCli([
      "storyboard",
      "--project",
      "project_1",
      "--storyboard-file",
      storyboardFile,
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.shots[0]).toMatchObject({ visualGoal: "开场白裙特写" });
  });

  it("writes JSON output directly as UTF-8 without relying on shell redirection", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "od-commerce-video-cli-"));
    tempDirs.push(tempDir);
    const outputFile = path.join(tempDir, "workflow-output.json");

    const result = await runCommerceVideoCli([
      "workflow",
      "--project",
      "project_1",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json-output",
      outputFile
    ]);

    expect(result.exitCode).toBe(0);
    expect(stdoutOutput.join("")).toBe("");
    const raw = readFileSync(outputFile);
    expect(raw.includes(Buffer.from("project_1", "utf8"))).toBe(true);
    expect(JSON.parse(raw.toString("utf8"))).toMatchObject({
      workflow: { projectId: "project_1" }
    });
  });

  it("creates generation tasks with the default Seedance 2.0 model without waiting unless full-auto follow is explicit", async () => {
    const result = await runCommerceVideoCli([
      "generate",
      "--project",
      "project_1",
      "--output",
      "commerce-video/final.mp4",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "doubao-seedance-2-0-260128",
      output: "commerce-video/final.mp4"
    });
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({ taskId: "task_1", status: "running" });
  });

  it("runs preview and export after full-auto follow reaches a completed generation task", async () => {
    const result = await runCommerceVideoCli([
      "generate",
      "--project",
      "project_1",
      "--follow",
      "--full-auto",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:17456/api/projects/project_1/commerce-video/generate",
      "http://127.0.0.1:17456/api/commerce-video/jobs/task_1/wait",
      "http://127.0.0.1:17456/api/projects/project_1/commerce-video/preview",
      "http://127.0.0.1:17456/api/projects/project_1/commerce-video/export"
    ]);
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({
      taskId: "task_1",
      job: { status: "done" },
      previewResult: { preview: { path: "commerce-video-final.mp4" } },
      exportResult: { export: { status: "done", manifestPath: "commerce-video/export-manifest.json" } }
    });
  });

  it("hands off full-auto follow when the generation task is still running after the wait budget", async () => {
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project_1/commerce-video/generate")) {
        return jsonResponse(
          {
            taskId: "task_1",
            status: "running",
            workflow: {
              projectId: "project_1",
              generation: JSON.parse(String(init?.body))
            }
          },
          202
        );
      }
      if (url.endsWith("/api/commerce-video/jobs/task_1/wait")) {
        return jsonResponse({
          taskId: "task_1",
          status: "running",
          progress: [],
          nextSince: 0
        });
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404);
    });

    const result = await runCommerceVideoCli([
      "generate",
      "--project",
      "project_1",
      "--follow",
      "--full-auto",
      "--wait-timeout-ms",
      "1",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(stdoutOutput.join(""));
    expect(body).toMatchObject({
      taskId: "task_1",
      job: {
        taskId: "task_1",
        status: "running",
        nextSince: 0
      }
    });
    expect(body.job.nextCommand).toContain("commerce-video wait task_1 --since 0");
  });

  it("supports task progress, preview, and export stage commands", async () => {
    const jobs = await runCommerceVideoCli([
      "jobs",
      "--project",
      "project_1",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);
    expect(jobs.exitCode).toBe(0);
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({ jobs: [{ taskId: "task_1", status: "running" }] });

    stdoutOutput = [];
    const wait = await runCommerceVideoCli(["wait", "task_1", "--daemon-url", "http://127.0.0.1:17456", "--json"]);
    expect(wait.exitCode).toBe(0);
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({ taskId: "task_1", status: "done" });

    stdoutOutput = [];
    const preview = await runCommerceVideoCli([
      "preview",
      "--project",
      "project_1",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({ preview: { path: "commerce-video-final.mp4" } });

    stdoutOutput = [];
    const exported = await runCommerceVideoCli([
      "export",
      "--project",
      "project_1",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);
    expect(exported.exitCode).toBe(0);
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({
      export: { status: "done", manifestPath: "commerce-video/export-manifest.json" }
    });
  });
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
