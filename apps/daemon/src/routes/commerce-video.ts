import type { Express } from "express";
import {
  COMMERCE_VIDEO_MODEL_OPTIONS,
  COMMERCE_VIDEO_STAGE_ORDER,
  COMMERCE_VIDEO_WORKFLOW_FILE
} from "@open-design/contracts";
import type {
  CommerceVideoExport,
  CommerceVideoFileRef,
  CommerceVideoGeneration,
  CommerceVideoMaterials,
  CommerceVideoProductMaterial,
  CommerceVideoProductMaterialInput,
  CommerceVideoScript,
  CommerceVideoStage,
  CommerceVideoStageId,
  CommerceVideoStageStatus,
  CommerceVideoStoryboard,
  CommerceVideoStoryboardShot,
  CommerceVideoWorkbenchState,
  CommerceVideoWorkflow
} from "@open-design/contracts";
import { listProjectProductMaterials, upsertProjectProductMaterials } from "../commerce-video-materials.js";
import type { RouteDeps } from "../server-context.js";
import { proxyDispatcherRequestInit } from "../connectionTest.js";
import { resolveLegacyMediaRouteGrant } from "../media-routes.js";
import { isSandboxModeEnabled } from "../sandbox-mode.js";

export interface RegisterCommerceVideoRoutesDeps extends RouteDeps<
  "db" | "http" | "paths" | "ids" | "auth" | "projectStore" | "projectFiles" | "media"
> {}

const STAGE_LABELS: Record<CommerceVideoStageId, string> = {
  materials: "Materials",
  script: "Script",
  storyboard: "Storyboard",
  generation: "Generation",
  progress: "Progress",
  export: "Export"
};

const STAGE_DISPLAY_NAMES: Record<CommerceVideoStageId, string> = {
  materials: "商品素材上传",
  script: "剧本生成",
  storyboard: "基础分镜",
  generation: "一键成片",
  progress: "任务进度",
  export: "预览导出"
};
const DEFAULT_COMMERCE_VIDEO_MODEL = COMMERCE_VIDEO_MODEL_OPTIONS[0].id;

export function registerCommerceVideoRoutes(app: Express, ctx: RegisterCommerceVideoRoutesDeps) {
  const { db } = ctx;
  const { isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  const { PROJECT_ROOT, PROJECTS_DIR } = ctx.paths;
  const { randomUUID } = ctx.ids;
  const { optionalToolGrantFromRequest, requestProjectOverride } = ctx.auth;
  const { getProject } = ctx.projectStore;
  const { readProjectFile, resolveProjectDir, writeProjectFile } = ctx.projectFiles;
  const {
    createMediaTask,
    persistMediaTask,
    appendTaskProgress,
    notifyTaskWaiters,
    getLiveMediaTask,
    mediaTaskSnapshot,
    listMediaTasksByProject,
    generateMedia
  } = ctx.media;
  const getResolvedPort = () => resolvedPortRef.current;

  async function requireWorkflow(req: any, res: any): Promise<CommerceVideoWorkflow | null> {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      res.status(403).json({ error: "cross-origin request rejected" });
      return null;
    }
    const project = getProject(db, req.params.id);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return null;
    }
    return await readOrCreateWorkflow(req.params.id, project.metadata);
  }

  async function readOrCreateWorkflow(projectId: string, metadata?: unknown): Promise<CommerceVideoWorkflow> {
    try {
      const file = await readProjectFile(PROJECTS_DIR, projectId, COMMERCE_VIDEO_WORKFLOW_FILE, metadata);
      return normalizeWorkflow(projectId, JSON.parse(file.buffer.toString("utf8")));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      const now = Date.now();
      return {
        version: 1,
        projectId,
        fileName: COMMERCE_VIDEO_WORKFLOW_FILE,
        stages: defaultStages(),
        materials: { productMaterialIds: [], uploadedFiles: [] },
        workbench: {
          activeStageId: "materials",
          pendingNextStageId: null,
          selectedModel: DEFAULT_COMMERCE_VIDEO_MODEL,
          updatedAt: now
        },
        createdAt: now,
        updatedAt: now
      };
    }
  }

  async function saveWorkflow(projectId: string, metadata: unknown, workflow: CommerceVideoWorkflow) {
    const next = normalizeWorkflow(projectId, { ...workflow, updatedAt: Date.now() });
    await writeProjectFile(
      PROJECTS_DIR,
      projectId,
      COMMERCE_VIDEO_WORKFLOW_FILE,
      `${JSON.stringify(next, null, 2)}\n`,
      { overwrite: true },
      metadata
    );
    return next;
  }

  function productMaterialsForWorkflow(projectId: string, metadata: unknown, workflow: CommerceVideoWorkflow) {
    const projectRoot = resolveProjectDir(PROJECTS_DIR, projectId, metadata);
    return listProjectProductMaterials(projectRoot, workflow.materials.productMaterialIds);
  }

  app.get("/api/projects/:id/commerce-video/workflow", async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow) return;
      res.json({ workflow, productMaterials: productMaterialsForWorkflow(req.params.id, project?.metadata, workflow) });
    } catch (error: any) {
      sendApiError(res, 500, "COMMERCE_VIDEO_WORKFLOW_FAILED", messageOf(error));
    }
  });

  app.get("/api/projects/:id/commerce-video/materials", async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow || !project) return;
      res.json({ workflow, productMaterials: productMaterialsForWorkflow(req.params.id, project.metadata, workflow) });
    } catch (error: any) {
      sendApiError(res, 500, "COMMERCE_VIDEO_MATERIALS_READ_FAILED", messageOf(error));
    }
  });

  app.post("/api/projects/:id/commerce-video/materials", async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow || !project) return;
      const projectRoot = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata);
      const productMaterials = upsertProjectProductMaterials(
        projectRoot,
        arrayOfRecords(req.body?.productMaterials) as unknown as CommerceVideoProductMaterialInput[],
        randomUUID
      );
      workflow.materials = normalizeMaterials(
        req.body,
        productMaterials.map((material) => material.id)
      );
      markStage(workflow, "materials", "done", "materials ready");
      setWorkbenchGate(workflow, "materials", "script");
      const saved = await saveWorkflow(req.params.id, project.metadata, workflow);
      res.json({
        workflow: saved,
        productMaterials: listProjectProductMaterials(projectRoot, saved.materials.productMaterialIds)
      });
    } catch (error: any) {
      sendApiError(res, 400, "COMMERCE_VIDEO_MATERIALS_FAILED", messageOf(error));
    }
  });

  app.post("/api/projects/:id/commerce-video/script", async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow || !project) return;
      const missingStage = firstIncompleteStage(workflow, ["materials"]);
      if (missingStage) return sendStageRequired(res, sendApiError, missingStage, "剧本生成");
      workflow.script = normalizeScript(req.body);
      markStage(workflow, "script", "done", "script ready");
      setWorkbenchGate(workflow, "script", "storyboard");
      res.json({ workflow: await saveWorkflow(req.params.id, project.metadata, workflow) });
    } catch (error: any) {
      sendApiError(res, 400, "COMMERCE_VIDEO_SCRIPT_FAILED", messageOf(error));
    }
  });

  app.post("/api/projects/:id/commerce-video/storyboard", async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow || !project) return;
      const missingStage = firstIncompleteStage(workflow, ["materials", "script"]);
      if (missingStage) return sendStageRequired(res, sendApiError, missingStage, "基础分镜");
      workflow.storyboard = normalizeStoryboard(req.body);
      markStage(workflow, "storyboard", "done", "storyboard ready");
      setWorkbenchGate(workflow, "storyboard", "generation");
      res.json({ workflow: await saveWorkflow(req.params.id, project.metadata, workflow) });
    } catch (error: any) {
      sendApiError(res, 400, "COMMERCE_VIDEO_STORYBOARD_FAILED", messageOf(error));
    }
  });

  app.post("/api/projects/:id/commerce-video/workbench", async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow || !project) return;
      workflow.workbench = normalizeWorkbench({
        ...(workflow.workbench ?? {}),
        ...(req.body ?? {}),
        updatedAt: Date.now()
      });
      const selectedModel = stringOrUndefined(req.body?.selectedModel);
      if (selectedModel) {
        workflow.generation = {
          status: workflow.generation?.status ?? "idle",
          ...(workflow.generation ?? {}),
          model: selectedModel
        };
      }
      res.json({ workflow: await saveWorkflow(req.params.id, project.metadata, workflow) });
    } catch (error: any) {
      sendApiError(res, 400, "COMMERCE_VIDEO_WORKBENCH_FAILED", messageOf(error));
    }
  });

  app.post("/api/projects/:id/commerce-video/generate", async (req, res) => {
    let task: any = null;
    let proxyDispatcher: ReturnType<typeof proxyDispatcherRequestInit> | null = null;
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
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow || !project) return;
      const model =
        stringOrUndefined(req.body?.model) ??
        stringOrUndefined(workflow.workbench?.selectedModel) ??
        DEFAULT_COMMERCE_VIDEO_MODEL;
      const missingStage = firstIncompleteStage(workflow, ["materials", "script", "storyboard"]);
      if (missingStage) return sendStageRequired(res, sendApiError, missingStage, "一键成片");
      const taskId = randomUUID();
      const aspect = stringOrUndefined(req.body?.aspect) ?? "9:16";
      const lengthSec = clampLength(Number(req.body?.lengthSec ?? req.body?.length ?? 15));
      const output = normalizeGenerationOutputName(stringOrUndefined(req.body?.output));
      const projectRoot = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata);
      const productMaterials = listProjectProductMaterials(projectRoot, workflow.materials.productMaterialIds);
      const referenceFiles = generationReferenceFiles(workflow, productMaterials);
      const referenceImagePaths =
        req.body?.useReferenceImages === true ? referenceFiles.filter(isImageFileRef).map((file) => file.path) : [];
      const prompt = buildGenerationPrompt(workflow, productMaterials, stringOrUndefined(req.body?.prompt));

      task = createMediaTask(taskId, req.params.id, { surface: "video", model });
      task.status = "running";
      persistMediaTask(task);
      appendTaskProgress(task, "commerce video generation started");

      workflow.generation = {
        status: "running",
        mediaTaskId: taskId,
        model,
        aspect,
        lengthSec,
        prompt,
        referenceFiles
      };
      markStage(workflow, "generation", "done", "video generation task created");
      markStage(workflow, "progress", "running", "video generation running");
      setWorkbenchGate(workflow, "generation", "progress", { selectedModel: model });
      const saved = await saveWorkflow(req.params.id, project.metadata, workflow);

      proxyDispatcher = proxyDispatcherRequestInit(process.env, {
        headersTimeout: 10 * 60 * 1000,
        bodyTimeout: 10 * 60 * 1000
      });
      const dispatcher = proxyDispatcher;
      void generateMedia({
        projectRoot: PROJECT_ROOT,
        projectsRoot: PROJECTS_DIR,
        projectId: req.params.id,
        surface: "video",
        model,
        prompt,
        output,
        aspect,
        length: lengthSec,
        ...(referenceImagePaths[0] ? { image: referenceImagePaths[0], images: referenceImagePaths.slice(1) } : {}),
        onProgress: (line: string) => appendTaskProgress(task, line),
        requestInit: dispatcher.requestInit
      })
        .then(async (meta: any) => {
          task.status = "done";
          task.file = meta;
          task.endedAt = Date.now();
          persistMediaTask(task);
          notifyTaskWaiters(task);
          const latest = await readOrCreateWorkflow(req.params.id, project.metadata);
          latest.generation = {
            ...(latest.generation ?? {}),
            status: "done",
            mediaTaskId: taskId,
            model,
            aspect,
            lengthSec,
            prompt,
            referenceFiles,
            output: normalizeFileRef(meta)
          };
          latest.export = {
            status: "idle",
            previewPath: typeof meta?.path === "string" ? meta.path : output,
            downloadPath: typeof meta?.path === "string" ? meta.path : output
          };
          markStage(latest, "generation", "done", "video generation task created");
          markStage(latest, "progress", "done", "video generation complete");
          markStage(latest, "export", "idle", "ready to export");
          setWorkbenchGate(latest, "progress", "export", { selectedModel: model });
          await saveWorkflow(req.params.id, project.metadata, latest);
        })
        .catch(async (error: any) => {
          task.status = "failed";
          task.error = {
            message: messageOf(error),
            status: typeof error?.status === "number" ? error.status : 400,
            code: error?.code
          };
          task.endedAt = Date.now();
          persistMediaTask(task);
          notifyTaskWaiters(task);
          const latest = await readOrCreateWorkflow(req.params.id, project.metadata);
          latest.generation = {
            ...(latest.generation ?? {}),
            status: "failed",
            mediaTaskId: taskId,
            model,
            aspect,
            lengthSec,
            prompt,
            referenceFiles,
            error: task.error
          };
          markStage(latest, "generation", "done", "video generation task created");
          markStage(latest, "progress", "failed", task.error.message);
          setWorkbenchGate(latest, "progress", null, { selectedModel: model });
          await saveWorkflow(req.params.id, project.metadata, latest);
        })
        .finally(() => dispatcher.close());

      res.status(202).json({ taskId, status: "running", workflow: saved });
    } catch (error: any) {
      if (task) {
        task.status = "failed";
        task.error = { message: messageOf(error), status: typeof error?.status === "number" ? error.status : 400 };
        task.endedAt = Date.now();
        persistMediaTask(task);
        notifyTaskWaiters(task);
      }
      proxyDispatcher?.close();
      sendApiError(res, 400, "COMMERCE_VIDEO_GENERATE_FAILED", messageOf(error));
    }
  });

  app.get("/api/projects/:id/commerce-video/jobs", async (req, res) => {
    try {
      const workflow = await requireWorkflow(req, res);
      if (!workflow) return;
      const jobs = listMediaTasksByProject(db, req.params.id, { includeTerminal: true })
        .filter((job: any) => !workflow.generation?.mediaTaskId || job.id === workflow.generation.mediaTaskId)
        .map(jobResponse);
      res.json({ jobs });
    } catch (error: any) {
      sendApiError(res, 500, "COMMERCE_VIDEO_JOBS_FAILED", messageOf(error));
    }
  });

  app.post("/api/commerce-video/jobs/:jobId/wait", async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: "cross-origin request rejected" });
    }
    const task = getLiveMediaTask(req.params.jobId);
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

  app.get("/api/projects/:id/commerce-video/preview", async (req, res) => {
    try {
      const workflow = await requireWorkflow(req, res);
      if (!workflow) return;
      const preview = workflow.generation?.output ?? undefined;
      res.json({ workflow, preview, export: workflow.export });
    } catch (error: any) {
      sendApiError(res, 500, "COMMERCE_VIDEO_PREVIEW_FAILED", messageOf(error));
    }
  });

  app.post("/api/projects/:id/commerce-video/export", async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const workflow = await requireWorkflow(req, res);
      if (!workflow || !project) return;
      const manifestPath = "commerce-video/export-manifest.json";
      const missingStage = firstIncompleteStage(workflow, ["generation", "progress"]);
      if (missingStage) return sendStageRequired(res, sendApiError, missingStage, "预览导出");
      const downloadPath = workflow.generation?.output?.path ?? workflow.export?.downloadPath;
      if (!downloadPath)
        return sendApiError(res, 400, "COMMERCE_VIDEO_EXPORT_NOT_READY", "no generated video to export");
      const previewPath = workflow.generation?.output?.path;
      const exportState: CommerceVideoExport = {
        status: "done",
        manifestPath,
        downloadPath,
        ...(previewPath ? { previewPath } : {})
      };
      workflow.export = exportState;
      markStage(workflow, "export", "done", "export ready");
      setWorkbenchGate(workflow, "export", null);
      const saved = await saveWorkflow(req.params.id, project.metadata, workflow);
      await writeProjectFile(
        PROJECTS_DIR,
        req.params.id,
        manifestPath,
        `${JSON.stringify({ workflowFile: COMMERCE_VIDEO_WORKFLOW_FILE, downloadPath, generatedAt: Date.now() }, null, 2)}\n`,
        { overwrite: true },
        project.metadata
      );
      res.json({ workflow: saved, export: exportState });
    } catch (error: any) {
      sendApiError(res, 400, "COMMERCE_VIDEO_EXPORT_FAILED", messageOf(error));
    }
  });
}

function defaultStages(): CommerceVideoStage[] {
  return COMMERCE_VIDEO_STAGE_ORDER.map((id) => ({ id, label: STAGE_LABELS[id], status: "idle" }));
}

function normalizeWorkflow(projectId: string, raw: any): CommerceVideoWorkflow {
  const now = Date.now();
  const stagesById = new Map<string, CommerceVideoStage>();
  for (const stage of Array.isArray(raw?.stages) ? raw.stages : []) {
    if (COMMERCE_VIDEO_STAGE_ORDER.includes(stage?.id)) {
      stagesById.set(stage.id, {
        id: stage.id,
        label:
          typeof stage.label === "string" && stage.label ? stage.label : STAGE_LABELS[stage.id as CommerceVideoStageId],
        status: normalizeStatus(stage.status),
        ...(typeof stage.detail === "string" ? { detail: stage.detail } : {}),
        ...(Number.isFinite(stage.updatedAt) ? { updatedAt: Number(stage.updatedAt) } : {})
      });
    }
  }
  const workflow: CommerceVideoWorkflow = {
    version: 1,
    projectId,
    fileName: COMMERCE_VIDEO_WORKFLOW_FILE,
    stages: COMMERCE_VIDEO_STAGE_ORDER.map(
      (id) => stagesById.get(id) ?? { id, label: STAGE_LABELS[id], status: "idle" }
    ),
    materials: normalizeMaterials(raw?.materials),
    ...(raw?.script ? { script: normalizeScript(raw.script) } : {}),
    ...(raw?.storyboard ? { storyboard: normalizeStoryboard(raw.storyboard) } : {}),
    ...(raw?.generation ? { generation: normalizeGeneration(raw.generation) } : {}),
    ...(raw?.export ? { export: normalizeExport(raw.export) } : {}),
    workbench: normalizeWorkbench(raw?.workbench),
    createdAt: Number.isFinite(raw?.createdAt) ? Number(raw.createdAt) : now,
    updatedAt: Number.isFinite(raw?.updatedAt) ? Number(raw.updatedAt) : now
  };
  reconcileWorkflowStages(workflow);
  return workflow;
}

function normalizeMaterials(raw: any, storedProductMaterialIds: string[] = []): CommerceVideoMaterials {
  const commerceVideoAssetIds = arrayOfStrings(raw?.commerceVideoAssetIds);
  const productMaterialIds = uniqueStrings([...arrayOfStrings(raw?.productMaterialIds), ...storedProductMaterialIds]);
  return {
    productMaterialIds,
    ...(commerceVideoAssetIds.length ? { commerceVideoAssetIds } : {}),
    uploadedFiles: arrayOfRecords(raw?.uploadedFiles)
      .map(normalizeFileRef)
      .filter((file) => file.path),
    ...(typeof raw?.notes === "string" && raw.notes.trim() ? { notes: raw.notes.trim() } : {})
  };
}

function normalizeScript(raw: any): CommerceVideoScript {
  const title = stringOrUndefined(raw?.title);
  const hook = stringOrUndefined(raw?.hook);
  const voiceover = stringOrUndefined(raw?.voiceover ?? raw?.prompt);
  const cta = stringOrUndefined(raw?.cta);
  if (!title) throw new Error("title is required");
  if (!hook) throw new Error("hook is required");
  if (!voiceover) throw new Error("voiceover is required");
  return {
    title,
    hook,
    voiceover,
    sellingPoints: arrayOfStrings(raw?.sellingPoints),
    ...(cta ? { cta } : {})
  };
}

function normalizeStoryboard(raw: any): CommerceVideoStoryboard {
  const rawShots = Array.isArray(raw?.shots)
    ? raw.shots
    : Array.isArray(raw?.storyboard)
      ? raw.storyboard
      : raw?.storyboard && Array.isArray(raw.storyboard.shots)
        ? raw.storyboard.shots
        : [];
  const shots = arrayOfRecords(rawShots)
    .slice(0, 6)
    .map((shot, index) => normalizeShot(shot, index));
  if (shots.length < 3) throw new Error("storyboard requires at least 3 shots");
  return {
    totalDurationSec: Math.min(
      15,
      shots.reduce((sum, shot) => sum + shot.durationSec, 0)
    ),
    shots
  };
}

function normalizeShot(raw: any, index: number): CommerceVideoStoryboardShot {
  const visualGoal =
    stringOrUndefined(raw?.visualGoal) ??
    stringOrUndefined(raw?.visual) ??
    stringOrUndefined(raw?.goal) ??
    stringOrUndefined(raw?.description);
  const prompt = stringOrUndefined(raw?.prompt) ?? visualGoal;
  if (!visualGoal) throw new Error(`shot ${index + 1} visualGoal is required`);
  if (!prompt) throw new Error(`shot ${index + 1} prompt is required`);
  const voiceover = stringOrUndefined(raw?.voiceover);
  const caption = stringOrUndefined(raw?.caption);
  const camera = stringOrUndefined(raw?.camera);
  const qaCheck = stringOrUndefined(raw?.qaCheck);
  return {
    id: stringOrUndefined(raw?.id) ?? `shot_${index + 1}`,
    index: index + 1,
    durationSec: clampShotDuration(Number(raw?.durationSec ?? 3)),
    visualGoal,
    prompt,
    ...(voiceover ? { voiceover } : {}),
    ...(caption ? { caption } : {}),
    ...(camera ? { camera } : {}),
    requiredAssets: arrayOfStrings(raw?.requiredAssets),
    ...(qaCheck ? { qaCheck } : {})
  };
}

function normalizeGeneration(raw: any): CommerceVideoGeneration {
  const next: CommerceVideoGeneration = { status: normalizeStatus(raw?.status) };
  const mediaTaskId = stringOrUndefined(raw?.mediaTaskId);
  const model = stringOrUndefined(raw?.model);
  const aspect = stringOrUndefined(raw?.aspect);
  const prompt = stringOrUndefined(raw?.prompt);
  if (mediaTaskId) next.mediaTaskId = mediaTaskId;
  if (model) next.model = model;
  if (aspect) next.aspect = aspect;
  if (Number.isFinite(raw?.lengthSec)) next.lengthSec = clampLength(Number(raw.lengthSec));
  if (prompt) next.prompt = prompt;
  const referenceFiles = arrayOfRecords(raw?.referenceFiles)
    .map(normalizeFileRef)
    .filter((file) => file.path);
  if (referenceFiles.length) next.referenceFiles = referenceFiles;
  if (raw?.output) next.output = normalizeFileRef(raw.output);
  if (raw?.error?.message) {
    next.error = {
      message: String(raw.error.message),
      ...(typeof raw.error.code === "string" ? { code: raw.error.code } : {}),
      ...(typeof raw.error.status === "number" ? { status: raw.error.status } : {})
    };
  }
  return next;
}

function normalizeExport(raw: any): CommerceVideoExport {
  const next: CommerceVideoExport = { status: normalizeStatus(raw?.status) };
  const manifestPath = stringOrUndefined(raw?.manifestPath);
  const downloadPath = stringOrUndefined(raw?.downloadPath);
  const previewPath = stringOrUndefined(raw?.previewPath);
  if (manifestPath) next.manifestPath = manifestPath;
  if (downloadPath) next.downloadPath = downloadPath;
  if (previewPath) next.previewPath = previewPath;
  return next;
}

function normalizeWorkbench(raw: any): CommerceVideoWorkbenchState {
  const activeStageId = stageIdOrUndefined(raw?.activeStageId);
  const pendingNextStageId =
    raw && Object.prototype.hasOwnProperty.call(raw, "pendingNextStageId")
      ? raw.pendingNextStageId === null
        ? null
        : stageIdOrUndefined(raw.pendingNextStageId)
      : undefined;
  const selectedModel = stringOrUndefined(raw?.selectedModel);
  const exportSettings = normalizeWorkbenchExportSettings(raw?.exportSettings);
  return {
    ...(activeStageId ? { activeStageId } : {}),
    ...(pendingNextStageId !== undefined ? { pendingNextStageId } : {}),
    ...(selectedModel ? { selectedModel } : { selectedModel: DEFAULT_COMMERCE_VIDEO_MODEL }),
    ...(exportSettings ? { exportSettings } : {}),
    ...(Number.isFinite(raw?.updatedAt) ? { updatedAt: Number(raw.updatedAt) } : {})
  };
}

function normalizeWorkbenchExportSettings(raw: any): CommerceVideoWorkbenchState["exportSettings"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const format = raw.format === "webm" || raw.format === "mov" || raw.format === "mp4" ? raw.format : undefined;
  const resolution =
    raw.resolution === "720x1280" || raw.resolution === "1080x1080" || raw.resolution === "1080x1920"
      ? raw.resolution
      : undefined;
  const targetDuration = Number.isFinite(raw.targetDuration) ? clampLength(Number(raw.targetDuration)) : undefined;
  const next = {
    ...(format ? { format } : {}),
    ...(resolution ? { resolution } : {}),
    ...(typeof raw.includeSubtitles === "boolean" ? { includeSubtitles: raw.includeSubtitles } : {}),
    ...(typeof raw.includeVoiceover === "boolean" ? { includeVoiceover: raw.includeVoiceover } : {}),
    ...(typeof raw.includeBgm === "boolean" ? { includeBgm: raw.includeBgm } : {}),
    ...(targetDuration ? { targetDuration } : {})
  };
  return Object.keys(next).length ? next : undefined;
}

function stageIdOrUndefined(value: unknown): CommerceVideoStageId | undefined {
  return typeof value === "string" && COMMERCE_VIDEO_STAGE_ORDER.includes(value as CommerceVideoStageId)
    ? (value as CommerceVideoStageId)
    : undefined;
}

function markStage(
  workflow: CommerceVideoWorkflow,
  id: CommerceVideoStageId,
  status: CommerceVideoStageStatus,
  detail?: string
) {
  const stage = workflow.stages.find((item) => item.id === id) ?? {
    id,
    label: STAGE_LABELS[id],
    status: "idle" as const
  };
  stage.status = status;
  if (detail) stage.detail = detail;
  stage.updatedAt = Date.now();
  if (!workflow.stages.some((item) => item.id === id)) workflow.stages.push(stage);
}

function setWorkbenchGate(
  workflow: CommerceVideoWorkflow,
  activeStageId: CommerceVideoStageId,
  pendingNextStageId: CommerceVideoStageId | null,
  patch: Partial<CommerceVideoWorkbenchState> = {}
) {
  workflow.workbench = normalizeWorkbench({
    ...(workflow.workbench ?? {}),
    ...patch,
    activeStageId,
    pendingNextStageId,
    updatedAt: Date.now()
  });
}

function reconcileWorkflowStages(workflow: CommerceVideoWorkflow) {
  reconcileStageDone(workflow, "materials", hasMaterials(workflow.materials));
  reconcileStageDone(workflow, "script", Boolean(workflow.script));
  reconcileStageDone(workflow, "storyboard", Boolean(workflow.storyboard && workflow.storyboard.shots.length >= 3));
  reconcileStageDone(
    workflow,
    "generation",
    workflow.generation?.status === "done" && Boolean(workflow.generation.output?.path)
  );
  reconcileStageDone(
    workflow,
    "progress",
    workflow.stages.find((stage) => stage.id === "progress")?.status === "done" &&
      workflow.generation?.status === "done"
  );
  reconcileStageDone(workflow, "export", workflow.export?.status === "done" && Boolean(workflow.export.downloadPath));
}

function reconcileStageDone(workflow: CommerceVideoWorkflow, id: CommerceVideoStageId, complete: boolean) {
  if (!complete) return;
  const stage = workflow.stages.find((item) => item.id === id);
  if (!stage) {
    workflow.stages.push({ id, label: STAGE_LABELS[id], status: "done", updatedAt: Date.now() });
    return;
  }
  if (stage.status === "idle") {
    stage.status = "done";
    stage.detail = stage.detail ?? `${STAGE_DISPLAY_NAMES[id]} already present`;
    stage.updatedAt = stage.updatedAt ?? Date.now();
  }
}

function firstIncompleteStage(
  workflow: CommerceVideoWorkflow,
  requiredStages: readonly CommerceVideoStageId[]
): CommerceVideoStageId | null {
  return requiredStages.find((stageId) => !isStageComplete(workflow, stageId)) ?? null;
}

function isStageComplete(workflow: CommerceVideoWorkflow, stageId: CommerceVideoStageId): boolean {
  const stage = workflow.stages.find((item) => item.id === stageId);
  if (stage?.status !== "done") return false;
  switch (stageId) {
    case "materials":
      return hasMaterials(workflow.materials);
    case "script":
      return Boolean(workflow.script);
    case "storyboard":
      return Boolean(workflow.storyboard && workflow.storyboard.shots.length >= 3);
    case "generation":
      return workflow.generation?.status === "done" && Boolean(workflow.generation.output?.path);
    case "progress":
      return stage.status === "done" && workflow.generation?.status === "done";
    case "export":
      return workflow.export?.status === "done" && Boolean(workflow.export.downloadPath);
  }
}

function hasMaterials(materials: CommerceVideoMaterials | undefined): boolean {
  return Boolean(
    materials &&
    ((materials.productMaterialIds?.length ?? 0) > 0 ||
      (materials.commerceVideoAssetIds?.length ?? 0) > 0 ||
      materials.uploadedFiles.length > 0 ||
      Boolean(materials.notes))
  );
}

function sendStageRequired(
  res: any,
  sendApiError: (res: any, status: number, code: string, message: string, extra?: Record<string, unknown>) => void,
  stageId: CommerceVideoStageId,
  targetStage: string
) {
  return sendApiError(
    res,
    409,
    "COMMERCE_VIDEO_STAGE_REQUIRED",
    `请先完成${STAGE_DISPLAY_NAMES[stageId]}阶段，再进入${targetStage}。`,
    {
      details: { stageId, requiredStage: stageId, targetStage }
    }
  );
}

function buildGenerationPrompt(
  workflow: CommerceVideoWorkflow,
  productMaterials: CommerceVideoProductMaterial[],
  extra?: string
): string {
  const referenceFiles = generationReferenceFiles(workflow, productMaterials);
  const lines = [
    workflow.materials.productMaterialIds.length
      ? `Project product material IDs: ${workflow.materials.productMaterialIds.join(", ")}`
      : "",
    productMaterials.length
      ? [
          "Product materials:",
          productMaterials
            .map((material) =>
              [
                `- ${material.title} (${material.id})`,
                material.subject ? `  subject: ${material.subject}` : "",
                material.category ? `  category: ${material.category}` : "",
                material.product.summary ? `  summary: ${material.product.summary}` : "",
                material.product.sellingPoints.length
                  ? `  selling points: ${material.product.sellingPoints.join(" / ")}`
                  : "",
                material.product.constraints.length ? `  constraints: ${material.product.constraints.join(" / ")}` : "",
                material.product.suggestedAngles.length
                  ? `  suggested shots: ${material.product.suggestedAngles.join(" / ")}`
                  : "",
                material.files.length ? `  files: ${material.files.map((file) => file.path).join(" / ")}` : "",
                material.analysis ? `  analysis: ${compactRecordText(material.analysis)}` : ""
              ]
                .filter(Boolean)
                .join("\n")
            )
            .join("\n")
        ].join("\n")
      : "",
    workflow.materials.uploadedFiles.length
      ? `Uploaded project files: ${workflow.materials.uploadedFiles.map((file) => file.path).join(", ")}`
      : "",
    referenceFiles.length
      ? `Reference files for visual matching: ${referenceFiles.map((file) => file.path).join(", ")}`
      : "",
    workflow.materials.commerceVideoAssetIds?.length
      ? `Commerce video reference asset IDs: ${workflow.materials.commerceVideoAssetIds.join(", ")}`
      : "",
    workflow.materials.notes ? `Material notes: ${workflow.materials.notes}` : "",
    workflow.script ? `Title: ${workflow.script.title}` : "",
    workflow.script ? `Hook: ${workflow.script.hook}` : "",
    workflow.script ? `Voiceover: ${workflow.script.voiceover}` : "",
    workflow.storyboard
      ? workflow.storyboard.shots
          .map((shot) => `${shot.index}. ${shot.visualGoal}; ${shot.prompt}; voiceover: ${shot.voiceover ?? ""}`)
          .join("\n")
      : "",
    extra ? `Additional direction: ${extra}` : ""
  ].filter(Boolean);
  return lines.join("\n\n");
}

function generationReferenceFiles(
  workflow: CommerceVideoWorkflow,
  productMaterials: CommerceVideoProductMaterial[]
): CommerceVideoFileRef[] {
  const files = [...workflow.materials.uploadedFiles, ...productMaterials.flatMap((material) => material.files)].filter(
    (file) => file.path
  );
  const byPath = new Map<string, CommerceVideoFileRef>();
  for (const file of files) {
    if (!byPath.has(file.path)) byPath.set(file.path, file);
  }
  return [...byPath.values()].slice(0, 12);
}

function isImageFileRef(file: CommerceVideoFileRef): boolean {
  return Boolean(
    file.path &&
    (file.mime?.startsWith("image/") ||
      /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(file.path) ||
      /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name ?? ""))
  );
}

function compactRecordText(record: Record<string, unknown>): string {
  const values = ["visionText", "summary", "description", "clusterId", "style", "color", "category"]
    .map((key) => {
      const value = record[key];
      return typeof value === "string" && value.trim() ? `${key}: ${value.trim()}` : "";
    })
    .filter(Boolean);
  return (values.length ? values.join("; ") : JSON.stringify(record)).slice(0, 800);
}

function jobResponse(row: any) {
  return {
    taskId: row.id,
    status: row.status,
    ...(row.surface ? { surface: row.surface } : {}),
    ...(row.model ? { model: row.model } : {}),
    progress: Array.isArray(row.progress) ? row.progress : [],
    ...(row.file ? { file: row.file } : {}),
    ...(row.error ? { error: row.error } : {}),
    startedAt: row.startedAt,
    endedAt: row.endedAt
  };
}

function normalizeFileRef(raw: any): CommerceVideoFileRef {
  const next: CommerceVideoFileRef = { path: stringOrUndefined(raw?.path ?? raw?.name) ?? "" };
  const name = stringOrUndefined(raw?.name);
  const mime = stringOrUndefined(raw?.mime);
  if (name) next.name = name;
  if (mime) next.mime = mime;
  if (typeof raw?.size === "number") next.size = raw.size;
  return next;
}

function normalizeStatus(raw: unknown): CommerceVideoStageStatus {
  return raw === "queued" ||
    raw === "running" ||
    raw === "done" ||
    raw === "failed" ||
    raw === "cancelled" ||
    raw === "interrupted"
    ? raw
    : "idle";
}

function normalizeGenerationOutputName(raw?: string): string {
  const normalized = (raw ?? "commerce-video-final.mp4")
    .replace(/[\\/]+/g, "-")
    .replace(/^-+/, "")
    .trim();
  return normalized || "commerce-video-final.mp4";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function clampShotDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(15, Math.max(1, Math.round(value))) : 3;
}

function clampLength(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(15, Math.max(1, Math.round(value))) : 15;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
