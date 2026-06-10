import type { Express, Request, Response } from "express";
import multer from "multer";
import fs, { type Dirent } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AssetLibraryConfigResponse,
  AssetLibraryToolConfig,
  AssetLibraryToolTestResponse,
  AssetLibrarySearchGranularity,
  AssetLibrarySearchKind,
  AssetLibrarySearchMatch,
  AssetLibrarySearchRequest,
  AssetLibrarySearchResponse,
  AssetLibrarySection,
  AssetLibraryStatus,
  BatchProcessCommerceVideosRequest,
  BatchProcessCommerceVideosResponse,
  CommerceVideoAsset,
  CommerceVideoSlice,
  CommerceVideoMethodologySummaryRequest,
  CommerceVideoMethodologySummaryResponse,
  CreateQualityVideoAssetRequest,
  DeleteCommerceVideoAssetResponse,
  DeleteProductAssetResponse,
  EmbedAssetLibraryAssetRequest,
  EmbeddingProviderConfig,
  EmbeddingProviderTestResponse,
  ImportProductImageResponse,
  ImportProductImagesResponse,
  ProductImageFolderIngestRequest,
  ProductImageFolderIngestResponse,
  ProductImageFolderIngestImageResult,
  ProductImageFolderIngestSkippedFile,
  ImportCommerceVideoSearchRequest,
  ImportQualityVideoSearchRequest,
  ProductAsset,
  QualityVideoAsset,
  SearchCommerceVideosRequest,
  SearchQualityVideosRequest,
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
  interruptActiveAssetLibraryJobs,
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
import { executePublicDouyinCrawlerDownload } from "../connectors/douyin-crawler-runtime.js";
import { connectorService, ConnectorServiceError } from "../connectors/service.js";
import { getStaticVideoCrawlerDefinitions } from "../connectors/video-crawler.js";
import { proxyDispatcherRequestInit } from "../connectionTest.js";
import type { BoundedJsonObject } from "../live-artifacts/schema.js";
import { understandMedia } from "../media.js";
import { decodeMultipartFilename, mimeFor, parseByteRange, sanitizeName } from "../projects.js";
import { rankAssetLibrarySearchMatches, rankAssetLibrarySearchResults } from "../asset-library-search.js";

const execFileAsync = promisify(execFile);

const DEFAULT_WINDOWS_FFMPEG =
  "C:\\Users\\pc\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe";
const DEFAULT_WINDOWS_FFPROBE =
  "C:\\Users\\pc\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffprobe.exe";
const DEFAULT_EMBEDDING_BASE_URL = "https://ark.cn-beijing.volces.com";
const DEFAULT_EMBEDDING_ENDPOINT_PATH = "/api/v3/embeddings/multimodal";
const DEFAULT_EMBEDDING_MODEL = "doubao-embedding-vision-251215";
const VOLCENGINE_ARK_ALLOWED_EMBEDDING_MODELS = new Set([DEFAULT_EMBEDDING_MODEL]);
const COMMERCE_VIDEO_UNDERSTANDING_MAX_BYTES = 24 * 1024 * 1024;
const COMMERCE_VIDEO_UNDERSTANDING_PREVIEW_SECONDS = 45;
const COMMERCE_VIDEO_UNDERSTANDING_COMPACT_SECONDS = 18;
const QUALITY_VIDEO_LIBRARY_KIND = "quality-videos";

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
  const { PROJECT_ROOT, RUNTIME_DATA_DIR, PROJECTS_DIR } = ctx.paths;
  const projectRoot = PROJECT_ROOT || process.cwd();
  const assetRoot = path.join(RUNTIME_DATA_DIR, "asset-library");
  const tmpRoot = path.join(assetRoot, "tmp");
  const configPath = path.join(assetRoot, "config.json");
  const randomId = typeof ctx.ids?.randomUUID === "function" ? ctx.ids.randomUUID : randomUUID;
  interruptActiveAssetLibraryJobs(db);

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
    try {
      const embedding = normalizeEmbeddingConfig(req.body?.embedding ?? req.body, current.embedding, { strict: true });
      const next = await writeConfig({ ...current, embedding });
      res.json({ embedding: maskEmbeddingConfig(withDefaults(next).embedding) });
    } catch (error: any) {
      sendApiError(res, error.status ?? 400, error.code ?? "BAD_REQUEST", errorMessage(error));
    }
  });

  app.post("/api/asset-library/embedding-config/test", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const current = withDefaults(await readConfig());
    try {
      const embedding = normalizeEmbeddingConfig(req.body?.embedding ?? req.body, current.embedding, { strict: true });
      res.json(await testEmbeddingConfig(embedding));
    } catch (error: any) {
      sendApiError(res, error.status ?? 400, error.code ?? "BAD_REQUEST", errorMessage(error));
    }
  });

  app.get("/api/asset-library/search", async (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      res.json(
        await searchAssetLibrary({
          db,
          request: searchRequestFromQuery(req.query),
          readConfig
        })
      );
    } catch (error: any) {
      sendApiError(res, error.status ?? 500, error.code ?? "ASSET_LIBRARY_SEARCH_FAILED", errorMessage(error));
    }
  });

  app.post("/api/asset-library/search", async (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      res.json(
        await searchAssetLibrary({
          db,
          request: req.body,
          readConfig
        })
      );
    } catch (error: any) {
      sendApiError(res, error.status ?? 500, error.code ?? "ASSET_LIBRARY_SEARCH_FAILED", errorMessage(error));
    }
  });

  app.get("/api/asset-library/products", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const query = cleanString(req.query.query);
    const limit = Number(req.query.limit);
    try {
      const products = query
        ? await searchProductAssets({
            db,
            query,
            limit: Number.isFinite(limit) ? clampNumber(limit, 1, 200, 50) : 50,
            readConfig
          })
        : listProductAssets(db, {
            ...(Number.isFinite(limit) ? { limit } : {})
          });
      res.json({ products: products.map(slimProductAssetForList) });
    } catch (error: any) {
      sendApiError(res, error.status ?? 500, error.code ?? "ASSET_LIBRARY_SEARCH_FAILED", errorMessage(error));
    }
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
      const originalName = decodedUploadName(file);
      if (!isSupportedProductImage(originalName, file.mimetype)) {
        return sendApiError(res, 400, "BAD_REQUEST", "file must be a jpg, png, webp, or gif image");
      }
      try {
        const imported = await importProductImageFile({
          db,
          assetRoot,
          randomId,
          tempPath: file.path,
          originalName,
          mime: file.mimetype || mimeFor(originalName),
          title: cleanString(req.body?.title) || originalName,
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

  app.post("/api/asset-library/products/import/uploads", (req, res) => {
    if (!requireLocal(req, res)) return;
    upload.array("files", 1000)(req, res, async (err: any) => {
      if (err) return sendMulterError(res, err);
      const files = Array.isArray((req as any).files) ? ((req as any).files as ProductUploadFile[]) : [];
      if (files.length === 0) return sendApiError(res, 400, "BAD_REQUEST", "at least one file is required");
      const job = insertAssetLibraryJob(db, {
        id: randomId(),
        assetKind: "products",
        assetId: "browser-upload",
        kind: "product-image-folder-ingest",
        progress: [`queued AI product analysis for ${files.length} uploaded item${files.length === 1 ? "" : "s"}`]
      });
      void runProductImageUploadIngestion({
        db,
        jobId: job.id,
        files,
        relativePaths: parseUploadRelativePaths(req.body?.relativePaths),
        assetRoot,
        projectRoot: PROJECT_ROOT,
        randomId,
        readConfig
      }).catch(() => undefined);
      res.status(202).json({ job, count: files.length } satisfies ImportProductImagesResponse);
    });
  });

  app.post("/api/asset-library/products/import/folder", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const request = (recordOrUndefined(req.body) ?? {}) as ProductImageFolderIngestRequest;
    try {
      const response = await ingestProductImageFolder({
        db,
        assetRoot,
        projectRoot: PROJECT_ROOT,
        randomId,
        request,
        readConfig
      });
      res.status(response.dryRun ? 200 : 201).json(response);
    } catch (error: any) {
      sendApiError(res, error.status ?? 400, error.code ?? "BAD_REQUEST", errorMessage(error));
    }
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

  app.get("/api/asset-library/commerce-videos", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const query = cleanString(req.query.query);
    const limit = Number(req.query.limit);
    try {
      const videos = query
        ? await searchCommerceVideoAssets({
            db,
            query,
            limit: Number.isFinite(limit) ? clampNumber(limit, 1, 200, 50) : 50,
            readConfig
          })
        : listCommerceVideoAssets(db, {
            ...(Number.isFinite(limit) ? { limit } : {})
          });
      res.json({ videos: videos.map(slimCommerceVideoAssetForList) });
    } catch (error: any) {
      sendApiError(res, error.status ?? 500, error.code ?? "ASSET_LIBRARY_SEARCH_FAILED", errorMessage(error));
    }
  });

  app.post("/api/asset-library/commerce-videos", (req, res) => {
    if (!requireLocal(req, res)) return;
    const title = cleanString(req.body?.title);
    if (!title) return sendApiError(res, 400, "BAD_REQUEST", "title is required");
    const sourceConnectorId = cleanString(req.body?.sourceConnectorId);
    const sourceUrl = cleanString(req.body?.sourceUrl);
    const sourceVideoId = cleanString(req.body?.sourceVideoId);
    if (!sourceUrl && !sourceVideoId) {
      return sendApiError(res, 400, "BAD_REQUEST", "commerce video sourceUrl or sourceVideoId is required");
    }
    const sourceKind = cleanString(req.body?.sourceKind) === "crawler" || sourceConnectorId ? "crawler" : "manual";
    const video = insertCommerceVideoAsset(db, {
      id: randomId(),
      title,
      sourceKind,
      ...(sourceConnectorId ? { sourceConnectorId } : {}),
      sourceUrl,
      sourceVideoId,
      status: "needs_video_file",
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
      const originalName = decodedUploadName(file);
      try {
        const imported = await importCommerceVideoFile({
          db,
          assetRoot,
          randomId,
          tempPath: file.path,
          originalName,
          mime: file.mimetype || mimeFor(originalName),
          title: cleanString(req.body?.title) || originalName,
          sourceKind: "upload",
          metadata: { importedBy: "upload" }
        });
        const job = queueCommerceVideoProcessing({ db, randomId, assetId: imported.id });
        void runCommerceVideoProcessing({
          db,
          jobId: job.id,
          assetId: imported.id,
          assetRoot,
          projectRoot,
          readConfig
        }).catch(() => undefined);
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
    const publicDouyinShare = connectorId === "douyin" && Boolean(input.url);
    if (publicTest && toolName !== "bilibili.bilibili_download_video") {
      return sendApiError(res, 400, "BAD_REQUEST", "Bilibili public test import only supports the download video tool");
    }
    if (publicTest) input.resolution = "360p";

    const importJob = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "commerce-videos",
      assetId: "pending",
      kind: "crawler-import",
      progress: [
        publicDouyinShare
          ? "executing Douyin public share import"
          : `executing ${toolName}${publicTest ? " (public 360p test)" : ""}`
      ]
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
      } else if (publicDouyinShare) {
        connectorOutput = await executePublicDouyinCrawlerDownload(input as BoundedJsonObject, context);
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
      void runCommerceVideoProcessing({
        db,
        jobId: processJob.id,
        assetId: imported.id,
        assetRoot,
        projectRoot,
        readConfig
      }).catch(() => undefined);
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
      projectRoot,
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

  app.get("/api/asset-library/quality-videos", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const query = cleanString(req.query.query);
    const category = cleanString(req.query.category);
    const keyword = cleanString(req.query.keyword);
    const limit = Number(req.query.limit);
    const safeLimit = Number.isFinite(limit) ? clampNumber(limit, 1, 200, 50) : 50;
    try {
      const videos =
        query || category || keyword
          ? await searchQualityVideoAssets({
              db,
              query: [query, category, keyword].filter(Boolean).join(" "),
              category,
              keyword,
              limit: safeLimit,
              readConfig
            })
          : listQualityVideoAssets(db, { limit: safeLimit });
      res.json({ videos: videos.map(slimCommerceVideoAssetForList) });
    } catch (error: any) {
      sendApiError(res, error.status ?? 500, error.code ?? "ASSET_LIBRARY_SEARCH_FAILED", errorMessage(error));
    }
  });

  app.post("/api/asset-library/quality-videos", (req, res) => {
    if (!requireLocal(req, res)) return;
    const body = (recordOrUndefined(req.body) ?? {}) as CreateQualityVideoAssetRequest;
    const title = cleanString(body.title);
    const sourceName = cleanString(body.sourceName);
    const sourceUrl = cleanString(body.sourceUrl);
    const sourceVideoId = cleanString(body.sourceVideoId);
    if (!title) return sendApiError(res, 400, "BAD_REQUEST", "title is required");
    if (!sourceName) return sendApiError(res, 400, "BAD_REQUEST", "sourceName is required");
    if (!sourceUrl && !sourceVideoId) {
      return sendApiError(res, 400, "BAD_REQUEST", "quality video sourceUrl or sourceVideoId is required");
    }
    const bodyVideo = recordOrUndefined(body.video) ?? {};
    const bodyReport = recordOrUndefined(body.report);
    const bodyMethodology = recordOrUndefined(body.methodology);
    const bodyMetadata = recordOrUndefined(body.metadata);
    const report = qualityReportFromInput({
      ...(bodyReport ? { report: bodyReport } : {}),
      ...(bodyMethodology ? { methodology: bodyMethodology } : {}),
      summary: cleanString(bodyVideo.summary)
    });
    const video = insertCommerceVideoAsset(db, {
      id: randomId(),
      title,
      sourceKind: "crawler",
      sourceConnectorId: sourceName,
      sourceUrl,
      sourceVideoId,
      status: "ready",
      product: {
        ...(recordOrUndefined(body.product) ?? {}),
        ...(cleanString(body.category) ? { category: cleanString(body.category) } : {}),
        ...(cleanString(body.keyword) ? { subject: cleanString(body.keyword) } : {})
      },
      video: {
        ...bodyVideo,
        summary: qualitySummaryFromReport(title, report, cleanString(bodyVideo.summary)),
        understanding: qualityPublicMetadataUnderstanding({
          title,
          sourceName,
          sourceUrl,
          sourceVideoId,
          report
        })
      },
      methodology: qualityMethodologyFromReport(bodyMethodology, report, sourceName),
      metadata: qualityVideoMetadata({
        sourceName,
        sourceUrl,
        sourceVideoId,
        publicSource: true,
        declaredBy: "user",
        category: cleanString(body.category),
        keyword: cleanString(body.keyword),
        report,
        ...(bodyMetadata ? { metadata: bodyMetadata } : {}),
        importedBy: "quality-reference"
      })
    });
    res.status(201).json({ video: asQualityVideoAsset(video), slices: [] });
  });

  app.post("/api/asset-library/quality-videos/search", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const body = (recordOrUndefined(req.body) ?? {}) as SearchQualityVideosRequest;
    try {
      res.json(await executeQualityVideoSearch(body, { assetRoot }));
    } catch (error: any) {
      const status = error instanceof ConnectorServiceError ? error.status : (error.status ?? 400);
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/asset-library/quality-videos/import/search", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const body = (recordOrUndefined(req.body) ?? {}) as ImportQualityVideoSearchRequest;
    const importJob = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "quality-videos",
      assetId: "search",
      kind: "crawler-import",
      progress: [
        `searching quality videos: ${cleanString(body.query) || cleanString(body.keyword) || cleanString(body.category)}`
      ]
    });
    try {
      updateAssetLibraryJob(db, importJob.id, { status: "running", startedAt: Date.now() });
      const search = await executeQualityVideoSearch(body, { assetRoot });
      const connectorId = search.search.connectorId;
      const sourceName = search.search.sourceName;
      const query = search.search.query;
      const sort = search.search.sort;
      const category = search.search.category ?? cleanString(body.category);
      const keyword = search.search.keyword ?? cleanString(body.keyword);
      const videos = search.items
        .filter(isRecordLike)
        .map((item) =>
          upsertQualityVideoSearchVideo({
            db,
            randomId,
            connectorId,
            sourceName,
            query,
            sort,
            category,
            keyword,
            item
          })
        )
        .sort((a, b) => crawlerHeatScore(b.metadata) - crawlerHeatScore(a.metadata));
      updateAssetLibraryJob(db, importJob.id, {
        assetId: videos[0]?.id ?? "search",
        status: "done",
        endedAt: Date.now(),
        progress: [
          ...(getAssetLibraryJob(db, importJob.id)?.progress ?? []),
          `saved ${videos.length} quality video report${videos.length === 1 ? "" : "s"} without storing public originals`
        ]
      });
      wakeJob(importJob.id);
      res.status(201).json({ ...search, videos, job: getAssetLibraryJob(db, importJob.id) });
    } catch (error: any) {
      const status = error instanceof ConnectorServiceError ? error.status : (error.status ?? 400);
      updateAssetLibraryJob(db, importJob.id, {
        status: "failed",
        endedAt: Date.now(),
        error: { message: errorMessage(error), status, code: error?.code }
      });
      wakeJob(importJob.id);
      res.status(status).json({ error: errorMessage(error), job: getAssetLibraryJob(db, importJob.id) });
    }
  });

  app.post("/api/asset-library/quality-videos/import/upload", (req, res) => {
    if (!requireLocal(req, res)) return;
    upload.single("file")(req, res, async (err: any) => {
      if (err) return sendMulterError(res, err);
      const file = (req as any).file;
      if (!file?.path) return sendApiError(res, 400, "BAD_REQUEST", "file is required");
      const originalName = decodedUploadName(file);
      const sourceName = cleanString(req.body?.sourceName) || "owned-upload";
      const category = cleanString(req.body?.category);
      const keyword = cleanString(req.body?.keyword);
      try {
        const imported = await importCommerceVideoFile({
          db,
          assetRoot,
          randomId,
          tempPath: file.path,
          originalName,
          mime: file.mimetype || mimeFor(originalName),
          title: cleanString(req.body?.title) || originalName,
          sourceKind: "upload",
          metadata: qualityVideoMetadata({
            sourceName,
            publicSource: false,
            declaredBy: "upload",
            category,
            keyword,
            report: qualityReportFromInput({ report: parseMetadataJson(req.body?.reportJson) }),
            metadata: parseMetadataJson(req.body?.metadataJson),
            importedBy: "quality-upload"
          })
        });
        const job = queueCommerceVideoProcessing({
          db,
          randomId,
          assetId: imported.id,
          assetKind: "quality-videos",
          progress: "queued owned quality video breakdown"
        });
        void runCommerceVideoProcessing({
          db,
          jobId: job.id,
          assetId: imported.id,
          assetRoot,
          projectRoot,
          readConfig
        }).catch(() => undefined);
        res.status(202).json({ video: asQualityVideoAsset(imported), job });
      } catch (error: any) {
        res.status(400).json({ error: errorMessage(error) });
      }
    });
  });

  app.post("/api/asset-library/quality-videos/methodology-summary", (req, res) => {
    if (!requireLocal(req, res)) return;
    const request = (recordOrUndefined(req.body) ?? {}) as CommerceVideoMethodologySummaryRequest;
    const sources = selectQualityVideosForBatch(db, request).map((video) => ({
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
    res.json({
      sources,
      stats,
      prompt: buildQualityVideoMethodologyPrompt(sources, stats)
    });
  });

  app.get("/api/asset-library/quality-videos/:id", (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video || !isQualityVideoAsset(video))
      return sendApiError(res, 404, "NOT_FOUND", "quality video asset not found");
    res.json({ video: asQualityVideoAsset(video), slices: listCommerceVideoSlices(db, video.id) });
  });

  const updateQualityVideoRoute = (req: Request, res: Response) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, cleanString(req.params.id));
    if (!video || !isQualityVideoAsset(video))
      return sendApiError(res, 404, "NOT_FOUND", "quality video asset not found");
    const patch = commerceVideoPatchFromRequest(video, req.body);
    const metadataPatch = recordOrUndefined((recordOrUndefined(req.body) ?? {}).metadata);
    patch.metadata = {
      ...(video.metadata ?? {}),
      ...(recordOrUndefined(patch.metadata) ?? {}),
      ...(metadataPatch ?? {}),
      libraryKind: QUALITY_VIDEO_LIBRARY_KIND
    };
    if (!commerceVideoPatchKeepsSource(video, patch)) {
      return sendApiError(
        res,
        400,
        "BAD_REQUEST",
        "quality video sourceUrl, sourceVideoId, or owned upload file is required"
      );
    }
    const updated = updateCommerceVideoAsset(db, video.id, patch);
    res.json({
      video: updated ? asQualityVideoAsset(updated) : updated,
      slices: listCommerceVideoSlices(db, video.id)
    });
  };

  app.patch("/api/asset-library/quality-videos/:id", updateQualityVideoRoute);
  app.put("/api/asset-library/quality-videos/:id", updateQualityVideoRoute);

  app.delete("/api/asset-library/quality-videos/:id", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, cleanString(req.params.id));
    if (!video || !isQualityVideoAsset(video))
      return sendApiError(res, 404, "NOT_FOUND", "quality video asset not found");
    const deleted = deleteCommerceVideoAsset(db, video.id);
    if (!deleted) return sendApiError(res, 404, "NOT_FOUND", "quality video asset not found");
    const cleanup = await removeAssetDirectory(assetRoot, "commerce-videos", video.id);
    const response: DeleteCommerceVideoAssetResponse = {
      video: asQualityVideoAsset(deleted),
      removedFiles: cleanup.ok,
      ...(cleanup.warning ? { warning: cleanup.warning } : {})
    };
    res.json(response);
  });

  app.post("/api/asset-library/quality-videos/:id/process", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video || !isQualityVideoAsset(video))
      return sendApiError(res, 404, "NOT_FOUND", "quality video asset not found");
    if (!video.file?.path) {
      return sendApiError(
        res,
        400,
        "PUBLIC_ORIGINAL_NOT_STORED",
        "public quality video references only store structured analysis; upload an owned video to run media processing"
      );
    }
    const job = queueCommerceVideoProcessing({
      db,
      randomId,
      assetId: video.id,
      assetKind: "quality-videos",
      progress: "queued owned quality video breakdown"
    });
    void runCommerceVideoProcessing({ db, jobId: job.id, assetId: video.id, assetRoot, projectRoot, readConfig }).catch(
      () => undefined
    );
    res.status(202).json({ job });
  });

  app.post("/api/asset-library/quality-videos/:id/embed", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video || !isQualityVideoAsset(video))
      return sendApiError(res, 404, "NOT_FOUND", "quality video asset not found");
    updateCommerceVideoAsset(db, video.id, { status: "processing" });
    const job = insertAssetLibraryJob(db, {
      id: randomId(),
      assetKind: "quality-videos",
      assetId: video.id,
      kind: "embed",
      progress: ["queued quality video embedding"]
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
    const patch = commerceVideoPatchFromRequest(video, req.body);
    if (!commerceVideoPatchKeepsSource(video, patch)) {
      return sendApiError(res, 400, "BAD_REQUEST", "commerce video sourceUrl, sourceVideoId, or file is required");
    }
    const updated = updateCommerceVideoAsset(db, video.id, patch);
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
    void runCommerceVideoProcessing({ db, jobId: job.id, assetId: video.id, assetRoot, projectRoot, readConfig }).catch(
      () => undefined
    );
    res.status(202).json({ job });
  });

  app.post("/api/asset-library/commerce-videos/:id/slice", async (req, res) => {
    if (!requireLocal(req, res)) return;
    const video = getCommerceVideoAsset(db, req.params.id);
    if (!video) return sendApiError(res, 404, "NOT_FOUND", "commerce video asset not found");
    const job = queueCommerceVideoProcessing({ db, randomId, assetId: video.id, kind: "slice" });
    void runCommerceVideoProcessing({ db, jobId: job.id, assetId: video.id, assetRoot, projectRoot, readConfig }).catch(
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

  app.get(/^\/api\/asset-library\/files\/(.+)$/, async (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      const rel = decodeAssetRoutePath(String((req.params as any)[0] ?? ""));
      const absolute = safeAssetPath(assetRoot, rel);
      const info = await stat(absolute);
      if (!info.isFile()) {
        res.status(404).json({ error: "file not found" });
        return;
      }
      const mime = mimeFor(absolute);
      const isMedia = mime.startsWith("video/") || mime.startsWith("audio/");
      res.type(mime);
      if (isMedia) {
        res.setHeader("Accept-Ranges", "bytes");
        const range = parseByteRange(req.headers.range, info.size);
        if (range === "unsatisfiable") {
          res.status(416);
          res.setHeader("Content-Range", `bytes */${info.size}`);
          res.end();
          return;
        }
        if (range) {
          const contentLength = range.end - range.start + 1;
          res.status(206);
          res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
          res.setHeader("Content-Length", String(contentLength));
          res.setHeader("Cache-Control", "private, max-age=3600");
          fs.createReadStream(absolute, { start: range.start, end: range.end })
            .on("error", (error) => {
              if (error && !res.headersSent) {
                res.status(500).json({ error: "file not found", detail: errorMessage(error) });
              } else if (error) {
                res.destroy(error);
              }
            })
            .pipe(res);
          return;
        }
      }
      res.setHeader("Content-Length", String(info.size));
      res.setHeader("Cache-Control", "private, max-age=3600");
      fs.createReadStream(absolute)
        .on("error", (error) => {
          if (error && !res.headersSent) {
            res.status(500).json({ error: "file not found", detail: errorMessage(error) });
          } else if (error) {
            res.destroy(error);
          }
        })
        .pipe(res);
    } catch (error) {
      res.status(404).json({ error: "file not found", detail: errorMessage(error) });
    }
  });
}

function queueCommerceVideoProcessing(input: {
  db: any;
  randomId: () => string;
  assetId: string;
  assetKind?: "commerce-videos" | "quality-videos";
  kind?: "process" | "slice";
  progress?: string;
}) {
  updateCommerceVideoAsset(input.db, input.assetId, { status: "processing" });
  return insertAssetLibraryJob(input.db, {
    id: input.randomId(),
    assetKind: input.assetKind ?? "commerce-videos",
    assetId: input.assetId,
    kind: input.kind ?? "process",
    progress: [input.progress ?? "queued commerce video processing"]
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
        !hasCommerceVideoSourceData(video) ||
        !video.video.durationMs ||
        !hasCommerceVideoUnderstanding(video) ||
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

const ASSET_LIBRARY_SEARCH_KINDS: AssetLibrarySection[] = ["products", "commerce-videos", "quality-videos"];

interface NormalizedAssetLibrarySearchRequest {
  query: string;
  tags: string[];
  kinds: AssetLibrarySection[];
  granularity: AssetLibrarySearchGranularity;
  limit: number;
  includeVectors: boolean;
}

interface AssetLibrarySearchCandidate {
  kind: AssetLibrarySection;
  granularity: "asset" | "slice";
  id: string;
  assetId: string;
  sliceId?: string;
  title: string;
  subtitle?: string;
  text: string;
  tags: string[];
  status: AssetLibraryStatus;
  vector?: number[];
  vectorDimensions?: number;
  product?: ProductAsset;
  video?: CommerceVideoAsset | QualityVideoAsset;
  slice?: CommerceVideoSlice;
}

async function searchAssetLibrary(input: {
  db: any;
  request: unknown;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<AssetLibrarySearchResponse> {
  const request = normalizeAssetLibrarySearchRequest(input.request);
  const queryForVector = [request.query, ...request.tags].filter(Boolean).join(" ");
  const queryVector = queryForVector ? await queryEmbeddingVector(input.readConfig, queryForVector) : undefined;
  const candidates = buildAssetLibrarySearchCandidates(input.db, request);
  const ranked = rankAssetLibrarySearchMatches(candidates, request.query, {
    limit: request.limit,
    tags: request.tags,
    ...(queryVector ? { queryVector } : {}),
    textFor: (candidate) => candidate.text,
    tagsFor: (candidate) => candidate.tags,
    vectorFor: (candidate) => candidate.vector
  });
  return {
    query: request.query,
    tags: request.tags,
    kinds: request.kinds,
    granularity: request.granularity,
    limit: request.limit,
    vectorizedQuery: Boolean(queryVector),
    results: ranked.map((item) => searchMatchFromCandidate(item.asset, item, request.includeVectors))
  };
}

function buildAssetLibrarySearchCandidates(
  db: any,
  request: NormalizedAssetLibrarySearchRequest
): AssetLibrarySearchCandidate[] {
  const candidates: AssetLibrarySearchCandidate[] = [];
  const wantsAssets = request.granularity === "asset" || request.granularity === "all";
  const wantsSlices = request.granularity === "slice" || request.granularity === "all";
  const wantsKind = (kind: AssetLibrarySection) => request.kinds.includes(kind);

  if (wantsAssets && wantsKind("products")) {
    for (const product of listProductAssets(db, { limit: 200 })) {
      candidates.push(productSearchCandidate(product));
    }
  }

  const wantsVideoAssets = wantsKind("commerce-videos") || wantsKind("quality-videos");
  if (wantsVideoAssets) {
    const videos = listCommerceVideoAssets(db, { limit: 200 });
    for (const video of videos) {
      const quality = isQualityVideoAsset(video);
      if (!quality && wantsKind("commerce-videos")) {
        if (wantsAssets) candidates.push(commerceVideoSearchCandidate("commerce-videos", video));
        if (wantsSlices) {
          for (const slice of listCommerceVideoSlices(db, video.id)) {
            candidates.push(commerceVideoSliceSearchCandidate("commerce-videos", video, slice));
          }
        }
      }
      if (quality && wantsKind("quality-videos")) {
        const qualityVideo = asQualityVideoAsset(video);
        if (wantsAssets) candidates.push(commerceVideoSearchCandidate("quality-videos", qualityVideo));
        if (wantsSlices) {
          for (const slice of listCommerceVideoSlices(db, qualityVideo.id)) {
            candidates.push(commerceVideoSliceSearchCandidate("quality-videos", qualityVideo, slice));
          }
        }
      }
    }
  }

  return candidates;
}

function productSearchCandidate(product: ProductAsset): AssetLibrarySearchCandidate {
  const text = productEmbeddingText(product);
  const subtitle = [product.category, product.subject].filter(Boolean).join(" / ");
  const vector = product.product.embedding?.vector;
  const vectorDimensions = product.product.embedding?.dimensions ?? vector?.length;
  return {
    kind: "products",
    granularity: "asset",
    id: product.id,
    assetId: product.id,
    title: product.title,
    ...(subtitle ? { subtitle } : {}),
    text,
    tags: productSearchTags(product),
    status: product.status,
    ...(vector ? { vector } : {}),
    ...(vectorDimensions ? { vectorDimensions } : {}),
    product
  };
}

function commerceVideoSearchCandidate(
  kind: "commerce-videos" | "quality-videos",
  video: CommerceVideoAsset | QualityVideoAsset
): AssetLibrarySearchCandidate {
  const text =
    kind === "quality-videos"
      ? qualityVideoEmbeddingText(asQualityVideoAsset(video))
      : commerceVideoEmbeddingText(video);
  const subtitle = [video.product.category, video.product.subject, video.sourceConnectorId ?? video.sourceKind]
    .filter(Boolean)
    .join(" / ");
  const vector = video.video.embedding?.vector;
  const vectorDimensions = video.video.embedding?.dimensions ?? vector?.length;
  return {
    kind,
    granularity: "asset",
    id: video.id,
    assetId: video.id,
    title: video.title,
    ...(subtitle ? { subtitle } : {}),
    text,
    tags:
      kind === "quality-videos" ? qualityVideoSearchTags(asQualityVideoAsset(video)) : commerceVideoSearchTags(video),
    status: video.status,
    ...(vector ? { vector } : {}),
    ...(vectorDimensions ? { vectorDimensions } : {}),
    video
  };
}

function commerceVideoSliceSearchCandidate(
  kind: "commerce-videos" | "quality-videos",
  video: CommerceVideoAsset | QualityVideoAsset,
  slice: CommerceVideoSlice
): AssetLibrarySearchCandidate {
  const text = sliceEmbeddingText(video, slice);
  const vector = slice.embedding?.vector;
  const vectorDimensions = slice.embedding?.dimensions ?? vector?.length;
  return {
    kind,
    granularity: "slice",
    id: slice.id,
    assetId: video.id,
    sliceId: slice.id,
    title: video.title,
    subtitle: `${slice.startMs}ms-${slice.endMs}ms`,
    text,
    tags: sliceSearchTags(video, slice),
    status: video.status,
    ...(vector ? { vector } : {}),
    ...(vectorDimensions ? { vectorDimensions } : {}),
    video,
    slice
  };
}

function searchMatchFromCandidate(
  candidate: AssetLibrarySearchCandidate,
  ranked: { score: number; lexicalScore: number; tagScore: number; vectorScore?: number },
  includeVectors: boolean
): AssetLibrarySearchMatch {
  return {
    kind: candidate.kind,
    granularity: candidate.granularity,
    id: candidate.id,
    assetId: candidate.assetId,
    ...(candidate.sliceId ? { sliceId: candidate.sliceId } : {}),
    title: candidate.title,
    ...(candidate.subtitle ? { subtitle: candidate.subtitle } : {}),
    text: truncate(candidate.text, 1600),
    tags: candidate.tags,
    status: candidate.status,
    score: roundSearchScore(ranked.score),
    lexicalScore: roundSearchScore(ranked.lexicalScore),
    tagScore: roundSearchScore(ranked.tagScore),
    ...(ranked.vectorScore === undefined ? {} : { vectorScore: roundSearchScore(ranked.vectorScore) }),
    ...(candidate.vectorDimensions ? { vectorDimensions: candidate.vectorDimensions } : {}),
    ...(candidate.product
      ? { product: includeVectors ? candidate.product : stripProductEmbeddingVectors(candidate.product) }
      : {}),
    ...(candidate.video
      ? {
          video: includeVectors
            ? candidate.video
            : candidate.kind === "quality-videos"
              ? asQualityVideoAsset(stripCommerceVideoEmbeddingVectors(candidate.video))
              : stripCommerceVideoEmbeddingVectors(candidate.video)
        }
      : {}),
    ...(candidate.slice
      ? { slice: includeVectors ? candidate.slice : stripCommerceVideoSliceEmbeddingVectors(candidate.slice) }
      : {})
  };
}

function stripProductEmbeddingVectors(product: ProductAsset): ProductAsset {
  const productData = { ...product.product };
  if (productData.embedding) productData.embedding = stripEmbeddingVector(productData.embedding);
  return {
    ...product,
    product: productData,
    ...(product.metadata ? { metadata: compactAssetMetadata(product.metadata) } : {})
  };
}

function productSearchTags(product: ProductAsset): string[] {
  return uniqueStrings([
    product.title,
    product.subject,
    product.category,
    ...product.product.sellingPoints,
    ...product.product.constraints,
    ...product.product.suggestedAngles
  ]);
}

function commerceVideoSearchTags(video: CommerceVideoAsset): string[] {
  return uniqueStrings([
    video.title,
    video.sourceConnectorId ?? "",
    video.sourceKind,
    video.product.subject ?? "",
    video.product.category ?? "",
    ...video.methodology.hooks,
    ...video.methodology.structure,
    ...video.methodology.sellingTriggers,
    ...video.methodology.styleTags
  ]);
}

function qualityVideoSearchTags(video: QualityVideoAsset): string[] {
  const metadata = recordOrUndefined(video.metadata) ?? {};
  const report = recordOrUndefined((metadata as any).qualityReport) ?? {};
  const source = recordOrUndefined((metadata as any).sourceDeclaration) ?? {};
  return uniqueStrings([
    ...commerceVideoSearchTags(video),
    cleanString(source.sourceName),
    ...stringList(report.hookMethods),
    ...stringList(report.sellingPoints),
    ...stringList(report.storyboard),
    ...stringList(report.styleTags)
  ]);
}

function sliceSearchTags(video: CommerceVideoAsset | QualityVideoAsset, slice: CommerceVideoSlice): string[] {
  return uniqueStrings([
    ...(isQualityVideoAsset(video)
      ? qualityVideoSearchTags(asQualityVideoAsset(video))
      : commerceVideoSearchTags(video)),
    slice.features.scene ?? "",
    slice.features.hook ?? "",
    slice.features.pace ?? "",
    slice.features.sellingPoint ?? "",
    ...slice.features.productMentions,
    ...slice.features.tags
  ]);
}

function normalizeAssetLibrarySearchRequest(request: unknown): NormalizedAssetLibrarySearchRequest {
  const body = recordOrUndefined(request) ?? {};
  const query = cleanSearchString(body.query ?? (body as any).q);
  const tags = searchStringList(body.tags ?? (body as any).tag);
  return {
    query,
    tags,
    kinds: normalizeAssetLibrarySearchKinds(body.kind ?? (body as any).kinds),
    granularity: normalizeAssetLibrarySearchGranularity(body.granularity),
    limit: clampNumber(Number(body.limit), 1, 100, 20),
    includeVectors: truthyFlag(body.includeVectors ?? (body as any)["include-vectors"] ?? (body as any).include_vectors)
  };
}

function searchRequestFromQuery(query: Record<string, unknown>): AssetLibrarySearchRequest {
  return {
    query: cleanSearchString(query.query ?? query.q),
    tags: searchStringList(query.tags ?? query.tag),
    kind: searchStringList(query.kind ?? query.kinds) as AssetLibrarySearchKind[],
    granularity: cleanSearchString(query.granularity) as AssetLibrarySearchGranularity,
    limit: Number(cleanSearchString(query.limit)),
    includeVectors: truthyFlag(query.includeVectors ?? query["include-vectors"] ?? query.include_vectors)
  };
}

function normalizeAssetLibrarySearchKinds(value: unknown): AssetLibrarySection[] {
  const values = searchStringList(value);
  if (values.length === 0 || values.some((item) => item.toLowerCase() === "all")) {
    return [...ASSET_LIBRARY_SEARCH_KINDS];
  }
  const kinds: AssetLibrarySection[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    let kind: AssetLibrarySection | undefined;
    if (normalized === "product" || normalized === "products") kind = "products";
    if (normalized === "commerce" || normalized === "commerce-video" || normalized === "commerce-videos") {
      kind = "commerce-videos";
    }
    if (normalized === "quality" || normalized === "quality-video" || normalized === "quality-videos") {
      kind = "quality-videos";
    }
    if (!kind) {
      throw badAssetLibrarySearchRequest(`unsupported asset search kind: ${value}`);
    }
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds.length ? kinds : [...ASSET_LIBRARY_SEARCH_KINDS];
}

function normalizeAssetLibrarySearchGranularity(value: unknown): AssetLibrarySearchGranularity {
  const normalized = cleanSearchString(value).toLowerCase();
  if (!normalized || normalized === "all") return "all";
  if (normalized === "asset" || normalized === "assets") return "asset";
  if (normalized === "slice" || normalized === "slices") return "slice";
  throw badAssetLibrarySearchRequest(`unsupported asset search granularity: ${normalized}`);
}

function searchStringList(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.flatMap(searchStringList));
  if (typeof value !== "string") return [];
  return uniqueStrings(value.split(/[\n,，、|/]+/u).map((item) => item.trim()));
}

function cleanSearchString(value: unknown): string {
  if (Array.isArray(value)) return cleanSearchString(value[0]);
  return cleanString(value);
}

function roundSearchScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function badAssetLibrarySearchRequest(message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });
}

async function searchProductAssets(input: {
  db: any;
  query: string;
  limit: number;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<ProductAsset[]> {
  const candidates = listProductAssets(input.db, { limit: 200 });
  const queryVector = await queryEmbeddingVector(input.readConfig, input.query);
  return rankAssetLibrarySearchResults(candidates, input.query, {
    limit: input.limit,
    ...(queryVector ? { queryVector } : {}),
    textFor: productEmbeddingText,
    vectorFor: (asset) => asset.product.embedding?.vector
  });
}

async function searchCommerceVideoAssets(input: {
  db: any;
  query: string;
  limit: number;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<CommerceVideoAsset[]> {
  const candidates = listCommerceVideoAssets(input.db, { limit: 200 });
  const queryVector = await queryEmbeddingVector(input.readConfig, input.query);
  return rankAssetLibrarySearchResults(candidates, input.query, {
    limit: input.limit,
    ...(queryVector ? { queryVector } : {}),
    textFor: commerceVideoEmbeddingText,
    vectorFor: (asset) => asset.video.embedding?.vector
  });
}

function listQualityVideoAssets(
  db: any,
  options: { query?: string; category?: string; keyword?: string; limit?: number } = {}
): QualityVideoAsset[] {
  const limit = clampNumber(Number(options.limit), 1, 200, 50);
  const query = [options.query, options.category, options.keyword].map(cleanString).filter(Boolean).join(" ");
  const videos = listCommerceVideoAssets(db, { limit: 200 }).filter(isQualityVideoAsset).map(asQualityVideoAsset);
  const filtered = query ? videos.filter((video) => qualityVideoMatches(video, query)) : videos;
  return filtered.slice(0, limit);
}

async function searchQualityVideoAssets(input: {
  db: any;
  query: string;
  category?: string;
  keyword?: string;
  limit: number;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<QualityVideoAsset[]> {
  const candidates = listQualityVideoAssets(input.db, {
    query: input.query,
    ...(input.category ? { category: input.category } : {}),
    ...(input.keyword ? { keyword: input.keyword } : {}),
    limit: 200
  });
  const queryVector = await queryEmbeddingVector(input.readConfig, input.query);
  return rankAssetLibrarySearchResults(candidates, input.query, {
    limit: input.limit,
    ...(queryVector ? { queryVector } : {}),
    textFor: qualityVideoEmbeddingText,
    vectorFor: (asset) => asset.video.embedding?.vector
  });
}

function selectQualityVideosForBatch(
  db: any,
  request: BatchProcessCommerceVideosRequest | CommerceVideoMethodologySummaryRequest
): QualityVideoAsset[] {
  const selected = selectCommerceVideosForBatch(db, request).filter(isQualityVideoAsset).map(asQualityVideoAsset);
  if (selected.length > 0 || Array.isArray(request.ids)) return selected;
  return listQualityVideoAssets(db, {
    query: cleanString(request.query),
    limit: clampNumber(Number(request.limit), 1, 200, 50)
  });
}

function isQualityVideoAsset(video: CommerceVideoAsset): video is QualityVideoAsset {
  return (video.metadata as any)?.libraryKind === QUALITY_VIDEO_LIBRARY_KIND;
}

function asQualityVideoAsset(video: CommerceVideoAsset): QualityVideoAsset {
  return video as QualityVideoAsset;
}

function qualityVideoMatches(video: QualityVideoAsset, query: string): boolean {
  const metadata = recordOrUndefined(video.metadata) ?? {};
  const report = recordOrUndefined((metadata as any).qualityReport) ?? {};
  const source = recordOrUndefined((metadata as any).sourceDeclaration) ?? {};
  return matchesSearchText(
    [
      video.title,
      video.sourceConnectorId,
      video.sourceUrl,
      video.sourceVideoId,
      video.product.subject,
      video.product.category,
      video.video.summary,
      cleanString(source.sourceName),
      ...stringList(report.hookMethods),
      ...stringList(report.sellingPoints),
      ...stringList(report.storyboard),
      ...stringList(report.styleTags),
      ...video.methodology.hooks,
      ...video.methodology.structure,
      ...video.methodology.sellingTriggers,
      ...video.methodology.styleTags
    ],
    query
  );
}

function matchesSearchText(values: Array<string | undefined>, query: string): boolean {
  const text = values.filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, "");
  return query
    .toLowerCase()
    .split(/[\s,，、/|]+/u)
    .filter(Boolean)
    .some((term) => text.includes(term.replace(/\s+/g, "")));
}

function qualityVideoEmbeddingText(asset: QualityVideoAsset): string {
  const metadata = recordOrUndefined(asset.metadata) ?? {};
  const report = recordOrUndefined((metadata as any).qualityReport) ?? {};
  const source = recordOrUndefined((metadata as any).sourceDeclaration) ?? {};
  return [
    commerceVideoEmbeddingText(asset),
    cleanString(source.sourceName) ? `素材来源：${cleanString(source.sourceName)}` : "",
    stringList(report.hookMethods).length ? `Hook 手法：${stringList(report.hookMethods).join("，")}` : "",
    stringList(report.sellingPoints).length ? `卖点：${stringList(report.sellingPoints).join("，")}` : "",
    stringList(report.storyboard).length ? `分镜：${stringList(report.storyboard).join(" > ")}` : "",
    stringList(report.styleTags).length ? `风格：${stringList(report.styleTags).join("，")}` : "",
    cleanString(report.notes) ? `报告备注：${cleanString(report.notes)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function queryEmbeddingVector(
  readConfig: () => Promise<AssetLibraryStoredConfig>,
  query: string
): Promise<number[] | undefined> {
  const config = withDefaults(await readConfig());
  if (!config.embedding.apiKey?.trim()) return undefined;
  try {
    return (
      await embedAssetSummary(config.embedding, {
        text: `素材库检索：${query}`
      })
    ).vector;
  } catch {
    return undefined;
  }
}

export function buildCommerceVideoMethodologyPrompt(
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
    "5. 按 n:1 聚类输出灵感模板：每个主模板必须包含 strategy（抽象创作方法）和 factors（开场、退场、画面重点、镜头/动作、BGM/口播/字幕、商品证明、CTA、风险控制等具体手段）。",
    "6. 为每个高置信模板生成一个可入库 child skill 草案；通过 /api/skills/import 入库时保持 od.provenance.kind=human-generated，可显式传入 provenance: { kind: 'human-generated', generatedBy: 'human', sourceSkillId: 'commerce-video-methodology-extractor' }。",
    "7. child skill payload 必须保留稳定英文 slug/id 作为 name，但用户可见的 name/description 必须提供中文展示文案：displayName 至少包含 { 'zh-CN': '中文技能名', en: 'English display name' }，descriptionI18n 至少包含 { 'zh-CN': '中文说明', en: 'English description' }；body、triggers 和示例提示优先使用中文。",
    "",
    "输出格式：",
    "- 方法论总览（适用类目、时长、比例、节奏）。",
    "- 聚类结果（每组来源视频 id、slice id、共同结构、差异点、置信度）。",
    "- 灵感模板（strategy + factors + evidence + downstreamContract）。",
    "- 爆款结构模板（按秒级镜头排列，含画面、口播/字幕、商品露出、CTA）。",
    "- 商品/类目差异化建议。",
    "- 可直接给脚本/分镜/生成模块消费的 JSON/YAML 片段。",
    "- 可直接导入 Skills 库的 child skill payload。",
    "- 缺口与下一步解析/向量化建议。",
    "",
    `素材统计：${stats.videoCount} 条视频，${stats.sliceCount} 个切片，${stats.embeddedVideoCount} 条视频已有向量，${stats.embeddedSliceCount} 个切片已有向量。`,
    "",
    "素材库上下文 JSON：",
    JSON.stringify({ stats, sources: compactSources }, null, 2)
  ].join("\n");
}

export function buildQualityVideoMethodologyPrompt(
  sources: Array<{ video: CommerceVideoAsset; slices: CommerceVideoSlice[] }>,
  stats: CommerceVideoMethodologySummaryResponse["stats"]
): string {
  return [
    "你是优质视频库爆款拆解 agent。",
    "请只基于优质视频库中保存的结构化分析、来源声明和用户自有上传视频切片总结方法论。公开视频原片没有保存、复刻或混剪；不要声称看过未上传的原片。",
    "",
    "输出重点：",
    "- 按类目/关键词归纳 Hook 手法、卖点结构、分镜节奏、风格标签和 CTA。",
    "- 区分公开视频元数据推断、人工录入报告、用户自有上传视频逐帧/切片分析。",
    "- 每条结论标注素材来源或数据限制。",
    "- 按 n:1 聚类输出灵感模板，每个模板必须包含 strategy（抽象创作方法）和 factors（开场、退场、画面重点、镜头/动作、BGM/口播/字幕、商品证明、CTA、风险控制等具体手段）。",
    "- 给出可复用脚本/分镜 JSON 片段和下一步需要补齐的自有素材。",
    "- 为高置信模板给出可导入 Skills 库的 child skill payload，并保持 provenance.kind=human-generated。",
    "- child skill payload 必须保留稳定英文 slug/id 作为 name，但用户可见的 name/description 必须提供中文展示文案：displayName 至少包含 { 'zh-CN': '中文技能名', en: 'English display name' }，descriptionI18n 至少包含 { 'zh-CN': '中文说明', en: 'English description' }；body、triggers 和示例提示优先使用中文。",
    "",
    `素材统计：${stats.videoCount} 条优质视频，${stats.sliceCount} 个自有视频切片，${stats.embeddedVideoCount} 条视频已有向量，${stats.embeddedSliceCount} 个切片已有向量。`,
    "",
    "优质视频库上下文 JSON：",
    JSON.stringify({ stats, sources }, null, 2)
  ].join("\n");
}

async function executeQualityVideoSearch(body: SearchQualityVideosRequest, input: { assetRoot: string }) {
  const sourceName = cleanString(body.sourceName) || cleanString(body.connectorId) || "bilibili";
  const connectorId = cleanString(body.connectorId) || sourceName;
  const query =
    cleanString(body.query) || [cleanString(body.category), cleanString(body.keyword)].filter(Boolean).join(" ");
  if (!query) throw Object.assign(new Error("query, category, or keyword is required"), { status: 400 });
  const limit = clampNumber(Number(body.limit), 1, 50, 20);
  const sort = cleanString(body.sort) || "hot";
  const requestedToolName =
    cleanString(body.toolName) ||
    (connectorId === "bilibili" ? "bilibili_search_videos" : `${connectorId}_search_videos`);
  const toolName = requestedToolName.includes(".") ? requestedToolName : `${connectorId}.${requestedToolName}`;
  const connectorInput = {
    ...(recordOrUndefined(body.input) ?? {}),
    query,
    limit,
    sort,
    ...(cleanString(body.category) ? { category: cleanString(body.category) } : {}),
    ...(cleanString(body.keyword) ? { keyword: cleanString(body.keyword) } : {})
  };
  const context = {
    projectsRoot: input.assetRoot,
    projectId: "quality-video-search-workspace",
    purpose: "agent_preview" as const
  };
  const output = await connectorService.execute({ connectorId, toolName, input: connectorInput }, context);
  const connectorOutput =
    output.output && typeof output.output === "object" ? (output.output as Record<string, any>) : {};
  const searchItems = Array.isArray(connectorOutput.items)
    ? connectorOutput.items.filter(isRecordLike).slice(0, limit)
    : [];
  return {
    items: searchItems,
    search: {
      connectorId,
      sourceName,
      toolName,
      provider: connectorOutput.provider ?? sourceName,
      query,
      ...(cleanString(body.category) ? { category: cleanString(body.category) } : {}),
      ...(cleanString(body.keyword) ? { keyword: cleanString(body.keyword) } : {}),
      limit,
      sort,
      count: searchItems.length,
      totalAvailable: connectorOutput.totalAvailable ?? null,
      nextCursor: connectorOutput.nextCursor ?? null,
      limitations: qualityVideoSearchLimitations(sourceName, connectorId)
    }
  };
}

function upsertQualityVideoSearchVideo(input: {
  db: any;
  randomId: () => string;
  connectorId: string;
  sourceName: string;
  query: string;
  sort: string;
  category?: string;
  keyword?: string;
  item: Record<string, unknown>;
}): QualityVideoAsset {
  const title = cleanString(input.item.title) || "Quality video search result";
  const sourceVideoId =
    cleanString(input.item.videoId) ||
    cleanString((input.item as any).bvid) ||
    cleanString((input.item as any).id) ||
    cleanString((input.item as any).shortcode);
  const sourceUrl = cleanString(input.item.url) || cleanString((input.item as any).permalink);
  if (!sourceVideoId && !sourceUrl) {
    throw Object.assign(new Error("quality video search result is missing source url and source video id"), {
      code: "MISSING_QUALITY_VIDEO_SOURCE"
    });
  }
  const author = cleanString(input.item.author) || cleanString((input.item as any).creator);
  const metrics = recordOrUndefined(input.item.metrics) ?? {};
  const description = cleanString(input.item.description) || cleanString((input.item as any).caption);
  const evidence = suspectedCommerceEvidence([title, description].join("\n"));
  const heatScore = heatScoreFromMetrics(metrics);
  const itemReport = recordOrUndefined((input.item as any).report);
  const report = qualityReportFromInput({
    ...(itemReport ? { report: itemReport } : {}),
    summary: description,
    fallback: {
      hookMethods:
        evidence.length > 0 ? evidence.map((item) => `公开标题/简介推断：${item}`) : ["公开元数据待人工复核"],
      sellingPoints: evidence,
      storyboard: ["公开视频原片未保存；分镜需来自公开描述、人工补充或自有上传视频拆解"],
      styleTags: uniqueStrings([
        input.sourceName,
        input.connectorId,
        "public-metadata-only",
        cleanString(input.category),
        cleanString(input.keyword)
      ]),
      notes: "该报告仅基于公开视频公开元数据和可获得互动指标生成。"
    }
  });
  const existing = getCommerceVideoAssetBySource(input.db, {
    sourceConnectorId: input.connectorId,
    ...(sourceVideoId ? { sourceVideoId } : {}),
    ...(sourceUrl ? { sourceUrl } : {})
  });
  const metadata = qualityVideoMetadata({
    sourceName: input.sourceName,
    sourceUrl,
    sourceVideoId,
    publicSource: true,
    declaredBy: "crawler",
    category: cleanString(input.category),
    keyword: cleanString(input.keyword) || input.query,
    report,
    metadata: {
      ...(existing?.metadata ?? {}),
      importedBy: "quality-search",
      source: input.sourceName,
      crawlerQuery: input.query,
      crawlerSort: input.sort,
      collectedAt: Date.now(),
      author,
      authorId: (input.item as any).authorId ?? null,
      coverImage: cleanString(input.item.coverImage) || cleanString((input.item as any).thumbnail),
      publishTime: cleanString(input.item.publishTime),
      metrics,
      heatScore,
      suspectedCommerceEvidence: evidence,
      rawCrawlerItem: input.item
    },
    importedBy: "quality-search"
  });
  const patch = {
    title,
    sourceKind: "crawler" as const,
    sourceConnectorId: input.connectorId,
    sourceUrl,
    sourceVideoId,
    status: "ready" as const,
    product: {
      subject: cleanString(input.keyword) || input.query,
      category: cleanString(input.category) || "优质视频样本"
    },
    video: {
      ...(existing?.video.durationMs ? { durationMs: existing.video.durationMs } : {}),
      ...(existing?.video.embedding ? { embedding: existing.video.embedding } : {}),
      summary: qualitySummaryFromReport(title, report, description),
      understanding: qualityPublicMetadataUnderstanding({
        title,
        sourceName: input.sourceName,
        sourceUrl,
        sourceVideoId,
        report
      })
    },
    methodology: qualityMethodologyFromReport(existing?.methodology, report, input.sourceName),
    metadata
  };
  if (existing) {
    const updated = updateCommerceVideoAsset(input.db, existing.id, patch);
    if (!updated) throw new Error(`failed to update quality video asset ${existing.id}`);
    return asQualityVideoAsset(updated);
  }
  return asQualityVideoAsset(
    insertCommerceVideoAsset(input.db, {
      id: input.randomId(),
      ...patch
    })
  );
}

function qualityReportFromInput(input: {
  report?: Record<string, unknown>;
  methodology?: Record<string, unknown>;
  summary?: string;
  fallback?: {
    hookMethods?: string[];
    sellingPoints?: string[];
    storyboard?: string[];
    styleTags?: string[];
    notes?: string;
  };
}) {
  const report = recordOrUndefined(input.report) ?? {};
  const methodology = recordOrUndefined(input.methodology) ?? {};
  const fallback = input.fallback ?? {};
  return {
    hookMethods: uniqueStrings([
      ...stringList(report.hookMethods),
      ...stringList((report as any).hooks),
      ...stringList(methodology.hooks),
      ...(fallback.hookMethods ?? [])
    ]),
    sellingPoints: uniqueStrings([
      ...stringList(report.sellingPoints),
      ...stringList(methodology.sellingTriggers),
      ...(fallback.sellingPoints ?? [])
    ]),
    storyboard: uniqueStrings([
      ...stringList(report.storyboard),
      ...stringList((report as any).shots),
      ...stringList(methodology.structure),
      ...(fallback.storyboard ?? [])
    ]),
    styleTags: uniqueStrings([
      ...stringList(report.styleTags),
      ...stringList(methodology.styleTags),
      ...(fallback.styleTags ?? [])
    ]),
    ...(cleanString(report.notes) || cleanString(input.summary) || fallback.notes
      ? { notes: cleanString(report.notes) || cleanString(input.summary) || fallback.notes }
      : {})
  };
}

function qualityMethodologyFromReport(
  existing: Record<string, unknown> | undefined,
  report: ReturnType<typeof qualityReportFromInput>,
  sourceName: string
) {
  const current = recordOrUndefined(existing) ?? {};
  return {
    hooks: uniqueStrings([...stringList(current.hooks), ...report.hookMethods]),
    structure: uniqueStrings([...stringList(current.structure), ...report.storyboard]),
    sellingTriggers: uniqueStrings([...stringList(current.sellingTriggers), ...report.sellingPoints]),
    styleTags: uniqueStrings([
      ...stringList(current.styleTags),
      ...report.styleTags,
      "quality-video",
      cleanString(sourceName)
    ])
  };
}

function qualitySummaryFromReport(
  title: string,
  report: ReturnType<typeof qualityReportFromInput>,
  fallback: string
): string {
  if (cleanString(fallback)) return cleanString(fallback);
  const parts = [
    report.hookMethods.length ? `Hook：${report.hookMethods.slice(0, 2).join("，")}` : "",
    report.sellingPoints.length ? `卖点：${report.sellingPoints.slice(0, 2).join("，")}` : "",
    report.storyboard.length ? `分镜：${report.storyboard.slice(0, 2).join(" -> ")}` : ""
  ].filter(Boolean);
  return parts.length > 0 ? `${title}；${parts.join("；")}` : `${title} 的优质视频结构化拆解报告。`;
}

function qualityPublicMetadataUnderstanding(input: {
  title: string;
  sourceName: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  report: ReturnType<typeof qualityReportFromInput>;
}) {
  return {
    providerId: "asset-library",
    model: "public-metadata-quality-report-v1",
    content: [
      `标题：${input.title}`,
      `素材来源：${input.sourceName}`,
      input.sourceUrl ? `来源 URL：${input.sourceUrl}` : "",
      input.sourceVideoId ? `来源视频 ID：${input.sourceVideoId}` : "",
      "合规边界：只保存公开视频的结构化分析结果，不保存、复刻或混剪原视频。",
      `结构化报告：${JSON.stringify(input.report)}`
    ]
      .filter(Boolean)
      .join("\n"),
    createdAt: Date.now()
  };
}

function qualityVideoMetadata(input: {
  sourceName: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  publicSource: boolean;
  declaredBy: "user" | "crawler" | "upload" | "agent";
  category?: string;
  keyword?: string;
  report: ReturnType<typeof qualityReportFromInput>;
  metadata?: Record<string, unknown>;
  importedBy: string;
}): Record<string, unknown> {
  return {
    ...(input.metadata ?? {}),
    importedBy: input.importedBy,
    libraryKind: QUALITY_VIDEO_LIBRARY_KIND,
    sourceDeclaration: {
      sourceName: input.sourceName,
      ...(cleanString(input.sourceUrl) ? { sourceUrl: cleanString(input.sourceUrl) } : {}),
      ...(cleanString(input.sourceVideoId) ? { sourceVideoId: cleanString(input.sourceVideoId) } : {}),
      public: input.publicSource,
      declaredAt: Date.now(),
      declaredBy: input.declaredBy
    },
    ...(cleanString(input.category) ? { category: cleanString(input.category) } : {}),
    ...(cleanString(input.keyword) ? { keyword: cleanString(input.keyword) } : {}),
    qualityReport: input.report,
    dataLimitations: qualityVideoSearchLimitations(input.sourceName, input.sourceName),
    compliance: {
      publicVideoOriginalStored: false,
      originalVideoRemixed: false,
      sourceDeclared: true
    }
  };
}

function qualityVideoSearchLimitations(sourceName: string, connectorId: string): string[] {
  return uniqueStrings([
    ...crawlerSearchLimitations(connectorId),
    "优质视频库只保存公开视频的结构化分析结果和来源声明。",
    "不保存、复刻、混剪或再分发公开视频原片。",
    "公开视频报告若未上传自有视频，只基于公开标题、简介、封面和可获得互动指标；镜头级结论需人工复核或上传自有视频拆解。",
    `作业素材来源声明：${sourceName || connectorId || "unknown"}`
  ]);
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
    status: "processing",
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
    status: "processing",
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

type ProductFolderImage = {
  path: string;
  relativePath: string;
  fileName: string;
  mime: string;
  size: number;
};

type ProductUploadFile = {
  path?: string;
  originalname?: string;
  filename?: string;
  mimetype?: string;
  size?: number;
};

type ProductVision = Record<string, unknown> & {
  subject?: string;
  category?: string;
  productType?: string;
  color?: string;
  pattern?: string;
  material?: string;
  shape?: string;
  summary?: string;
  sellingPoints?: unknown;
  constraints?: unknown;
  suggestedAngles?: unknown;
};

type ProductImageWorkResult = ProductImageFolderIngestImageResult & {
  image: ProductFolderImage;
  clusterKey: string;
  sellingPoints: string[];
  constraints: string[];
  suggestedAngles: string[];
  summary?: string;
};

async function runProductImageUploadIngestion(input: {
  db: any;
  jobId: string;
  files: ProductUploadFile[];
  relativePaths: string[];
  assetRoot: string;
  projectRoot: string;
  randomId: () => string;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<void> {
  updateAssetLibraryJob(input.db, input.jobId, { status: "running", startedAt: Date.now() });
  const append = (line: string) => {
    appendAssetLibraryJobProgress(input.db, input.jobId, line);
    wakeJob(input.jobId);
  };
  try {
    const inventory = productUploadInventory(input.files, input.relativePaths);
    append(`received ${input.files.length} upload item${input.files.length === 1 ? "" : "s"}`);
    append(`scanned ${inventory.images.length} supported image${inventory.images.length === 1 ? "" : "s"}`);
    if (inventory.skipped.length > 0) {
      append(`skipped ${inventory.skipped.length} unsupported item${inventory.skipped.length === 1 ? "" : "s"}`);
    }
    if (inventory.images.length === 0) {
      throw Object.assign(new Error("no supported product images found"), { code: "NO_SUPPORTED_IMAGES" });
    }

    const prompt = productImageUnderstandingPrompt();
    const proxyDispatcher = proxyDispatcherRequestInit(process.env);
    let workResults: ProductImageWorkResult[];
    try {
      workResults = await mapWithConcurrency(inventory.images, 3, async (image, index) => {
        const label = `[${index + 1}/${inventory.images.length}]`;
        append(`${label} understanding ${image.relativePath}`);
        const result = await understandProductFolderImage({
          projectRoot: input.projectRoot,
          image,
          prompt,
          requestInit: proxyDispatcher.requestInit
        });
        if (result.error) append(`${label} understanding failed: ${result.error}`);
        else append(`${label} understood ${result.category || result.title || image.fileName}`);
        return result;
      });
    } finally {
      await proxyDispatcher.close();
    }

    const clusters = clusterProductImageResults(workResults);
    append(`clustered into ${clusters.length} product group${clusters.length === 1 ? "" : "s"}`);

    const config = withDefaults(await input.readConfig());
    const hasEmbeddingConfig = Boolean(config.embedding.apiKey?.trim());
    let importedCount = 0;
    let successfulImports = 0;
    let failedCount = 0;
    for (const cluster of clusters) {
      for (const result of cluster.images) {
        importedCount += 1;
        const label = `[${importedCount}/${inventory.images.length}]`;
        try {
          const imported = await importProductImageFile({
            db: input.db,
            assetRoot: input.assetRoot,
            randomId: input.randomId,
            tempPath: result.path,
            originalName: result.fileName,
            mime: result.image.mime,
            title: result.title || `${cluster.category}#${importedCount}`,
            subject: result.subject || cluster.subject,
            category: cluster.category,
            sellingPoints: result.sellingPoints,
            constraints: result.constraints,
            suggestedAngles: result.suggestedAngles,
            ...(result.summary ? { summary: result.summary } : {}),
            metadata: {
              importedBy: "browser-upload-ingest",
              relativePath: result.relativePath,
              clusterId: cluster.id,
              vision: result.vision,
              visionText: result.visionText
            }
          });
          result.productId = imported.id;
          result.title = imported.title;
          result.category = cluster.category;
          result.subject = imported.subject;
          successfulImports += 1;
          append(`${label} imported ${imported.title}`);

          const productForProcessing = productWithAnalysis(imported, result);
          if (!hasEmbeddingConfig) {
            updateProductAsset(
              input.db,
              imported.id,
              productAnalysisPatch(productForProcessing, "needs_embedding_config")
            );
            append(`${label} vectorization skipped: configure vectorization provider`);
            continue;
          }

          try {
            append(`${label} vectorizing ${imported.title}`);
            const embedding = await embedAssetSummary(config.embedding, {
              text: productEmbeddingText(productForProcessing),
              ...productFirstImagePath(input.assetRoot, imported)
            });
            updateProductAsset(input.db, imported.id, productAnalysisPatch(productForProcessing, "ready", embedding));
            append(`${label} vectorization complete`);
          } catch (error) {
            failedCount += 1;
            const message = errorMessage(error);
            result.error = result.error ? `${result.error}; ${message}` : message;
            updateProductAsset(input.db, imported.id, productAnalysisPatch(productForProcessing, "failed"));
            append(`${label} vectorization failed: ${message}`);
          }
        } catch (error) {
          failedCount += 1;
          result.error = errorMessage(error);
          append(`${label} import failed: ${result.error}`);
        }
      }
    }

    const finalLine = `AI product analysis complete: ${successfulImports}/${inventory.images.length} imported, ${failedCount} failed, ${inventory.skipped.length} skipped`;
    updateAssetLibraryJob(input.db, input.jobId, {
      status: successfulImports === 0 ? "failed" : "done",
      endedAt: Date.now(),
      ...(successfulImports === 0 ? { error: { message: "no uploaded product image was imported successfully" } } : {}),
      progress: [...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []), finalLine]
    });
  } catch (error: any) {
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "failed",
      endedAt: Date.now(),
      error: { message: errorMessage(error), code: error?.code }
    });
  } finally {
    await Promise.allSettled(input.files.map((file) => (file.path ? rm(file.path, { force: true }) : undefined)));
    wakeJob(input.jobId);
  }
}

async function ingestProductImageFolder(input: {
  db: any;
  assetRoot: string;
  projectRoot: string;
  randomId: () => string;
  request: ProductImageFolderIngestRequest;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<ProductImageFolderIngestResponse> {
  const rootPath = cleanString(input.request.path);
  if (!rootPath) {
    throw Object.assign(new Error("path is required"), { status: 400, code: "BAD_REQUEST" });
  }
  const rootInfo = await stat(rootPath).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    throw Object.assign(new Error("path must be an existing directory"), { status: 400, code: "BAD_REQUEST" });
  }

  const recursive = input.request.recursive !== false;
  const dryRun = input.request.dryRun === true;
  const mode = input.request.mode === "serial" ? "serial" : "parallel";
  const concurrency = mode === "serial" ? 1 : clampNumber(Number(input.request.concurrency), 1, 8, 3);
  const limit = Number.isFinite(Number(input.request.limit))
    ? clampNumber(Number(input.request.limit), 1, 10_000, 10_000)
    : undefined;
  const inventory = await scanProductImageFolder(rootPath, { recursive });
  const images = typeof limit === "number" ? inventory.images.slice(0, limit) : inventory.images;
  const prompt = cleanString(input.request.prompt) || productImageUnderstandingPrompt();
  const processImported = input.request.processImported !== false;

  const proxyDispatcher = proxyDispatcherRequestInit(process.env);
  let workResults: ProductImageWorkResult[];
  try {
    workResults = await mapWithConcurrency(images, concurrency, async (image) =>
      understandProductFolderImage({
        projectRoot: input.projectRoot,
        image,
        prompt,
        providerId: cleanString(input.request.providerId),
        model: cleanString(input.request.model),
        requestInit: proxyDispatcher.requestInit
      })
    );
  } finally {
    await proxyDispatcher.close();
  }

  const clustered = clusterProductImageResults(workResults);
  if (!dryRun) {
    let importedIndex = 0;
    for (const cluster of clustered) {
      for (const result of cluster.images) {
        importedIndex += 1;
        const imported = await importProductImageFile({
          db: input.db,
          assetRoot: input.assetRoot,
          randomId: input.randomId,
          tempPath: result.path,
          originalName: result.fileName,
          mime: result.image.mime,
          title: result.title || `${cluster.category}#${importedIndex}`,
          subject: result.subject || cluster.subject,
          category: cluster.category,
          sellingPoints: result.sellingPoints,
          constraints: result.constraints,
          suggestedAngles: result.suggestedAngles,
          ...(result.summary ? { summary: result.summary } : {}),
          metadata: {
            importedBy: "folder-ingest",
            sourcePath: result.path,
            relativePath: result.relativePath,
            clusterId: cluster.id,
            vision: result.vision,
            visionText: result.visionText
          },
          copyInsteadOfMove: true
        });
        result.productId = imported.id;
        result.title = imported.title;
        result.category = cluster.category;
        result.subject = imported.subject;
        if (processImported) {
          updateProductAsset(input.db, imported.id, { status: "processing" });
          const job = insertAssetLibraryJob(input.db, {
            id: input.randomId(),
            assetKind: "products",
            assetId: imported.id,
            kind: "process",
            progress: ["queued product image processing"]
          });
          result.processJobId = job.id;
          void runProductProcessing({
            db: input.db,
            jobId: job.id,
            productId: imported.id,
            assetRoot: input.assetRoot,
            readConfig: input.readConfig
          }).catch(() => undefined);
        }
      }
    }
  }

  const failed = workResults.filter((result) => result.error).map(stripInternalProductImageResult);
  const clusters = clustered.map((cluster) => ({
    id: cluster.id,
    category: cluster.category,
    subject: cluster.subject,
    images: cluster.images.map(stripInternalProductImageResult)
  }));
  const imported = clusters.flatMap((cluster) =>
    cluster.images.filter((image) => (dryRun ? !image.error : Boolean(image.productId)))
  );
  return {
    ok: failed.length === 0,
    dryRun,
    rootPath: path.resolve(rootPath),
    recursive,
    mode,
    concurrency,
    scanned: {
      imageCount: images.length,
      skippedCount: inventory.skipped.length
    },
    clusters,
    imported,
    failed,
    skipped: inventory.skipped
  };
}

async function scanProductImageFolder(
  rootPath: string,
  options: { recursive: boolean }
): Promise<{ images: ProductFolderImage[]; skipped: ProductImageFolderIngestSkippedFile[] }> {
  const root = path.resolve(rootPath);
  const images: ProductFolderImage[] = [];
  const skipped: ProductImageFolderIngestSkippedFile[] = [];

  async function visit(dir: string) {
    let entries: Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error: any) {
      skipped.push({
        path: dir,
        relativePath: relativeFromRoot(root, dir),
        reason: "read_error",
        error: errorMessage(error)
      });
      return;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relativePath = relativeFromRoot(root, abs);
      if (entry.isDirectory()) {
        if (options.recursive) await visit(abs);
        else skipped.push({ path: abs, relativePath, reason: "directory" });
        continue;
      }
      if (!entry.isFile()) {
        skipped.push({ path: abs, relativePath, reason: "unsupported" });
        continue;
      }
      const mime = mimeFor(abs);
      if (isSupportedProductImage(entry.name, mime)) {
        const info = await stat(abs).catch(() => null);
        if (!info?.isFile()) {
          skipped.push({ path: abs, relativePath, reason: "read_error", mime });
          continue;
        }
        images.push({ path: abs, relativePath, fileName: entry.name, mime, size: info.size });
      } else {
        skipped.push({
          path: abs,
          relativePath,
          mime,
          reason: isVideoFile(entry.name, mime) ? "video" : "unsupported"
        });
      }
    }
  }

  await visit(root);
  images.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  skipped.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  return { images, skipped };
}

function productUploadInventory(
  files: ProductUploadFile[],
  relativePaths: string[]
): { images: ProductFolderImage[]; skipped: ProductImageFolderIngestSkippedFile[] } {
  const images: ProductFolderImage[] = [];
  const skipped: ProductImageFolderIngestSkippedFile[] = [];
  files.forEach((file, index) => {
    const originalName = decodedUploadName(file);
    const relativePath = normalizeUploadRelativePath(relativePaths[index], originalName || `upload-${index + 1}`);
    const fileName = uploadPathLeaf(relativePath) || uploadPathLeaf(originalName) || `upload-${index + 1}`;
    const mime = file.mimetype || mimeFor(fileName);
    if (file.path && isSupportedProductImage(fileName, mime)) {
      images.push({
        path: file.path,
        relativePath,
        fileName,
        mime,
        size: Number(file.size) || 0
      });
      return;
    }
    skipped.push({
      path: file.path || originalName || relativePath,
      relativePath,
      reason: isVideoFile(fileName, mime) ? "video" : "unsupported",
      mime
    });
  });
  images.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  skipped.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  return { images, skipped };
}

function parseUploadRelativePaths(value: unknown): string[] {
  const raw = cleanString(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(cleanString) : [];
  } catch {
    return [];
  }
}

function normalizeUploadRelativePath(value: string | undefined, fallback: string): string {
  const clean = cleanString(value || fallback)
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return clean || sanitizeName(fallback || "upload");
}

function uploadPathLeaf(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? value) : value;
}

function productWithAnalysis(product: ProductAsset, result: ProductImageWorkResult): ProductAsset {
  const summary = result.summary || product.product.summary;
  return {
    ...product,
    subject: result.subject || product.subject,
    category: result.category || product.category,
    product: {
      sellingPoints: result.sellingPoints.length ? result.sellingPoints : product.product.sellingPoints,
      constraints: result.constraints.length ? result.constraints : product.product.constraints,
      suggestedAngles: result.suggestedAngles.length ? result.suggestedAngles : product.product.suggestedAngles,
      ...(summary ? { summary } : {}),
      ...(product.product.embedding ? { embedding: product.product.embedding } : {})
    }
  };
}

function productAnalysisPatch(
  product: ProductAsset,
  status: "ready" | "needs_embedding_config" | "failed",
  embedding?: ProductAsset["product"]["embedding"]
) {
  const sellingPoints =
    product.product.sellingPoints.length > 0
      ? product.product.sellingPoints
      : [`突出 ${product.subject || product.title} 的核心卖点`];
  const suggestedAngles =
    product.product.suggestedAngles.length > 0
      ? product.product.suggestedAngles
      : ["开场先给使用场景", "中段展示细节和对比", "结尾给购买理由"];
  return {
    status,
    subject: product.subject,
    category: product.category,
    product: {
      sellingPoints,
      constraints: product.product.constraints,
      suggestedAngles,
      summary: product.product.summary || `${product.category || "商品"}：${product.subject || product.title}`,
      ...(embedding ? { embedding } : {})
    }
  };
}

async function understandProductFolderImage(input: {
  projectRoot: string;
  image: ProductFolderImage;
  prompt: string;
  providerId?: string;
  model?: string;
  requestInit?: Pick<RequestInit, "dispatcher">;
}): Promise<ProductImageWorkResult> {
  try {
    const bytes = await readFile(input.image.path);
    const result = await understandMedia({
      projectRoot: input.projectRoot,
      kind: "image",
      mediaUrl: `data:${input.image.mime};base64,${bytes.toString("base64")}`,
      prompt: input.prompt,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.requestInit ? { requestInit: input.requestInit } : {})
    });
    const vision = normalizeProductVision(parseJsonObjectFromText(result.content), result.content, input.image);
    const category = cleanString(vision.category) || inferVisualCategory(vision, input.image);
    const subject = cleanString(vision.subject) || cleanString(vision.productType) || inferSubject(category);
    const clusterKey = productVisionClusterKey(vision, category);
    return {
      path: input.image.path,
      relativePath: input.image.relativePath,
      fileName: input.image.fileName,
      title: category,
      subject,
      category,
      clusterKey,
      vision,
      visionText: result.content,
      sellingPoints: stringList(vision.sellingPoints),
      constraints: stringList(vision.constraints),
      suggestedAngles: stringList(vision.suggestedAngles),
      ...(cleanString(vision.summary) ? { summary: cleanString(vision.summary) } : {}),
      image: input.image
    };
  } catch (error: any) {
    const fallbackCategory = inferSubject(input.image.fileName);
    return {
      path: input.image.path,
      relativePath: input.image.relativePath,
      fileName: input.image.fileName,
      title: fallbackCategory,
      subject: fallbackCategory,
      category: fallbackCategory,
      clusterKey: `error:${stableKey(fallbackCategory)}`,
      vision: {},
      visionText: "",
      sellingPoints: [],
      constraints: [],
      suggestedAngles: [],
      error: errorMessage(error),
      image: input.image
    };
  }
}

function clusterProductImageResults(results: ProductImageWorkResult[]): Array<{
  id: string;
  category: string;
  subject: string;
  images: ProductImageWorkResult[];
}> {
  const clusters = new Map<
    string,
    { id: string; category: string; subject: string; images: ProductImageWorkResult[] }
  >();
  for (const result of results) {
    const key = result.clusterKey;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        id: `cluster-${String(clusters.size + 1).padStart(2, "0")}`,
        category: result.category || result.title || inferSubject(result.fileName),
        subject: result.subject || inferSubject(result.category || result.fileName),
        images: []
      };
      clusters.set(key, cluster);
    }
    result.clusterId = cluster.id;
    result.category = cluster.category;
    result.subject = result.subject || cluster.subject;
    cluster.images.push(result);
  }
  return Array.from(clusters.values());
}

function stripInternalProductImageResult(result: ProductImageWorkResult): ProductImageFolderIngestImageResult {
  const {
    image: _image,
    clusterKey: _clusterKey,
    sellingPoints: _sellingPoints,
    constraints: _constraints,
    suggestedAngles: _suggestedAngles,
    summary: _summary,
    ...clean
  } = result;
  return clean;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
  return results;
}

function productImageUnderstandingPrompt(): string {
  return [
    "请理解这张商品图片。只输出一个 JSON 对象，不要 markdown，不要解释。",
    "字段：subject, category, productType, color, pattern, material, shape, details, sellingPoints, constraints, suggestedAngles, summary。",
    "category 必须是可直接作为商品素材库分类的中文类名，包含品类 + 主要颜色/花纹 + 关键款式，例如“白色衬衫裙”“浅蓝牛仔半身裙”。",
    "同一个可见商品不同角度应给出相同 category；同款但颜色或花纹明显不同，应给出相邻但不同的 category。",
    "只描述图片可见事实；不确定的内容放进 constraints。"
  ].join("\n");
}

function normalizeProductVision(
  parsed: Record<string, unknown> | null,
  content: string,
  image: ProductFolderImage
): ProductVision {
  const fallback = inferSubject(image.fileName);
  const vision = parsed ?? {};
  return {
    ...vision,
    subject: cleanString(vision.subject) || cleanString(vision.productType) || fallback,
    category: cleanString(vision.category) || fallback,
    summary: cleanString(vision.summary) || truncate(content, 180)
  };
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim()
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      return recordOrUndefined(JSON.parse(candidate)) ?? null;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

interface CommerceVideoUnderstandingData {
  summary?: string;
  product?: Record<string, unknown>;
  methodology?: Record<string, unknown>;
  slices?: Array<Record<string, unknown>>;
}

async function understandCommerceVideoFile(input: {
  projectRoot: string;
  fileAbs: string;
  ffmpegPath: string;
  mime: string;
  asset: CommerceVideoAsset;
  durationMs: number;
}): Promise<{
  providerId: string;
  model: string;
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  data: CommerceVideoUnderstandingData;
}> {
  const media = await prepareCommerceVideoUnderstandingMedia({
    fileAbs: input.fileAbs,
    ffmpegPath: input.ffmpegPath,
    mime: input.mime
  });
  const bytes = await readFile(media.fileAbs);
  const proxyDispatcher = proxyDispatcherRequestInit(process.env);
  try {
    const result = await understandMedia({
      projectRoot: input.projectRoot,
      kind: "video",
      mediaUrl: `data:${media.mime};base64,${bytes.toString("base64")}`,
      prompt: commerceVideoUnderstandingPrompt(input.asset, input.durationMs, media.sampled),
      fps: 2,
      mediaResolution: "default",
      requestInit: proxyDispatcher.requestInit
    });
    return {
      providerId: result.providerId,
      model: result.model,
      content: result.content,
      ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      data: normalizeCommerceVideoUnderstanding(parseJsonObjectFromText(result.content), result.content)
    };
  } finally {
    await proxyDispatcher.close();
  }
}

async function prepareCommerceVideoUnderstandingMedia(input: {
  fileAbs: string;
  ffmpegPath: string;
  mime: string;
}): Promise<{ fileAbs: string; mime: string; sampled: boolean }> {
  const info = await stat(input.fileAbs);
  if (info.size <= COMMERCE_VIDEO_UNDERSTANDING_MAX_BYTES) {
    return { fileAbs: input.fileAbs, mime: input.mime, sampled: false };
  }

  const dir = path.dirname(input.fileAbs);
  const previewAbs = path.join(dir, "understanding-preview.mp4");
  await createCommerceVideoUnderstandingPreview({
    ffmpegPath: input.ffmpegPath,
    sourceAbs: input.fileAbs,
    outputAbs: previewAbs,
    seconds: COMMERCE_VIDEO_UNDERSTANDING_PREVIEW_SECONDS,
    crf: "34"
  });
  const previewInfo = await stat(previewAbs).catch(() => null);
  if (previewInfo?.isFile() && previewInfo.size > 0 && previewInfo.size <= COMMERCE_VIDEO_UNDERSTANDING_MAX_BYTES) {
    return { fileAbs: previewAbs, mime: "video/mp4", sampled: true };
  }

  const compactAbs = path.join(dir, "understanding-preview-compact.mp4");
  await createCommerceVideoUnderstandingPreview({
    ffmpegPath: input.ffmpegPath,
    sourceAbs: input.fileAbs,
    outputAbs: compactAbs,
    seconds: COMMERCE_VIDEO_UNDERSTANDING_COMPACT_SECONDS,
    crf: "38"
  });
  const compactInfo = await stat(compactAbs).catch(() => null);
  if (compactInfo?.isFile() && compactInfo.size > 0 && compactInfo.size <= COMMERCE_VIDEO_UNDERSTANDING_MAX_BYTES) {
    return { fileAbs: compactAbs, mime: "video/mp4", sampled: true };
  }

  throw Object.assign(new Error("commerce video understanding sample is too large after compression"), {
    code: "MEDIA_UNDERSTANDING_INPUT_TOO_LARGE"
  });
}

async function createCommerceVideoUnderstandingPreview(input: {
  ffmpegPath: string;
  sourceAbs: string;
  outputAbs: string;
  seconds: number;
  crf: string;
}): Promise<void> {
  await execFileAsync(
    input.ffmpegPath,
    [
      "-y",
      "-i",
      input.sourceAbs,
      "-t",
      String(input.seconds),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "scale=720:-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      input.crf,
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      input.outputAbs
    ],
    { timeout: 120_000, windowsHide: true }
  );
}

function commerceVideoUnderstandingPrompt(asset: CommerceVideoAsset, durationMs: number, sampled: boolean): string {
  return [
    "请原生理解这条带货/种草/短视频素材。只输出一个 JSON 对象，不要 markdown，不要解释。",
    `标题：${asset.title}`,
    asset.sourceUrl ? `来源 URL：${asset.sourceUrl}` : "",
    asset.sourceVideoId ? `来源视频 ID：${asset.sourceVideoId}` : "",
    `视频时长约：${Math.round(durationMs / 1000)} 秒`,
    sampled ? "当前上传的是源视频的压缩预览样本；只基于样本中真实可见/可听内容判断，不要补写未出现片段。" : "",
    "",
    "字段要求：",
    "summary: 一句话概述真实视频内容。",
    "product: { subject, category }，subject 是主推商品或商品族，category 是中文类目。",
    "methodology: { hooks, structure, sellingTriggers, styleTags }，每个字段都是字符串数组。",
    "slices: 按时间顺序输出数组，每项可包含 scene, visualActions, spokenText, onScreenText, productMentions, hook, transition, pace, sellingPoint, tags。",
    "只写视频中能看见或听见的信息；无法确认的内容不要编造，可放入 styleTags 或 summary 的限制说明。"
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeCommerceVideoUnderstanding(
  parsed: Record<string, unknown> | null,
  content: string
): CommerceVideoUnderstandingData {
  const data = parsed ?? {};
  const product = recordOrUndefined(data.product) ?? {};
  const methodology = recordOrUndefined(data.methodology) ?? {};
  return {
    summary: cleanString(data.summary) || truncate(content, 400),
    product: {
      ...(cleanString(product.subject) ? { subject: cleanString(product.subject) } : {}),
      ...(cleanString(product.category) ? { category: cleanString(product.category) } : {})
    },
    methodology: {
      hooks: stringList(methodology.hooks),
      structure: stringList(methodology.structure),
      sellingTriggers: stringList(methodology.sellingTriggers),
      styleTags: stringList(methodology.styleTags)
    },
    slices: Array.isArray(data.slices)
      ? data.slices.map((slice) => recordOrUndefined(slice) ?? {}).filter((slice) => Object.keys(slice).length > 0)
      : []
  };
}

function sliceFeaturesFromUnderstanding(
  data: CommerceVideoUnderstandingData,
  slices: CommerceVideoSlice[]
): Array<Record<string, unknown>> {
  const understoodSlices = Array.isArray(data.slices) ? data.slices : [];
  return slices.map((_slice, index) => commerceVideoSliceFeaturePatch(understoodSlices[index] ?? {}));
}

function commerceVideoSliceFeaturePatch(raw: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["scene", "hook", "transition", "pace", "sellingPoint"] as const) {
    const value = cleanString(raw[key]);
    if (value) patch[key] = value;
  }
  for (const key of ["visualActions", "spokenText", "onScreenText", "productMentions", "tags"] as const) {
    const values = stringList(raw[key]);
    if (values.length > 0) patch[key] = values;
  }
  return patch;
}

function inferVisualCategory(vision: ProductVision, image: ProductFolderImage): string {
  const parts = [
    cleanString(vision.color),
    cleanString(vision.pattern),
    cleanString(vision.material),
    cleanString(vision.shape),
    cleanString(vision.productType) || cleanString(vision.subject)
  ].filter(Boolean);
  return parts.length > 0 ? Array.from(new Set(parts)).join("") : inferSubject(image.fileName);
}

function productVisionClusterKey(vision: ProductVision, category: string): string {
  return [
    cleanString(vision.productType) || cleanString(vision.subject) || category,
    cleanString(vision.color),
    cleanString(vision.pattern),
    cleanString(vision.material),
    cleanString(vision.shape)
  ]
    .map(stableKey)
    .filter(Boolean)
    .join("|");
}

function stableKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function relativeFromRoot(root: string, target: string): string {
  const relative = path.relative(root, target).split(path.sep).join("/");
  return relative || ".";
}

function isVideoFile(name: string, mime: string | undefined): boolean {
  const normalizedMime = (mime || "").toLowerCase();
  return normalizedMime.startsWith("video/") || /\.(mp4|mov|m4v|avi|mkv|webm)$/iu.test(name);
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
    status: "processing",
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
  if (!sourceVideoId && !sourceUrl) {
    throw Object.assign(new Error("crawler search result is missing source url and source video id"), {
      code: "MISSING_COMMERCE_VIDEO_SOURCE"
    });
  }
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
  const existingSlices = existing ? listCommerceVideoSlices(input.db, existing.id) : [];
  const patch = {
    title,
    sourceKind: "crawler" as const,
    sourceConnectorId: input.connectorId,
    sourceUrl,
    sourceVideoId,
    status: existing ? commerceVideoReadyStatus(existing, existingSlices) : ("needs_video_file" as const),
    product: {
      subject: input.query,
      category: "带货视频样本"
    },
    video: {
      ...(existing?.video.durationMs ? { durationMs: existing.video.durationMs } : {}),
      ...(existing?.video.understanding ? { understanding: existing.video.understanding } : {}),
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
  projectRoot: string;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
}): Promise<void> {
  updateAssetLibraryJob(input.db, input.jobId, { status: "running", startedAt: Date.now() });
  const progress = (line: string) => appendAssetLibraryJobProgress(input.db, input.jobId, line);
  try {
    await processCommerceVideoAssetCore({ ...input, onProgress: progress });
    const embedded = await embedCommerceVideoAssetCore({ ...input, includeSlices: true, onProgress: progress });
    if (embedded.skipped) {
      throw Object.assign(new Error("vectorization provider is not configured"), { code: "NEEDS_EMBEDDING_CONFIG" });
    }
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "done",
      endedAt: Date.now(),
      progress: [...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []), "commerce video processing complete"]
    });
  } catch (error: any) {
    updateCommerceVideoAsset(input.db, input.assetId, {
      status: commerceVideoStatusForProcessingError(error)
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
  projectRoot: string;
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
        projectRoot: input.projectRoot,
        readConfig: input.readConfig,
        onProgress: (line) => append(`${label} ${line}`)
      });
      if (input.includeEmbeddings) {
        const embedded = await embedCommerceVideoAssetCore({
          db: input.db,
          assetId,
          assetRoot: input.assetRoot,
          includeSlices: true,
          readConfig: input.readConfig,
          onProgress: (line) => append(`${label} ${line}`)
        });
        if (embedded.skipped) {
          throw Object.assign(new Error("vectorization provider is not configured"), {
            code: "NEEDS_EMBEDDING_CONFIG"
          });
        }
      }
      append(`${label} done: ${processed.slices.length} slices`);
      results.push({ id: assetId, ok: true });
    } catch (error: any) {
      const code = commerceVideoStatusForProcessingError(error);
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
  projectRoot: string;
  readConfig: () => Promise<AssetLibraryStoredConfig>;
  onProgress: (line: string) => void;
}): Promise<{ asset: CommerceVideoAsset; slices: CommerceVideoSlice[]; durationMs: number }> {
  let asset = getCommerceVideoAsset(input.db, input.assetId);
  if (!asset) throw new Error("commerce video asset not found");
  if (!hasCommerceVideoSourceData(asset)) {
    throw Object.assign(new Error("commerce video source data is required"), { code: "MISSING_COMMERCE_VIDEO_SOURCE" });
  }
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
  const fileAbs = safeAssetPath(input.assetRoot, asset.file.path);
  await assertProcessableCommerceVideoFile(fileAbs);
  const config = withDefaults(await input.readConfig());
  const toolResult = await testToolConfig(config.tools);
  if (!toolResult.ok || !toolResult.ffmpeg?.ok || !toolResult.ffprobe?.ok) {
    throw Object.assign(new Error(summarizeToolErrors(toolResult)), { code: "FFMPEG_NOT_CONFIGURED" });
  }
  const ffmpegPath = toolResult.ffmpeg.path;
  const ffprobePath = toolResult.ffprobe.path;
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

  input.onProgress("understanding commerce video");
  const understanding = await understandCommerceVideoFile({
    projectRoot: input.projectRoot,
    fileAbs,
    ffmpegPath,
    mime: mediaUnderstandingVideoMime(asset.file.mime, fileAbs),
    asset,
    durationMs
  });
  input.onProgress("video understanding complete");
  const slicePatches = sliceFeaturesFromUnderstanding(understanding.data, storedSlices);
  const understoodSlices = replaceCommerceVideoSlices(
    input.db,
    asset.id,
    storedSlices.map((slice, index) => ({
      id: slice.id,
      startMs: slice.startMs,
      endMs: slice.endMs,
      filePath: slice.file?.path ?? null,
      thumbnailPath: slice.thumbnail?.path ?? null,
      features: {
        ...slice.features,
        ...(slicePatches[index] ?? {})
      }
    }))
  );

  const updated = updateCommerceVideoAsset(input.db, asset.id, {
    status: "needs_embedding_config",
    product: {
      subject: cleanString(understanding.data.product?.subject) || asset.product.subject || inferSubject(asset.title),
      category: cleanString(understanding.data.product?.category) || asset.product.category || "带货商品"
    },
    video: {
      durationMs,
      summary: cleanString(understanding.data.summary) || truncate(understanding.content, 400),
      understanding: {
        providerId: understanding.providerId,
        model: understanding.model,
        content: understanding.content,
        ...(understanding.finishReason ? { finishReason: understanding.finishReason } : {}),
        ...(understanding.usage ? { usage: understanding.usage } : {}),
        createdAt: Date.now()
      }
    },
    methodology: {
      hooks: stringList(understanding.data.methodology?.hooks),
      structure: stringList(understanding.data.methodology?.structure),
      sellingTriggers: stringList(understanding.data.methodology?.sellingTriggers),
      styleTags: uniqueStrings([
        "commerce-video",
        "media-understood",
        ...stringList(understanding.data.methodology?.styleTags)
      ])
    }
  });
  return { asset: updated ?? asset, slices: understoodSlices, durationMs };
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
    const embedded = await embedCommerceVideoAssetCore({ ...input, onProgress: progress });
    if (embedded.skipped) {
      throw Object.assign(new Error("vectorization provider is not configured"), { code: "NEEDS_EMBEDDING_CONFIG" });
    }
    updateAssetLibraryJob(input.db, input.jobId, {
      status: "done",
      endedAt: Date.now(),
      progress: [...(getAssetLibraryJob(input.db, input.jobId)?.progress ?? []), "commerce video embedding complete"]
    });
  } catch (error: any) {
    updateCommerceVideoAsset(input.db, input.assetId, { status: commerceVideoStatusForProcessingError(error) });
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
  const assetWithEmbedding =
    updateCommerceVideoAsset(input.db, asset.id, {
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
  const finalSlices = listCommerceVideoSlices(input.db, asset.id);
  const finalAsset =
    updateCommerceVideoAsset(input.db, asset.id, {
      status: commerceVideoReadyStatus(assetWithEmbedding, finalSlices)
    }) ?? assetWithEmbedding;
  return { asset: finalAsset, slices: finalSlices, embeddedSlices, skipped: false };
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

async function assertProcessableCommerceVideoFile(filePath: string): Promise<void> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size < 128) {
    throw needsVideoFileError("commerce video file is missing or too small to process");
  }
}

async function embedAssetSummary(config: EmbeddingProviderConfig, input: { text: string; imagePath?: string }) {
  const startedAt = Date.now();
  if (config.providerId === "volcengine-ark") {
    normalizeVolcengineArkEmbeddingModel(config.model, true);
  }
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

function normalizeEmbeddingConfig(
  input: unknown,
  fallback: EmbeddingProviderConfig,
  options: { strict?: boolean } = {}
): EmbeddingProviderConfig {
  const record = recordOrUndefined(input) ?? {};
  const apiKey = cleanString(record.apiKey);
  const preserveKey = !apiKey && (record.preserveApiKey === true || record.apiKeyConfigured === true);
  const label = cleanString(record.label) || fallback.label;
  const providerId = record.providerId === "custom" ? "custom" : "volcengine-ark";
  const rawModel = cleanString(record.model) || fallback.model || DEFAULT_EMBEDDING_MODEL;
  const model =
    providerId === "volcengine-ark"
      ? normalizeVolcengineArkEmbeddingModel(rawModel, options.strict === true)
      : rawModel;
  return {
    providerId,
    ...(label ? { label } : {}),
    apiKey: apiKey || (preserveKey ? (fallback.apiKey ?? "") : ""),
    baseUrl: cleanString(record.baseUrl) || fallback.baseUrl || DEFAULT_EMBEDDING_BASE_URL,
    endpointPath: cleanString(record.endpointPath) || fallback.endpointPath || DEFAULT_EMBEDDING_ENDPOINT_PATH,
    model,
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

function normalizeVolcengineArkEmbeddingModel(model: string, strict: boolean): string {
  if (VOLCENGINE_ARK_ALLOWED_EMBEDDING_MODELS.has(model)) return model;
  if (!strict) return DEFAULT_EMBEDDING_MODEL;
  throw Object.assign(
    new Error(
      `Volcengine Ark vectorization only allows ${DEFAULT_EMBEDDING_MODEL}; use Custom for non-Ark gateways or other models.`
    ),
    { status: 400, code: "MODEL_NOT_ALLOWED" }
  );
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

function slimProductAssetForList(asset: ProductAsset): ProductAsset {
  const { embedding, ...product } = asset.product;
  const slimEmbedding = slimEmbeddingForList(embedding);
  return {
    ...asset,
    product: {
      ...product,
      ...(slimEmbedding ? { embedding: slimEmbedding } : {})
    }
  };
}

function slimCommerceVideoAssetForList<T extends CommerceVideoAsset | QualityVideoAsset>(asset: T): T {
  const { embedding, understanding, ...video } = asset.video;
  const slimEmbedding = slimEmbeddingForList(embedding);
  const slimUnderstanding = slimUnderstandingForList(understanding);
  return {
    ...asset,
    video: {
      ...video,
      ...(slimUnderstanding ? { understanding: slimUnderstanding } : {}),
      ...(slimEmbedding ? { embedding: slimEmbedding } : {})
    }
  };
}

function slimEmbeddingForList<T extends { vector?: number[] } | undefined>(embedding: T): Omit<NonNullable<T>, "vector"> | undefined {
  if (!embedding) return undefined;
  const { vector: _vector, ...summary } = embedding;
  return summary;
}

function slimUnderstandingForList<T extends { content?: string } | undefined>(
  understanding: T
): Omit<NonNullable<T>, "content"> | undefined {
  if (!understanding) return undefined;
  const { content: _content, ...summary } = understanding;
  return summary;
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

function decodeAssetRoutePath(raw: string): string {
  const normalized = raw.replace(/\\/g, "/");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function decodedUploadName(file: { originalname?: string; filename?: string }): string {
  return decodeMultipartFilename(file.originalname || file.filename || "");
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
    asset.video.understanding?.content ? `媒体理解：${truncate(asset.video.understanding.content, 800)}` : "",
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

function hasCommerceVideoSourceData(asset: CommerceVideoAsset): boolean {
  return Boolean(asset.sourceUrl?.trim() || asset.sourceVideoId?.trim() || asset.file?.path?.trim());
}

function commerceVideoPatchKeepsSource(video: CommerceVideoAsset, patch: Record<string, unknown>): boolean {
  const nextSourceUrl = "sourceUrl" in patch ? cleanString(patch.sourceUrl) : (video.sourceUrl ?? "");
  const nextSourceVideoId = "sourceVideoId" in patch ? cleanString(patch.sourceVideoId) : (video.sourceVideoId ?? "");
  return Boolean(nextSourceUrl.trim() || nextSourceVideoId.trim() || video.file?.path?.trim());
}

function hasCommerceVideoUnderstanding(asset: CommerceVideoAsset): boolean {
  return Boolean(asset.video.understanding?.content?.trim());
}

function commerceVideoReadyStatus(asset: CommerceVideoAsset, slices: CommerceVideoSlice[]): AssetLibraryStatus {
  if (!hasCommerceVideoSourceData(asset)) return "needs_video_file";
  if (!hasCommerceVideoUnderstanding(asset)) return "needs_model";
  if (!asset.video.embedding?.dimensions) return "needs_embedding_config";
  if (slices.length > 0 && slices.some((slice) => !slice.embedding?.dimensions)) return "needs_embedding_config";
  return "ready";
}

function commerceVideoStatusForProcessingError(error: unknown): AssetLibraryStatus {
  const code = (error as any)?.code;
  const message = errorMessage(error);
  if (code === "NEEDS_VIDEO_FILE" || code === "MISSING_COMMERCE_VIDEO_SOURCE") return "needs_video_file";
  if (code === "NEEDS_EMBEDDING_CONFIG") return "needs_embedding_config";
  if (code === "MISSING_API_KEY" || /api key/i.test(message)) return "needs_model";
  return "failed";
}

function mediaUnderstandingVideoMime(mime: unknown, filePath: string): string {
  const clean = cleanString(mime).toLowerCase();
  if (clean.startsWith("video/")) return clean;
  const inferred = mimeFor(filePath).toLowerCase();
  return inferred.startsWith("video/") ? inferred : "video/mp4";
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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
