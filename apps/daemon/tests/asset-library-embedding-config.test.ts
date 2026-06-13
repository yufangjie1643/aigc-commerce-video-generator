import express, { type Response } from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerAssetLibraryRoutes } from "../src/routes/asset-library.js";

const ALLOWED_VOLCENGINE_ARK_EMBEDDING_MODEL = "doubao-embedding-vision-251215";

describe("asset library embedding config", () => {
  let root: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "od-asset-library-embedding-"));
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    registerAssetLibraryRoutes(app, {
      db: {},
      paths: {
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
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  it("defaults Volcengine Ark vectorization to the allowlisted model", async () => {
    const response = await fetch(`${baseUrl}/api/asset-library/embedding-config`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;

    expect(body.embedding).toMatchObject({
      providerId: "volcengine-ark",
      model: ALLOWED_VOLCENGINE_ARK_EMBEDDING_MODEL,
      baseUrl: "https://ark.cn-beijing.volces.com",
      endpointPath: "/api/v3/embeddings/multimodal"
    });
  });

  it("rejects non-allowlisted Volcengine Ark vectorization models", async () => {
    const response = await fetch(`${baseUrl}/api/asset-library/embedding-config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embedding: {
          providerId: "volcengine-ark",
          apiKey: "ark-key",
          model: "doubao-embedding-text-250715"
        }
      })
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "MODEL_NOT_ALLOWED"
    });
  });

  it("saves the allowlisted Volcengine Ark vectorization model", async () => {
    const response = await fetch(`${baseUrl}/api/asset-library/embedding-config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embedding: {
          providerId: "volcengine-ark",
          apiKey: "ark-key",
          model: ALLOWED_VOLCENGINE_ARK_EMBEDDING_MODEL
        }
      })
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.embedding).toMatchObject({
      providerId: "volcengine-ark",
      model: ALLOWED_VOLCENGINE_ARK_EMBEDDING_MODEL,
      apiKeyConfigured: true
    });
  });
});
