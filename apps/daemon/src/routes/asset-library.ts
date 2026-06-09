import type { Express, Request, Response } from "express";
import multer from "multer";
import fs from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AssetLibraryConfigResponse,
  AssetLibraryToolConfig,
  AssetLibraryToolTestResponse,
  BatchProcessCommerceVideosRequest,
  BatchProcessCommerceVideosResponse,
  CommerceVideoAsset,
  CommerceVideoSlice,
  CommerceVideoMethodologySummaryRequest,
  CommerceVideoMethodologySummaryResponse,
  DeleteCommerceVideoAssetResponse,
  DeleteProductAssetResponse,
  EmbedAssetLibraryAssetRequest,
  EmbeddingProviderConfig,
  EmbeddingProviderTestResponse,
  ImportProductImageResponse,
  ImportCommerceVideoSearchRequest,
  ProductAsset,
  SearchCommerceVideosRequest,
  UpdateCommerceVideoAssetRequest,
  UpdateProductAssetRequest
} from "@open-design/contracts";
import type { RouteDeps } from "../server-context.js";
import {
  appendAssetLibraryJobProgress,
  deleteCommerceVideoAsset,
  deleteProductAsset,
  getAssetLibraryJob,
  getCommerceVideoAsset,
  getCommerceVideoAssetBySha,
  getCommerceVideoAssetBySource,
  getCommerceVideoSlice,
  getProductAsset,
  insertAssetLibraryJob,
  insertCommerceVideoAsset,
  insertProductAsset,
  listCommerceVideoAssets,
  listCommerceVideoSlices,
  listProductAssets,
  replaceCommerceVideoSlices,
  setProjectAssetLibraryContext,
  updateAssetLibraryJob,
  updateCommerceVideoAsset,
  updateCommerceVideoSliceEmbedding,
  updateProductAsset
} from "../asset-library.js";
import { executeBuiltInBilibiliCrawlerTool } from "../connectors/bilibili-crawler-runtime.js";
import { connectorService, ConnectorServiceError } from "../connectors/service.js";
import { getStaticVideoCrawlerDefinitions } from "../connectors/video-crawler.js";
import type { BoundedJsonObject } from "../live-artifacts/schema.js";
import { mimeFor, sanitizeName } from "../projects.js";

const execFileAsync = promisify(execFile);

const DEFAULT_WINDOWS_FFMPEG =
  "C:\\Users\\pc\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe";
const DEFAULT_WINDOWS_FFPROBE =
  "C:\\Users\\pc\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffprobe.exe";
const DEFAULT_EMBEDDING_BASE_URL = "https://ark.cn-beijing.volces.com";
const DEFAULT_EMBEDDING_ENDPOINT_PATH = "/api/v3/embeddings/multimodal";
const DEFAULT_EMBEDDING_MODEL = "doubao-embedding-vision-251215";

export interface RegisterAssetLibraryRoutesDeps extends RouteDeps<
  "db" | "http" | "paths" | "ids" | "projectStore" | "projectFiles"
> {}

interface AssetLibraryStoredConfig {
  embedding?: EmbeddingProviderConfig;
  tools?: AssetLibraryToolConfig;
}

const liveJobWaiters = new Map<string, Set<() => void>>();

export function registerAssetLibraryRoutes(app: Express, ctx: RegisterAssetLibraryRoutesDeps): void {
  const { db } = ctx;
  const { isLocalSameOrigin, resolvedPortRef, sendApiError, sendMulterError } = ctx.http;
  const { RUNTIME_DATA_DIR, PROJECTS_DIR } = ctx.paths;
  const assetRoot = path.join(RUNTIME_DATA_DIR, "asset-library");
  const tmpRoot = path.join(assetRoot, "tmp");
  const configPath = path.join(assetRoot, "config.json");
  const randomId = typeof ctx.ids?.randomUUID === "function" ? ctx.ids.randomUUID : randomUUID;

  const requireLocal = (req: Request, res: Response): boolean => {
    if (isLocalSameOrigin(req, resolvedPortRef.current)) return true;
    res.status(403).json({ error: "cross-origin request rejected" });
    return false;
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination(_req, _file, cb) {
        try {
          fs.mkdirSync(tmpRoot, { recursive: true });
          cb(null, tmpRoot);
        } catch (err) {
          cb(err as Error, tmpRoot);
        }
      },
      filename(_req, file, cb) {
        cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname || "")}`);
      }
    }),
    limits: { fileSize: 1024 * 1024 * 1024 }
  });

  const readConfig = async (): Promise<AssetLibraryStoredConfig> => readStoredConfig(configPath);
  const writeConfig = async (next: AssetLibraryStoredConfig): Promise<AssetLibraryStoredConfig> => {
    await mkdir(assetRoot, { recursive: true });
    await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return next;
  };

  app.get("/api/asset-library/config", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const config = withDefaults(await readConfig());
    res.json(maskConfig(config) satisfies AssetLibraryConfigResponse);
  });

  app.get("/api/asset-library/tool-config", async (req, res) => {
    if (!requireLocal(req, res)) return;
    res.json({ tools: withDefaults(await readConfig()).tools });
  });

  app.put("/api/asset-library/tool-config", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const current = withDefaults(await readConfig());
    const nextTools = normalizeToolConfig(req.body, current.tools);
    const next = await writeConfig({ ...current, tools: nextTools });
    res.json({ tools: next.tools });
  });

  app.post("/api/asset-library/tool-config/test", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const current = withDefaults(await readConfig());
    const tools = normalizeToolConfig(req.body?.tools ?? req.body, current.tools);
    const result = await testToolConfig(tools);
    const { lastVerificationError: _previousError, ...verifiedTools } = tools;
    const nextTools = {
      ...verifiedTools,
      lastVerifiedAt: Date.now(),
      ...(result.ok ? {} : { lastVerificationError: summarizeToolErrors(result) })
    };
    const next = await writeConfig({ ...current, tools: nextTools });
    res.json({ ...result, tools: next.tools });
  });

  app.get("/api/asset-library/embedding-config", async (req, res) => {
    if (!requireLocal(req, res)) return;
    res.json({ embedding: maskEmbeddingConfig(withDefaults(await readConfig()).embedding) });
  });

  app.put("/api/asset-library/embedding-config", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const current = withDefaults(await readConfig());
    const embedding = normalizeEmbeddingConfig(req.body?.embedding ?? req.body, current.embedding);
    const next = await writeConfig({ ...current, embedding });
    res.json({ embedding: maskEmbeddingConfig(withDefaults(next).embedding) });
  });

  app.post("/api/asset-library/embedding-config/test", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const current = withDefaults(await readConfig());
    const embedding = normalizeEmbeddingConfig(req.body?.embedding ?? req.body, current.embedding);
    res.json(await testEmbeddingConfig(embedding));
  });

  app.get("/api/asset-library/products", (req, res) => {
    if (!requireLocal(req, res)) return;
    const query = typeof req.query.query === "string" ? req.query.query : undefined;
    const limit = Number(req.query.limit);
    res.json({
      products: listProductAssets(db, {
        ...(query ? { query } : {}),
        ...(Number.isFinite(limit) ? { limit } : {})
      })
    });
  });

  app.post("/api/asset-library/products", (req, res) => {
    if (!requireLocal(req, res)) return;
    const title = cleanString(req.body?.title);
    if (!title) return sendApiError(res, 400, "BAD_REQUEST", "title is required");
    const product = insertProductAsset(db, {
      id: randomId(),
      title,
      subject: cleanString(req.body?.subject),
      category: cleanString(req.body?.category),
      sourceKind: "manual",
      product: {
        sellingPoints: stringList(req.body?.sellingPoints),
        constraints: stringList(req.body?.constraints),
        suggestedAngles: stringList(req.body?.suggestedAngles),
        summary: cleanString(req.body?.summary)
      },
      metadata: recordOrUndefined(req.body?.metadata)
    });
    res.status(201).json({ product });
  });

  app.post("/api/asset-library/products/import/upload", (req, res) => {
    if (!requireLocal(req, res)) return;
    upload.single("file")(req, res, async (err: any) => {
      if (err) return sendMulterError(res, err);
      const file = (req as any).file;
      if (!file?.path) return sendApiError(res, 400, "BAD_REQUEST", "file is required");
      if (!isSupportedProductImage(file.originalname || file.filename, file.mimetype)) {
        return sendApiError(res, 400, "BAD_REQUEST", "file must be a jpg, png, webp, or gif image");
      }
      try {
        const imported = await importProductImageFile({
          db,
          assetRoot,
          randomId,
          tempPath: file.path,
          originalName: file.originalname || file.filename,
          mime: file.mimetype || mimeFor(file.originalname || file.filename),
          title: cleanString(req.body?.title) || file.originalname || file.filename,
          subject: cleanString(req.body?.subject),
          category: cleanString(req.body?.category),
          sellingPoints: stringList(req.body?.sellingPoints),
          constraints: stringList(req.body?.constraints),
          suggestedAngles: stringList(req.body?.suggestedAngles),
          summary: cleanString(req.body?.summary),
          metadata: {
            importedBy: "upload",
            ...parseMetadataJson(req.body?.metadataJson)
          }
        });
        const job = insertAssetLibraryJob(db, {
          id: randomId(),
          assetKind: "products",
          assetId: imported.id,
          kind: "process",
          progress: ["queued product image processing"]
        });
        void runProductProcessing({ db, jobId: job.id, productId: imported.id, assetRoot, readConfig }).catch(
          () => undefined
        );
        res.status(202).json({ product: imported, job } satisfies ImportProductImageResponse);
      } catch (error: any) {
        res.status(400).json({ error: errorMessage(error) });
      }
    });
  });

  app.get("/api/asset-library/products/:id", (req, res) => {
    if (!requireLocal(req, res)) return;
    const product = getProductAsset(db, req.params.id);
    if (!product) return sendApiError(res, 404, "NOT_FOUND", "product asset not found");
    res.json({ product });
  });

  const updateProductRoute = (req: Request, res: Response) => {
    if (!requireLocal(req, res)) return;
    const product = getProductAsset(db, cleanString(req.params.id));
    if (!product) return sendApiError(res, 404, "NOT_FOUND", "product asset not found");
    const updated = updateProductAsset(db, product.id, productPatchFromRequest(product, req.body));
    res.json({ product: updated });
  };

  app.patch("/api/asset-library/products/:id", updateProductRoute);
  app.put("/api/asset-library/products/:id", updateProductRoute);

  app.delete("/api/asset-library/products/:id", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const product = getProductAsset(db, cleanString(req.params.id));
    if (!product) return sendApiError(res, 404, "NOT_FOUND", "product asset not found");
    const deleted = deleteProductAsset(db, product.id);
    if (!deleted) return sendApiError(res, 404, "NOT_FOUND", "product asset not found");
    const cleanup = await removeAssetDirectory(assetRoot, "products", product.id);
    const response: DeleteProductAssetResponse = {
      product: deleted,
      removedFiles: cleanup.ok,
      ...(cleanup.warning ? { warning: cleanup.warning } : {})
    };
    res.json(response);
  });

  app.post("/api/asset-library/products/:id/process", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const product = getProductAsset(db, req.params.id);
    if (!product) return sendApiError(res, 404, "NOT_FOUND", "product asset not found");
    const job = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "products",
      assetId: product.id,
      kind: "process",
      progress: ["queued product asset processing"]
    });
    void runProductProcessing({ db, jobId: job.id, productId: product.id, assetRoot, readConfig }).catch(
      () => undefined
    );
    res.status(202).json({ job });
  });

  app.post("/api/asset-library/products/:id/embed", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const product = getProductAsset(db, req.params.id);
    if (!product) return sendApiError(res, 404, "NOT_FOUND", "product asset not found");
    updateProductAsset(db, product.id, { status: "processing" });
    const job = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "products",
      assetId: product.id,
      kind: "embed",
      progress: ["queued product embedding"]
    });
    const request = (recordOrUndefined(req.body) ?? {}) as EmbedAssetLibraryAssetRequest;
    void runProductEmbedding({
      db,
      jobId: job.id,
      productId: product.id,
      assetRoot,
      text: cleanString(request.text),
      readConfig
    }).catch(() => undefined);
    res.status(202).json({ job });
  });

  app.get("/api/asset-library/commerce-videos", (req, res) => {
    if (!requireLocal(req, res)) return;
    const query = typeof req.query.query === "string" ? req.query.query : undefined;
    const limit = Number(req.query.limit);
    res.json({
      videos: listCommerceVideoAssets(db, {
        ...(query ? { query } : {}),
        ...(Number.isFinite(limit) ? { limit } : {})
      })
    });
  });

  app.post("/api/asset-library/commerce-videos", (req, res) => {
    if (!requireLocal(req, res)) return;
    const title = cleanString(req.body?.title);
    if (!title) return sendApiError(res, 400, "BAD_REQUEST", "title is required");
    const sourceConnectorId = cleanString(req.body?.sourceConnectorId);
    const sourceKind = cleanString(req.body?.sourceKind) === "crawler" || sourceConnectorId ? "crawler" : "manual";
    const video = insertCommerceVideoAsset(db, {
      id: randomId(),
      title,
      sourceKind,
      ...(sourceConnectorId ? { sourceConnectorId } : {}),
      sourceUrl: cleanString(req.body?.sourceUrl),
      sourceVideoId: cleanString(req.body?.sourceVideoId),
      status: "ready",
      product: recordOrUndefined(req.body?.product) ?? {},
      video: recordOrUndefined(req.body?.video) ?? {},
      methodology: recordOrUndefined(req.body?.methodology) ?? {},
      metadata: recordOrUndefined(req.body?.metadata)
    });
    res.status(201).json({ video });
  });

  app.post("/api/asset-library/commerce-videos/search", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const body = (recordOrUndefined(req.body) ?? {}) as SearchCommerceVideosRequest;
    const connectorId = cleanString(body.connectorId || "bilibili");
    if (!["bilibili", "youtube", "tiktok", "douyin"].includes(connectorId)) {
      return sendApiError(res, 400, "BAD_REQUEST", "connectorId must be bilibili, youtube, tiktok, or douyin");
    }
    if (connectorId !== "bilibili") {
      return sendApiError(res, 501, "NOT_IMPLEMENTED", "search preview is currently implemented for Bilibili");
    }
    const query = cleanString(body.query);
    if (!query) return sendApiError(res, 400, "BAD_REQUEST", "query is required");
    const limit = clampNumber(Number(body.limit), 1, 50, 20);
    const sort = cleanString(body.sort) || "hot";
    const requestedToolName = cleanString(body.toolName) || "bilibili_search_videos";
    const toolName = requestedToolName.includes(".") ? requestedToolName : `${connectorId}.${requestedToolName}`;
    const input = {
      ...(recordOrUndefined(body.input) ?? {}),
      query,
      limit,
      sort
    };
    try {
      const context = {
        projectsRoot: assetRoot,
        projectId: "crawler-search-workspace",
        purpose: "agent_preview" as const
      };
      const output = await connectorService.execute({ connectorId, toolName, input }, context);
      const connectorOutput =
        output.output && typeof output.output === "object" ? (output.output as Record<string, any>) : {};
      const searchItems = Array.isArray(connectorOutput.items)
        ? connectorOutput.items.filter(isRecordLike).slice(0, limit)
        : [];
      res.json({
        items: searchItems,
        search: {
          connectorId,
          toolName,
          provider: connectorOutput.provider ?? "bilibili-web",
          query,
          limit,
          sort,
          count: searchItems.length,
          totalAvailable: connectorOutput.totalAvailable ?? null,
          nextCursor: connectorOutput.nextCursor ?? null,
          limitations: crawlerSearchLimitations(connectorId)
        }
      });
    } catch (error: any) {
      const status = error instanceof ConnectorServiceError ? error.status : 400;
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/asset-library/commerce-videos/import/search", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const body = (recordOrUndefined(req.body) ?? {}) as ImportCommerceVideoSearchRequest;
    const connectorId = cleanString(body.connectorId || "bilibili");
    if (!["bilibili", "youtube", "tiktok", "douyin"].includes(connectorId)) {
      return sendApiError(res, 400, "BAD_REQUEST", "connectorId must be bilibili, youtube, tiktok, or douyin");
    }
    if (connectorId !== "bilibili") {
      return sendApiError(res, 501, "NOT_IMPLEMENTED", "search import is currently implemented for Bilibili");
    }
    const query = cleanString(body.query);
    if (!query) return sendApiError(res, 400, "BAD_REQUEST", "query is required");
    const limit = clampNumber(Number(body.limit), 1, 50, 20);
    const sort = cleanString(body.sort) || "hot";
    const requestedToolName = cleanString(body.toolName) || "bilibili_search_videos";
    const toolName = requestedToolName.includes(".") ? requestedToolName : `${connectorId}.${requestedToolName}`;
    const input = {
      ...(recordOrUndefined(body.input) ?? {}),
      query,
      limit,
      sort
    };
    const importJob = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "commerce-videos",
      assetId: "search",
      kind: "crawler-import",
      progress: [`searching ${connectorId} videos: ${query}`]
    });
    try {
      updateAssetLibraryJob(db, importJob.id, { status: "running", startedAt: Date.now() });
      const context = {
        projectsRoot: assetRoot,
        projectId: "crawler-search-workspace",
        purpose: "agent_preview" as const
      };
      const output = await connectorService.execute({ connectorId, toolName, input }, context);
      const connectorOutput =
        output.output && typeof output.output === "object" ? (output.output as Record<string, any>) : {};
      const searchItems = Array.isArray(connectorOutput.items)
        ? connectorOutput.items.filter(isRecordLike).slice(0, limit)
        : [];
      const videos = searchItems
        .map((item) => upsertCrawlerSearchVideo({ db, randomId, connectorId, query, sort, item }))
        .sort((a, b) => crawlerHeatScore(b.metadata) - crawlerHeatScore(a.metadata));
      updateAssetLibraryJob(db, importJob.id, {
        assetId: videos[0]?.id ?? "search",
        status: "done",
        endedAt: Date.now(),
        progress: [
          ...(getAssetLibraryJob(db, importJob.id)?.progress ?? []),
          `imported ${videos.length} search result${videos.length === 1 ? "" : "s"} into commerce video library`
        ]
      });
      wakeJob(importJob.id);
      res.status(201).json({
        videos,
        job: getAssetLibraryJob(db, importJob.id),
        search: {
          connectorId,
          toolName,
          provider: connectorOutput.provider ?? "bilibili-web",
          query,
          limit,
          sort,
          count: videos.length,
          totalAvailable: connectorOutput.totalAvailable ?? null,
          nextCursor: connectorOutput.nextCursor ?? null,
          limitations: crawlerSearchLimitations(connectorId)
        }
      });
    } catch (error: any) {
      const status = error instanceof ConnectorServiceError ? error.status : 400;
      updateAssetLibraryJob(db, importJob.id, {
        status: "failed",
        endedAt: Date.now(),
        error: { message: errorMessage(error), status, code: error?.code }
      });
      wakeJob(importJob.id);
      res.status(status).json({ error: errorMessage(error), job: getAssetLibraryJob(db, importJob.id) });
    }
  });

  app.post("/api/asset-library/commerce-videos/import/upload", (req, res) => {
    if (!requireLocal(req, res)) return;
    upload.single("file")(req, res, async (err: any) => {
      if (err) return sendMulterError(res, err);
      const file = (req as any).file;
      if (!file?.path) return sendApiError(res, 400, "BAD_REQUEST", "file is required");
      try {
        const imported = await importCommerceVideoFile({
          db,
          assetRoot,
          randomId,
          tempPath: file.path,
          originalName: file.originalname || file.filename,
          mime: file.mimetype || mimeFor(file.originalname || file.filename),
          title: cleanString(req.body?.title) || file.originalname || file.filename,
          sourceKind: "upload",
          metadata: { importedBy: "upload" }
        });
        const job = queueCommerceVideoProcessing({ db, randomId, assetId: imported.id });
        void runCommerceVideoProcessing({ db, jobId: job.id, assetId: imported.id, assetRoot, readConfig }).catch(
          () => undefined
        );
        res.status(202).json({ video: imported, job });
      } catch (error: any) {
        res.status(400).json({ error: errorMessage(error) });
      }
    });
  });

  app.post("/api/asset-library/commerce-videos/import/crawler", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const connectorId = cleanString(req.body?.connectorId);
    if (!["youtube", "tiktok", "douyin", "bilibili"].includes(connectorId)) {
      return sendApiError(res, 400, "BAD_REQUEST", "connectorId must be youtube, tiktok, douyin, or bilibili");
    }
    const requestedToolName = cleanString(req.body?.toolName) || `${connectorId}_download_video`;
    const toolName = requestedToolName.includes(".") ? requestedToolName : `${connectorId}.${requestedToolName}`;
    const input = recordOrUndefined(req.body?.input) ?? {};
    const url = cleanString(req.body?.url);
    const videoId = cleanString(req.body?.videoId);
    if (url && !input.url) input.url = url;
    if (videoId && !input.videoId) input.videoId = videoId;
    if (!input.url && !input.videoId && !input.bvid && !input.aid) {
      return sendApiError(res, 400, "BAD_REQUEST", "crawler import needs url, videoId, bvid, aid, or input");
    }
    const publicTest = connectorId === "bilibili" && truthyFlag(req.body?.publicTest);
    if (publicTest && toolName !== "bilibili.bilibili_download_video") {
      return sendApiError(res, 400, "BAD_REQUEST", "Bilibili public test import only supports the download video tool");
    }
    if (publicTest) input.resolution = "360p";

    const importJob = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "commerce-videos",
      assetId: "pending",
      kind: "crawler-import",
      progress: [`executing ${toolName}${publicTest ? " (public 360p test)" : ""}`]
    });

    try {
      updateAssetLibraryJob(db, importJob.id, { status: "running", startedAt: Date.now() });
      const context = { projectsRoot: assetRoot, projectId: "crawler-workspace", purpose: "agent_preview" as const };
      let connectorOutput: Record<string, any>;
      if (publicTest) {
        connectorOutput = {
          ...(await executePublicBilibiliCrawlerDownload(input as BoundedJsonObject, context)),
          publicTest: true
        };
      } else {
        const output = await connectorService.execute({ connectorId, toolName, input }, context);
        connectorOutput =
          output.output && typeof output.output === "object" ? (output.output as Record<string, any>) : {};
      }
      const absolutePath = cleanString(connectorOutput.absolutePath);
      if (!absolutePath) throw new Error("crawler did not return an absolutePath for the downloaded video");
      const video = recordOrUndefined(connectorOutput.video) ?? {};
      const imported = await importCommerceVideoFile({
        db,
        assetRoot,
        randomId,
        tempPath: absolutePath,
        originalName: path.basename(absolutePath),
        mime: mimeFor(absolutePath),
        title: cleanString(req.body?.title) || cleanString(video.title) || path.basename(absolutePath),
        sourceKind: "crawler",
        sourceConnectorId: connectorId,
        sourceUrl: cleanString(video.url) || url,
        sourceVideoId: cleanString(video.videoId) || videoId,
        metadata: { importedBy: "crawler", connectorOutput },
        copyInsteadOfMove: true
      });
      updateAssetLibraryJob(db, importJob.id, {
        assetId: imported.id,
        status: "done",
        endedAt: Date.now(),
        progress: [...importJob.progress, `imported ${imported.title}`]
      });
      wakeJob(importJob.id);
      const processJob = queueCommerceVideoProcessing({ db, randomId, assetId: imported.id });
      void runCommerceVideoProcessing({ db, jobId: processJob.id, assetId: imported.id, assetRoot, readConfig }).catch(
        () => undefined
      );
      res.status(202).json({ video: imported, importJob: getAssetLibraryJob(db, importJob.id), job: processJob });
    } catch (error: any) {
      const status = error instanceof ConnectorServiceError ? error.status : 400;
      updateAssetLibraryJob(db, importJob.id, {
        status: "failed",
        endedAt: Date.now(),
        error: { message: errorMessage(error), status, code: error?.code }
      });
      wakeJob(importJob.id);
      res.status(status).json({ error: errorMessage(error), job: getAssetLibraryJob(db, importJob.id) });
    }
  });

  app.post("/api/asset-library/commerce-videos/batch-process", (req, res) => {
    if (!requireLocal(req, res)) return;
    const request = (recordOrUndefined(req.body) ?? {}) as BatchProcessCommerceVideosRequest;
    const selected = selectCommerceVideosForBatch(db, request);
    if (selected.length === 0) {
      return sendApiError(res, 400, "BAD_REQUEST", "no commerce videos matched the batch request");
    }
    for (const video of selected) updateCommerceVideoAsset(db, video.id, { status: "processing" });
    const job = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "commerce-videos",
      assetId: selected.length === 1 ? selected[0]!.id : "batch",
      kind: "batch-process",
      progress: [`queued batch video analysis (${selected.length} video${selected.length === 1 ? "" : "s"})`]
    });
    void runCommerceVideoBatchProcessing({
      db,
      jobId: job.id,
      assetIds: selected.map((video) => video.id),
      assetRoot,
      includeEmbeddings: request.includeEmbeddings !== false,
      readConfig
    }).catch(() => undefined);
    res.status(202).json({
      job,
      count: selected.length,
      ids: selected.map((video) => video.id)
    } satisfies BatchProcessCommerceVideosResponse);
  });

  app.post("/api/asset-library/commerce-videos/methodology-summary", (req, res) => {
    if (!requireLocal(req, res)) return;
    const request = (recordOrUndefined(req.body) ?? {}) as CommerceVideoMethodologySummaryRequest;
    const selection: BatchProcessCommerceVideosRequest = {
      onlyUnprocessed: false,
      includeEmbeddings: false
    };
    if (Array.isArray(request.ids)) selection.ids = request.ids;
    if (typeof request.query === "string") selection.query = request.query;
    if (typeof request.limit === "number") selection.limit = request.limit;
    const sources = selectCommerceVideosForBatch(db, selection).map((video) => ({
      video: stripCommerceVideoEmbeddingVectors(video),
      slices:
        request.includeSlices === false
          ? []
          : listCommerceVideoSlices(db, video.id).map(stripCommerceVideoSliceEmbeddingVectors)
    }));
    const stats = {
      videoCount: sources.length,
      sliceCount: sources.reduce((sum, source) => sum + source.slices.length, 0),
      embeddedVideoCount: sources.filter((source) => Boolean(source.video.video.embedding?.dimensions)).length,
      embeddedSliceCount: sources.reduce(
        (sum, source) => sum + source.slices.filter((slice) => Boolean(slice.embedding?.dimensions)).length,
        0
      )
    };
    const response: CommerceVideoMethodologySummaryResponse = {
      sources,
      stats,
      prompt: buildCommerceVideoMethodologyPrompt(sources, stats)
    };
    res.json(response);
  });

  app.get("/api/asset-library/commerce-videos/:id", (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    res.json({ video, slices: listCommerceVideoSlices(db, video.id) });
  });

  const updateCommerceVideoRoute = (req: Request, res: Response) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, cleanString(req.params.id));
    if (!video) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    const updated = updateCommerceVideoAsset(db, video.id, commerceVideoPatchFromRequest(video, req.body));
    res.json({ video: updated, slices: listCommerceVideoSlices(db, video.id) });
  };

  app.patch("/api/asset-library/commerce-videos/:id", updateCommerceVideoRoute);
  app.put("/api/asset-library/commerce-videos/:id", updateCommerceVideoRoute);

  app.delete("/api/asset-library/commerce-videos/:id", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, cleanString(req.params.id));
    if (!video) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    const deleted = deleteCommerceVideoAsset(db, video.id);
    if (!deleted) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    const cleanup = await removeAssetDirectory(assetRoot, "commerce-videos", video.id);
    const response: DeleteCommerceVideoAssetResponse = {
      video: deleted,
      removedFiles: cleanup.ok,
      ...(cleanup.warning ? { warning: cleanup.warning } : {})
    };
    res.json(response);
  });

  app.post("/api/asset-library/commerce-videos/:id/process", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    const job = queueCommerceVideoProcessing({ db, randomId, assetId: video.id });
    void runCommerceVideoProcessing({ db, jobId: job.id, assetId: video.id, assetRoot, readConfig }).catch(
      () => undefined
    );
    res.status(202).json({ job });
  });

  app.post("/api/asset-library/commerce-videos/:id/slice", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    const job = queueCommerceVideoProcessing({ db, randomId, assetId: video.id, kind: "slice" });
    void runCommerceVideoProcessing({ db, jobId: job.id, assetId: video.id, assetRoot, readConfig }).catch(
      () => undefined
    );
    res.status(202).json({ job });
  });

  app.post("/api/asset-library/commerce-videos/:id/embed", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    updateCommerceVideoAsset(db, video.id, { status: "processing" });
    const job = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "commerce-videos",
      assetId: video.id,
      kind: "embed",
      progress: ["queued commerce video embedding"]
    });
    const request = (recordOrUndefined(req.body) ?? {}) as EmbedAssetLibraryAssetRequest;
    void runCommerceVideoEmbedding({
      db,
      jobId: job.id,
      assetId: video.id,
      assetRoot,
      text: cleanString(request.text),
      includeSlices: request.includeSlices !== false,
      readConfig
    }).catch(() => undefined);
    res.status(202).json({ job });
  });

  app.get("/api/asset-library/jobs/:id", (req, res) => {
    if (!requireLocal(req, res)) return;
    const job = getAssetLibraryJob(db, req.params.id);
    if (!job) return sendApiError(res, 404, "NOT_FOUND", "job not found");
    res.json({ job });
  });

  app.post("/api/asset-library/jobs/:id/wait", (req, res) => {
    if (!requireLocal(req, res)) return;
    const jobId = req.params.id;
    const job = getAssetLibraryJob(db, jobId);
    if (!job) return sendApiError(res, 404, "NOT_FOUND", "job not found");
    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;
    const timeoutMs = Math.min(Math.max(Number(req.body?.timeoutMs) || 25_000, 0), 25_000);
    const respond = () => {
      const latest = getAssetLibraryJob(db, jobId) ?? job;
      res.json({ job: latest, progress: latest.progress.slice(since) });
    };
    if (isTerminalJob(job) || job.progress.length > since) return respond();
    const waiters = liveJobWaiters.get(jobId) ?? new Set<() => void>();
    liveJobWaiters.set(jobId, waiters);
    let done = false;
    const wake = () => {
      if (done) return;
      done = true;
      waiters.delete(wake);
      clearTimeout(timer);
      respond();
    };
    waiters.add(wake);
    const timer = setTimeout(wake, timeoutMs);
    res.on("close", wake);
  });

  app.post("/api/projects/:id/asset-library/context", (req, res) => {
    if (!requireLocal(req, res)) return;
    const project = ctx.projectStore.getProject(db, req.params.id);
    if (!project) return sendApiError(res, 404, "NOT_FOUND", "project not found");
    const refs = Array.isArray(req.body?.refs) ? req.body.refs : [];
    res.json({ refs: setProjectAssetLibraryContext(db, req.params.id, refs) });
  });

  app.post("/api/projects/:id/asset-library/export", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const project = ctx.projectStore.getProject(db, req.params.id);
    if (!project) return sendApiError(res, 404, "NOT_FOUND", "project not found");
    const source = resolveExportSource(db, req.body);
    if (!source) return sendApiError(res, 400, "BAD_REQUEST", "assetId or sliceId is required");
    const absolute = safeAssetPath(assetRoot, source.path);
    const bytes = await readFile(absolute);
    const output = sanitizeName(cleanString(req.body?.as) || path.basename(source.path));
    const meta = await ctx.projectFiles.writeProjectFile(
      PROJECTS_DIR,
      req.params.id,
      output,
      bytes,
      { overwrite: true },
      project.metadata
    );
    res.json({ file: meta });
  });

  app.get(/^\/api\/asset-library\/files\/(.+)$/, (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      const rel = String((req.params as any)[0] ?? "");
      res.sendFile(safeAssetPath(assetRoot, rel));
    } catch {
      res.status(404).json({ error: "file not found" });
    }
  });
}

function queueCommerceVideoProcessing(input: {
  db: any;
  randomId: () => string;
  assetId: string;
  kind?: "process" | "slice";
}) {
  updateCommerceVideoAsset(input.db, input.assetId, { status: "processing" });
  return insertAssetLibraryJob(input.db, {
    id: input.randomId(),
    assetKind: "commerce-videos",
    assetId: input.assetId,
    kind: input.kind ?? "process",
    progress: ["queued commerce video processing"]
  });
}

function selectCommerceVideosForBatch(
  db: any,
  request: BatchProcessCommerceVideosRequest | CommerceVideoMethodologySummaryRequest
): CommerceVideoAsset[] {
  const ids = Array.isArray(request.ids) ? request.ids.map(cleanString).filter(Boolean) : [];
  const limit = ids.length > 0 ? 200 : clampNumber(Number(request.limit), 1, 200, 50);
  const videos =
    ids.length > 0
      ? ids.map((id) => getCommerceVideoAsset(db, id)).filter((video): video is CommerceVideoAsset => Boolean(video))
      : listCommerceVideoAssets(db, {
          ...(cleanString(request.query) ? { query: cleanString(request.query) } : {}),
          limit
        });
  const seen = new Set<string>();
  let deduped = videos.filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
  if ((request as BatchProcessCommerceVideosRequest).onlyUnprocessed === true) {
    deduped = deduped.filter((video) => {
      const slices = listCommerceVideoSlices(db, video.id);
      return (
        video.status !== "ready" ||
        !video.video.durationMs ||
        slices.length === 0 ||
        !video.video.embedding?.dimensions ||
        slices.some((slice) => !slice.embedding?.dimensions)
      );
    });
  }
  return deduped.slice(0, limit);
}

function stripCommerceVideoEmbeddingVectors(video: CommerceVideoAsset): CommerceVideoAsset {
  const embedding = video.video.embedding ? stripEmbeddingVector(video.video.embedding) : undefined;
  return {
    ...video,
    video: {
      ...video.video,
      ...(embedding ? { embedding } : {})
    },
    ...(video.metadata ? { metadata: compactAssetMetadata(video.metadata) } : {})
  };
}

function stripCommerceVideoSliceEmbeddingVectors(slice: CommerceVideoSlice): CommerceVideoSlice {
  return {
    ...slice,
    ...(slice.embedding ? { embedding: stripEmbeddingVector(slice.embedding) } : {})
  };
}

function stripEmbeddingVector<T extends { vector?: number[] }>(embedding: T): T {
  const { vector: _vector, ...rest } = embedding;
  return rest as T;
}

function compactAssetMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "rawCrawlerItem" || key === "connectorOutput") continue;
    out[key] = value;
  }
  return out;
}

function buildCommerceVideoMethodologyPrompt(
  sources: Array<{ video: CommerceVideoAsset; slices: CommerceVideoSlice[] }>,
  stats: CommerceVideoMethodologySummaryResponse["stats"]
): string {
  const compactSources = sources.slice(0, 30).map((source) => ({
    video: {
      id: source.video.id,
      title: source.video.title,
      sourceKind: source.video.sourceKind,
      sourceConnectorId: source.video.sourceConnectorId,
      sourceUrl: source.video.sourceUrl,
      sourceVideoId: source.video.sourceVideoId,
      status: source.video.status,
      product: source.video.product,
      video: source.video.video,
      methodology: source.video.methodology,
      metadata: source.video.metadata
    },
    slices: source.slices.slice(0, 24).map((slice) => ({
      id: slice.id,
      startMs: slice.startMs,
      endMs: slice.endMs,
      thumbnail: slice.thumbnail,
      features: slice.features,
      embedding: slice.embedding
    }))
  }));
  return [
    "你是带货视频爆款方法论总结 agent。",
    "请基于素材库中已解析的带货视频和 slice 结构化数据，参考 video-storyboard-analysis 的逐帧/切片拆解流程，以及 video-generation-pipeline 的可执行生成方法论格式，输出可复用的方法论。",
    "",
    "工作流要求：",
    "1. 先检查每条视频的来源、时长、摘要、商品主体/类目、已提取方法论和 slice 特征。",
    "2. 把 slice 按开场钩子、细节特写、场景/试用、卖点证明、价格/权益、CTA 收尾分组。",
    "3. 对比多条样本，提炼共性结构、差异化打法、镜头节奏、字幕/口播套路、商品露出方式、成交诱因和适合复用的生成提示词。",
    "4. 标注数据限制：哪些结论来自真实 slice，哪些只是标题/摘要/搜索指标推断，哪些需要用户补视频或补商品信息。",
    "",
    "输出格式：",
    "- 方法论总览（适用类目、时长、比例、节奏）。",
    "- 爆款结构模板（按秒级镜头排列，含画面、口播/字幕、商品露出、CTA）。",
    "- 商品/类目差异化建议。",
    "- 可直接给脚本/分镜/生成模块消费的 JSON/YAML 片段。",
    "- 缺口与下一步解析/向量化建议。",
    "",
    `素材统计：${stats.videoCount} 条视频，${stats.sliceCount} 个切片，${stats.embeddedVideoCount} 条视频已有向量，${stats.embeddedSliceCount} 个切片已有向量。`,
    "",
    "素材库上下文 JSON：",
    JSON.stringify({ stats, sources: compactSources }, null, 2)
  ].join("\n");
}

async function importCommerceVideoFile(input: {
  db: any;
  assetRoot: string;
  randomId: () => string;
  tempPath: string;
  originalName: string;
  mime: string;
  title: string;
  sourceKind: "upload" | "crawler";
  sourceConnectorId?: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  metadata?: Record<string, unknown>;
  copyInsteadOfMove?: boolean;
}): Promise<CommerceVideoAsset> {
  const sha256 = await sha256File(input.tempPath);
  const assetId = input.randomId();
  const ext = path.extname(input.originalName || input.tempPath) || ".mp4";
  const dirRel = path.join("commerce-videos", assetId);
  const dirAbs = path.join(input.assetRoot, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const safeOriginalName = sanitizeName(input.originalName || `video${ext}`);
  const fileRel = path.join(dirRel, `original${ext}`).split(path.sep).join("/");
  const fileAbs = path.join(input.assetRoot, fileRel);
  if (input.copyInsteadOfMove) await copyFile(input.tempPath, fileAbs);
  else await rename(input.tempPath, fileAbs);
  const info = await stat(fileAbs);
  return insertCommerceVideoAsset(input.db, {
    id: assetId,
    title: input.title,
    sourceKind: input.sourceKind,
    ...(input.sourceConnectorId ? { sourceConnectorId: input.sourceConnectorId } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.sourceVideoId ? { sourceVideoId: input.sourceVideoId } : {}),
    filePath: fileRel,
    originalFileName: safeOriginalName,
    mime: input.mime || mimeFor(fileRel),
    size: info.size,
    sha256,
    status: "ready",
    product: {},
    video: {},
    methodology: {},
    ...(input.metadata ? { metadata: input.metadata } : {})
  });
}

async function importProductImageFile(input: {
  db: any;
  assetRoot: string;
  randomId: () => string;
  tempPath: string;
  originalName: string;
  mime: string;
  title: string;
  subject?: string;
  category?: string;
  sellingPoints?: string[];
  constraints?: string[];
  suggestedAngles?: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
  copyInsteadOfMove?: boolean;
}): Promise<ProductAsset> {
  const sha256 = await sha256File(input.tempPath);
  const assetId = input.randomId();
  const ext = path.extname(input.originalName || input.tempPath) || ".jpg";
  const dirRel = path.join("products", assetId);
  const dirAbs = path.join(input.assetRoot, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const safeOriginalName = sanitizeName(input.originalName || `product${ext}`);
  const fileRel = path.join(dirRel, `original${ext}`).split(path.sep).join("/");
  const fileAbs = path.join(input.assetRoot, fileRel);
  if (input.copyInsteadOfMove) await copyFile(input.tempPath, fileAbs);
  else await rename(input.tempPath, fileAbs);
  const info = await stat(fileAbs);
  return insertProductAsset(input.db, {
    id: assetId,
    title: input.title,
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.category ? { category: input.category } : {}),
    sourceKind: "upload",
    status: "ready",
    files: [
      {
        path: fileRel,
        name: safeOriginalName,
        mime: input.mime || mimeFor(fileRel),
        size: info.size
      }
    ],
    product: {
      sellingPoints: input.sellingPoints ?? [],
      constraints: input.constraints ?? [],
      suggestedAngles: input.suggestedAngles ?? [],
      ...(input.summary ? { summary: input.summary } : {})
    },
    metadata: {
      ...(input.metadata ?? {}),
      sha256,
      originalFileName: safeOriginalName
    }
  });
}

async function attachCommerceVideoFile(input: {
  db: any;
  assetRoot: string;
  asset: CommerceVideoAsset;
  tempPath: string;
  originalName: string;
  mime: string;
  metadata?: Record<string, unknown>;
  copyInsteadOfMove?: boolean;
}): Promise<CommerceVideoAsset> {
  const sha256 = await sha256File(input.tempPath);
  const ext = path.extname(input.originalName || input.tempPath) || ".mp4";
  const dirRel = path.join("commerce-videos", input.asset.id);
  const dirAbs = path.join(input.assetRoot, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const safeOriginalName = sanitizeName(input.originalName || `video${ext}`);
  const fileRel = path.join(dirRel, `original${ext}`).split(path.sep).join("/");
  const fileAbs = path.join(input.assetRoot, fileRel);
  if (input.copyInsteadOfMove) await copyFile(input.tempPath, fileAbs);
  else await rename(input.tempPath, fileAbs);
  const info = await stat(fileAbs);
  const duplicate = getCommerceVideoAssetBySha(input.db, sha256);
  const updated = updateCommerceVideoAsset(input.db, input.asset.id, {
    file: {
      path: fileRel,
      name: safeOriginalName,
      mime: input.mime || mimeFor(fileRel),
      size: info.size
    },
    ...(duplicate && duplicate.id !== input.asset.id ? {} : { sha256 }),
    status: "ready",
    metadata: {
      ...(input.asset.metadata ?? {}),
      ...(input.metadata ?? {}),
      ...(duplicate && duplicate.id !== input.asset.id ? { duplicateFileOf: duplicate.id } : {})
    }
  });
  if (!updated) throw new Error(`failed to attach commerce video file ${input.asset.id}`);
  return updated;
}

function upsertCrawlerSearchVideo(input: {
  db: any;
  randomId: () => string;
  connectorId: string;
  query: string;
  sort: string;
  item: Record<string, unknown>;
}): CommerceVideoAsset {
  const title = cleanString(input.item.title) || "Bilibili search result";
  const sourceVideoId = cleanString(input.item.videoId) || cleanString((input.item as any).bvid);
  const sourceUrl = cleanString(input.item.url);
  const author = cleanString(input.item.author);
  const metrics = recordOrUndefined(input.item.metrics) ?? {};
  const description = cleanString(input.item.description);
  const evidence = suspectedCommerceEvidence([title, description].join("\n"));
  const heatScore = heatScoreFromMetrics(metrics);
  const metadata = {
    importedBy: "crawler-search",
    source: "bilibili-web",
    crawlerQuery: input.query,
    crawlerSort: input.sort,
    collectedAt: Date.now(),
    author,
    authorId: (input.item as any).authorId ?? null,
    coverImage: cleanString(input.item.coverImage),
    publishTime: cleanString(input.item.publishTime),
    metrics,
    heatScore,
    suspectedCommerceEvidence: evidence,
    dataLimitations: crawlerSearchLimitations(input.connectorId),
    rawCrawlerItem: input.item
  };
  const videoSummary = [
    `Bilibili 公开搜索样本《${title}》${author ? `，作者 ${author}` : ""}。`,
    metricSummary(metrics),
    `疑似带货证据：${evidence.join("；") || "未在标题/简介中发现明显购买词，需人工复核"}`
  ]
    .filter(Boolean)
    .join(" ");
  const existing = getCommerceVideoAssetBySource(input.db, {
    sourceConnectorId: input.connectorId,
    ...(sourceVideoId ? { sourceVideoId } : {}),
    ...(sourceUrl ? { sourceUrl } : {})
  });
  const patch = {
    title,
    sourceKind: "crawler" as const,
    sourceConnectorId: input.connectorId,
    sourceUrl,
    sourceVideoId,
    status: "ready" as const,
    product: {
      subject: input.query,
      category: "带货视频样本"
    },
    video: {
      ...(existing?.video.durationMs ? { durationMs: existing.video.durationMs } : {}),
      ...(existing?.video.embedding ? { embedding: existing.video.embedding } : {}),
      summary: videoSummary
    },
    methodology: {
      hooks: evidence.includes("标题/简介出现痛点或测评词") ? ["痛点/测评切入"] : [],
      structure: ["公开搜索样本", "待下载切片分析"],
      sellingTriggers: evidence,
      styleTags: ["bilibili", "crawler-search", "commerce-video-sample"]
    },
    metadata: {
      ...(existing?.metadata ?? {}),
      ...metadata
    }
  };
  if (existing) {
    const updated = updateCommerceVideoAsset(input.db, existing.id, patch);
    if (!updated) throw new Error(`failed to update crawler search asset ${existing.id}`);
    return updated;
  }
  return insertCommerceVideoAsset(input.db, {
    id: input.randomId(),
    ...patch
  });
}

function productPatchFromRequest(existing: ProductAsset, raw: unknown) {
  const body = (recordOrUndefined(raw) ?? {}) as UpdateProductAssetRequest;
  const nextProduct = { ...existing.product };
  const patch: Record<string, unknown> = {};
  if ("title" in body && cleanString(body.title)) patch.title = cleanString(body.title);
  if ("subject" in body) patch.subject = cleanString(body.subject);
  if ("category" in body) patch.category = cleanString(body.category);
  if ("sellingPoints" in body) nextProduct.sellingPoints = stringList(body.sellingPoints);
  if ("constraints" in body) nextProduct.constraints = stringList(body.constraints);
  if ("suggestedAngles" in body) nextProduct.suggestedAngles = stringList(body.suggestedAngles);
  if ("summary" in body) {
    const summary = cleanString(body.summary);
    if (summary) nextProduct.summary = summary;
    else delete nextProduct.summary;
  }
  patch.product = nextProduct;
  if ("metadata" in body) patch.metadata = recordOrUndefined(body.metadata);
  return patch;
}

function commerceVideoPatchFromRequest(existing: CommerceVideoAsset, raw: unknown) {
  const body = (recordOrUndefined(raw) ?? {}) as UpdateCommerceVideoAssetRequest;
  const patch: Record<string, unknown> = {};
  if ("title" in body && cleanString(body.title)) patch.title = cleanString(body.title);
  if ("sourceUrl" in body) patch.sourceUrl = cleanString(body.sourceUrl);
  if ("sourceVideoId" in body) patch.sourceVideoId = cleanString(body.sourceVideoId);
  if ("product" in body) {
    const product = recordOrUndefined(body.product) ?? {};
    patch.product = {
      ...existing.product,
      ...("subject" in product ? { subject: cleanString(product.subject) } : {}),
      ...("category" in product ? { category: cleanString(product.category) } : {})
    };
  }
  if ("video" in body) {
    const video = recordOrUndefined(body.video) ?? {};
    patch.video = {
      ...existing.video,
      ...("durationMs" in video && Number.isFinite(Number(video.durationMs))
        ? { durationMs: Number(video.durationMs) }
        : {}),
      ...("summary" in video ? { summary: cleanString(video.summary) } : {})
    };
  }
  if ("methodology" in body) {
    const methodology = recordOrUndefined(body.methodology) ?? {};
    patch.methodology = {
      ...existing.methodology,
      ...("hooks" in methodology ? { hooks: stringList(methodology.hooks) } : {}),
      ...("structure" in methodology ? { structure: stringList(methodology.structure) } : {}),
      ...("sellingTriggers" in methodology ? { sellingTriggers: stringList(methodology.sellingTriggers) } : {}),
      ...("styleTags" in methodology ? { styleTags: stringList(methodology.styleTags) } : {})
    };
  }
  if ("metadata" in body) patch.metadata = recordOrUndefined(body.metadata);
  return patch;
}

async function runProductProcessing(input: {
  db: any;
  jobId: string;
  productId: string;
  assetRoot: string;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<void> {
  updateAssetLibraryJob(input.db, input.jobId, { status: "running", startedAt: Date.now() });
  try {
    const product = getProductAsset(input.db, input.productId);
    if (!product) throw new Error("product asset not found");
    appendAssetLibraryJobProgress(input.db, input.jobId, "extracting product selling structure");
    const sellingPoints =
      product.product.sellingPoints.length > 0
        ? product.product.sellingPoints
        : [`突出 ${product.subject || product.title} 的核心卖点`];
    const suggestedAngles =
      product.product.suggestedAngles.length > 0
        ? product.product.suggestedAngles
        : ["开场先给使用场景", "中段展示细节和对比", "结尾给购买理由"];
    const config = withDefaults(await input.readConfig());
    let embedding: any = undefined;
    let status: "ready" | "needs_embedding_config" = "needs_embedding_config";
    if (config.embedding.apiKey?.trim()) {
      embedding = await embedAssetSummary(config.embedding, {
        text: productEmbeddingText({
          ...product,
          product: {
            ...product.product,
            sellingPoints,
            suggestedAngles
          }
        }),
        ...productFirstImagePath(input.assetRoot, product)
      });
      status = "ready";
      appendAssetLibraryJobProgress(input.db, input.jobId, "embedding complete");
    } else {
      appendAssetLibraryJobProgress(input.db, input.jobId, "embedding skipped: configure vectorization provider");
    }
    updateProductAsset(input.db, input.productId, {
      status,
      product: {
        sellingPoints,
        constraints: product.product.constraints,
        suggestedAngles,
        summary: `${product.category || "商品"}：${product.subject || product.title}`,
        ...(embedding ? { embedding } : {})
      }
    });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "done",
      endedAt: Date.now(),
      progress: [...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []), "product processing complete"]
    });
  } catch (error: any) {
    updateProductAsset(input.db, input.productId, { status: "failed" });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "failed",
      endedAt: Date.now(),
      error: { message: errorMessage(error), code: error?.code }
    });
  } finally {
    wakeJob(input.jobId);
  }
}

async function runProductEmbedding(input: {
  db: any;
  jobId: string;
  productId: string;
  assetRoot: string;
  text?: string;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<void> {
  updateAssetLibraryJob(input.db, input.jobId, { status: "running", startedAt: Date.now() });
  try {
    const product = getProductAsset(input.db, input.productId);
    if (!product) throw new Error("product asset not found");
    const config = withDefaults(await input.readConfig());
    if (!config.embedding.apiKey?.trim()) {
      updateProductAsset(input.db, input.productId, { status: "needs_embedding_config" });
      updateAssetLibraryJob(input.db, input.jobId, {
        status: "done",
        endedAt: Date.now(),
        progress: [
          ...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []),
          "embedding skipped: configure vectorization provider"
        ]
      });
      return;
    }
    appendAssetLibraryJobProgress(input.db, input.jobId, "embedding product content");
    const embedding = await embedAssetSummary(config.embedding, {
      text: input.text || productEmbeddingText(product),
      ...productFirstImagePath(input.assetRoot, product)
    });
    updateProductAsset(input.db, input.productId, {
      status: "ready",
      product: {
        ...product.product,
        embedding
      }
    });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "done",
      endedAt: Date.now(),
      progress: [...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []), "product embedding complete"]
    });
  } catch (error: any) {
    updateProductAsset(input.db, input.productId, { status: "failed" });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "failed",
      endedAt: Date.now(),
      error: { message: errorMessage(error), code: error?.code }
    });
  } finally {
    wakeJob(input.jobId);
  }
}

async function materializeCrawlerVideoAssetFile(input: {
  db: any;
  assetRoot: string;
  asset: CommerceVideoAsset;
}): Promise<CommerceVideoAsset> {
  const asset = input.asset;
  if (asset.file?.path) return asset;
  if (asset.sourceConnectorId !== "bilibili") {
    throw needsVideoFileError(
      "video processing needs a local video file; upload a file or use a downloadable crawler source"
    );
  }
  const rawItem = recordOrUndefined((asset.metadata as any)?.rawCrawlerItem) ?? {};
  const crawlerInput: BoundedJsonObject = {
    resolution: "360p"
  };
  if (asset.sourceUrl) crawlerInput.url = asset.sourceUrl;
  if (asset.sourceVideoId) crawlerInput.videoId = asset.sourceVideoId;
  const rawBvid = cleanString((rawItem as any).bvid);
  const rawAid = cleanString((rawItem as any).aid);
  if (!crawlerInput.videoId && rawBvid) crawlerInput.videoId = rawBvid;
  if (!crawlerInput.aid && rawAid) crawlerInput.aid = rawAid;
  if (!crawlerInput.url && !crawlerInput.videoId && !crawlerInput.aid) {
    throw needsVideoFileError("crawler search asset does not include a downloadable url, videoId, bvid, or aid");
  }
  try {
    const connectorOutput: Record<string, unknown> = {
      ...(await executePublicBilibiliCrawlerDownload(crawlerInput, {
        projectsRoot: input.assetRoot,
        projectId: `asset-library-${asset.id}`,
        purpose: "agent_preview"
      })),
      publicTest: true,
      materializedFromSearchAsset: asset.id
    };
    const absolutePath = cleanString(connectorOutput.absolutePath);
    if (!absolutePath) {
      throw new Error("crawler did not return an absolutePath for the downloaded video");
    }
    return await attachCommerceVideoFile({
      db: input.db,
      assetRoot: input.assetRoot,
      asset,
      tempPath: absolutePath,
      originalName: path.basename(absolutePath),
      mime: mimeFor(absolutePath),
      metadata: {
        downloadedBy: "process",
        connectorOutput
      },
      copyInsteadOfMove: true
    });
  } catch (error) {
    throw needsVideoFileError(`automatic crawler download failed: ${errorMessage(error)}`);
  }
}

async function runCommerceVideoProcessing(input: {
  db: any;
  jobId: string;
  assetId: string;
  assetRoot: string;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<void> {
  updateAssetLibraryJob(input.db, input.jobId, { status: "running", startedAt: Date.now() });
  const progress = (line: string) => appendAssetLibraryJobProgress(input.db, input.jobId, line);
  try {
    await processCommerceVideoAssetCore({ ...input, onProgress: progress });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "done",
      endedAt: Date.now(),
      progress: [...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []), "commerce video processing complete"]
    });
  } catch (error: any) {
    updateCommerceVideoAsset(input.db, input.assetId, {
      status: error?.code === "NEEDS_VIDEO_FILE" ? "needs_video_file" : "failed"
    });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "failed",
      endedAt: Date.now(),
      error: { message: errorMessage(error), code: error?.code }
    });
  } finally {
    wakeJob(input.jobId);
  }
}

async function runCommerceVideoBatchProcessing(input: {
  db: any;
  jobId: string;
  assetIds: string[];
  assetRoot: string;
  includeEmbeddings: boolean;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<void> {
  updateAssetLibraryJob(input.db, input.jobId, { status: "running", startedAt: Date.now() });
  const total = input.assetIds.length;
  const results: Array<{ id: string; ok: boolean; message?: string }> = [];
  const append = (line: string) => appendAssetLibraryJobProgress(input.db, input.jobId, line);
  append(`batch analysis started (${total} video${total === 1 ? "" : "s"})`);
  for (let index = 0; index < input.assetIds.length; index += 1) {
    const assetId = input.assetIds[index]!;
    const label = `[${index + 1}/${total}]`;
    const current = getCommerceVideoAsset(input.db, assetId);
    append(`${label} ${current?.title ?? assetId}: start`);
    try {
      const processed = await processCommerceVideoAssetCore({
        db: input.db,
        assetId,
        assetRoot: input.assetRoot,
        readConfig: input.readConfig,
        onProgress: (line) => append(`${label} ${line}`)
      });
      if (input.includeEmbeddings) {
        await embedCommerceVideoAssetCore({
          db: input.db,
          assetId,
          assetRoot: input.assetRoot,
          includeSlices: true,
          readConfig: input.readConfig,
          onProgress: (line) => append(`${label} ${line}`)
        });
      }
      append(`${label} done: ${processed.slices.length} slices`);
      results.push({ id: assetId, ok: true });
    } catch (error: any) {
      const code = error?.code === "NEEDS_VIDEO_FILE" ? "needs_video_file" : "failed";
      updateCommerceVideoAsset(input.db, assetId, { status: code });
      const message = errorMessage(error);
      append(`${label} failed: ${message}`);
      results.push({ id: assetId, ok: false, message });
    }
  }
  const failed = results.filter((result) => !result.ok);
  updateAssetLibraryJob(input.db, input.jobId, {
    status: failed.length === total ? "failed" : "done",
    endedAt: Date.now(),
    ...(failed.length === total ? { error: { message: "all batch videos failed" } } : {}),
    progress: [
      ...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []),
      `batch analysis complete: ${results.length - failed.length}/${total} succeeded`
    ]
  });
  wakeJob(input.jobId);
}

async function processCommerceVideoAssetCore(input: {
  db: any;
  assetId: string;
  assetRoot: string;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
  onProgress: (line: string) => void;
}): Promise<{ asset: CommerceVideoAsset; slices: CommerceVideoSlice[]; durationMs: number }> {
  let asset = getCommerceVideoAsset(input.db, input.assetId);
  if (!asset) throw new Error("commerce video asset not found");
  if (!asset.file?.path) {
    input.onProgress("local video file missing; attempting crawler download");
    asset = await materializeCrawlerVideoAssetFile({
      db: input.db,
      assetRoot: input.assetRoot,
      asset
    });
    input.onProgress("crawler video downloaded into asset library");
  }
  if (!asset.file?.path) throw needsVideoFileError("commerce video file not found");
  const config = withDefaults(await input.readConfig());
  const toolResult = await testToolConfig(config.tools);
  if (!toolResult.ok || !toolResult.ffmpeg?.ok || !toolResult.ffprobe?.ok) {
    throw Object.assign(new Error(summarizeToolErrors(toolResult)), { code: "FFMPEG_NOT_CONFIGURED" });
  }
  const ffmpegPath = toolResult.ffmpeg.path;
  const ffprobePath = toolResult.ffprobe.path;
  const fileAbs = safeAssetPath(input.assetRoot, asset.file.path);
  input.onProgress("probing video duration");
  const durationMs = await ffprobeDurationMs(ffprobePath, fileAbs);
  input.onProgress(`duration ${Math.round(durationMs / 1000)}s`);
  const slices = await createVideoSlices({
    asset,
    assetRoot: input.assetRoot,
    ffmpegPath,
    fileAbs,
    durationMs
  });
  const storedSlices = replaceCommerceVideoSlices(input.db, asset.id, slices);
  input.onProgress(`created ${storedSlices.length} slices`);

  let embedding: any = undefined;
  let status: "ready" | "needs_embedding_config" = "needs_embedding_config";
  if (config.embedding.apiKey?.trim()) {
    try {
      const firstThumbnail = storedSlices.find((slice) => slice.thumbnail?.path)?.thumbnail?.path;
      const embedInput = {
        text: `${asset.title}\n带货视频摘要：提炼爆款结构、商品露出和成交诱因。`,
        ...(firstThumbnail ? { imagePath: safeAssetPath(input.assetRoot, firstThumbnail) } : {})
      };
      embedding = await embedAssetSummary(config.embedding, embedInput);
      status = "ready";
      input.onProgress("summary embedding complete");
    } catch (error) {
      input.onProgress(`summary embedding failed: ${errorMessage(error)}`);
    }
  } else {
    input.onProgress("embedding skipped: configure vectorization provider");
  }

  const updated = updateCommerceVideoAsset(input.db, asset.id, {
    status,
    product: {
      subject: asset.product.subject || inferSubject(asset.title),
      category: asset.product.category || "带货商品"
    },
    video: {
      durationMs,
      summary: `带货视频《${asset.title}》，可用于分析开场钩子、卖点呈现和成交节奏。`,
      ...(embedding ? { embedding } : {})
    },
    methodology: {
      hooks: ["开场快速呈现商品/场景", "用问题或痛点吸引停留"],
      structure: ["痛点/场景", "商品展示", "卖点强化", "行动引导"],
      sellingTriggers: ["即时可见的使用效果", "价格/稀缺/便利性理由"],
      styleTags: ["commerce-video", "short-form", "methodology-source"]
    }
  });
  return { asset: updated ?? asset, slices: storedSlices, durationMs };
}

async function runCommerceVideoEmbedding(input: {
  db: any;
  jobId: string;
  assetId: string;
  assetRoot: string;
  text?: string;
  includeSlices: boolean;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<void> {
  updateAssetLibraryJob(input.db, input.jobId, { status: "running", startedAt: Date.now() });
  const progress = (line: string) => appendAssetLibraryJobProgress(input.db, input.jobId, line);
  try {
    await embedCommerceVideoAssetCore({ ...input, onProgress: progress });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "done",
      endedAt: Date.now(),
      progress: [...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []), "commerce video embedding complete"]
    });
  } catch (error: any) {
    updateCommerceVideoAsset(input.db, input.assetId, { status: "failed" });
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "failed",
      endedAt: Date.now(),
      error: { message: errorMessage(error), code: error?.code }
    });
  } finally {
    wakeJob(input.jobId);
  }
}

async function embedCommerceVideoAssetCore(input: {
  db: any;
  assetId: string;
  assetRoot: string;
  text?: string;
  includeSlices: boolean;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
  onProgress: (line: string) => void;
}): Promise<{ asset: CommerceVideoAsset; slices: CommerceVideoSlice[]; embeddedSlices: number; skipped: boolean }> {
  const asset = getCommerceVideoAsset(input.db, input.assetId);
  if (!asset) throw new Error("commerce video asset not found");
  const config = withDefaults(await input.readConfig());
  if (!config.embedding.apiKey?.trim()) {
    updateCommerceVideoAsset(input.db, input.assetId, { status: "needs_embedding_config" });
    input.onProgress("embedding skipped: configure vectorization provider");
    return { asset, slices: listCommerceVideoSlices(input.db, asset.id), embeddedSlices: 0, skipped: true };
  }

  const slices = listCommerceVideoSlices(input.db, asset.id);
  const firstThumbnail = slices.find((slice) => slice.thumbnail?.path)?.thumbnail?.path;
  input.onProgress("embedding commerce video summary");
  const embedding = await embedAssetSummary(config.embedding, {
    text: input.text || commerceVideoEmbeddingText(asset),
    ...(firstThumbnail ? { imagePath: safeAssetPath(input.assetRoot, firstThumbnail) } : {})
  });
  const updated =
    updateCommerceVideoAsset(input.db, asset.id, {
      status: "ready",
      video: {
        ...asset.video,
        embedding
      }
    }) ?? asset;

  let embeddedSlices = 0;
  if (input.includeSlices && slices.length > 0) {
    input.onProgress(`embedding ${slices.length} slices`);
    for (const slice of slices) {
      const sliceEmbedding = await embedAssetSummary(config.embedding, {
        text: sliceEmbeddingText(asset, slice),
        ...(slice.thumbnail?.path ? { imagePath: safeAssetPath(input.assetRoot, slice.thumbnail.path) } : {})
      });
      updateCommerceVideoSliceEmbedding(input.db, slice.id, sliceEmbedding);
      embeddedSlices += 1;
    }
  }
  return { asset: updated, slices, embeddedSlices, skipped: false };
}

async function createVideoSlices(input: {
  asset: CommerceVideoAsset;
  assetRoot: string;
  ffmpegPath: string;
  fileAbs: string;
  durationMs: number;
}): Promise<
  Array<{
    id: string;
    startMs: number;
    endMs: number;
    thumbnailPath?: string;
    features: Record<string, unknown>;
  }>
> {
  const sliceDurationMs = 5_000;
  const count = Math.max(1, Math.min(60, Math.ceil(input.durationMs / sliceDurationMs)));
  const dirRel = path.join("commerce-videos", input.asset.id, "slices");
  const dirAbs = path.join(input.assetRoot, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const slices = [];
  for (let i = 0; i < count; i += 1) {
    const startMs = i * sliceDurationMs;
    const endMs = Math.min(input.durationMs || sliceDurationMs, startMs + sliceDurationMs);
    const id = randomUUID();
    const thumbnailRel = path
      .join(dirRel, `${String(i + 1).padStart(3, "0")}.jpg`)
      .split(path.sep)
      .join("/");
    const thumbnailAbs = path.join(input.assetRoot, thumbnailRel);
    await execFileAsync(
      input.ffmpegPath,
      [
        "-y",
        "-ss",
        String(Math.max(0, startMs / 1000 + 0.25)),
        "-i",
        input.fileAbs,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        thumbnailAbs
      ],
      { timeout: 20_000, windowsHide: true }
    ).catch(() => undefined);
    const hasThumb = fs.existsSync(thumbnailAbs);
    slices.push({
      id,
      startMs,
      endMs,
      ...(hasThumb ? { thumbnailPath: thumbnailRel } : {}),
      features: {
        scene: `Slice ${i + 1}`,
        visualActions: [],
        spokenText: [],
        onScreenText: [],
        productMentions: [],
        pace: i === 0 ? "hook" : "steady",
        tags: i === 0 ? ["hook", "opening"] : ["commerce-video"]
      }
    });
  }
  return slices;
}

async function ffprobeDurationMs(ffprobePath: string, filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath],
    { timeout: 20_000, windowsHide: true }
  );
  const parsed = JSON.parse(stdout);
  const seconds = Number(parsed?.format?.duration);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 5_000;
}

async function embedAssetSummary(config: EmbeddingProviderConfig, input: { text: string; imagePath?: string }) {
  const startedAt = Date.now();
  const textType = config.inputMapping?.textType || "text";
  const imageUrlType = config.inputMapping?.imageUrlType || "image_url";
  const imageUrlField = config.inputMapping?.imageUrlField || "image_url";
  const bodyInput: any[] = [{ type: textType, text: input.text }];
  if (input.imagePath) {
    const bytes = await readFile(input.imagePath);
    bodyInput.push({
      type: imageUrlType,
      [imageUrlField]: {
        url: `data:${mimeFor(input.imagePath)};base64,${bytes.toString("base64")}`
      }
    });
  }
  const response = await fetch(embeddingEndpoint(config), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      ...(config.headers ?? {})
    },
    body: JSON.stringify({ model: config.model, input: bodyInput }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`embedding request failed: ${response.status}`);
  const data = await response.json();
  const vector = extractEmbeddingVector(data);
  return {
    providerId: config.providerId,
    model: config.model,
    ...(vector ? { dimensions: vector.length, vector } : {}),
    createdAt: startedAt
  };
}

async function testEmbeddingConfig(config: EmbeddingProviderConfig): Promise<EmbeddingProviderTestResponse> {
  const startedAt = Date.now();
  if (!config.apiKey?.trim()) {
    return {
      ok: false,
      providerId: config.providerId,
      model: config.model,
      latencyMs: 0,
      kind: "missing_api_key",
      detail: "API key is required"
    };
  }
  try {
    const response = await fetch(embeddingEndpoint(config), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
        ...(config.headers ?? {})
      },
      body: JSON.stringify({
        model: config.model,
        input: [{ type: config.inputMapping?.textType || "text", text: "Open Design vectorization test" }]
      }),
      signal: AbortSignal.timeout(30_000)
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        providerId: config.providerId,
        model: config.model,
        latencyMs: Date.now() - startedAt,
        status: response.status,
        kind: embeddingFailureKind(response.status),
        detail: truncate(text, 240)
      };
    }
    const parsed = text ? JSON.parse(text) : {};
    const vector = extractEmbeddingVector(parsed);
    return {
      ok: Boolean(vector),
      providerId: config.providerId,
      model: config.model,
      latencyMs: Date.now() - startedAt,
      status: response.status,
      kind: vector ? "success" : "bad_response",
      ...(vector ? { dimensions: vector.length } : { detail: truncate(text, 240) })
    };
  } catch (error: any) {
    return {
      ok: false,
      providerId: config.providerId,
      model: config.model,
      latencyMs: Date.now() - startedAt,
      kind: "network_error",
      detail: errorMessage(error)
    };
  }
}

async function testToolConfig(tools: AssetLibraryToolConfig): Promise<AssetLibraryToolTestResponse> {
  const ffmpeg = await testToolWithFallback(tools.ffmpegPath, tools.autoDetectEnabled ? "ffmpeg" : "");
  const ffprobe = await testToolWithFallback(tools.ffprobePath, tools.autoDetectEnabled ? "ffprobe" : "");
  return { ok: Boolean(ffmpeg.ok && ffprobe.ok), ffmpeg, ffprobe };
}

async function testToolWithFallback(
  configured: string | undefined,
  fallback: string
): Promise<{ path: string; ok: boolean; version?: string; error?: string }> {
  const primary = await testTool(configured || "");
  if (primary.ok || !fallback || fallback === configured) return primary;
  const detected = await testTool(fallback);
  return detected.ok ? detected : primary;
}

async function testTool(command: string): Promise<{ path: string; ok: boolean; version?: string; error?: string }> {
  const pathLabel = command || "";
  if (!command) return { path: pathLabel, ok: false, error: "path is empty" };
  try {
    const { stdout, stderr } = await execFileAsync(command, ["-version"], { timeout: 10_000, windowsHide: true });
    const firstLine = String(stdout || stderr)
      .split(/\r?\n/)
      .find(Boolean);
    return { path: pathLabel, ok: true, ...(firstLine ? { version: firstLine } : {}) };
  } catch (error: any) {
    return { path: pathLabel, ok: false, error: errorMessage(error) };
  }
}

async function readStoredConfig(configPath: string): Promise<AssetLibraryStoredConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function withDefaults(config: AssetLibraryStoredConfig): Required<AssetLibraryStoredConfig> {
  return {
    embedding: normalizeEmbeddingConfig(config.embedding, defaultEmbeddingConfig()),
    tools: normalizeToolConfig(config.tools, defaultToolConfig())
  };
}

function defaultToolConfig(): AssetLibraryToolConfig {
  return {
    ffmpegPath: DEFAULT_WINDOWS_FFMPEG,
    ffprobePath: DEFAULT_WINDOWS_FFPROBE,
    autoDetectEnabled: true
  };
}

function defaultEmbeddingConfig(): EmbeddingProviderConfig {
  return {
    providerId: "volcengine-ark",
    label: "Volcengine Ark",
    apiKey: "",
    baseUrl: DEFAULT_EMBEDDING_BASE_URL,
    endpointPath: DEFAULT_EMBEDDING_ENDPOINT_PATH,
    model: DEFAULT_EMBEDDING_MODEL,
    headers: {},
    inputMapping: {
      textType: "text",
      imageUrlType: "image_url",
      imageUrlField: "image_url"
    }
  };
}

function normalizeToolConfig(input: unknown, fallback: AssetLibraryToolConfig): AssetLibraryToolConfig {
  const record = recordOrUndefined(input) ?? {};
  return {
    ffmpegPath: cleanString(record.ffmpegPath) || fallback.ffmpegPath || DEFAULT_WINDOWS_FFMPEG,
    ffprobePath: cleanString(record.ffprobePath) || fallback.ffprobePath || DEFAULT_WINDOWS_FFPROBE,
    autoDetectEnabled:
      typeof record.autoDetectEnabled === "boolean" ? record.autoDetectEnabled : fallback.autoDetectEnabled !== false,
    ...(typeof fallback.lastVerifiedAt === "number" ? { lastVerifiedAt: fallback.lastVerifiedAt } : {}),
    ...(typeof fallback.lastVerificationError === "string"
      ? { lastVerificationError: fallback.lastVerificationError }
      : {})
  };
}

function normalizeEmbeddingConfig(input: unknown, fallback: EmbeddingProviderConfig): EmbeddingProviderConfig {
  const record = recordOrUndefined(input) ?? {};
  const apiKey = cleanString(record.apiKey);
  const preserveKey = !apiKey && (record.preserveApiKey === true || record.apiKeyConfigured === true);
  const label = cleanString(record.label) || fallback.label;
  return {
    providerId: record.providerId === "custom" ? "custom" : "volcengine-ark",
    ...(label ? { label } : {}),
    apiKey: apiKey || (preserveKey ? (fallback.apiKey ?? "") : ""),
    baseUrl: cleanString(record.baseUrl) || fallback.baseUrl || DEFAULT_EMBEDDING_BASE_URL,
    endpointPath: cleanString(record.endpointPath) || fallback.endpointPath || DEFAULT_EMBEDDING_ENDPOINT_PATH,
    model: cleanString(record.model) || fallback.model || DEFAULT_EMBEDDING_MODEL,
    headers: normalizeHeaders(record.headers ?? fallback.headers),
    inputMapping: {
      textType: cleanString((record.inputMapping as any)?.textType) || fallback.inputMapping?.textType || "text",
      imageUrlType:
        cleanString((record.inputMapping as any)?.imageUrlType) || fallback.inputMapping?.imageUrlType || "image_url",
      imageUrlField:
        cleanString((record.inputMapping as any)?.imageUrlField) || fallback.inputMapping?.imageUrlField || "image_url"
    }
  };
}

function maskConfig(config: Required<AssetLibraryStoredConfig>): AssetLibraryConfigResponse {
  return {
    embedding: maskEmbeddingConfig(config.embedding),
    tools: config.tools
  };
}

function maskEmbeddingConfig(config: EmbeddingProviderConfig): EmbeddingProviderConfig {
  const tail = config.apiKey?.trim() ? config.apiKey.trim().slice(-4) : (config.apiKeyTail ?? "");
  return {
    ...config,
    apiKey: "",
    apiKeyConfigured: Boolean(tail),
    apiKeyTail: tail
  };
}

function normalizeHeaders(input: unknown): Record<string, string> {
  const record = recordOrUndefined(input) ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const k = cleanString(key);
    const v = cleanString(value);
    if (!k || !v) continue;
    if (/authorization|api[-_]?key|secret|token/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function embeddingEndpoint(config: EmbeddingProviderConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  const pathPart = config.endpointPath.startsWith("/") ? config.endpointPath : `/${config.endpointPath}`;
  return `${base}${pathPart}`;
}

function embeddingFailureKind(status: number): EmbeddingProviderTestResponse["kind"] {
  if (status === 401) return "auth_failed";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return "unknown";
}

function extractEmbeddingVector(value: unknown): number[] | null {
  const data = recordOrUndefined(value);
  const candidates = [
    (data?.data as any)?.[0]?.embedding,
    (data?.data as any)?.[0]?.embeddings,
    (data?.data as any)?.embedding,
    (data?.data as any)?.embeddings,
    (data as any)?.embedding
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.every((n) => typeof n === "number")) return candidate;
  }
  return null;
}

function resolveExportSource(db: any, body: any): { path: string } | null {
  const sliceId = cleanString(body?.sliceId);
  if (sliceId) {
    const slice = getCommerceVideoSlice(db, sliceId);
    if (slice?.file?.path) return { path: slice.file.path };
    if (slice?.thumbnail?.path) return { path: slice.thumbnail.path };
  }
  const assetId = cleanString(body?.assetId);
  if (assetId) {
    const video = getCommerceVideoAsset(db, assetId);
    if (video?.file?.path) return { path: video.file.path };
    const product = getProductAsset(db, assetId);
    const file = product?.files?.[0];
    if (file?.path) return { path: file.path };
  }
  return null;
}

function isTerminalJob(job: { status: string }): boolean {
  return job.status === "done" || job.status === "failed" || job.status === "interrupted";
}

function wakeJob(jobId: string): void {
  const waiters = liveJobWaiters.get(jobId);
  if (!waiters) return;
  for (const waiter of Array.from(waiters)) waiter();
  liveJobWaiters.delete(jobId);
}

function safeAssetPath(assetRoot: string, rel: string): string {
  const clean = rel.replace(/^[/\\]+/, "");
  const root = path.resolve(assetRoot);
  const absolute = path.resolve(root, clean);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("asset path escapes library root");
  }
  return absolute;
}

async function removeAssetDirectory(
  assetRoot: string,
  section: "products" | "commerce-videos",
  assetId: string
): Promise<{ ok: boolean; warning?: string }> {
  try {
    const absolute = safeAssetPath(assetRoot, path.join(section, assetId));
    await rm(absolute, { recursive: true, force: true });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, warning: errorMessage(error) };
  }
}

function productFirstImagePath(assetRoot: string, product: ProductAsset): { imagePath?: string } {
  const firstImage = product.files.find((file) => isSupportedProductImage(file.name || file.path, file.mime));
  return firstImage?.path ? { imagePath: safeAssetPath(assetRoot, firstImage.path) } : {};
}

function isSupportedProductImage(name: string | undefined, mime: string | undefined): boolean {
  const normalizedMime = (mime || "").toLowerCase();
  if (
    normalizedMime === "image/jpeg" ||
    normalizedMime === "image/png" ||
    normalizedMime === "image/webp" ||
    normalizedMime === "image/gif"
  ) {
    return true;
  }
  return /\.(jpe?g|png|webp|gif)$/iu.test(name || "");
}

function parseMetadataJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    return recordOrUndefined(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function summarizeToolErrors(result: AssetLibraryToolTestResponse): string {
  const parts = [];
  if (!result.ffmpeg?.ok) parts.push(`ffmpeg: ${result.ffmpeg?.error ?? "not found"}`);
  if (!result.ffprobe?.ok) parts.push(`ffprobe: ${result.ffprobe?.error ?? "not found"}`);
  return parts.join("; ") || "tool verification failed";
}

function productEmbeddingText(product: ProductAsset): string {
  return [
    `商品素材：${product.title}`,
    product.subject ? `主体：${product.subject}` : "",
    product.category ? `类目：${product.category}` : "",
    product.product.summary ? `摘要：${product.product.summary}` : "",
    product.product.sellingPoints.length ? `卖点：${product.product.sellingPoints.join("，")}` : "",
    product.product.constraints.length ? `约束：${product.product.constraints.join("，")}` : "",
    product.product.suggestedAngles.length ? `适合视频方向：${product.product.suggestedAngles.join("，")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function commerceVideoEmbeddingText(asset: CommerceVideoAsset): string {
  return [
    `带货视频：${asset.title}`,
    asset.product.subject ? `商品主体：${asset.product.subject}` : "",
    asset.product.category ? `商品类目：${asset.product.category}` : "",
    asset.video.summary ? `摘要：${asset.video.summary}` : "",
    asset.methodology.hooks.length ? `钩子：${asset.methodology.hooks.join("，")}` : "",
    asset.methodology.structure.length ? `结构：${asset.methodology.structure.join(" > ")}` : "",
    asset.methodology.sellingTriggers.length ? `成交诱因：${asset.methodology.sellingTriggers.join("，")}` : "",
    asset.methodology.styleTags.length ? `风格标签：${asset.methodology.styleTags.join("，")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function sliceEmbeddingText(
  asset: CommerceVideoAsset,
  slice: ReturnType<typeof listCommerceVideoSlices>[number]
): string {
  return [
    `带货视频切片：${asset.title}`,
    `时间：${slice.startMs}ms-${slice.endMs}ms`,
    slice.features.scene ? `场景：${slice.features.scene}` : "",
    slice.features.hook ? `钩子：${slice.features.hook}` : "",
    slice.features.visualActions.length ? `画面动作：${slice.features.visualActions.join("，")}` : "",
    slice.features.spokenText.length ? `口播：${slice.features.spokenText.join("，")}` : "",
    slice.features.onScreenText.length ? `字幕：${slice.features.onScreenText.join("，")}` : "",
    slice.features.productMentions.length ? `商品露出：${slice.features.productMentions.join("，")}` : "",
    slice.features.sellingPoint ? `卖点：${slice.features.sellingPoint}` : "",
    slice.features.tags.length ? `标签：${slice.features.tags.join("，")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function crawlerSearchLimitations(connectorId: string): string[] {
  if (connectorId === "bilibili") {
    return [
      "仅保存 Bilibili 公开搜索接口可返回的字段。",
      "互动指标可能有延迟或缺字段，不代表最终实时数据。",
      "未绕过登录、验证码或平台风控；需要下载/评论分析时请使用已授权连接器继续处理。",
      "搜索入库不下载原视频文件，后续可对单条样本执行下载导入或向量化。"
    ];
  }
  return ["仅保存连接器公开返回字段；不绕过登录、验证码或平台风控。"];
}

function suspectedCommerceEvidence(text: string): string[] {
  const haystack = text.toLowerCase();
  const evidence = [];
  if (/(带货|种草|好物|同款|橱窗|购买|下单|优惠|券|链接|到手|价格|测评|开箱|推荐)/i.test(text)) {
    evidence.push("标题/简介出现带货、购买、种草、测评或优惠相关词");
  }
  if (/(数字人|ai|虚拟人|直播|口播|短视频)/i.test(text)) {
    evidence.push("标题/简介出现短视频/数字人/口播等内容生产线索");
  }
  if (/(教程|怎么|对比|实测|真实|避坑|清单|合集)/i.test(text)) {
    evidence.push("标题/简介出现痛点或测评词");
  }
  if (haystack.includes("http") || /(tb|taobao|jd|pdd|小店|店铺)/i.test(text)) {
    evidence.push("文本中疑似包含外链、店铺或平台购买线索");
  }
  return Array.from(new Set(evidence));
}

function heatScoreFromMetrics(metrics: Record<string, any>): number {
  const play = Number(metrics.play ?? metrics.view ?? metrics.views ?? 0);
  const like = Number(metrics.like ?? metrics.likes ?? 0);
  const favorite = Number(metrics.favorite ?? metrics.favorites ?? metrics.collect ?? 0);
  const comment = Number(metrics.comment ?? metrics.comments ?? 0);
  const share = Number(metrics.share ?? metrics.shares ?? 0);
  const danmaku = Number(metrics.danmaku ?? 0);
  return [play, like * 10, favorite * 8, comment * 6, share * 12, danmaku * 2]
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
}

function metricSummary(metrics: Record<string, any>): string {
  const parts = [
    ["播放", metrics.play ?? metrics.view ?? metrics.views],
    ["点赞", metrics.like ?? metrics.likes],
    ["收藏", metrics.favorite ?? metrics.favorites ?? metrics.collect],
    ["评论", metrics.comment ?? metrics.comments],
    ["分享", metrics.share ?? metrics.shares],
    ["弹幕", metrics.danmaku]
  ]
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([label, value]) => `${label} ${Number(value).toLocaleString("zh-CN")}`);
  return parts.length ? `可获得指标：${parts.join("，")}。` : "暂无可用互动指标。";
}

function crawlerHeatScore(metadata: unknown): number {
  const record = recordOrUndefined(metadata) ?? {};
  return Number(record.heatScore ?? (record.crawlerSearch as any)?.heatScore ?? 0) || 0;
}

function inferSubject(title: string): string {
  return title.replace(/\.[a-z0-9]+$/i, "").trim() || "商品";
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function recordOrUndefined(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : undefined;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(recordOrUndefined(value));
}

function truthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

async function executePublicBilibiliCrawlerDownload(
  input: BoundedJsonObject,
  context: { projectsRoot: string; projectId: string; purpose: string }
): Promise<BoundedJsonObject> {
  const definition = getStaticVideoCrawlerDefinitions().find((item) => item.id === "bilibili");
  const tool = definition?.tools.find((item) => item.name === "bilibili.bilibili_download_video");
  if (!definition || !tool) {
    throw new ConnectorServiceError("CONNECTOR_TOOL_NOT_FOUND", "Bilibili download tool is not available", 404, {
      connectorId: "bilibili",
      toolName: "bilibili.bilibili_download_video"
    });
  }
  return executeBuiltInBilibiliCrawlerTool({
    definition,
    tool,
    input,
    credentials: {},
    context
  });
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function needsVideoFileError(message: string): Error & { code: "NEEDS_VIDEO_FILE" } {
  return Object.assign(new Error(message), { code: "NEEDS_VIDEO_FILE" as const });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
