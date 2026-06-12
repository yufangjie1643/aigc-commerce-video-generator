import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Button, Input, Select, Textarea } from "@open-design/components";
import { COMMERCE_VIDEO_MODEL_OPTIONS } from "@open-design/contracts";
import type {
  CommerceVideoJobWaitResponse,
  CommerceVideoProductMaterial,
  CommerceVideoStageId,
  CommerceVideoStage,
  CommerceVideoWorkflow
} from "@open-design/contracts";

import {
  exportCommerceVideo,
  fetchCommerceVideoPreview,
  fetchCommerceVideoWorkflow,
  generateCommerceVideo,
  saveCommerceVideoMaterials,
  saveCommerceVideoScript,
  saveCommerceVideoStoryboard,
  saveCommerceVideoWorkbench,
  waitCommerceVideoJob
} from "../providers/commerce-video";
import { fetchProjectFileText, projectFileUrl } from "../providers/registry";
import type { ProjectFile } from "../types";
import { Icon } from "./Icon";
import styles from "./StoryboardEditor.module.css";

type ShotStatus = "synced" | "dirty" | "refreshing" | "queued" | "refreshed";
type ScriptTemplateId = "clean-girl-tryon" | "detail-proof-closeup" | "scenario-switch";
type ExportFormat = "mp4" | "webm" | "mov";
type ExportResolution = "1080x1920" | "720x1280" | "1080x1080";

interface StoryboardShot {
  id: string;
  title: string;
  sellingPoint: string;
  visual: string;
  assetName: string;
  assetIn: number;
  assetOut: number;
  duration: number;
  dialogue: string;
  status: ShotStatus;
  version: number;
}

interface ScriptEntity {
  id: string;
  title: string;
  templateId: ScriptTemplateId;
  version: number;
  sellingPoints: string;
  body: string;
  cta: string;
}

interface ScriptTemplate {
  id: ScriptTemplateId;
  label: string;
  strategy: string;
  factors: string[];
  constraints: string[];
}

interface ReferenceVideoMock {
  id: string;
  title: string;
  source: string;
  category: string;
  matchReason: string;
  hookMethod: string;
  storyboardPattern: string;
  style: string;
  score: number;
}

interface ExportSettings {
  format: ExportFormat;
  resolution: ExportResolution;
  includeSubtitles: boolean;
  includeVoiceover: boolean;
  includeBgm: boolean;
  targetDuration: number;
}

interface ExportResult {
  id: string;
  name: string;
  format: ExportFormat;
  resolution: ExportResolution;
  duration: number;
  status: "requested" | "ready" | "failed";
  scriptVersion: number;
}

interface RenderTaskState {
  taskId: string;
  status: string;
  progress: string[];
  nextSince: number;
}

const WORKFLOW_STAGE_IDS: CommerceVideoStageId[] = [
  "materials",
  "script",
  "storyboard",
  "generation",
  "progress",
  "export"
];

const WORKFLOW_STAGE_COPY: Record<CommerceVideoStageId, { label: string; eyebrow: string; summary: string }> = {
  materials: {
    label: "商品素材",
    eyebrow: "Materials",
    summary: "上传商品图、商品视频、卖点素材，并确认是否进入 workflow。"
  },
  script: {
    label: "剧本生成",
    eyebrow: "Script",
    summary: "沉淀标题、钩子、卖点、口播和 CTA，作为分镜输入。"
  },
  storyboard: {
    label: "基础分镜",
    eyebrow: "Storyboard",
    summary: "管理镜头、时长、素材切片、画面目标和台词。"
  },
  generation: {
    label: "一键成片",
    eyebrow: "Generation",
    summary: "确认模型、时长、格式和成片任务配置，只负责创建生成任务。"
  },
  progress: {
    label: "任务进度",
    eyebrow: "Progress",
    summary: "单独观察生成任务、等待结果和失败原因，不自动进入导出。"
  },
  export: {
    label: "预览导出",
    eyebrow: "Preview / export",
    summary: "检查预览文件、导出文件和最终 manifest。"
  }
};

const STAGE_SYSTEM_PROMPTS: Record<CommerceVideoStageId, string> = {
  materials:
    "系统提示词：当前只处理商品素材上传与素材确认。识别商品图/视频、卖点素材、缺失项和素材风险；完成后必须停下，询问用户是否进入剧本生成，不要生成脚本、分镜或成片。",
  script:
    "系统提示词：当前只处理剧本生成。先从素材库解析好的优质视频库中找相似公开视频参考；只保存结构化分析和素材来源，不复刻、不混剪原视频。再提炼方法论模板（策略 + 因子），结合商品信息生成标题、钩子、卖点、口播、CTA 和约束清单。完成后必须停下，询问用户是否进入基础分镜；不要生成基础分镜、不要保存 storyboard、不要创建成片任务。",
  storyboard:
    "系统提示词：当前只处理基础分镜。只把已保存剧本拆成镜头、时长、画面目标、素材建议、口播/字幕和 QA 检查；完成后必须停下，询问用户是否进入一键成片，不要回写剧本，不要创建生成任务。",
  generation:
    "系统提示词：当前只处理一键成片任务创建。确认模型、比例、时长和输出文件并创建生成任务；任务创建后必须停下，询问用户是否进入任务进度，不要等待任务或导出。",
  progress:
    "系统提示词：当前只处理任务进度。观察/等待生成任务状态、进度和错误；任务完成后必须停下，询问用户是否进入预览导出，不要自动导出。",
  export:
    "系统提示词：当前只处理预览导出。读取预览文件、执行导出 manifest、提供下载/预览路径；不要回头重写脚本、分镜或重新生成成片。"
};

interface Props {
  projectId: string;
  files: ProjectFile[];
  onOpenFile?: (name: string) => void;
  onRequestAgentPrompt?: (prompt: string) => void;
}

const STORAGE_PREFIX = "od:storyboard-editor:";
const SCRIPT_STORAGE_PREFIX = "od:storyboard-script:";
const EXPORT_STORAGE_PREFIX = "od:storyboard-export:";
const STORYBOARD_FILE_RE = /(^|[/\\])(storyboard|分镜|fenjing|shots?|scenes?)[^/\\]*\.(json|md|txt)$/i;

const EMPTY_ASSET = "";
const DEFAULT_COMMERCE_VIDEO_MODEL: string = COMMERCE_VIDEO_MODEL_OPTIONS[0]?.id ?? "doubao-seedance-2-0-260128";
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: "mp4",
  resolution: "1080x1920",
  includeSubtitles: true,
  includeVoiceover: true,
  includeBgm: true,
  targetDuration: 15
};

const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: "clean-girl-tryon",
    label: "通勤 Clean Girl",
    strategy: "第一人称试穿 + 氛围 BGM + 细节证明，把商品从真实穿搭场景里自然推荐出来。",
    factors: ["开场=镜前上身 1 秒抓气质", "画面重点=翻领/腰带/金扣/裙摆", "旁白=优雅知性", "退场=价格或行动引导"],
    constraints: ["只使用用户上传商品事实", "不虚构面料、价格、品牌承诺", "剧本阶段不落分镜表"]
  },
  {
    id: "detail-proof-closeup",
    label: "细节证明流",
    strategy: "用近景细节和穿着动作证明卖点，先给结果感，再给可见证据。",
    factors: ["开场=痛点/愿望一句话", "中段=扣子、腰带、口袋、版型近景", "字幕=短句卖点", "结尾=适合场景 + CTA"],
    constraints: ["每个卖点都要能从素材或商品信息追溯", "不复刻参考视频原片", "不要自动进入基础分镜"]
  },
  {
    id: "scenario-switch",
    label: "场景切换流",
    strategy: "围绕通勤、约会、面试、轻社交做场景切换，让一件商品覆盖多种购买理由。",
    factors: ["开场=一条裙子解决多场景", "结构=场景名 + 对应卖点", "画面=全身/半身/细节交替", "结尾=今天下单理由"],
    constraints: ["场景必须符合商品定位", "不要写无法验证的功效", "保存脚本后等待用户确认再进入分镜"]
  }
];

const REFERENCE_VIDEO_MOCKS: ReferenceVideoMock[] = [
  {
    id: "mock-fashion-001",
    title: "白色通勤裙 15 秒试穿拆解",
    source: "public mock / fashion reference",
    category: "女装 / 连衣裙",
    matchReason: "同为白色通勤连衣裙，强调翻领、腰线和多场景穿搭。",
    hookMethod: "前三秒直接给“夏天通勤不用想穿什么”的场景钩子。",
    storyboardPattern: "镜前试穿 -> 领口腰带细节 -> 全身走动 -> 场景/CTA 收口",
    style: "clean girl、轻通勤、浅色自然光",
    score: 92
  },
  {
    id: "mock-fashion-002",
    title: "极简白裙细节证明短片",
    source: "public mock / detail proof",
    category: "女装 / 极简风",
    matchReason: "参考视频以金属扣、腰带、口袋作为可信证据，适合白裙商品。",
    hookMethod: "用“看起来简单，其实显贵在细节”引入。",
    storyboardPattern: "半身近景 -> 扣子/腰带特写 -> 口袋动作 -> 优惠字幕",
    style: "克制、干净、偏电商详情页节奏",
    score: 88
  },
  {
    id: "mock-fashion-003",
    title: "一条裙子四个场景种草",
    source: "public mock / scenario montage",
    category: "女装 / 多场景穿搭",
    matchReason: "场景覆盖通勤、约会、面试和聚会，贴合用户商品定位。",
    hookMethod: "用“一条白裙搞定一周穿搭”制造购买理由。",
    storyboardPattern: "场景标题快切 -> 对应卖点口播 -> 模特全身回看 -> CTA",
    style: "都市、轻快、字幕节奏强",
    score: 84
  }
];

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.5, Math.min(30, Math.round(value * 10) / 10));
}

function clampAssetTime(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(600, Math.round(value * 10) / 10));
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function mediaFiles(files: ProjectFile[]): ProjectFile[] {
  return files
    .filter((file) => file.kind === "image" || file.kind === "video")
    .sort((left, right) => left.name.localeCompare(right.name));
}

function storyboardSourceFile(files: ProjectFile[]): ProjectFile | null {
  return (
    files.find((file) => STORYBOARD_FILE_RE.test(file.name) && (file.kind === "text" || file.kind === "code")) ?? null
  );
}

function createDefaultShots(files: ProjectFile[]): StoryboardShot[] {
  void files;
  return [];
}

function defaultScriptEntity(): ScriptEntity {
  const template = SCRIPT_TEMPLATES[0]!;
  return {
    id: "script-main",
    title: "",
    templateId: template.id,
    version: 1,
    sellingPoints: "",
    body: "",
    cta: ""
  };
}

function scriptFromTemplate(templateId: ScriptTemplateId, current?: ScriptEntity): ScriptEntity {
  const template = SCRIPT_TEMPLATES.find((item) => item.id === templateId) ?? SCRIPT_TEMPLATES[0]!;
  return {
    id: current?.id ?? "script-main",
    title: current?.title ?? "",
    templateId: template.id,
    version: (current?.version ?? 1) + 1,
    sellingPoints: current?.sellingPoints ?? "",
    body: current?.body ?? "",
    cta: current?.cta ?? ""
  };
}

function sellingPointList(script: ScriptEntity): string[] {
  return script.sellingPoints
    .split(/\r?\n|[，,；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function readStoredShots(projectId: string): StoryboardShot[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return normalizeShots(parsed, []);
  } catch {
    return null;
  }
}

function storeShots(projectId: string, shots: StoryboardShot[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(shots));
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function readStoredScript(projectId: string): ScriptEntity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${SCRIPT_STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    return normalizeScript(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function storeScript(projectId: string, script: ScriptEntity): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${SCRIPT_STORAGE_PREFIX}${projectId}`, JSON.stringify(script));
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function readStoredExports(projectId: string): ExportResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(`${EXPORT_STORAGE_PREFIX}${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ExportResult | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const format = stringValue(record.format) as ExportFormat;
        const resolution = stringValue(record.resolution) as ExportResolution;
        if (!["mp4", "webm", "mov"].includes(format)) return null;
        if (!["1080x1920", "720x1280", "1080x1080"].includes(resolution)) return null;
        return {
          id: stringValue(record.id) || `export-${Date.now()}`,
          name: stringValue(record.name) || "成片导出",
          format,
          resolution,
          duration: clampDuration(numberValue(record.duration) ?? 15),
          status: record.status === "ready" ? "ready" : "requested",
          scriptVersion: Math.max(1, Math.round(numberValue(record.scriptVersion) ?? 1))
        };
      })
      .filter((item): item is ExportResult => Boolean(item));
  } catch {
    return [];
  }
}

function storeExports(projectId: string, results: ExportResult[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${EXPORT_STORAGE_PREFIX}${projectId}`, JSON.stringify(results));
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function normalizeShots(value: unknown, assets: ProjectFile[]): StoryboardShot[] | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const rawShots = Array.isArray(value)
    ? value
    : Array.isArray(record?.shots)
      ? record.shots
      : Array.isArray(record?.scenes)
        ? record.scenes
        : Array.isArray(record?.storyboard)
          ? record.storyboard
          : null;
  if (!rawShots || rawShots.length === 0) return null;

  const assetNames = new Set(assets.map((file) => file.name));
  const normalized = rawShots
    .map((shot, index): StoryboardShot | null => {
      if (!shot || typeof shot !== "object") return null;
      const item = shot as Record<string, unknown>;
      const id = stringValue(item.id) || `shot-${index + 1}`;
      const duration = clampDuration(
        numberValue(item.duration) ?? numberValue(item.durationSec) ?? numberValue(item.seconds) ?? 3
      );
      const rawAsset = stringValue(item.assetName) || stringValue(item.asset) || stringValue(item.slice) || "";
      const assetName = assetNames.has(rawAsset)
        ? rawAsset
        : (assets[index % Math.max(assets.length, 1)]?.name ?? EMPTY_ASSET);
      const assetIn = clampAssetTime(numberValue(item.assetIn) ?? numberValue(item.start) ?? 0);
      const assetOut = clampAssetTime(numberValue(item.assetOut) ?? numberValue(item.end) ?? assetIn + duration);
      return {
        id,
        title: stringValue(item.title) || stringValue(item.name) || stringValue(item.scene) || `镜头 ${index + 1}`,
        sellingPoint: stringValue(item.sellingPoint) || stringValue(item.point) || stringValue(item.benefit) || "",
        visual:
          stringValue(item.visual) ||
          stringValue(item.description) ||
          stringValue(item.prompt) ||
          stringValue(item.imagePrompt) ||
          "",
        assetName,
        assetIn,
        assetOut: Math.max(assetIn, assetOut),
        duration,
        dialogue:
          stringValue(item.dialogue) ||
          stringValue(item.voiceover) ||
          stringValue(item.line) ||
          stringValue(item.narration) ||
          "",
        status: "synced",
        version: Math.max(1, Math.round(numberValue(item.version) ?? 1))
      };
    })
    .filter((shot): shot is StoryboardShot => Boolean(shot));
  return normalized.length > 0 ? normalized : null;
}

function normalizeScript(value: unknown): ScriptEntity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const templateId = stringValue(record.templateId) as ScriptTemplateId;
  const validTemplate = SCRIPT_TEMPLATES.some((template) => template.id === templateId);
  return {
    id: stringValue(record.id) || "script-main",
    title: stringValue(record.title),
    templateId: validTemplate ? templateId : "clean-girl-tryon",
    version: Math.max(1, Math.round(numberValue(record.version) ?? 1)),
    sellingPoints: stringValue(record.sellingPoints) || stringValue(record.points),
    body: stringValue(record.body) || stringValue(record.script),
    cta: stringValue(record.cta)
  };
}

function scriptFromWorkflow(workflow: CommerceVideoWorkflow): ScriptEntity | null {
  if (!workflow.script) return null;
  return {
    id: "script-main",
    title: workflow.script.title || "",
    templateId: "clean-girl-tryon",
    version: 1,
    sellingPoints: workflow.script.sellingPoints.join("\n"),
    body: workflow.script.voiceover,
    cta: workflow.script.cta || ""
  };
}

function shotsFromWorkflow(workflow: CommerceVideoWorkflow, assets: ProjectFile[]): StoryboardShot[] | null {
  const shots = workflow.storyboard?.shots;
  if (!shots || shots.length === 0) return null;
  const assetNames = new Set(assets.map((file) => file.name));
  return shots.map((shot, index) => {
    const requiredAsset = shot.requiredAssets.find((asset) => assetNames.has(asset)) ?? EMPTY_ASSET;
    return {
      id: shot.id || `shot-${index + 1}`,
      title: `镜头 ${index + 1}`,
      sellingPoint: shot.qaCheck || "",
      visual: shot.visualGoal || shot.prompt,
      assetName: requiredAsset,
      assetIn: 0,
      assetOut: clampDuration(shot.durationSec),
      duration: clampDuration(shot.durationSec),
      dialogue: shot.voiceover || shot.caption || "",
      status: "synced",
      version: 1
    };
  });
}

function workflowScriptInput(script: ScriptEntity) {
  const sellingPoints = sellingPointList(script);
  return {
    title: script.title,
    hook: sellingPoints[0] || script.title,
    voiceover: script.body,
    sellingPoints,
    ...(script.cta ? { cta: script.cta } : {})
  };
}

function workflowStoryboardInput(shots: StoryboardShot[]) {
  return {
    shots: shots.slice(0, 6).map((shot) => ({
      id: shot.id,
      visualGoal: shot.visual || shot.title,
      prompt: shot.visual || shot.title,
      voiceover: shot.dialogue,
      caption: shot.dialogue,
      durationSec: Math.min(15, Math.max(1, Math.round(shot.duration))),
      requiredAssets: shot.assetName ? [shot.assetName] : [],
      qaCheck: shot.sellingPoint
    }))
  };
}

function previewPathFromWorkflow(workflow: CommerceVideoWorkflow | null): string | null {
  return workflow?.generation?.output?.path ?? workflow?.export?.previewPath ?? null;
}

function downloadPathFromWorkflow(workflow: CommerceVideoWorkflow | null): string | null {
  return workflow?.export?.downloadPath ?? workflow?.generation?.output?.path ?? null;
}

function mergeRenderTask(current: RenderTaskState | null, snapshot: CommerceVideoJobWaitResponse): RenderTaskState {
  const priorProgress = current?.taskId === snapshot.taskId ? current.progress : [];
  return {
    taskId: snapshot.taskId,
    status: snapshot.status,
    progress: [...priorProgress, ...snapshot.progress],
    nextSince: snapshot.nextSince
  };
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "interrupted";
}

function workflowGenerationFailureMessage(workflow: CommerceVideoWorkflow | null): string | null {
  const status = workflow?.generation?.status;
  if (status !== "failed" && status !== "cancelled" && status !== "interrupted") return null;
  return workflow?.generation?.error?.message ?? "成片生成失败";
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "排队";
    case "running":
      return "生成中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "interrupted":
      return "已中断";
    default:
      return status || "等待生成";
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function shotStart(shots: StoryboardShot[], shotId: string): number {
  let cursor = 0;
  for (const shot of shots) {
    if (shot.id === shotId) return cursor;
    cursor += shot.duration;
  }
  return 0;
}

function shotAtTime(shots: StoryboardShot[], time: number): StoryboardShot | null {
  let cursor = 0;
  for (const shot of shots) {
    cursor += shot.duration;
    if (time <= cursor) return shot;
  }
  return shots[shots.length - 1] ?? null;
}

function reorderShots(shots: StoryboardShot[], draggedId: string, targetId: string): StoryboardShot[] {
  if (draggedId === targetId) return shots;
  const from = shots.findIndex((shot) => shot.id === draggedId);
  const to = shots.findIndex((shot) => shot.id === targetId);
  if (from < 0 || to < 0) return shots;
  const next = shots.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return shots;
  next.splice(to, 0, moved);
  return next.map((shot) => ({ ...shot, status: shot.id === draggedId ? "dirty" : shot.status }));
}

function buildAgentPrompt(shots: StoryboardShot[], changedIds: Set<string>, script: ScriptEntity): string {
  const changed = shots.filter((shot) => changedIds.has(shot.id));
  const changedSummary =
    changed.length > 0
      ? changed.map((shot, index) => `${index + 1}. ${shot.title} (${shot.id})`).join("\n")
      : "无显式脏分镜；请按当前分镜表做一次快速一致性检查。";
  const shotLines = shots
    .map((shot, index) => {
      const changedMark = changedIds.has(shot.id) ? " [changed]" : "";
      return [
        `${index + 1}. ${shot.title}${changedMark}`,
        `   id: ${shot.id}`,
        `   duration: ${formatSeconds(shot.duration)}`,
        `   asset: ${shot.assetName || "待生成/待匹配素材"}`,
        `   slice: ${formatSeconds(shot.assetIn)}-${formatSeconds(shot.assetOut)}`,
        `   visual: ${shot.visual || "未填写"}`,
        `   dialogue: ${shot.dialogue || "无台词"}`,
        `   version: v${shot.version}`
      ].join("\n");
    })
    .join("\n");

  return [
    "请基于当前项目执行分镜级干预，并快速重渲染整体视频。",
    "",
    `脚本实体：${script.title} v${script.version}`,
    `核心卖点：${sellingPointList(script).join(" / ") || "未填写"}`,
    `CTA：${script.cta || "未填写"}`,
    "",
    "要求：",
    "- 只对标记为 [changed] 的单个分镜做重生成、素材切片替换、时长或台词调整。",
    "- 未标记的分镜尽量复用已有素材、镜头和渲染结果，不要重做整片策略。",
    "- 局部刷新完成后再拼接整片，保持字幕、口播、节奏和画面连续性。",
    "- 如果项目已有可执行渲染脚本或 Hyperframes/Remotion 源文件，请直接更新源文件并输出新成片。",
    "",
    "变更分镜：",
    changedSummary,
    "",
    "当前分镜表：",
    shotLines
  ].join("\n");
}

function selectedScriptTemplate(script: ScriptEntity): ScriptTemplate {
  return SCRIPT_TEMPLATES.find((template) => template.id === script.templateId) ?? SCRIPT_TEMPLATES[0]!;
}

function buildScriptPrompt(
  script: ScriptEntity,
  productMaterials: CommerceVideoProductMaterial[],
  files: ProjectFile[]
): string {
  const template = selectedScriptTemplate(script);
  const materialLines =
    productMaterials.length > 0
      ? productMaterials
          .map((material, index) =>
            [
              `${index + 1}. ${material.title || material.subject || material.id}`,
              `   source: ${material.sourceKind}`,
              `   subject: ${material.subject || "未填写"}`,
              `   category: ${material.category || "未填写"}`,
              `   files: ${
                material.files
                  .map((file) => file.path || file.name)
                  .filter(Boolean)
                  .join(", ") || "未绑定"
              }`,
              `   selling_points: ${material.product.sellingPoints.join(" / ") || "待 AI 从素材事实中提炼"}`
            ].join("\n")
          )
          .join("\n")
      : files
          .filter((file) => file.kind === "image" || file.kind === "video")
          .map((file, index) => `${index + 1}. ${file.name} (${file.kind}, ${file.mime ?? "unknown"})`)
          .join("\n") || "暂无商品素材文件，请先完成商品素材上传。";

  return [
    STAGE_SYSTEM_PROMPTS.script,
    "",
    "请严格执行 commerce-video 第 2 阶段「剧本生成」：只输出剧本，不要生成基础分镜，不要调用 storyboard，不要创建成片任务。",
    "",
    "剧本模块三步链路：",
    "1. 找参考：从素材库里解析好的优质视频库寻找相似公开视频；如果真实检索不可用，使用下方 mock 参考视频做结构化拆解。",
    "2. 提炼方法论：把同套路视频聚类为灵感模板，拆成策略 + 因子。",
    "3. 生产剧本：用策略 + 因子 + 商品信息 + 约束规则生成完整电商 AIGC 视频剧本。",
    "",
    "优质视频库（mock，仅保存结构化分析和来源声明，不复刻、不混剪原视频）：",
    REFERENCE_VIDEO_MOCKS.map((video, index) =>
      [
        `${index + 1}. ${video.title}`,
        `   id: ${video.id}`,
        `   source: ${video.source}`,
        `   match_score: ${video.score}`,
        `   match_reason: ${video.matchReason}`,
        `   hook: ${video.hookMethod}`,
        `   storyboard_pattern: ${video.storyboardPattern}`,
        `   style: ${video.style}`
      ].join("\n")
    ).join("\n"),
    "",
    "方法论模板：",
    `strategy: ${template.strategy}`,
    `factors: ${template.factors.join(" / ")}`,
    `constraints: ${template.constraints.join(" / ")}`,
    "",
    "商品素材事实：",
    materialLines,
    "",
    "当前人工输入（可为空，空则由 AI 基于素材事实填写）：",
    `title: ${script.title || "待生成"}`,
    `selling_points: ${sellingPointList(script).join(" / ") || "待生成"}`,
    `voiceover: ${script.body || "待生成"}`,
    `cta: ${script.cta || "待生成"}`,
    "",
    "输出格式：",
    "- 标题",
    "- 开场钩子",
    "- 3 个核心卖点，每个卖点必须有素材或商品信息依据",
    "- 15 秒中文口播正文",
    "- CTA",
    "- 视觉风格",
    "- 约束清单",
    "- 来源声明：列出使用的参考视频 id/source；说明只使用结构化分析，不复刻原视频",
    "",
    "完成后调用 od commerce-video script 写入剧本阶段，并停下询问：是否进入基础分镜？"
  ].join("\n");
}

function storyboardMaterialLines(files: ProjectFile[], productMaterials: CommerceVideoProductMaterial[]): string {
  const materialLines = productMaterials.flatMap((material, index) => {
    const filesText = material.files
      .map((file) => file.path)
      .filter(Boolean)
      .join(" / ");
    return [
      `${index + 1}. ${material.title} (${material.id})`,
      `   subject: ${material.subject || "未识别"}`,
      `   selling_points: ${material.product.sellingPoints.join(" / ") || "待从素材事实中提炼"}`,
      `   constraints: ${material.product.constraints.join(" / ") || "以用户上传素材为准"}`,
      filesText ? `   files: ${filesText}` : ""
    ].filter(Boolean);
  });
  const fileLines = files
    .filter((file) => file.kind === "image" || file.kind === "video")
    .map((file, index) => `${index + 1}. ${file.name} (${file.kind}, ${file.mime ?? "unknown"})`);
  const lines = materialLines.length ? materialLines : fileLines;
  return lines.length ? lines.join("\n") : "暂无可用素材；如缺少商品图/链接，必须在分镜 QA 中标注缺失素材。";
}

function buildStoryboardPrompt(
  script: ScriptEntity,
  shots: StoryboardShot[],
  files: ProjectFile[] = [],
  productMaterials: CommerceVideoProductMaterial[] = []
): string {
  const currentShotLines = shots
    .map(
      (shot, index) =>
        `${index + 1}. ${shot.title} / ${shot.sellingPoint || "未绑定卖点"} / ${formatSeconds(shot.duration)} / ${shot.assetName || "待生成素材"}`
    )
    .join("\n");
  return [
    STAGE_SYSTEM_PROMPTS.storyboard,
    "",
    "请把当前商品卖点稳定串成“分镜脚本 -> 镜头计划”。",
    "",
    `脚本实体：${script.title} v${script.version}`,
    `模板：${SCRIPT_TEMPLATES.find((item) => item.id === script.templateId)?.label ?? script.templateId}`,
    `卖点：${sellingPointList(script).join(" / ") || "未填写"}`,
    `脚本正文：${script.body || "未填写"}`,
    `CTA：${script.cta || "未填写"}`,
    "",
    "可用素材链路：",
    storyboardMaterialLines(files, productMaterials),
    "",
    "输出要求：",
    "- 先给 15 秒内成片结构，再给镜头级计划。",
    "- 每个镜头必须包含绑定卖点、画面目标、口播/字幕、素材需求、时长和重生成提示。",
    "- 保持商品图片/商品链接到脚本、分镜、TTS/BGM/字幕、预览导出的连续链路。",
    "- 分镜必须写入右侧工作台：构造 3-6 个 shots，总时长 <=15s，每个 shot 都有 visualGoal、prompt、durationSec、requiredAssets、voiceover/caption 和 qaCheck。",
    "",
    "storyboard-json 结构示例：",
    JSON.stringify(
      {
        shots: [
          {
            id: "shot_1",
            durationSec: 3,
            visualGoal: "画面目标",
            prompt: "图片/视频生成或剪辑提示词",
            voiceover: "口播",
            caption: "字幕",
            camera: "镜头运动",
            requiredAssets: ["商品图片或素材路径"],
            qaCheck: "QA 检查点"
          }
        ]
      },
      null,
      2
    ),
    "",
    "完成镜头计划后必须调用命令写入基础分镜工作台：",
    '`"$OD_NODE_BIN" "$OD_BIN" commerce-video storyboard --project "$OD_PROJECT_ID" --storyboard-json \'<json>\' --json`',
    "等价命令名：od commerce-video storyboard。只调用 storyboard；不要调用 script、generate、jobs、wait、preview 或 export。",
    "命令成功后停下，询问：是否进入一键成片？",
    "",
    "当前镜头计划：",
    currentShotLines || "无已保存镜头；请从已保存剧本拆出新的基础分镜。"
  ].join("\n");
}

function buildExportPrompt(
  script: ScriptEntity,
  shots: StoryboardShot[],
  settings: ExportSettings,
  selectedModel: string
): string {
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  return [
    STAGE_SYSTEM_PROMPTS.generation,
    "",
    "请执行一键成片阶段：只创建生成任务，不要等待任务完成，不要自动导出。",
    "",
    "目标链路：商品输入 -> 脚本 -> 分镜 -> TTS/BGM/字幕 -> <=15s 成片 -> 预览/导出。",
    `脚本实体：${script.title} v${script.version}`,
    `脚本正文：${script.body || "未填写"}`,
    `CTA：${script.cta || "未填写"}`,
    "",
    "导出设置：",
    `format: ${settings.format}`,
    `resolution: ${settings.resolution}`,
    `video_model: ${selectedModel}`,
    `target_duration: <=${formatSeconds(settings.targetDuration)}`,
    `current_duration: ${formatSeconds(totalDuration)}`,
    `subtitles: ${settings.includeSubtitles ? "on" : "off"}`,
    `tts: ${settings.includeVoiceover ? "on" : "off"}`,
    `bgm: ${settings.includeBgm ? "on" : "off"}`,
    "",
    "镜头计划：",
    shots
      .map((shot, index) =>
        [
          `${index + 1}. ${shot.title}`,
          `   selling_point: ${shot.sellingPoint || "未绑定"}`,
          `   duration: ${formatSeconds(shot.duration)}`,
          `   asset: ${shot.assetName || "待生成/待匹配素材"}`,
          `   visual: ${shot.visual || "未填写"}`,
          `   dialogue: ${shot.dialogue || "无台词"}`
        ].join("\n")
      )
      .join("\n"),
    "",
    "请返回：预览路径、导出文件路径、格式信息、失败重试建议和结果管理摘要。"
  ].join("\n");
}

function stageStatusLabel(stage: CommerceVideoStage): string {
  switch (stage.status) {
    case "queued":
      return "排队";
    case "running":
      return "进行中";
    case "done":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "interrupted":
      return "已中断";
    default:
      return "未开始";
  }
}

function defaultWorkflowStage(id: CommerceVideoStageId): CommerceVideoStage {
  return {
    id,
    label: WORKFLOW_STAGE_COPY[id].label,
    status: "idle"
  };
}

function normalizedWorkflowStages(workflow: CommerceVideoWorkflow | null): CommerceVideoStage[] {
  return WORKFLOW_STAGE_IDS.map((id) => {
    const stage = workflow?.stages.find((item) => item.id === id);
    return stage ? { ...stage, label: WORKFLOW_STAGE_COPY[id].label } : defaultWorkflowStage(id);
  });
}

function workflowStageGate(workflow: CommerceVideoWorkflow | null): {
  activeStageId: CommerceVideoStageId;
  pendingNextStageId: CommerceVideoStageId | null;
} {
  const activeFromWorkbench = stageIdFromWorkbench(workflow?.workbench?.activeStageId);
  if (activeFromWorkbench) {
    return {
      activeStageId: activeFromWorkbench,
      pendingNextStageId:
        workflow?.workbench?.pendingNextStageId === null
          ? null
          : (stageIdFromWorkbench(workflow?.workbench?.pendingNextStageId) ?? null)
    };
  }

  const stages = normalizedWorkflowStages(workflow);
  const active = stages.find((stage) => stage.status === "running" || stage.status === "queued");
  if (active) return { activeStageId: active.id, pendingNextStageId: null };
  const failed = stages.find(
    (stage) => stage.status === "failed" || stage.status === "cancelled" || stage.status === "interrupted"
  );
  if (failed) return { activeStageId: failed.id, pendingNextStageId: null };

  const nextIndex = stages.findIndex((stage) => stage.status !== "done");
  if (nextIndex < 0) return { activeStageId: "export", pendingNextStageId: null };
  const nextStage = stages[nextIndex]!;
  if (nextIndex > 0 && nextStage.status === "idle") {
    return { activeStageId: stages[nextIndex - 1]!.id, pendingNextStageId: nextStage.id };
  }
  return { activeStageId: nextStage.id, pendingNextStageId: null };
}

function stageIdFromWorkbench(value: unknown): CommerceVideoStageId | null {
  return typeof value === "string" && WORKFLOW_STAGE_IDS.includes(value as CommerceVideoStageId)
    ? (value as CommerceVideoStageId)
    : null;
}

function nextWorkflowStageId(stageId: CommerceVideoStageId): CommerceVideoStageId | null {
  const index = WORKFLOW_STAGE_IDS.indexOf(stageId);
  return index >= 0 ? (WORKFLOW_STAGE_IDS[index + 1] ?? null) : null;
}

function stageIndex(stageId: CommerceVideoStageId): number {
  return WORKFLOW_STAGE_IDS.indexOf(stageId);
}

export function StoryboardEditor({ projectId, files, onOpenFile, onRequestAgentPrompt }: Props) {
  const assets = useMemo(() => mediaFiles(files), [files]);
  const [shots, setShots] = useState<StoryboardShot[]>(() => readStoredShots(projectId) ?? createDefaultShots(files));
  const [script, setScript] = useState<ScriptEntity>(() => readStoredScript(projectId) ?? defaultScriptEntity());
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [selectedVideoModel, setSelectedVideoModel] = useState<string>(DEFAULT_COMMERCE_VIDEO_MODEL);
  const [exportResults, setExportResults] = useState<ExportResult[]>(() => readStoredExports(projectId));
  const [activeShotId, setActiveShotId] = useState(() => shots[0]?.id ?? "");
  const [draggedShotId, setDraggedShotId] = useState<string | null>(null);
  const [changedShotIds, setChangedShotIds] = useState<Set<string>>(() => new Set());
  const [playTime, setPlayTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<CommerceVideoWorkflow | null>(null);
  const [productMaterials, setProductMaterials] = useState<CommerceVideoProductMaterial[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [renderTask, setRenderTask] = useState<RenderTaskState | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [activeSidebarStage, setActiveSidebarStage] = useState<CommerceVideoStageId>("materials");
  const [currentFlowStageId, setCurrentFlowStageId] = useState<CommerceVideoStageId>("materials");
  const [pendingNextStageId, setPendingNextStageId] = useState<CommerceVideoStageId | null>(null);
  const loadedSourceRef = useRef<string | null>(null);
  const refreshTimersRef = useRef<number[]>([]);

  const totalDuration = useMemo(() => shots.reduce((sum, shot) => sum + shot.duration, 0), [shots]);
  const workflowStages = useMemo(() => normalizedWorkflowStages(workflow), [workflow]);
  const currentStageId = currentFlowStageId;
  const activeStage = workflowStages.find((stage) => stage.id === activeSidebarStage) ?? workflowStages[0]!;
  const activeShot = shots.find((shot) => shot.id === activeShotId) ?? shots[0] ?? null;
  const activeAsset = activeShot?.assetName
    ? (assets.find((asset) => asset.name === activeShot.assetName) ?? null)
    : null;
  const lastRenderProgress = renderTask?.progress[renderTask.progress.length - 1] ?? null;

  function syncWorkflowState(
    nextWorkflow: CommerceVideoWorkflow,
    nextProductMaterials?: CommerceVideoProductMaterial[]
  ): void {
    setWorkflow(nextWorkflow);
    if (nextProductMaterials) setProductMaterials(nextProductMaterials);
    const nextGate = workflowStageGate(nextWorkflow);
    setCurrentFlowStageId(nextGate.activeStageId);
    setActiveSidebarStage(nextGate.activeStageId);
    setPendingNextStageId(nextGate.pendingNextStageId);
    setSelectedVideoModel(
      nextWorkflow.workbench?.selectedModel ?? nextWorkflow.generation?.model ?? DEFAULT_COMMERCE_VIDEO_MODEL
    );
    if (nextWorkflow.workbench?.exportSettings) {
      setExportSettings((current) => ({
        ...current,
        ...nextWorkflow.workbench?.exportSettings
      }));
    }
    setPreviewPath(previewPathFromWorkflow(nextWorkflow));
    setDownloadPath(downloadPathFromWorkflow(nextWorkflow));
    const nextScript = scriptFromWorkflow(nextWorkflow);
    if (nextScript) setScript(nextScript);
    const nextShots = shotsFromWorkflow(nextWorkflow, assets);
    if (nextShots) {
      setShots(nextShots);
      setActiveShotId(nextShots[0]?.id ?? "");
      setChangedShotIds(new Set());
      setPlayTime(0);
    }
  }

  function refreshWorkflowFromBackend(): void {
    const stageAtRequest = currentFlowStageId;
    setWorkflowLoading(true);
    setWorkflowError(null);
    void fetchCommerceVideoWorkflow(projectId)
      .then(({ workflow: nextWorkflow, productMaterials: nextProductMaterials }) => {
        syncWorkflowState(nextWorkflow, nextProductMaterials ?? []);
        const nextGate = workflowStageGate(nextWorkflow);
        if (nextGate.pendingNextStageId) {
          setNotice(
            `${WORKFLOW_STAGE_COPY[nextGate.activeStageId].label}已从 workflow 同步。是否进入${WORKFLOW_STAGE_COPY[nextGate.pendingNextStageId].label}？`
          );
        } else {
          setNotice(
            stageAtRequest === nextGate.activeStageId
              ? "工作台已同步最新 workflow"
              : `工作台已同步到${WORKFLOW_STAGE_COPY[nextGate.activeStageId].label}`
          );
        }
      })
      .catch((error: unknown) => {
        setWorkflowError(error instanceof Error ? error.message : String(error));
        setNotice("同步 workflow 失败");
      })
      .finally(() => {
        setWorkflowLoading(false);
      });
  }

  useEffect(() => {
    const stored = readStoredShots(projectId);
    const next = stored ?? createDefaultShots(files);
    const nextScript = readStoredScript(projectId) ?? defaultScriptEntity();
    setShots(next);
    setScript(nextScript);
    setExportSettings(DEFAULT_EXPORT_SETTINGS);
    setExportResults(readStoredExports(projectId));
    setActiveShotId(next[0]?.id ?? "");
    setChangedShotIds(new Set());
    setPlayTime(0);
    setPlaying(false);
    setWorkflow(null);
    setProductMaterials([]);
    setWorkflowError(null);
    setRenderTask(null);
    setPreviewPath(null);
    setDownloadPath(null);
    setSelectedVideoModel(DEFAULT_COMMERCE_VIDEO_MODEL);
    setActiveSidebarStage("materials");
    setCurrentFlowStageId("materials");
    setPendingNextStageId(null);
    loadedSourceRef.current = null;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setWorkflowLoading(true);
    setWorkflowError(null);
    void fetchCommerceVideoWorkflow(projectId)
      .then(({ workflow: nextWorkflow, productMaterials: nextProductMaterials }) => {
        if (cancelled) return;
        syncWorkflowState(nextWorkflow, nextProductMaterials ?? []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkflowError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setWorkflowLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assets, projectId]);

  useEffect(() => {
    if (shots.length === 0 && activeShotId) setActiveShotId("");
  }, [activeShotId, shots.length]);

  useEffect(() => {
    storeShots(projectId, shots);
  }, [projectId, shots]);

  useEffect(() => {
    storeScript(projectId, script);
  }, [projectId, script]);

  useEffect(() => {
    storeExports(projectId, exportResults);
  }, [exportResults, projectId]);

  useEffect(() => {
    const message = workflowGenerationFailureMessage(workflow);
    if (!message) return;
    markGenerationFailed(message);
  }, [workflow?.generation?.status, workflow?.generation?.error?.message]);

  useEffect(() => {
    const source = storyboardSourceFile(files);
    if (!source) return;
    if (changedShotIds.size > 0) return;
    const sourceKey = `${projectId}:${source.name}:${source.mtime}`;
    if (loadedSourceRef.current === sourceKey) return;
    loadedSourceRef.current = sourceKey;

    let cancelled = false;
    void fetchProjectFileText(projectId, source.name, {
      cache: "no-store",
      cacheBustKey: source.mtime
    }).then((text) => {
      if (cancelled || !text) return;
      try {
        const parsed = JSON.parse(text) as unknown;
        const normalized = normalizeShots(parsed, assets);
        if (!normalized) return;
        setShots(normalized);
        setActiveShotId(normalized[0]?.id ?? "");
        setPlayTime(0);
      } catch {
        // Markdown storyboards remain editable through the default slate for now.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [assets, changedShotIds.size, files, projectId]);

  useEffect(() => {
    if (!playing || totalDuration <= 0) return;
    const interval = window.setInterval(() => {
      setPlayTime((current) => {
        const next = current + 0.1;
        return next >= totalDuration ? 0 : next;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [playing, totalDuration]);

  useEffect(() => {
    if (!playing) return;
    const shot = shotAtTime(shots, playTime);
    if (shot && shot.id !== activeShotId) setActiveShotId(shot.id);
  }, [activeShotId, playTime, playing, shots]);

  useEffect(
    () => () => {
      for (const timer of refreshTimersRef.current) window.clearTimeout(timer);
      refreshTimersRef.current = [];
    },
    []
  );

  function isStageDone(stageId: CommerceVideoStageId): boolean {
    return workflowStages.find((stage) => stage.id === stageId)?.status === "done";
  }

  function canOpenStage(stageId: CommerceVideoStageId): boolean {
    return stageIndex(stageId) <= stageIndex(currentFlowStageId) || isStageDone(stageId);
  }

  function openStage(stageId: CommerceVideoStageId): void {
    if (!canOpenStage(stageId)) {
      setNotice(
        `请先完成${WORKFLOW_STAGE_COPY[currentFlowStageId].label}，再确认进入${WORKFLOW_STAGE_COPY[stageId].label}`
      );
      return;
    }
    setActiveSidebarStage(stageId);
  }

  function persistWorkbenchState(patch: {
    activeStageId?: CommerceVideoStageId;
    pendingNextStageId?: CommerceVideoStageId | null;
    selectedModel?: string;
    exportSettings?: ExportSettings;
  }): void {
    const nextPending = Object.prototype.hasOwnProperty.call(patch, "pendingNextStageId")
      ? (patch.pendingNextStageId ?? null)
      : pendingNextStageId;
    void saveCommerceVideoWorkbench(projectId, {
      activeStageId: patch.activeStageId ?? currentFlowStageId,
      pendingNextStageId: nextPending,
      selectedModel: patch.selectedModel ?? selectedVideoModel,
      exportSettings: patch.exportSettings ?? exportSettings
    }).catch((error: unknown) => {
      setWorkflowError(error instanceof Error ? error.message : String(error));
    });
  }

  function updateSelectedVideoModel(model: string): void {
    setSelectedVideoModel(model);
    persistWorkbenchState({ selectedModel: model });
  }

  function updateExportSettings(patch: Partial<ExportSettings>): void {
    setExportSettings((current) => {
      const next = { ...current, ...patch };
      persistWorkbenchState({ exportSettings: next });
      return next;
    });
  }

  function markStageComplete(stageId: CommerceVideoStageId, prefix: string): void {
    const nextStage = nextWorkflowStageId(stageId);
    setCurrentFlowStageId(stageId);
    setActiveSidebarStage(stageId);
    setPendingNextStageId(nextStage);
    persistWorkbenchState({ activeStageId: stageId, pendingNextStageId: nextStage });
    setNotice(nextStage ? `${prefix}是否进入${WORKFLOW_STAGE_COPY[nextStage].label}？` : `${prefix}全部流程已完成。`);
  }

  function enterPendingStage(): void {
    if (!pendingNextStageId) return;
    const nextStage = pendingNextStageId;
    setCurrentFlowStageId(nextStage);
    setActiveSidebarStage(nextStage);
    setPendingNextStageId(null);
    persistWorkbenchState({ activeStageId: nextStage, pendingNextStageId: null });
    setNotice(`已进入${WORKFLOW_STAGE_COPY[nextStage].label}`);
  }

  function markGenerationFailed(message: string): void {
    setCurrentFlowStageId("progress");
    setActiveSidebarStage("progress");
    setPendingNextStageId(null);
    persistWorkbenchState({ activeStageId: "progress", pendingNextStageId: null });
    setExportResults((current) =>
      current.map((item) => (item.status === "requested" ? { ...item, status: "failed" } : item))
    );
    setNotice(`成片生成失败：${message}`);
  }

  function materialWorkflowInput() {
    const uploadedFiles = assets.map((asset) => ({
      path: asset.name,
      name: asset.name.split(/[\\/]/).pop() ?? asset.name,
      mime: asset.mime,
      size: asset.size
    }));
    const existingMaterialIds =
      workflow?.materials.productMaterialIds ?? productMaterials.map((material) => material.id);
    const shouldCreateMaterial = uploadedFiles.length > 0 && productMaterials.length === 0;
    return {
      productMaterialIds: existingMaterialIds,
      productMaterials: shouldCreateMaterial
        ? [
            {
              id: "storyboard-editor-uploaded-material",
              title: script.title || "项目商品素材",
              subject: sellingPointList(script)[0] ?? "待识别商品",
              category: "commerce-video",
              sourceKind: "upload" as const,
              files: uploadedFiles,
              product: {
                summary: "由分镜剪辑台确认的项目图片/视频素材。",
                sellingPoints: sellingPointList(script),
                constraints: ["以用户上传素材和当前脚本事实为准"],
                suggestedAngles: shots
                  .slice(0, 6)
                  .map((shot) => shot.visual || shot.title)
                  .filter(Boolean)
              },
              metadata: {
                createdBy: "storyboard-editor"
              }
            }
          ]
        : [],
      uploadedFiles,
      notes: "confirmed from storyboard editor strict flow"
    };
  }

  function markChanged(shotId: string): void {
    setChangedShotIds((current) => {
      const next = new Set(current);
      next.add(shotId);
      return next;
    });
  }

  function updateShot(shotId: string, patch: Partial<StoryboardShot>): void {
    setShots((current) =>
      current.map((shot) => (shot.id === shotId ? { ...shot, ...patch, status: patch.status ?? "dirty" } : shot))
    );
    markChanged(shotId);
  }

  function updateScript(patch: Partial<ScriptEntity>): void {
    setScript((current) => ({ ...current, ...patch }));
  }

  function confirmMaterialsStage(): void {
    setActiveSidebarStage("materials");
    void saveCommerceVideoMaterials(projectId, materialWorkflowInput())
      .then(({ workflow: nextWorkflow, productMaterials: nextProductMaterials }) => {
        setWorkflow(nextWorkflow);
        setProductMaterials(nextProductMaterials ?? []);
        setWorkflowError(null);
        markStageComplete("materials", "商品素材上传已完成。");
      })
      .catch((error: unknown) => {
        setWorkflowError(error instanceof Error ? error.message : String(error));
        setNotice("商品素材写入失败，请查看 workflow 错误");
      });
  }

  function saveScriptVersion(): void {
    const input = workflowScriptInput(script);
    if (!input.title || sellingPointList(script).length === 0 || !input.voiceover) {
      setActiveSidebarStage("script");
      setNotice("请先补齐脚本标题、卖点摘要和脚本正文，再保存剧本");
      return;
    }
    setActiveSidebarStage("script");
    setScript((current) => {
      const next = { ...current, version: current.version + 1 };
      void saveCommerceVideoScript(projectId, workflowScriptInput(next))
        .then(({ workflow: nextWorkflow }) => {
          setWorkflow(nextWorkflow);
          setWorkflowError(null);
          markStageComplete("script", "脚本实体已保存为新版本。");
        })
        .catch((error: unknown) => {
          setWorkflowError(error instanceof Error ? error.message : String(error));
        });
      return next;
    });
    setNotice("脚本实体已保存为新版本");
  }

  function applyScriptTemplate(): void {
    setScript((current) => scriptFromTemplate(current.templateId, current));
    setNotice("已选择方法论模板；工作台内容等待 AI 或用户填写");
  }

  function requestScriptGeneration(): void {
    setActiveSidebarStage("script");
    if (!onRequestAgentPrompt) {
      setNotice("当前会话不可接收剧本生成提示词");
      return;
    }
    onRequestAgentPrompt(buildScriptPrompt(script, productMaterials, files));
    setNotice("已把剧本生成提示词放入左侧输入框");
  }

  function generateShotPlan(): void {
    setActiveSidebarStage("storyboard");
    if (shots.length === 0) {
      setNotice("请先让 AI 生成基础分镜，或手动添加可保存的镜头");
      requestStoryboardPlan();
      return;
    }
    void saveCommerceVideoStoryboard(projectId, workflowStoryboardInput(shots))
      .then(({ workflow: nextWorkflow }) => {
        setWorkflow(nextWorkflow);
        setWorkflowError(null);
        markStageComplete("storyboard", "基础分镜已保存。");
      })
      .catch((error: unknown) => {
        setWorkflowError(error instanceof Error ? error.message : String(error));
      });
    setNotice("基础分镜已保存");
  }

  function requestStoryboardPlan(): void {
    setActiveSidebarStage("storyboard");
    if (!onRequestAgentPrompt) {
      setNotice("当前会话不可接收分镜生成指令");
      return;
    }
    onRequestAgentPrompt(buildStoryboardPrompt(script, shots, files, productMaterials));
    setNotice("已把分镜生成提示词放入左侧输入框");
  }

  function selectShot(shotId: string): void {
    setActiveShotId(shotId);
    setPlayTime(shotStart(shots, shotId));
  }

  function moveActive(offset: number): void {
    const index = shots.findIndex((shot) => shot.id === activeShotId);
    const target = shots[index + offset];
    if (!target) return;
    setShots((current) => reorderShots(current, activeShotId, target.id));
    markChanged(activeShotId);
  }

  function handleShotKeyDown(event: KeyboardEvent<HTMLButtonElement>, shotId: string): void {
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveShotId(shotId);
      moveShotById(shotId, -1);
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveShotId(shotId);
      moveShotById(shotId, 1);
      return;
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      refreshShot(shotId);
    }
  }

  function moveShotById(shotId: string, offset: number): void {
    const index = shots.findIndex((shot) => shot.id === shotId);
    const target = shots[index + offset];
    if (!target) return;
    setShots((current) => reorderShots(current, shotId, target.id));
    markChanged(shotId);
  }

  function onDropShot(event: DragEvent<HTMLElement>, targetId: string): void {
    event.preventDefault();
    const sourceId = draggedShotId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId) return;
    setShots((current) => reorderShots(current, sourceId, targetId));
    markChanged(sourceId);
    setDraggedShotId(null);
  }

  function refreshShot(shotId: string): void {
    updateShot(shotId, { status: "refreshing" });
    const timer = window.setTimeout(() => {
      setShots((current) =>
        current.map((shot) => (shot.id === shotId ? { ...shot, status: "refreshed", version: shot.version + 1 } : shot))
      );
      setNotice("单个分镜已局部刷新");
    }, 700);
    refreshTimersRef.current.push(timer);
  }

  function regenerateShot(shotId: string): void {
    setShots((current) =>
      current.map((shot) => (shot.id === shotId ? { ...shot, status: "queued", version: shot.version + 1 } : shot))
    );
    markChanged(shotId);
  }

  function requestFastRender(): void {
    const prompt = buildAgentPrompt(shots, changedShotIds, script);
    if (!onRequestAgentPrompt) {
      setNotice("当前会话不可接收重渲染指令");
      return;
    }
    onRequestAgentPrompt(prompt);
    setNotice("已把分镜变更放入左侧输入框");
  }

  async function createGenerationTask(prompt: string, result: ExportResult): Promise<void> {
    setActiveSidebarStage("generation");
    setWorkflowError(null);
    setRenderTask(null);
    setPreviewPath(null);
    setDownloadPath(null);
    const generated = await generateCommerceVideo(projectId, {
      model: selectedVideoModel,
      prompt,
      aspect: exportSettings.resolution === "1080x1080" ? "1:1" : "9:16",
      lengthSec: Math.min(exportSettings.targetDuration, 15),
      output: `commerce-video/${result.id}.${exportSettings.format}`
    });
    setWorkflow(generated.workflow);
    setRenderTask({
      taskId: generated.taskId,
      status: generated.status,
      progress: [],
      nextSince: 0
    });
    const failureMessage = workflowGenerationFailureMessage(generated.workflow);
    if (failureMessage || (isTerminalTaskStatus(generated.status) && generated.status !== "done")) {
      markGenerationFailed(failureMessage ?? "成片任务创建失败");
      return;
    }
    markStageComplete("generation", onRequestAgentPrompt ? "已创建成片生成任务。" : "已直接创建成片生成任务。");
  }

  async function waitForGenerationTask(): Promise<void> {
    setActiveSidebarStage("progress");
    setWorkflowError(null);
    const taskId = renderTask?.taskId ?? workflow?.generation?.mediaTaskId;
    if (!taskId) {
      setNotice("还没有可等待的成片任务");
      return;
    }

    let since = renderTask?.nextSince ?? 0;
    let snapshot: CommerceVideoJobWaitResponse | null = null;
    do {
      snapshot = await waitCommerceVideoJob(taskId, { since, timeoutMs: 4_000 });
      since = snapshot.nextSince;
      setRenderTask((current) => mergeRenderTask(current, snapshot!));
    } while (snapshot && !isTerminalTaskStatus(snapshot.status));

    if (!snapshot || snapshot.status !== "done") {
      const message =
        snapshot && typeof snapshot.error === "object" && snapshot.error && "message" in snapshot.error
          ? String((snapshot.error as { message?: unknown }).message)
          : "成片生成未完成";
      setExportResults((current) =>
        current.map((item) => (item.status === "requested" ? { ...item, status: "failed" } : item))
      );
      markGenerationFailed(message);
      throw new Error(message);
    }

    const previewResponse = await fetchCommerceVideoPreview(projectId);
    setWorkflow(previewResponse.workflow);
    setPreviewPath(previewResponse.preview?.path ?? previewResponse.export?.previewPath ?? null);
    setDownloadPath(previewResponse.export?.downloadPath ?? previewResponse.preview?.path ?? null);
    markStageComplete("progress", "任务已完成。");
  }

  async function runPreviewExport(): Promise<void> {
    setActiveSidebarStage("export");
    setWorkflowError(null);
    const previewResponse = await fetchCommerceVideoPreview(projectId);
    setWorkflow(previewResponse.workflow);
    setPreviewPath(previewResponse.preview?.path ?? previewResponse.export?.previewPath ?? null);
    setDownloadPath(previewResponse.export?.downloadPath ?? previewResponse.preview?.path ?? null);
    const exportResponse = await exportCommerceVideo(projectId);
    setWorkflow(exportResponse.workflow);
    setPreviewPath(exportResponse.preview?.path ?? exportResponse.export?.previewPath ?? null);
    setDownloadPath(exportResponse.export?.downloadPath ?? exportResponse.preview?.path ?? null);
    setExportResults((current) =>
      current.map((item) => (item.status === "requested" ? { ...item, status: "ready" } : item))
    );
    setActiveSidebarStage("export");
    setCurrentFlowStageId("export");
    setPendingNextStageId(null);
    setNotice("成片已生成，可预览和导出");
  }

  function requestFinalExport(): void {
    const prompt = buildExportPrompt(script, shots, exportSettings, selectedVideoModel);
    if (onRequestAgentPrompt) onRequestAgentPrompt(prompt);
    const result: ExportResult = {
      id: `export-${Date.now()}`,
      name: `${script.title || "成片"} v${script.version}`,
      format: exportSettings.format,
      resolution: exportSettings.resolution,
      duration: Math.min(exportSettings.targetDuration, totalDuration),
      status: "requested",
      scriptVersion: script.version
    };
    setExportResults((current) => [result, ...current].slice(0, 6));
    void createGenerationTask(prompt, result).catch((error: unknown) => {
      setWorkflowError(error instanceof Error ? error.message : String(error));
      setNotice("成片任务创建失败，请查看任务进度");
    });
    setNotice(onRequestAgentPrompt ? "正在创建成片生成任务" : "正在直接创建成片生成任务");
  }

  const showStoryboardWorkspace =
    activeSidebarStage === "storyboard" ||
    activeSidebarStage === "generation" ||
    activeSidebarStage === "progress" ||
    activeSidebarStage === "export";
  const showExportWorkspace =
    activeSidebarStage === "generation" || activeSidebarStage === "progress" || activeSidebarStage === "export";

  return (
    <section className={styles.shell} data-testid="storyboard-editor">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span>分镜剪辑 · 脚本 v{script.version}</span>
          <h2>{activeShot?.title ?? WORKFLOW_STAGE_COPY[activeSidebarStage].label}</h2>
        </div>
        <div className={styles.headerStats}>
          <span>{workflowLoading ? "workflow 同步中" : `当前阶段：${WORKFLOW_STAGE_COPY[currentStageId].label}`}</span>
          <span>{shots.length} 镜</span>
          <span>{formatSeconds(totalDuration)}</span>
          <span>{changedShotIds.size} 处变更</span>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            onClick={refreshWorkflowFromBackend}
            disabled={workflowLoading}
            title="从 workflow 重新读取剧本和分镜"
          >
            <Icon name={workflowLoading ? "spinner" : "refresh"} size={14} />
            同步工作台
          </Button>
          <Button
            variant="ghost"
            onClick={() => activeShot && refreshShot(activeShot.id)}
            disabled={!activeShot}
            title="局部刷新当前分镜"
          >
            <Icon name={activeShot?.status === "refreshing" ? "spinner" : "refresh"} size={14} />
            局部刷新
          </Button>
          <Button variant="primary" onClick={requestFastRender} disabled={shots.length === 0}>
            <Icon name="send" size={14} />
            快速重渲染
          </Button>
          <Button
            variant="primary-ghost"
            onClick={requestFinalExport}
            disabled={shots.length === 0 || currentFlowStageId !== "generation"}
          >
            <Icon name="download" size={14} />
            成片导出
          </Button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.shotList} aria-label="分镜列表">
          {shots.length === 0 ? <div className={styles.emptyState}>等待 AI 生成基础分镜</div> : null}
          {shots.map((shot, index) => {
            const selected = shot.id === activeShot?.id;
            const asset = shot.assetName ? assets.find((item) => item.name === shot.assetName) : null;
            return (
              <button
                key={shot.id}
                type="button"
                className={`${styles.shotCard} ${selected ? styles.shotCardActive : ""}`}
                draggable
                aria-pressed={selected}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown R"
                onClick={() => selectShot(shot.id)}
                onKeyDown={(event) => handleShotKeyDown(event, shot.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", shot.id);
                  setDraggedShotId(shot.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => onDropShot(event, shot.id)}
                onDragEnd={() => setDraggedShotId(null)}
              >
                <span className={styles.shotThumb} data-kind={asset?.kind ?? "empty"}>
                  {asset?.kind === "image" ? (
                    <img src={projectFileUrl(projectId, asset.name)} alt="" />
                  ) : asset?.kind === "video" ? (
                    <Icon name="play" size={16} />
                  ) : (
                    <Icon name="image" size={16} />
                  )}
                </span>
                <span className={styles.shotMeta}>
                  <span>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <strong>{shot.title}</strong>
                  </span>
                  <small>
                    {formatSeconds(shot.duration)} · v{shot.version}
                  </small>
                </span>
                <span className={`${styles.statusDot} ${styles[`status_${shot.status}`]}`} />
              </button>
            );
          })}
        </aside>

        <main className={styles.stage}>
          <section
            className={styles.stageConsole}
            aria-label={`${WORKFLOW_STAGE_COPY[activeSidebarStage].label}控制台`}
          >
            <div className={styles.consoleHeader}>
              <div>
                <span>{WORKFLOW_STAGE_COPY[activeSidebarStage].eyebrow}</span>
                <h3>{WORKFLOW_STAGE_COPY[activeSidebarStage].label}控制台</h3>
              </div>
              <strong>{activeSidebarStage === currentStageId ? "当前阶段" : stageStatusLabel(activeStage)}</strong>
            </div>

            {activeSidebarStage === "materials" ? (
              <>
                <div className={styles.consoleMetrics}>
                  <span>
                    <b>{assets.length}</b>
                    项目素材
                  </span>
                  <span>
                    <b>{productMaterials.length}</b>
                    商品素材记录
                  </span>
                  <span>
                    <b>{workflow?.materials.uploadedFiles.length ?? 0}</b>
                    workflow 文件
                  </span>
                </div>
                <div className={styles.consoleAssetGrid}>
                  {productMaterials.slice(0, 4).map((material) => (
                    <div key={material.id} className={styles.consoleMaterialRecord}>
                      <strong>{material.title}</strong>
                      <small>
                        {[material.subject, material.category, ...material.product.sellingPoints.slice(0, 2)]
                          .filter(Boolean)
                          .join(" / ") || "已确认商品素材"}
                      </small>
                    </div>
                  ))}
                  {assets.slice(0, 6).map((asset) => (
                    <button key={asset.name} type="button" onClick={() => onOpenFile?.(asset.name)}>
                      <span className={styles.consoleAssetThumb} data-kind={asset.kind}>
                        {asset.kind === "image" ? (
                          <img src={projectFileUrl(projectId, asset.name)} alt="" />
                        ) : (
                          <Icon name="play" size={14} />
                        )}
                      </span>
                      <strong>{asset.name.split(/[\\/]/).pop() ?? asset.name}</strong>
                    </button>
                  ))}
                  {assets.length === 0 ? <small>等待上传商品图片或视频素材。</small> : null}
                </div>
                <div className={styles.consoleActions}>
                  <Button variant="primary" onClick={confirmMaterialsStage}>
                    <Icon name="check" size={14} />
                    完成素材上传
                  </Button>
                </div>
              </>
            ) : null}

            {activeSidebarStage === "script" ? (
              <>
                <div className={styles.scriptModuleGrid} aria-label="剧本模块实体">
                  <section className={styles.moduleCard}>
                    <div className={styles.moduleCardHeader}>
                      <span>Quality videos</span>
                      <strong>优质视频库</strong>
                    </div>
                    {REFERENCE_VIDEO_MOCKS.slice(0, 2).map((video) => (
                      <div key={video.id} className={styles.referenceCard}>
                        <strong>{video.title}</strong>
                        <small>{video.source}</small>
                        <span>{video.matchReason}</span>
                      </div>
                    ))}
                  </section>
                  <section className={styles.moduleCard}>
                    <div className={styles.moduleCardHeader}>
                      <span>Methodology</span>
                      <strong>方法论模板</strong>
                    </div>
                    <p>{selectedScriptTemplate(script).strategy}</p>
                    <small>{selectedScriptTemplate(script).factors.join(" / ")}</small>
                  </section>
                </div>
                <div className={styles.consoleGrid}>
                  <label className={styles.field}>
                    <span>脚本标题</span>
                    <Input
                      value={script.title}
                      onChange={(event) => updateScript({ title: event.currentTarget.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>脚本模板</span>
                    <Select
                      value={script.templateId}
                      onChange={(event) => updateScript({ templateId: event.currentTarget.value as ScriptTemplateId })}
                    >
                      {SCRIPT_TEMPLATES.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>卖点摘要</span>
                  <Textarea
                    rows={4}
                    value={script.sellingPoints}
                    onChange={(event) => updateScript({ sellingPoints: event.currentTarget.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>脚本正文</span>
                  <Textarea
                    rows={4}
                    value={script.body}
                    onChange={(event) => updateScript({ body: event.currentTarget.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>CTA</span>
                  <Input value={script.cta} onChange={(event) => updateScript({ cta: event.currentTarget.value })} />
                </label>
                <div className={styles.consoleActions}>
                  <Button variant="ghost" onClick={applyScriptTemplate}>
                    <Icon name="copy" size={14} />
                    应用方法论模板
                  </Button>
                  <Button variant="primary-ghost" onClick={requestScriptGeneration}>
                    <Icon name="sparkles" size={14} />
                    生成剧本提示词
                  </Button>
                  <Button variant="primary-ghost" onClick={saveScriptVersion}>
                    <Icon name="history" size={14} />
                    保存剧本
                  </Button>
                </div>
              </>
            ) : null}

            {activeSidebarStage === "storyboard" ? (
              activeShot ? (
                <>
                  <div className={styles.consoleGrid}>
                    <label className={styles.field}>
                      <span>镜头标题</span>
                      <Input
                        value={activeShot.title}
                        onChange={(event) => updateShot(activeShot.id, { title: event.currentTarget.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>绑定素材</span>
                      <Select
                        value={activeShot.assetName}
                        onChange={(event) => updateShot(activeShot.id, { assetName: event.currentTarget.value })}
                      >
                        <option value={EMPTY_ASSET}>待生成 / 不指定</option>
                        {assets.map((asset) => (
                          <option key={asset.name} value={asset.name}>
                            {asset.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span>画面目标</span>
                    <Textarea
                      rows={3}
                      value={activeShot.visual}
                      onChange={(event) => updateShot(activeShot.id, { visual: event.currentTarget.value })}
                    />
                  </label>
                  <div className={styles.consoleActions}>
                    <Button variant="ghost" onClick={() => refreshShot(activeShot.id)}>
                      <Icon name="refresh" size={14} />
                      局部刷新
                    </Button>
                    <Button variant="primary-ghost" onClick={requestFastRender}>
                      <Icon name="send" size={14} />
                      重渲染当前分镜
                    </Button>
                    <Button variant="primary" onClick={generateShotPlan}>
                      <Icon name="check" size={14} />
                      完成分镜
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.consoleNote}>等待 AI 根据已保存剧本生成基础分镜。</p>
                  <div className={styles.consoleActions}>
                    <Button variant="primary" onClick={requestStoryboardPlan}>
                      <Icon name="sparkles" size={14} />
                      生成分镜提示词
                    </Button>
                  </div>
                </>
              )
            ) : null}

            {activeSidebarStage === "generation" ? (
              <>
                <div className={styles.consoleMetrics}>
                  <span>
                    <b>{exportSettings.resolution}</b>
                    输出尺寸
                  </span>
                  <span>
                    <b>{formatSeconds(Math.min(exportSettings.targetDuration, 15))}</b>
                    目标时长
                  </span>
                  <span>
                    <b>{exportSettings.format.toUpperCase()}</b>
                    格式
                  </span>
                </div>
                <div className={styles.consoleActions}>
                  <Button variant="primary" onClick={requestFinalExport}>
                    <Icon name="download" size={14} />
                    创建成片任务
                  </Button>
                </div>
              </>
            ) : null}

            {activeSidebarStage === "progress" ? (
              <>
                <div className={styles.consoleMetrics}>
                  <span>
                    <b>{renderTask ? taskStatusLabel(renderTask.status) : stageStatusLabel(activeStage)}</b>
                    任务状态
                  </span>
                  <span>
                    <b>{renderTask?.taskId ?? workflow?.generation?.mediaTaskId ?? "无任务"}</b>
                    任务 ID
                  </span>
                </div>
                {lastRenderProgress ? <p className={styles.consoleNote}>{lastRenderProgress}</p> : null}
                <div className={styles.consoleActions}>
                  <Button
                    variant="primary"
                    onClick={() =>
                      void waitForGenerationTask().catch((error: unknown) => {
                        setWorkflowError(error instanceof Error ? error.message : String(error));
                        setNotice("任务进度检查失败，请查看错误");
                      })
                    }
                    disabled={!renderTask?.taskId && !workflow?.generation?.mediaTaskId}
                  >
                    <Icon name="refresh" size={14} />
                    等待任务完成
                  </Button>
                </div>
              </>
            ) : null}

            {activeSidebarStage === "export" ? (
              <>
                <div className={styles.consolePathList}>
                  <span>
                    <b>预览</b>
                    {previewPath ?? workflow?.export?.previewPath ?? "等待生成结果"}
                  </span>
                  <span>
                    <b>导出</b>
                    {downloadPath ?? workflow?.export?.downloadPath ?? "等待导出"}
                  </span>
                  <span>
                    <b>Manifest</b>
                    {workflow?.export?.manifestPath ?? "等待写入"}
                  </span>
                </div>
                <div className={styles.consoleActions}>
                  <Button
                    variant="primary"
                    onClick={() =>
                      void runPreviewExport().catch((error: unknown) => {
                        setWorkflowError(error instanceof Error ? error.message : String(error));
                        setNotice("预览导出失败，请查看错误");
                      })
                    }
                    disabled={!previewPath && !workflow?.generation?.output && !workflow?.export?.previewPath}
                  >
                    <Icon name="download" size={14} />
                    生成预览与导出
                  </Button>
                  {previewPath ? (
                    <Button
                      variant="ghost"
                      onClick={() => (onOpenFile ? onOpenFile(previewPath) : setNotice(`预览路径：${previewPath}`))}
                    >
                      <Icon name="play" size={14} />
                      打开预览
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>

          {activeSidebarStage === "script" ? (
            <section className={styles.scriptPanel} aria-label="脚本实体">
              <div className={styles.panelTitle}>
                <div>
                  <span>Script entity</span>
                  <h3>剧本生成工作台</h3>
                </div>
                <strong>v{script.version}</strong>
              </div>
              <div className={styles.scriptGrid}>
                <label className={styles.field}>
                  <span>脚本标题</span>
                  <Input
                    value={script.title}
                    onChange={(event) => updateScript({ title: event.currentTarget.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>复用模板</span>
                  <Select
                    value={script.templateId}
                    onChange={(event) => updateScript({ templateId: event.currentTarget.value as ScriptTemplateId })}
                  >
                    {SCRIPT_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <label className={styles.field}>
                <span>卖点摘要</span>
                <Textarea
                  rows={3}
                  value={script.sellingPoints}
                  onChange={(event) => updateScript({ sellingPoints: event.currentTarget.value })}
                />
              </label>
              <label className={styles.field}>
                <span>脚本正文</span>
                <Textarea
                  rows={3}
                  value={script.body}
                  onChange={(event) => updateScript({ body: event.currentTarget.value })}
                />
              </label>
              <div className={styles.scriptGrid}>
                <label className={styles.field}>
                  <span>CTA</span>
                  <Input value={script.cta} onChange={(event) => updateScript({ cta: event.currentTarget.value })} />
                </label>
                <div className={styles.scriptActions}>
                  <Button variant="ghost" onClick={applyScriptTemplate}>
                    <Icon name="copy" size={14} />
                    应用模板
                  </Button>
                  <Button variant="primary-ghost" onClick={requestScriptGeneration}>
                    <Icon name="sparkles" size={14} />
                    生成剧本提示词
                  </Button>
                  <Button variant="primary" onClick={saveScriptVersion}>
                    <Icon name="history" size={14} />
                    保存版本
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {showStoryboardWorkspace ? (
            <>
              <div className={styles.previewPanel}>
                <div className={styles.previewSurface}>
                  {activeAsset?.kind === "image" ? (
                    <img src={projectFileUrl(projectId, activeAsset.name)} alt={activeAsset.name} />
                  ) : activeAsset?.kind === "video" ? (
                    <video
                      key={activeAsset.name}
                      src={projectFileUrl(projectId, activeAsset.name)}
                      controls
                      muted
                      playsInline
                    />
                  ) : (
                    <div className={styles.previewPlaceholder}>
                      <Icon name="sparkles" size={26} />
                    </div>
                  )}
                  <div className={styles.previewCaption}>
                    <span>
                      {formatTime(playTime)} / {formatSeconds(totalDuration)}
                    </span>
                    <strong>{activeShot?.dialogue || "等待基础分镜"}</strong>
                  </div>
                </div>
                <div className={styles.previewControls}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={playing ? "暂停预览" : "播放预览"}
                    aria-keyshortcuts="Space"
                    onClick={() => setPlaying((value) => !value)}
                    disabled={shots.length === 0}
                  >
                    <Icon name={playing ? "stop" : "play"} size={14} />
                  </Button>
                  <Input
                    type="range"
                    min={0}
                    max={Math.max(totalDuration, 0.5)}
                    step={0.1}
                    value={Math.min(playTime, totalDuration)}
                    onChange={(event) => {
                      const next = Number.parseFloat(event.currentTarget.value);
                      setPlayTime(next);
                      const shot = shotAtTime(shots, next);
                      if (shot) setActiveShotId(shot.id);
                    }}
                    aria-label="预览时间"
                    disabled={shots.length === 0}
                  />
                </div>
              </div>

              <section className={styles.timeline} aria-label="分镜时间轴">
                <div className={styles.timelineRuler}>
                  <span>0s</span>
                  <span>{formatSeconds(totalDuration)}</span>
                </div>
                <div className={styles.timelineTrack}>
                  {shots.length === 0 ? <div className={styles.emptyState}>等待 AI 写入镜头计划</div> : null}
                  {shots.map((shot, index) => {
                    const width = `${Math.max(7, (shot.duration / Math.max(totalDuration, 1)) * 100)}%`;
                    const selected = shot.id === activeShot?.id;
                    return (
                      <button
                        key={shot.id}
                        type="button"
                        draggable
                        className={`${styles.timelineBlock} ${selected ? styles.timelineBlockActive : ""}`}
                        style={{ width }}
                        onClick={() => selectShot(shot.id)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", shot.id);
                          setDraggedShotId(shot.id);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => onDropShot(event, shot.id)}
                        onDragEnd={() => setDraggedShotId(null)}
                        title={`${shot.title} · ${formatSeconds(shot.duration)}`}
                      >
                        <span>{index + 1}</span>
                        <strong>{shot.title}</strong>
                      </button>
                    );
                  })}
                  <span
                    className={styles.playhead}
                    style={{ left: `${totalDuration > 0 ? (playTime / totalDuration) * 100 : 0}%` }}
                  />
                </div>
              </section>
            </>
          ) : null}

          {showExportWorkspace ? (
            <section className={styles.exportPanel} aria-label="成片预览导出">
              <div className={styles.panelTitle}>
                <div>
                  <span>Preview / export</span>
                  <h3>最终成片预览与结果管理</h3>
                </div>
                <strong>{formatSeconds(Math.min(exportSettings.targetDuration, totalDuration))}</strong>
              </div>
              <div className={styles.exportControls}>
                <label className={styles.field}>
                  <span>格式</span>
                  <Select
                    value={exportSettings.format}
                    onChange={(event) => {
                      const format = event.currentTarget.value as ExportFormat;
                      updateExportSettings({ format });
                    }}
                  >
                    <option value="mp4">MP4</option>
                    <option value="webm">WebM</option>
                    <option value="mov">MOV</option>
                  </Select>
                </label>
                <label className={styles.field}>
                  <span>尺寸</span>
                  <Select
                    value={exportSettings.resolution}
                    onChange={(event) => {
                      const resolution = event.currentTarget.value as ExportResolution;
                      updateExportSettings({ resolution });
                    }}
                  >
                    <option value="1080x1920">1080x1920</option>
                    <option value="720x1280">720x1280</option>
                    <option value="1080x1080">1080x1080</option>
                  </Select>
                </label>
                <label className={styles.field}>
                  <span>目标时长</span>
                  <Input
                    type="number"
                    min={1}
                    max={15}
                    step={0.1}
                    value={exportSettings.targetDuration}
                    onChange={(event) => {
                      const targetDuration = Math.min(15, clampDuration(Number.parseFloat(event.currentTarget.value)));
                      updateExportSettings({ targetDuration });
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span>视频生成模型</span>
                  <Select
                    value={selectedVideoModel}
                    onChange={(event) => updateSelectedVideoModel(event.currentTarget.value)}
                  >
                    {COMMERCE_VIDEO_MODEL_OPTIONS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className={styles.checkboxField}>
                  <Input
                    type="checkbox"
                    checked={exportSettings.includeSubtitles}
                    onChange={(event) => {
                      const includeSubtitles = event.currentTarget.checked;
                      updateExportSettings({ includeSubtitles });
                    }}
                  />
                  <span>字幕</span>
                </label>
                <label className={styles.checkboxField}>
                  <Input
                    type="checkbox"
                    checked={exportSettings.includeVoiceover}
                    onChange={(event) => {
                      const includeVoiceover = event.currentTarget.checked;
                      updateExportSettings({ includeVoiceover });
                    }}
                  />
                  <span>TTS</span>
                </label>
                <label className={styles.checkboxField}>
                  <Input
                    type="checkbox"
                    checked={exportSettings.includeBgm}
                    onChange={(event) => {
                      const includeBgm = event.currentTarget.checked;
                      updateExportSettings({ includeBgm });
                    }}
                  />
                  <span>BGM</span>
                </label>
                <Button variant="primary" onClick={requestFinalExport}>
                  <Icon name="download" size={14} />
                  生成成片
                </Button>
              </div>
              <div className={styles.exportLiveStatus} aria-label="成片任务状态">
                <span>生成任务</span>
                <strong>
                  {renderTask
                    ? `${taskStatusLabel(renderTask.status)} · ${renderTask.taskId}`
                    : workflow?.generation?.status
                      ? stageStatusLabel({
                          id: "generation",
                          label: "Generation",
                          status: workflow.generation.status
                        })
                      : "等待生成"}
                </strong>
                {lastRenderProgress ? <small>{lastRenderProgress}</small> : null}
                <div className={styles.exportPathActions}>
                  {previewPath ? (
                    <Button
                      variant="ghost"
                      onClick={() => (onOpenFile ? onOpenFile(previewPath) : setNotice(`预览路径：${previewPath}`))}
                    >
                      <Icon name="play" size={14} />
                      预览 {previewPath}
                    </Button>
                  ) : null}
                  {downloadPath ? (
                    <Button
                      variant="ghost"
                      onClick={() => (onOpenFile ? onOpenFile(downloadPath) : setNotice(`导出路径：${downloadPath}`))}
                    >
                      <Icon name="download" size={14} />
                      导出 {downloadPath}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className={styles.exportResults} aria-label="导出结果">
                {exportResults.length === 0 ? (
                  <span>暂无导出结果</span>
                ) : (
                  exportResults.map((result, index) => (
                    <button
                      key={result.id}
                      type="button"
                      className={styles.exportResult}
                      onClick={() => setNotice(`${result.name} 正在等待 agent 返回预览/导出路径`)}
                    >
                      <strong>请求 {exportResults.length - index}</strong>
                      <span>
                        {result.format.toUpperCase()} · {result.resolution} · {formatSeconds(result.duration)}
                      </span>
                      <small>
                        脚本 v{result.scriptVersion} ·{" "}
                        {result.status === "ready" ? "已完成" : result.status === "failed" ? "失败" : "待生成"}
                      </small>
                    </button>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </main>

        <aside className={styles.stageSidebar} aria-label="阶段右侧栏" data-stage={activeSidebarStage}>
          <div className={styles.stageSidebarHeader}>
            <span>{WORKFLOW_STAGE_COPY[activeSidebarStage].eyebrow}</span>
            <div>
              <h3>{WORKFLOW_STAGE_COPY[activeSidebarStage].label}</h3>
              <strong>{activeSidebarStage === currentStageId ? "当前阶段" : stageStatusLabel(activeStage)}</strong>
            </div>
            <p>{WORKFLOW_STAGE_COPY[activeSidebarStage].summary}</p>
          </div>

          <div className={styles.stageSidebarNav} aria-label="阶段右侧栏切换">
            {workflowStages.map((stage) => {
              const locked = !canOpenStage(stage.id);
              return (
                <button
                  key={stage.id}
                  type="button"
                  className={`${styles.stageSidebarNavItem} ${stage.id === activeSidebarStage ? styles.stageSidebarNavItemActive : ""}`}
                  aria-current={stage.id === currentStageId ? "step" : undefined}
                  aria-pressed={stage.id === activeSidebarStage}
                  disabled={locked}
                  onClick={() => openStage(stage.id)}
                >
                  <span>{WORKFLOW_STAGE_COPY[stage.id].label}</span>
                  <small>{locked ? "待解锁" : stage.id === currentStageId ? "当前" : stageStatusLabel(stage)}</small>
                </button>
              );
            })}
          </div>

          {workflowError ? <p className={styles.workflowError}>{workflowError}</p> : null}

          {pendingNextStageId && activeSidebarStage === currentFlowStageId ? (
            <div className={styles.stageGate} role="status">
              <strong>是否进入{WORKFLOW_STAGE_COPY[pendingNextStageId].label}？</strong>
              <small>当前流程已完成。确认后才会更新右侧栏并进入下一流程。</small>
              <Button variant="primary" onClick={enterPendingStage}>
                进入{WORKFLOW_STAGE_COPY[pendingNextStageId].label}
              </Button>
            </div>
          ) : null}

          {activeSidebarStage === "materials" ? (
            <section className={styles.stagePanel} aria-label="商品素材阶段侧栏">
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.materials}</div>
              <div className={styles.stageFacts}>
                <span>
                  <b>{assets.length}</b>
                  项目图片/视频素材
                </span>
                <span>
                  <b>{(workflow?.materials.productMaterialIds ?? []).length}</b>
                  商品素材记录
                </span>
                <span>
                  <b>{(workflow?.materials.uploadedFiles ?? []).length}</b>
                  已写入 workflow
                </span>
              </div>
              <div className={styles.stageList}>
                {(productMaterials ?? []).slice(0, 4).map((material) => (
                  <div key={material.id} className={styles.materialRecord}>
                    <strong>{material.title}</strong>
                    <small>
                      {[material.subject, material.category, ...material.product.sellingPoints.slice(0, 2)]
                        .filter(Boolean)
                        .join(" / ") || "已确认商品素材"}
                    </small>
                  </div>
                ))}
                {(workflow?.materials.uploadedFiles ?? []).slice(0, 5).map((file) => (
                  <button key={file.path} type="button" onClick={() => onOpenFile?.(file.path)}>
                    <Icon name="image" size={14} />
                    <span>{file.name ?? file.path}</span>
                  </button>
                ))}
                {(workflow?.materials.uploadedFiles ?? []).length === 0 ? (
                  <small>等待从聊天上传或素材库导入商品图。</small>
                ) : null}
              </div>
              <Button variant="primary" onClick={confirmMaterialsStage}>
                <Icon name="check" size={14} />
                完成素材上传
              </Button>
            </section>
          ) : null}

          {activeSidebarStage === "script" ? (
            <section className={styles.stagePanel} aria-label="剧本生成阶段侧栏">
              <strong>剧本工作台</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.script}</div>
              <div className={styles.stageList}>
                <div className={styles.materialRecord}>
                  <strong>优质视频库</strong>
                  <small>{REFERENCE_VIDEO_MOCKS.map((video) => `${video.id}:${video.score}`).join(" / ")}</small>
                </div>
                <div className={styles.materialRecord}>
                  <strong>方法论模板</strong>
                  <small>{selectedScriptTemplate(script).strategy}</small>
                </div>
              </div>
              <label className={styles.field}>
                <span>脚本标题</span>
                <Input value={script.title} onChange={(event) => updateScript({ title: event.currentTarget.value })} />
              </label>
              <label className={styles.field}>
                <span>卖点摘要</span>
                <Textarea
                  rows={4}
                  value={script.sellingPoints}
                  onChange={(event) => updateScript({ sellingPoints: event.currentTarget.value })}
                />
              </label>
              <label className={styles.field}>
                <span>脚本正文</span>
                <Textarea
                  rows={4}
                  value={script.body}
                  onChange={(event) => updateScript({ body: event.currentTarget.value })}
                />
              </label>
              <label className={styles.field}>
                <span>CTA</span>
                <Input value={script.cta} onChange={(event) => updateScript({ cta: event.currentTarget.value })} />
              </label>
              <div className={styles.inspectorActions}>
                <Button variant="primary-ghost" onClick={saveScriptVersion}>
                  <Icon name="history" size={14} />
                  保存剧本
                </Button>
                <Button variant="primary" onClick={requestScriptGeneration}>
                  <Icon name="sparkles" size={14} />
                  生成剧本提示词
                </Button>
              </div>
            </section>
          ) : null}

          {activeSidebarStage === "storyboard" ? (
            <section className={styles.stagePanel} aria-label="基础分镜阶段侧栏">
              <strong>基础分镜面板</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.storyboard}</div>
              {activeShot ? (
                <>
                  <label className={styles.field}>
                    <span>镜头标题</span>
                    <Input
                      value={activeShot.title}
                      onChange={(event) => updateShot(activeShot.id, { title: event.currentTarget.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>绑定卖点</span>
                    <Input
                      value={activeShot.sellingPoint}
                      onChange={(event) => updateShot(activeShot.id, { sellingPoint: event.currentTarget.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>素材切片</span>
                    <Select
                      value={activeShot.assetName}
                      onChange={(event) => updateShot(activeShot.id, { assetName: event.currentTarget.value })}
                    >
                      <option value={EMPTY_ASSET}>待生成 / 不指定</option>
                      {assets.map((asset) => (
                        <option key={asset.name} value={asset.name}>
                          {asset.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className={styles.inlineFields}>
                    <label className={styles.field}>
                      <span>入点</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={activeShot.assetIn}
                        onChange={(event) =>
                          updateShot(activeShot.id, {
                            assetIn: clampAssetTime(Number.parseFloat(event.currentTarget.value))
                          })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>出点</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={activeShot.assetOut}
                        onChange={(event) =>
                          updateShot(activeShot.id, {
                            assetOut: clampAssetTime(Number.parseFloat(event.currentTarget.value))
                          })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>时长</span>
                      <Input
                        type="number"
                        min={0.5}
                        max={30}
                        step={0.1}
                        value={activeShot.duration}
                        onChange={(event) =>
                          updateShot(activeShot.id, {
                            duration: clampDuration(Number.parseFloat(event.currentTarget.value))
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span>画面目标</span>
                    <Textarea
                      rows={4}
                      value={activeShot.visual}
                      onChange={(event) => updateShot(activeShot.id, { visual: event.currentTarget.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>台词 / 口播</span>
                    <Textarea
                      rows={4}
                      value={activeShot.dialogue}
                      onChange={(event) => updateShot(activeShot.id, { dialogue: event.currentTarget.value })}
                    />
                  </label>
                  <div className={styles.inspectorActions}>
                    <Button
                      variant="ghost"
                      onClick={() => moveActive(-1)}
                      disabled={shots[0]?.id === activeShot.id}
                      title="前移当前分镜"
                    >
                      <Icon name="chevron-left" size={14} />
                      前移
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => moveActive(1)}
                      disabled={shots[shots.length - 1]?.id === activeShot.id}
                      title="后移当前分镜"
                    >
                      后移
                      <Icon name="chevron-right" size={14} />
                    </Button>
                  </div>
                  <div className={styles.inspectorActions}>
                    <Button variant="primary-ghost" onClick={() => regenerateShot(activeShot.id)}>
                      <Icon name="reload" size={14} />
                      重生成单镜
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => activeShot.assetName && onOpenFile?.(activeShot.assetName)}
                      disabled={!activeShot.assetName}
                    >
                      <Icon name="external-link" size={14} />
                      打开素材
                    </Button>
                  </div>
                  <Button variant="primary" onClick={generateShotPlan}>
                    <Icon name="kanban" size={14} />
                    完成分镜
                  </Button>
                </>
              ) : (
                <>
                  <div className={styles.stageProgressBox}>
                    <strong>等待 AI 生成基础分镜</strong>
                    <small>当前阶段只接收镜头、时长、画面目标、素材建议和口播，不会创建成片任务。</small>
                  </div>
                  <Button variant="primary" onClick={requestStoryboardPlan}>
                    <Icon name="sparkles" size={14} />
                    生成分镜提示词
                  </Button>
                </>
              )}
            </section>
          ) : null}

          {activeSidebarStage === "generation" ? (
            <section className={styles.stagePanel} aria-label="一键成片阶段侧栏">
              <strong>成片任务配置</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.generation}</div>
              <div className={styles.stageFacts}>
                <span>
                  <b>{exportSettings.resolution}</b>
                  输出尺寸
                </span>
                <span>
                  <b>{selectedVideoModel}</b>
                  模型
                </span>
                <span>
                  <b>{workflow?.generation?.lengthSec ?? Math.min(exportSettings.targetDuration, 15)}s</b>
                  目标时长
                </span>
              </div>
              <div className={styles.stageProgressBox}>
                <strong>{renderTask?.taskId ?? workflow?.generation?.mediaTaskId ?? "尚未创建任务"}</strong>
                <small>点击生成成片只会创建任务；确认后再进入任务进度。</small>
              </div>
              <label className={styles.field}>
                <span>视频生成模型</span>
                <Select
                  value={selectedVideoModel}
                  onChange={(event) => updateSelectedVideoModel(event.currentTarget.value)}
                >
                  {COMMERCE_VIDEO_MODEL_OPTIONS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </Select>
              </label>
              <Button variant="primary" onClick={requestFinalExport} disabled={shots.length === 0}>
                <Icon name="download" size={14} />
                生成成片
              </Button>
            </section>
          ) : null}

          {activeSidebarStage === "progress" ? (
            <section className={styles.stagePanel} aria-label="任务进度阶段侧栏">
              <strong>任务进度</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.progress}</div>
              <div className={styles.stageFacts}>
                <span>
                  <b>{renderTask ? taskStatusLabel(renderTask.status) : stageStatusLabel(activeStage)}</b>
                  任务状态
                </span>
                <span>
                  <b>{renderTask?.taskId ?? workflow?.generation?.mediaTaskId ?? "无任务"}</b>
                  任务 ID
                </span>
              </div>
              <div className={styles.stageProgressBox}>
                <strong>{lastRenderProgress ?? "等待进度"}</strong>
                <small>{workflow?.generation?.error?.message ?? "任务完成后会询问是否进入预览导出。"}</small>
              </div>
              <Button
                variant="primary"
                onClick={() =>
                  void waitForGenerationTask().catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    setWorkflowError(message);
                    setNotice(`成片生成失败：${message}`);
                  })
                }
                disabled={!renderTask?.taskId && !workflow?.generation?.mediaTaskId}
              >
                <Icon name="spinner" size={14} />
                等待任务完成
              </Button>
            </section>
          ) : null}

          {activeSidebarStage === "export" ? (
            <section className={styles.stagePanel} aria-label="预览导出阶段侧栏">
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.export}</div>
              <div className={styles.stageProgressBox}>
                <strong>{downloadPath ? "导出已就绪" : "等待生成结果"}</strong>
                <small>{workflow?.export?.manifestPath ?? "生成完成后会写入导出 manifest。"}</small>
              </div>
              <Button
                variant="primary"
                onClick={() =>
                  void runPreviewExport().catch((error: unknown) => {
                    setWorkflowError(error instanceof Error ? error.message : String(error));
                    setNotice("预览导出失败，请查看错误");
                  })
                }
                disabled={!previewPath && !workflow?.generation?.output && !workflow?.export?.previewPath}
              >
                <Icon name="download" size={14} />
                生成预览与导出
              </Button>
              <div className={styles.exportPathActions}>
                {previewPath ? (
                  <Button
                    variant="ghost"
                    onClick={() => (onOpenFile ? onOpenFile(previewPath) : setNotice(`预览路径：${previewPath}`))}
                  >
                    <Icon name="play" size={14} />
                    预览 {previewPath}
                  </Button>
                ) : null}
                {downloadPath ? (
                  <Button
                    variant="primary-ghost"
                    onClick={() => (onOpenFile ? onOpenFile(downloadPath) : setNotice(`导出路径：${downloadPath}`))}
                  >
                    <Icon name="download" size={14} />
                    导出 {downloadPath}
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {notice ? (
            <div className={styles.notice} role="status">
              {notice}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
