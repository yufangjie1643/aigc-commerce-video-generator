import type http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { closeDatabase, insertProject, openDatabase } from "../src/db.js";
import { insertMediaTask } from "../src/media-tasks.js";
import { writeProjectFile } from "../src/projects.js";
import { startServer } from "../src/server.js";
import { toolTokenRegistry } from "../src/tool-tokens.js";

const projectsRoot = () => path.join(process.env.OD_DATA_DIR ?? path.join(process.cwd(), ".od"), "projects");

function optionalTableCount(db: Database.Database, tableName: string): number {
  if (!/^[A-Za-z0-9_]+$/.test(tableName)) throw new Error(`unsafe table name: ${tableName}`);
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  if (!exists) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

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

    expect(response.status, JSON.stringify(body)).toBe(200);
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

    const materialsResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadedFiles: [{ path: "product_1.jpg", name: "product_1.jpg", mime: "image/jpeg" }],
          notes: "用户已上传商品素材。"
        })
      }
    );
    expect(materialsResponse.status).toBe(200);

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
          storyboard: [
            {
              visual: "开场展示整身穿搭",
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
    expect(storyboardBody.workflow?.storyboard?.shots?.[0]).toMatchObject({
      visualGoal: "开场展示整身穿搭",
      prompt: "开场展示整身穿搭"
    });
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
          productMaterialIds: ["material-white-dress"],
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
        materials?: { productMaterialIds?: string[]; notes?: string };
        stages?: Array<{ id: string; status: string }>;
      };
    };

    expect(workflowResponse.status).toBe(200);
    expect(body.workflow?.projectId).toBe(projectId);
    expect(body.workflow?.materials?.productMaterialIds).toEqual(["material-white-dress"]);
    expect(body.workflow?.materials?.notes).toContain("白色无袖翻领连衣裙");
    expect(body.workflow?.stages?.find((stage) => stage.id === "materials")?.status).toBe("done");
    expect(body.workflow?.stages?.find((stage) => stage.id === "script")?.status).toBe("idle");
  });

  it("persists workbench state in the project workflow file", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Workbench state",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/workbench`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activeStageId: "storyboard",
          pendingNextStageId: "generation",
          selectedModel: "doubao-seedance-2-0-fast-260128",
          exportSettings: {
            format: "webm",
            resolution: "720x1280",
            includeSubtitles: true,
            includeVoiceover: true,
            includeBgm: false,
            targetDuration: 5
          }
        })
      }
    );
    const body = (await response.json()) as {
      workflow?: {
        workbench?: {
          activeStageId?: string;
          pendingNextStageId?: string | null;
          selectedModel?: string;
          exportSettings?: { format?: string; targetDuration?: number };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.workflow?.workbench).toMatchObject({
      activeStageId: "storyboard",
      pendingNextStageId: "generation",
      selectedModel: "doubao-seedance-2-0-fast-260128",
      exportSettings: {
        format: "webm",
        targetDuration: 5
      }
    });

    const workflowFile = path.join(projectsRoot(), projectId, "commerce-video.workflow.json");
    const persisted = JSON.parse(readFileSync(workflowFile, "utf8")) as {
      workbench?: { selectedModel?: string; activeStageId?: string };
    };
    expect(persisted.workbench?.activeStageId).toBe("storyboard");
    expect(persisted.workbench?.selectedModel).toBe("doubao-seedance-2-0-fast-260128");
  });

  it("reconciles stale stage statuses from persisted workflow content", async () => {
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    const project = insertProject(db, {
      id: projectId,
      name: "Stale commerce stages",
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
          { id: "materials", label: "Materials", status: "idle" },
          { id: "script", label: "Script", status: "idle" },
          { id: "storyboard", label: "Storyboard", status: "idle" },
          { id: "generation", label: "Generation", status: "idle" },
          { id: "progress", label: "Progress", status: "idle" },
          { id: "export", label: "Export", status: "idle" }
        ],
        materials: { notes: "用户已上传并确认商品素材。" },
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

    const response = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/workflow`
    );
    const body = (await response.json()) as { workflow?: { stages?: Array<{ id: string; status: string }> } };

    expect(response.status).toBe(200);
    expect(body.workflow?.stages?.find((stage) => stage.id === "materials")?.status).toBe("done");
    expect(body.workflow?.stages?.find((stage) => stage.id === "script")?.status).toBe("done");
    expect(body.workflow?.stages?.find((stage) => stage.id === "storyboard")?.status).toBe("done");
    expect(body.workflow?.stages?.find((stage) => stage.id === "generation")?.status).toBe("idle");
  });

  it("stores parsed product materials in the project-local commerce video database", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Project-local product materials",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const globalProductCountBefore = optionalTableCount(db, "asset_library_products");

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productMaterials: [
            {
              title: "香槟色花卉印花吊带荷叶边连衣裙",
              subject: "花卉印花吊带连衣裙",
              category: "女装连衣裙",
              files: [
                {
                  path: "uploads/front-full.jpg",
                  name: "front-full.jpg",
                  mime: "image/jpeg",
                  size: 1234
                }
              ],
              product: {
                summary: "同一商品不同角度的商品图解析结果。",
                sellingPoints: ["荷叶边领口", "花卉印花", "吊带可调节"],
                constraints: ["只基于图片可见事实"],
                suggestedAngles: ["面料特写", "后背肩带细节"]
              },
              analysis: {
                visionText: "米白 / 香槟色花卉印花吊带荷叶边连衣裙，包含正面、面料和肩带细节。",
                clusterId: "cluster-01"
              },
              metadata: {
                importedBy: "commerce-video-materials"
              }
            }
          ],
          uploadedFiles: [{ path: "uploads/front-full.jpg", name: "front-full.jpg", mime: "image/jpeg" }],
          notes: "商品素材解析写入项目本地数据库。"
        })
      }
    );
    const body = (await response.json()) as {
      workflow?: {
        materials?: {
          productMaterialIds?: string[];
          notes?: string;
        };
      };
      productMaterials?: Array<{
        id: string;
        title: string;
        product?: { sellingPoints?: string[] };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.productMaterials).toHaveLength(1);
    expect(body.productMaterials?.[0]?.title).toBe("香槟色花卉印花吊带荷叶边连衣裙");
    expect(body.productMaterials?.[0]?.product?.sellingPoints).toContain("花卉印花");
    expect(body.workflow?.materials?.productMaterialIds).toEqual([body.productMaterials?.[0]?.id]);
    expect(body.workflow?.materials?.notes).toContain("项目本地数据库");

    const projectMaterialsDb = path.join(projectsRoot(), projectId, "commerce-video", "materials.sqlite");
    expect(existsSync(projectMaterialsDb)).toBe(true);
    const projectSqlite = new Database(projectMaterialsDb, { readonly: true });
    try {
      const rows = projectSqlite
        .prepare("SELECT id, title, product_json AS productJson, analysis_json AS analysisJson FROM product_materials")
        .all() as Array<{ id: string; title: string; productJson: string; analysisJson: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(body.productMaterials?.[0]?.id);
      expect(rows[0]?.title).toBe("香槟色花卉印花吊带荷叶边连衣裙");
      expect(JSON.parse(rows[0]?.productJson ?? "{}").sellingPoints).toContain("吊带可调节");
      expect(JSON.parse(rows[0]?.analysisJson ?? "{}").clusterId).toBe("cluster-01");
    } finally {
      projectSqlite.close();
    }

    const globalProductCountAfter = optionalTableCount(db, "asset_library_products");
    expect(globalProductCountAfter).toBe(globalProductCountBefore);
  });

  it("returns project product materials with fresh workflow and materials reads", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Readable commerce product materials",
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
          productMaterials: [
            {
              title: "白色无袖翻领连衣裙",
              subject: "夏季通勤连衣裙",
              category: "女装",
              files: [{ path: "uploads/white-dress-front.jpg", name: "white-dress-front.jpg", mime: "image/jpeg" }],
              product: {
                summary: "白色无袖翻领连衣裙，同色腰带和金属扣。",
                sellingPoints: ["100% 棉", "同色腰带", "侧插兜"],
                suggestedAngles: ["翻领特写", "腰带扣特写"]
              }
            }
          ],
          uploadedFiles: [{ path: "uploads/white-dress-front.jpg", name: "white-dress-front.jpg", mime: "image/jpeg" }]
        })
      }
    );
    expect(materialsResponse.status).toBe(200);

    const workflowResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/workflow`
    );
    const workflowBody = (await workflowResponse.json()) as {
      productMaterials?: Array<{ title?: string; product?: { sellingPoints?: string[] } }>;
    };
    expect(workflowResponse.status).toBe(200);
    expect(workflowBody.productMaterials?.[0]?.title).toBe("白色无袖翻领连衣裙");
    expect(workflowBody.productMaterials?.[0]?.product?.sellingPoints).toContain("侧插兜");

    const readResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`
    );
    const readBody = (await readResponse.json()) as {
      productMaterials?: Array<{ title?: string; files?: Array<{ path?: string }> }>;
    };
    expect(readResponse.status).toBe(200);
    expect(readBody.productMaterials?.[0]?.title).toBe("白色无袖翻领连衣裙");
    expect(readBody.productMaterials?.[0]?.files?.[0]?.path).toBe("uploads/white-dress-front.jpg");
  });

  it("builds generation prompt from project-local materials and flattens requested output paths", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Generation prompt uses materials",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productMaterials: [
          {
            title: "白色无袖翻领连衣裙",
            subject: "夏季通勤连衣裙",
            category: "女装",
            files: [{ path: "uploads/white-dress-front.jpg", name: "white-dress-front.jpg", mime: "image/jpeg" }],
            product: {
              summary: "白色无袖翻领连衣裙，同色腰带和金属扣。",
              sellingPoints: ["100% 棉", "同色腰带", "侧插兜"],
              constraints: ["不要改变商品颜色"],
              suggestedAngles: ["翻领特写", "腰带扣特写"]
            },
            analysis: {
              visionText: "模特展示白色无袖翻领连衣裙。"
            }
          }
        ],
        uploadedFiles: [{ path: "uploads/white-dress-front.jpg", name: "white-dress-front.jpg", mime: "image/jpeg" }],
        notes: "用户刚上传的商品素材。"
      })
    });
    await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "白色连衣裙 15 秒带货短片",
        hook: "夏季最省心的一条白裙",
        voiceover: "通勤约会都能穿。",
        sellingPoints: ["通勤", "约会"],
        cta: "现在下单。"
      })
    });
    await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/storyboard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shots: [
          { visualGoal: "开场全身", prompt: "Opening full-body shot", durationSec: 3 },
          { visualGoal: "腰带细节", prompt: "Close-up of belt", durationSec: 3 },
          { visualGoal: "CTA 收尾", prompt: "Final CTA shot", durationSec: 3 }
        ]
      })
    });

    const generateResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          output: "commerce-video/export-white-dress.mp4"
        })
      }
    );
    const generateBody = (await generateResponse.json()) as {
      workflow?: {
        generation?: {
          model?: string;
          prompt?: string;
          referenceFiles?: Array<{ path?: string }>;
        };
      };
    };

    expect(generateResponse.status).toBe(202);
    expect(generateBody.workflow?.generation?.model).toBe("doubao-seedance-2-0-260128");
    expect(generateBody.workflow?.generation?.prompt).toContain("白色无袖翻领连衣裙");
    expect(generateBody.workflow?.generation?.prompt).toContain("侧插兜");
    expect(generateBody.workflow?.generation?.prompt).toContain("uploads/white-dress-front.jpg");
    expect(generateBody.workflow?.generation?.prompt).toContain("用户刚上传的商品素材");
    expect(generateBody.workflow?.generation?.prompt).toContain("模特展示白色无袖翻领连衣裙");
    expect(generateBody.workflow?.generation?.referenceFiles?.[0]?.path).toBe("uploads/white-dress-front.jpg");
  });

  it("uses the saved workbench video model when generation omits a model", async () => {
    const projectId = `project_${randomUUID()}`;
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    insertProject(db, {
      id: projectId,
      name: "Workbench model generation",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadedFiles: [{ path: "uploads/product.jpg", name: "product.jpg" }] })
    });
    await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "白裙 15 秒短片",
        hook: "夏天一条白裙",
        voiceover: "通勤约会都能穿。"
      })
    });
    await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/storyboard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shots: [
          { visualGoal: "开场", prompt: "Opening shot", durationSec: 3 },
          { visualGoal: "细节", prompt: "Detail shot", durationSec: 3 },
          { visualGoal: "收尾", prompt: "CTA shot", durationSec: 3 }
        ]
      })
    });
    await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/workbench`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activeStageId: "generation",
        selectedModel: "doubao-seedance-2-0-fast-260128"
      })
    });

    const generateResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }
    );
    const generateBody = (await generateResponse.json()) as {
      workflow?: { generation?: { model?: string }; workbench?: { selectedModel?: string } };
    };

    expect(generateResponse.status).toBe(202);
    expect(generateBody.workflow?.generation?.model).toBe("doubao-seedance-2-0-fast-260128");
    expect(generateBody.workflow?.workbench?.selectedModel).toBe("doubao-seedance-2-0-fast-260128");
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

  it("rejects script and storyboard writes when earlier commerce-video stages are incomplete", async () => {
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    const db = openDatabase(process.cwd(), process.env.OD_DATA_DIR ? { dataDir: process.env.OD_DATA_DIR } : {});
    const project = insertProject(db, {
      id: projectId,
      name: "Commerce stage gates",
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
          { id: "materials", label: "Materials", status: "idle" },
          { id: "script", label: "Script", status: "idle" },
          { id: "storyboard", label: "Storyboard", status: "idle" },
          { id: "generation", label: "Generation", status: "idle" },
          { id: "progress", label: "Progress", status: "idle" },
          { id: "export", label: "Export", status: "idle" }
        ],
        materials: { uploadedFiles: [] },
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

    const scriptResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/script`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "白裙带货脚本",
          hook: "夏天通勤不用想",
          voiceover: "翻领和收腰让白裙更利落。"
        })
      }
    );
    const scriptBody = (await scriptResponse.json()) as { error?: { code?: string; details?: { stageId?: string } } };

    expect(scriptResponse.status).toBe(409);
    expect(scriptBody.error?.code).toBe("COMMERCE_VIDEO_STAGE_REQUIRED");
    expect(scriptBody.error?.details?.stageId).toBe("materials");

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
          { id: "script", label: "Script", status: "idle" },
          { id: "storyboard", label: "Storyboard", status: "idle" },
          { id: "generation", label: "Generation", status: "idle" },
          { id: "progress", label: "Progress", status: "idle" },
          { id: "export", label: "Export", status: "idle" }
        ],
        materials: { notes: "用户已上传白色无袖翻领连衣裙素材。" },
        createdAt: now,
        updatedAt: now
      })}\n`,
      { overwrite: true },
      project?.metadata
    );

    const storyboardResponse = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/commerce-video/storyboard`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shots: [
            { id: "shot-1", durationSec: 3, visualGoal: "开场", prompt: "opening" },
            { id: "shot-2", durationSec: 4, visualGoal: "细节", prompt: "detail" },
            { id: "shot-3", durationSec: 5, visualGoal: "收口", prompt: "cta" }
          ]
        })
      }
    );
    const storyboardBody = (await storyboardResponse.json()) as {
      error?: { code?: string; details?: { stageId?: string } };
    };

    expect(storyboardResponse.status).toBe(409);
    expect(storyboardBody.error?.code).toBe("COMMERCE_VIDEO_STAGE_REQUIRED");
    expect(storyboardBody.error?.details?.stageId).toBe("script");
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
        materials: { productMaterialIds: [], uploadedFiles: [] },
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
