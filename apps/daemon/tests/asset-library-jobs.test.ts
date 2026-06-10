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
  insertProductAsset,
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
    insertProductAsset(db, {
      id: "product-heavy",
      title: "Heavy product",
      product: {
        summary: "List cards need the summary.",
        embedding: {
          providerId: "test",
          model: "embedding-model",
          dimensions: vector.length,
          vector,
          createdAt: 10
        }
      }
    });
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
    const products = await jsonFetch(`${baseUrl}/api/asset-library/products`);
    const videos = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos`);
    const productDetail = await jsonFetch(`${baseUrl}/api/asset-library/products/product-heavy`);
    const videoDetail = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/video-heavy`);

    expect(products.body.products[0].product.embedding).toMatchObject({
      providerId: "test",
      model: "embedding-model",
      dimensions: vector.length,
      createdAt: 10
    });
    expect(products.body.products[0].product.embedding).not.toHaveProperty("vector");
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

    expect(productDetail.body.product.product.embedding.vector).toEqual(vector);
    expect(videoDetail.body.video.video.embedding.vector).toEqual(vector);
    expect(videoDetail.body.video.video.understanding.content).toContain("Full media understanding");
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
