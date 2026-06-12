import express, { type Response } from "express";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getAssetLibraryJob,
  insertAssetLibraryJob,
  insertCommerceVideoAsset,
  migrateAssetLibrary
} from "../src/asset-library.js";
import { registerAssetLibraryRoutes } from "../src/routes/asset-library.js";

type JsonObject = Record<string, any>;

describe("asset library jobs", () => {
  let db: Database.Database;
  let root: string;
  let server: http.Server | undefined;

  beforeEach(async () => {
    db = new Database(":memory:");
    migrateAssetLibrary(db);
    root = await mkdtemp(path.join(tmpdir(), "od-asset-library-jobs-"));
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    server = undefined;
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  it("interrupts leftover active jobs before waiters poll them", async () => {
    const active = insertAssetLibraryJob(db, {
      id: "stale-job",
      assetKind: "commerce-videos",
      assetId: "video-1",
      kind: "process",
      status: "running",
      progress: ["queued commerce video processing", "understanding commerce video"]
    });

    expect(active.status).toBe("running");

    const baseUrl = await startAssetLibraryServer();
    const waited = await jsonFetch(`${baseUrl}/api/asset-library/jobs/${active.id}/wait`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since: active.progress.length, timeoutMs: 1 })
    });

    expect(waited.status).toBe(200);
    expect(waited.body.job).toMatchObject({
      status: "interrupted",
      error: { code: "DAEMON_RESTARTED" }
    });
    expect(waited.body.progress).toEqual(["interrupted: daemon restarted before asset library job completed"]);
    expect(getAssetLibraryJob(db, active.id)?.status).toBe("interrupted");
  });

  it("keeps list responses lightweight while detail responses retain heavy fields", async () => {
    const vector = Array.from({ length: 8 }, (_, index) => index / 10);
    insertCommerceVideoAsset(db, {
      id: "video-heavy",
      title: "Heavy video",
      sourceKind: "upload",
      filePath: "commerce-videos/video-heavy/original.mp4",
      video: {
        summary: "List cards need the summary.",
        understanding: {
          providerId: "test",
          model: "vision-model",
          content: "Full media understanding content is only needed on detail views.",
          createdAt: 11
        },
        embedding: {
          providerId: "test",
          model: "embedding-model",
          dimensions: vector.length,
          vector,
          createdAt: 12
        }
      }
    });

    const baseUrl = await startAssetLibraryServer();
    const videos = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos`);
    const videoDetail = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/video-heavy`);

    expect(videos.body.videos[0].video.embedding).toMatchObject({
      providerId: "test",
      model: "embedding-model",
      dimensions: vector.length,
      createdAt: 12
    });
    expect(videos.body.videos[0].video.embedding).not.toHaveProperty("vector");
    expect(videos.body.videos[0].video.understanding).toMatchObject({
      providerId: "test",
      model: "vision-model",
      createdAt: 11
    });
    expect(videos.body.videos[0].video.understanding).not.toHaveProperty("content");

    expect(videoDetail.body.video.video.embedding.vector).toEqual(vector);
    expect(videoDetail.body.video.video.understanding.content).toContain("Full media understanding");
  });

  it("does not register global product material library routes", async () => {
    const baseUrl = await startAssetLibraryServer();

    const list = await fetch(`${baseUrl}/api/asset-library/products`);
    const upload = await fetch(`${baseUrl}/api/asset-library/products/import/upload`, { method: "POST" });
    const detail = await fetch(`${baseUrl}/api/asset-library/products/product-heavy`);

    expect(list.status).toBe(404);
    expect(upload.status).toBe(404);
    expect(detail.status).toBe(404);
  });

  it("removes legacy global product material storage during migration", () => {
    db.exec(`
      CREATE TABLE asset_library_products (id TEXT PRIMARY KEY);
      INSERT INTO asset_library_products (id) VALUES ('legacy-product');
      INSERT INTO asset_library_jobs
        (id, asset_kind, asset_id, kind, status, progress_json, created_at, updated_at)
      VALUES
        ('legacy-product-job', 'products', 'legacy-product', 'process', 'queued', '[]', 1, 1);
    `);

    migrateAssetLibrary(db);

    const productTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_library_products'")
      .get();
    const productJobs = db
      .prepare("SELECT COUNT(*) AS count FROM asset_library_jobs WHERE asset_kind = 'products'")
      .get() as { count: number };
    expect(productTable).toBeUndefined();
    expect(productJobs.count).toBe(0);
  });

  async function startAssetLibraryServer(): Promise<string> {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    registerAssetLibraryRoutes(app, {
      db,
      paths: {
        PROJECT_ROOT: root,
        RUNTIME_DATA_DIR: root,
        PROJECTS_DIR: path.join(root, "projects")
      },
      ids: { randomUUID: () => "test-id" },
      projectStore: {},
      projectFiles: {},
      http: {
        resolvedPortRef: { current: 0 },
        isLocalSameOrigin: () => true,
        sendApiError: (res: Response, status: number, code: string, message: string) =>
          res.status(status).json({ error: { code, message } }),
        sendMulterError: (res: Response, error: Error) =>
          res.status(400).json({ error: { code: "UPLOAD_ERROR", message: error.message } })
      }
    } as any);

    server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
    return `http://127.0.0.1:${address.port}`;
  }
});

async function jsonFetch<TBody = JsonObject>(url: string, init?: RequestInit): Promise<{ status: number; body: TBody }> {
  const response = await fetch(url, init);
  return { status: response.status, body: (await response.json()) as TBody };
}
