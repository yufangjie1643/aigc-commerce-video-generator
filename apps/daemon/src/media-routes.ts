import type { Express } from "express";
import type { MediaExecutionPolicy, MediaProviderTestKind, MediaProviderTestResponse } from "@open-design/contracts";
import { validateBaseUrl } from "@open-design/contracts/api/connectionTest";
import { defaultMediaExecutionPolicy, mediaPolicyDenial } from "./media-policy.js";
import type { RouteDeps } from "./server-context.js";
import { proxyDispatcherRequestInit } from "./connectionTest.js";
import {
  aihubmixCatalogUrl,
  parseAIHubMixCatalog,
  AIHUBMIX_DEFAULT_BASE_URL,
  type AIHubMixCatalogType
} from "./aihubmix.js";
import { isSandboxModeEnabled } from "./sandbox-mode.js";
import type { ToolTokenGrant } from "./tool-tokens.js";

const LONG_MEDIA_PROXY_TIMEOUT_MS = 10 * 60 * 1000;

// Short in-memory cache for the AIHubMix media catalogue so the picker can
// refresh without hammering the upstream public endpoint. Keyed by
// `${baseUrl}|${type}`. Values expire after AIHUBMIX_CATALOG_TTL_MS.
const AIHUBMIX_CATALOG_TTL_MS = 5 * 60 * 1000;
const aihubmixCatalogCache = new Map<string, { at: number; models: Array<{ id: string; label: string }> }>();

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mediaProviderProbePath(providerId: string, baseUrl: string): string {
  const lower = baseUrl.toLowerCase().replace(/\/+$/, "");
  if (providerId === "elevenlabs") {
    return lower.endsWith("/v1") ? "/voices" : "/v1/voices";
  }
  if (providerId === "nanobanana" || providerId === "google") {
    return lower.endsWith("/v1beta") ? "/models" : "/v1beta/models";
  }
  if (providerId === "leonardo") {
    return lower.endsWith("/api/rest/v1") ? "/me" : "/api/rest/v1/me";
  }
  return "/models";
}

function mediaProviderProbeHeaders(providerId: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (!apiKey) return headers;
  if (providerId === "elevenlabs") {
    headers["xi-api-key"] = apiKey;
    return headers;
  }
  headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function countModels(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const candidates = [record.data, record.models, record.voices, record.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.length;
  }
  return undefined;
}

function mediaProviderTestKindForStatus(status: number): MediaProviderTestKind {
  if (status === 401) return "auth_failed";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 405) return "unsupported";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return "unknown";
}

function mediaProviderTestResult(input: {
  ok: boolean;
  providerId: string;
  kind: MediaProviderTestKind;
  startedAt: number;
  status?: number;
  detail?: string;
  modelCount?: number;
  model?: string;
}): MediaProviderTestResponse {
  const result: MediaProviderTestResponse = {
    ok: input.ok,
    providerId: input.providerId,
    kind: input.kind,
    latencyMs: Date.now() - input.startedAt
  };
  if (typeof input.status === "number") result.status = input.status;
  if (input.detail) result.detail = input.detail;
  if (typeof input.modelCount === "number") result.modelCount = input.modelCount;
  if (input.model) result.model = input.model;
  return result;
}

function truncateDetail(value: string, max = 240): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}...` : singleLine;
}

async function testMediaProviderConnection(input: {
  provider: { id: string; defaultBaseUrl?: string; credentialsRequired?: boolean };
  apiKey: string;
  baseUrl: string;
  model: string;
  requestInit: Pick<RequestInit, "dispatcher">;
  startedAt: number;
}): Promise<MediaProviderTestResponse> {
  const { provider, apiKey, model, requestInit, startedAt } = input;
  const providerId = provider.id;
  if (providerId === "hyperframes") {
    return mediaProviderTestResult({
      ok: true,
      providerId,
      kind: "success",
      startedAt,
      detail: "local renderer",
      model
    });
  }

  const baseUrl = (input.baseUrl || provider.defaultBaseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) {
    return mediaProviderTestResult({
      ok: false,
      providerId,
      kind: "invalid_base_url",
      startedAt,
      detail: "missing baseUrl",
      model
    });
  }
  const validation = validateBaseUrl(baseUrl);
  if (validation.error || !validation.parsed) {
    return mediaProviderTestResult({
      ok: false,
      providerId,
      kind: "invalid_base_url",
      startedAt,
      detail: validation.error || "invalid baseUrl",
      model
    });
  }
  if (provider.credentialsRequired !== false && !apiKey) {
    return mediaProviderTestResult({
      ok: false,
      providerId,
      kind: "missing_api_key",
      startedAt,
      model
    });
  }

  const url = `${baseUrl}${mediaProviderProbePath(providerId, baseUrl)}`;
  try {
    const resp = await fetch(url, {
      ...requestInit,
      method: "GET",
      headers: mediaProviderProbeHeaders(providerId, apiKey),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    const text = await resp.text();
    if (!resp.ok) {
      return mediaProviderTestResult({
        ok: false,
        providerId,
        kind: mediaProviderTestKindForStatus(resp.status),
        startedAt,
        status: resp.status,
        detail: truncateDetail(text),
        model
      });
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const modelCount = countModels(json);
    return mediaProviderTestResult({
      ok: true,
      providerId,
      kind: "success",
      startedAt,
      status: resp.status,
      detail: url,
      ...(typeof modelCount === "number" ? { modelCount } : {}),
      model
    });
  } catch (err: any) {
    const message = String(err && err.message ? err.message : err);
    const kind: MediaProviderTestKind =
      err?.name === "TimeoutError" || /timeout/i.test(message) ? "timeout" : "network_error";
    return mediaProviderTestResult({
      ok: false,
      providerId,
      kind,
      startedAt,
      detail: truncateDetail(message),
      model
    });
  }
}

export interface RegisterMediaRoutesDeps extends RouteDeps<
  | "db"
  | "design"
  | "http"
  | "paths"
  | "ids"
  | "auth"
  | "media"
  | "appConfig"
  | "orbit"
  | "nativeDialogs"
  | "projectStore"
  | "projectFiles"
  | "conversations"
  | "research"
> {}

export type LegacyMediaRouteGrantDecision =
  | { ok: true; grant: ToolTokenGrant | null }
  | {
      ok: false;
      code: string;
      details?: Record<string, unknown>;
      message: string;
      status: number;
    };

export function resolveLegacyMediaRouteGrant(input: {
  grant: ToolTokenGrant | null;
  projectId: string;
  requestProjectOverride: (projectId: string, tokenProjectId: string) => boolean;
  sandboxMode: boolean;
}): LegacyMediaRouteGrantDecision {
  if (input.sandboxMode && input.grant && input.requestProjectOverride(input.projectId, input.grant.projectId)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      details: { suppliedProjectId: input.projectId },
      message: "projectId is derived from the tool token",
      status: 403
    };
  }

  if (!input.grant && input.sandboxMode) {
    return {
      ok: false,
      code: "TOOL_TOKEN_MISSING",
      message: "tool token is required for media generation in sandbox mode",
      status: 401
    };
  }

  return { ok: true, grant: input.grant };
}

export function registerMediaRoutes(app: Express, ctx: RegisterMediaRoutesDeps) {
  const { db, design } = ctx;
  const { sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const { PROJECT_ROOT, PROJECTS_DIR, RUNTIME_DATA_DIR } = ctx.paths;
  const { authorizeToolRequest, optionalToolGrantFromRequest, requestProjectOverride } = ctx.auth;
  const { randomUUID } = ctx.ids;
  const {
    MEDIA_PROVIDERS,
    IMAGE_MODELS,
    VIDEO_MODELS,
    AUDIO_MODELS_BY_KIND,
    MEDIA_ASPECTS,
    VIDEO_LENGTHS_SEC,
    AUDIO_DURATIONS_SEC,
    readMaskedConfig,
    resolveProviderConfig,
    writeConfig,
    generateMedia,
    understandMedia,
    createMediaTask,
    persistMediaTask,
    appendTaskProgress,
    notifyTaskWaiters,
    getLiveMediaTask,
    mediaTaskSnapshot,
    listMediaTasksByProject,
    listElevenLabsVoiceOptions
  } = ctx.media;
  const { readAppConfig, writeAppConfig } = ctx.appConfig;
  const { orbitService } = ctx.orbit;
  const { openNativeFolderDialog } = ctx.nativeDialogs;
  const { getProject } = ctx.projectStore;
  const { searchResearch, ResearchError } = ctx.research;
  const getResolvedPort = () => resolvedPortRef.current;

  const mediaPolicyForGrant = (
    grant: ToolTokenGrant | null
  ): { ok: true; policy: MediaExecutionPolicy } | { ok: false; code: string; message: string } => {
    if (!grant?.runId) return { ok: true, policy: defaultMediaExecutionPolicy() };
    const run = design.runs.get(grant.runId);
    if (!run) {
      return {
        ok: false,
        code: "MEDIA_POLICY_UNAVAILABLE",
        message: "media generation policy is unavailable for this run"
      };
    }
    return { ok: true, policy: run.mediaExecution ?? defaultMediaExecutionPolicy() };
  };

  const handleGenerate = async (req: any, res: any, options: { projectId: string; grant: ToolTokenGrant | null }) => {
    const projectId = options.projectId;
    const project = getProject(db, projectId);
    if (!project) return res.status(404).json({ error: "project not found" });

    const surface = req.body?.surface;
    if (surface !== "image" && surface !== "video" && surface !== "audio") {
      return sendApiError(res, 400, "BAD_REQUEST", "surface must be image, video, or audio");
    }
    const model = typeof req.body?.model === "string" ? req.body.model : "";
    if (!model) {
      return sendApiError(res, 400, "BAD_REQUEST", "model is required");
    }

    const policy = mediaPolicyForGrant(options.grant);
    if (!policy.ok) {
      return sendApiError(res, 403, policy.code, policy.message);
    }
    const denial = mediaPolicyDenial(policy.policy, { surface, model });
    if (denial) {
      return sendApiError(res, 403, denial.code, denial.message);
    }

    let task: ReturnType<typeof createMediaTask> | null = null;
    try {
      const taskId = randomUUID();
      task = createMediaTask(taskId, projectId, {
        surface: req.body?.surface,
        model: req.body?.model
      });
      console.error(
        `[task ${taskId.slice(0, 8)}] queued model=${req.body?.model} ` +
          `surface=${req.body?.surface} ` +
          `image=${req.body?.image ? "yes" : "no"} ` +
          `compositionDir=${req.body?.compositionDir ? "yes" : "no"}`
      );

      const proxyDispatcher = proxyDispatcherRequestInit(process.env, {
        headersTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS,
        bodyTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS
      });
      task.status = "running";
      persistMediaTask(task);
      generateMedia({
        projectRoot: PROJECT_ROOT,
        projectsRoot: PROJECTS_DIR,
        projectId,
        surface: req.body?.surface,
        model: req.body?.model,
        prompt: req.body?.prompt,
        output: req.body?.output,
        aspect: req.body?.aspect,
        length: typeof req.body?.length === "number" ? req.body.length : undefined,
        duration: typeof req.body?.duration === "number" ? req.body.duration : undefined,
        voice: req.body?.voice,
        audioKind: req.body?.audioKind,
        language: typeof req.body?.language === "string" ? req.body.language : undefined,
        loop: typeof req.body?.loop === "boolean" ? req.body.loop : undefined,
        promptInfluence: typeof req.body?.promptInfluence === "number" ? req.body.promptInfluence : undefined,
        compositionDir: req.body?.compositionDir,
        image: req.body?.image,
        images: Array.isArray(req.body?.images) ? req.body.images : undefined,
        onProgress: (line: any) => appendTaskProgress(task, line),
        requestInit: proxyDispatcher.requestInit
      })
        .then((meta: any) => {
          task.status = "done";
          task.file = meta;
          task.endedAt = Date.now();
          persistMediaTask(task);
          notifyTaskWaiters(task);
          console.error(
            `[task ${taskId.slice(0, 8)}] done size=${meta?.size} mime=${meta?.mime} ` +
              `elapsed=${Math.round((task.endedAt - task.startedAt) / 1000)}s`
          );
        })
        .catch((err: any) => {
          task.status = "failed";
          task.error = {
            message: String(err && err.message ? err.message : err),
            status: typeof err?.status === "number" ? err.status : 400,
            code: err?.code
          };
          task.endedAt = Date.now();
          persistMediaTask(task);
          notifyTaskWaiters(task);
          console.error(
            `[task ${taskId.slice(0, 8)}] failed status=${task.error.status} ` +
              `message=${(task.error.message || "").slice(0, 240)}`
          );
        })
        .finally(() => proxyDispatcher.close());

      return res.status(202).json({
        taskId,
        status: task.status,
        startedAt: task.startedAt
      });
    } catch (err: any) {
      if (task) {
        task.status = "failed";
        task.error = {
          message: String(err && err.message ? err.message : err),
          status: typeof err?.status === "number" ? err.status : 400,
          code: err?.code
        };
        task.endedAt = Date.now();
        persistMediaTask(task);
        notifyTaskWaiters(task);
      }
      throw err;
    }
  };

  type UnderstandingRouteKind = "image" | "audio" | "video";
  const parseUnderstandingKind = (raw: unknown): UnderstandingRouteKind | null => {
    const value = stringField(raw);
    return value === "image" || value === "audio" || value === "video" ? value : null;
  };
  const mediaUrlForKind = (kind: UnderstandingRouteKind, body: any): string => {
    if (kind === "image") return stringField(body?.imageUrl) || stringField(body?.mediaUrl);
    if (kind === "audio") return stringField(body?.audioUrl) || stringField(body?.mediaUrl);
    return stringField(body?.videoUrl) || stringField(body?.mediaUrl);
  };
  const handleUnderstandMedia = async (routeKind: UnderstandingRouteKind | null, req: any, res: any) => {
    const kind = routeKind || parseUnderstandingKind(req.body?.kind);
    if (!kind) {
      return sendApiError(res, 400, "BAD_REQUEST", "kind must be image, audio, or video");
    }
    const mediaUrl = mediaUrlForKind(kind, req.body);
    const providerId = stringField(req.body?.providerId) || stringField(req.body?.provider);
    const prompt = stringField(req.body?.prompt);
    const model = stringField(req.body?.model);
    const fps = Number.isFinite(Number(req.body?.fps)) ? Number(req.body.fps) : undefined;
    const mediaResolution =
      req.body?.mediaResolution === "max" ? "max" : req.body?.media_resolution === "max" ? "max" : undefined;
    const proxyDispatcher = proxyDispatcherRequestInit(process.env, {
      headersTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS,
      bodyTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS
    });
    try {
      const result = await understandMedia({
        projectRoot: PROJECT_ROOT,
        kind,
        mediaUrl,
        ...(providerId ? { providerId } : {}),
        ...(prompt ? { prompt } : {}),
        ...(model ? { model } : {}),
        ...(fps !== undefined ? { fps } : {}),
        ...(mediaResolution ? { mediaResolution } : {}),
        requestInit: proxyDispatcher.requestInit
      });
      return res.json(result);
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 400;
      const code = err?.code || (status >= 500 ? "UPSTREAM_ERROR" : "BAD_REQUEST");
      return sendApiError(res, status, code, String(err && err.message ? err.message : err));
    } finally {
      await proxyDispatcher.close();
    }
  };
  app.get("/api/media/models", (_req, res) => {
    res.json({
      providers: MEDIA_PROVIDERS,
      image: IMAGE_MODELS,
      video: VIDEO_MODELS,
      audio: AUDIO_MODELS_BY_KIND,
      aspects: MEDIA_ASPECTS,
      videoLengthsSec: VIDEO_LENGTHS_SEC,
      audioDurationsSec: AUDIO_DURATIONS_SEC
    });
  });

  // Live AIHubMix media catalogue. The static IMAGE_MODELS registry only
  // seeds a couple of AIHubMix entries; the picker calls this to list the full
  // image-generation catalogue straight from AIHubMix
  // (GET /api/v1/models?type=image_generation, public). Ids are prefixed
  // `aihubmix-` so they stay unique and route through the AIHubMix renderer
  // (which strips the prefix to the wire name). Falls back to the cached copy
  // on upstream failure so a transient blip doesn't empty the picker.
  app.get("/api/media/providers/aihubmix/models", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    const raw = req.query.type;
    const type: AIHubMixCatalogType = raw === "llm" || raw === "video" || raw === "tts" ? raw : "image_generation";
    // This is an unauthenticated, public GET. The AIHubMix catalogue lives at a
    // single fixed origin, so we deliberately do NOT honour a caller-supplied
    // `baseUrl` here — letting the caller pick the fetch target would open an
    // SSRF hole (e.g. pointing the daemon at http://169.254.169.254/ cloud
    // metadata). Hard-code the official origin instead; a custom BYOK base URL
    // only ever needs to differ for authenticated chat/media calls, not for
    // browsing the public model catalogue.
    const baseUrl = AIHUBMIX_DEFAULT_BASE_URL;
    const cacheKey = `${baseUrl}|${type}`;
    const cached = aihubmixCatalogCache.get(cacheKey);
    if (cached && Date.now() - cached.at < AIHUBMIX_CATALOG_TTL_MS) {
      return res.json({ ok: true, cached: true, models: cached.models });
    }
    const dispatcher = proxyDispatcherRequestInit();
    try {
      const resp = await fetch(aihubmixCatalogUrl(baseUrl, type), {
        ...dispatcher.requestInit,
        method: "GET",
        // The catalogue endpoint is public — no auth header (sending an empty
        // Bearer would be rejected by some gateways).
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
      if (!resp.ok) {
        if (cached) return res.json({ ok: true, stale: true, models: cached.models });
        return res.status(502).json({ ok: false, detail: `aihubmix catalog ${resp.status}` });
      }
      const data = await resp.json();
      const models = parseAIHubMixCatalog(data).map((m) => ({
        id: `aihubmix-${m.id}`,
        label: m.label
      }));
      aihubmixCatalogCache.set(cacheKey, { at: Date.now(), models });
      return res.json({ ok: true, models });
    } catch (err: any) {
      if (cached) return res.json({ ok: true, stale: true, models: cached.models });
      return res.status(502).json({ ok: false, detail: String(err && err.message ? err.message : err) });
    } finally {
      await dispatcher.close();
    }
  });

  app.get("/api/media/config", async (_req, res) => {
    try {
      const cfg = await readMaskedConfig(PROJECT_ROOT);
      res.json(cfg);
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put("/api/media/config", async (req, res) => {
    try {
      const cfg = await writeConfig(PROJECT_ROOT, req.body);
      res.json(cfg);
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 400;
      res.status(status).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post("/api/media/providers/:providerId/test", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    const providerId = String(req.params.providerId || "").trim();
    const startedAt = Date.now();
    const provider = MEDIA_PROVIDERS.find((candidate: any) => candidate.id === providerId);
    if (!provider) {
      return res.json(
        mediaProviderTestResult({
          ok: false,
          providerId,
          kind: "unsupported",
          startedAt,
          detail: "unknown provider"
        })
      );
    }
    try {
      const stored = await resolveProviderConfig(PROJECT_ROOT, providerId);
      const apiKey = stringField(req.body?.apiKey) || stringField(stored.apiKey);
      const baseUrl =
        stringField(req.body?.baseUrl) || stringField(stored.baseUrl) || stringField(provider.defaultBaseUrl);
      const model = stringField(req.body?.model) || stringField(stored.model);
      const proxyDispatcher = proxyDispatcherRequestInit(process.env);
      try {
        const result = await testMediaProviderConnection({
          provider,
          apiKey,
          baseUrl,
          model,
          requestInit: proxyDispatcher.requestInit,
          startedAt
        });
        return res.json(result);
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      return res.json(
        mediaProviderTestResult({
          ok: false,
          providerId,
          kind: "unknown",
          startedAt,
          detail: String(err && err.message ? err.message : err)
        })
      );
    }
  });

  const registerLocalUnderstandingRoute = (kind: UnderstandingRouteKind) => {
    app.post(`/api/media/understand-${kind}`, async (req, res) => {
      if (!isLocalSameOrigin(req, getResolvedPort())) {
        return res.status(403).json({
          error: "cross-origin request rejected: media understanding is restricted to the local UI / CLI"
        });
      }
      await handleUnderstandMedia(kind, req, res);
    });
  };

  registerLocalUnderstandingRoute("image");
  registerLocalUnderstandingRoute("audio");
  registerLocalUnderstandingRoute("video");

  app.post("/api/media/understand", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error: "cross-origin request rejected: media understanding is restricted to the local UI / CLI"
      });
    }
    await handleUnderstandMedia(null, req, res);
  });

  app.get("/api/media/providers/elevenlabs/voices", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
      const proxyDispatcher = proxyDispatcherRequestInit(process.env);
      try {
        const voices = await listElevenLabsVoiceOptions(PROJECT_ROOT, {
          limit,
          requestInit: proxyDispatcher.requestInit
        });
        res.json({ voices });
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      const message = String(err && err.message ? err.message : err);
      const status = message.includes("no ElevenLabs API key") ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.get("/api/app-config", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      res.json({ config });
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put("/api/app-config", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    try {
      const config = await writeAppConfig(RUNTIME_DATA_DIR, req.body);
      orbitService.configure(config.orbit);
      res.json({ config });
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.get("/api/orbit/status", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    try {
      res.json(await orbitService.status());
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post("/api/orbit/run", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    try {
      const locale = typeof req.body?.locale === "string" ? req.body.locale : null;
      res.json(await orbitService.start("manual", { locale }));
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  // Native OS folder picker dialog. Returns { path: string | null }.
  app.post("/api/dialog/open-folder", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    try {
      const selected = await openNativeFolderDialog();
      res.json({ path: selected });
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post("/api/projects/:id/media/generate", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error: "cross-origin request rejected: media generation is restricted to the local UI / CLI"
      });
    }

    try {
      const grant = optionalToolGrantFromRequest(req, { operation: "media:generate" });
      const grantDecision = resolveLegacyMediaRouteGrant({
        grant,
        projectId: req.params.id,
        requestProjectOverride,
        sandboxMode: isSandboxModeEnabled(process.env)
      });
      if (!grantDecision.ok) {
        return sendApiError(
          res,
          grantDecision.status,
          grantDecision.code,
          grantDecision.message,
          grantDecision.details ? { details: grantDecision.details } : {}
        );
      }
      await handleGenerate(req, res, { projectId: req.params.id, grant: grantDecision.grant });
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  app.post("/api/tools/media/generate", async (req, res) => {
    const grant = authorizeToolRequest(req, res, "media:generate");
    if (!grant) return;
    try {
      await handleGenerate(req, res, { projectId: grant.projectId, grant });
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  const registerToolUnderstandingRoute = (kind: UnderstandingRouteKind) => {
    app.post(`/api/tools/media/understand-${kind}`, async (req, res) => {
      const grant = authorizeToolRequest(req, res, `media:understand-${kind}`);
      if (!grant) return;
      await handleUnderstandMedia(kind, req, res);
    });
  };

  registerToolUnderstandingRoute("image");
  registerToolUnderstandingRoute("audio");
  registerToolUnderstandingRoute("video");

  app.post("/api/tools/media/understand", async (req, res) => {
    const grant = authorizeToolRequest(req, res, "media:understand");
    if (!grant) return;
    await handleUnderstandMedia(null, req, res);
  });

  app.post("/api/research/search", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error: "cross-origin request rejected: research search is restricted to the local UI / CLI"
      });
    }

    try {
      const proxyDispatcher = proxyDispatcherRequestInit(process.env);
      try {
        const result = await searchResearch({
          projectRoot: PROJECT_ROOT,
          query: req.body?.query,
          maxSources: typeof req.body?.maxSources === "number" ? req.body.maxSources : undefined,
          providers: Array.isArray(req.body?.providers) ? req.body.providers : undefined,
          requestInit: proxyDispatcher.requestInit
        });
        res.json(result);
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      if (err instanceof ResearchError) {
        return res.status(err.status).json({
          error: { code: err.code, message: err.message }
        });
      }
      res.status(500).json({
        error: {
          code: "RESEARCH_FAILED",
          message: String(err && err.message ? err.message : err)
        }
      });
    }
  });

  app.post("/api/media/tasks/:id/wait", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    const taskId = req.params.id;
    const task = getLiveMediaTask(taskId);
    if (!task) return res.status(404).json({ error: "task not found" });

    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;
    const requestedTimeout = Number.isFinite(req.body?.timeoutMs) ? Number(req.body.timeoutMs) : 25_000;
    const timeoutMs = Math.min(Math.max(requestedTimeout, 0), 25_000);

    const respond = () => {
      if (res.writableEnded) return;
      res.json(mediaTaskSnapshot(task, since));
    };

    if (
      task.status === "done" ||
      task.status === "failed" ||
      task.status === "interrupted" ||
      task.progress.length > since
    ) {
      return respond();
    }

    let resolved = false;
    const wake = () => {
      if (resolved) return;
      resolved = true;
      task.waiters.delete(wake);
      clearTimeout(timer);
      respond();
    };
    task.waiters.add(wake);
    const timer = setTimeout(wake, timeoutMs);
    res.on("close", wake);
  });

  app.get("/api/projects/:id/media/tasks", (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    const projectId = req.params.id;
    const includeDone = req.query.includeDone === "1" || req.query.includeDone === "true";
    const tasks = listMediaTasksByProject(db, projectId, {
      includeTerminal: includeDone
    }).map((t: any) => ({
      taskId: t.id,
      status: t.status,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      elapsed: Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000),
      surface: t.surface,
      model: t.model,
      progress: t.progress.slice(-3),
      progressCount: t.progress.length,
      ...(t.status === "done" ? { file: t.file } : {}),
      ...(t.status === "failed" || t.status === "interrupted" ? { error: t.error } : {})
    }));
    res.json({ tasks });
  });

  // Multi-file upload that the chat composer uses for paste/drop/picker.
  // Files land flat in the project folder; the response carries the same
  // metadata as listFiles so the client can stage them as ChatAttachments
  // without a separate refetch.
}
