import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Button, Input, Select, Textarea } from '@open-design/components';
import type {
  CommerceVideoJobWaitResponse,
  CommerceVideoStageId,
  CommerceVideoStage,
  CommerceVideoWorkflow,
} from '@open-design/contracts';

import {
  exportCommerceVideo,
  fetchCommerceVideoPreview,
  fetchCommerceVideoWorkflow,
  generateCommerceVideo,
  saveCommerceVideoMaterials,
  saveCommerceVideoScript,
  saveCommerceVideoStoryboard,
  waitCommerceVideoJob,
} from '../providers/commerce-video';
import { fetchProjectFileText, projectFileUrl } from '../providers/registry';
import type { ProjectFile } from '../types';
import { Icon } from './Icon';
import styles from './StoryboardEditor.module.css';

type ShotStatus = 'synced' | 'dirty' | 'refreshing' | 'queued' | 'refreshed';
type ScriptTemplateId = 'pain-proof-offer' | 'demo-contrast' | 'creator-testimonial';
type ExportFormat = 'mp4' | 'webm' | 'mov';
type ExportResolution = '1080x1920' | '720x1280' | '1080x1080';

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
  title: string;
  sellingPoints: string;
  body: string;
  cta: string;
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
  status: 'requested' | 'ready' | 'failed';
  scriptVersion: number;
}

interface RenderTaskState {
  taskId: string;
  status: string;
  progress: string[];
  nextSince: number;
}

const WORKFLOW_STAGE_IDS: CommerceVideoStageId[] = [
  'materials',
  'script',
  'storyboard',
  'generation',
  'progress',
  'export',
];

const WORKFLOW_STAGE_COPY: Record<
  CommerceVideoStageId,
  { label: string; eyebrow: string; summary: string }
> = {
  materials: {
    label: '商品素材',
    eyebrow: 'Materials',
    summary: '上传商品图、商品视频、卖点素材，并确认是否进入 workflow。',
  },
  script: {
    label: '剧本生成',
    eyebrow: 'Script',
    summary: '沉淀标题、钩子、卖点、口播和 CTA，作为分镜输入。',
  },
  storyboard: {
    label: '基础分镜',
    eyebrow: 'Storyboard',
    summary: '管理镜头、时长、素材切片、画面目标和台词。',
  },
  generation: {
    label: '一键成片',
    eyebrow: 'Generation',
    summary: '确认模型、时长、格式和成片任务配置，只负责创建生成任务。',
  },
  progress: {
    label: '任务进度',
    eyebrow: 'Progress',
    summary: '单独观察生成任务、等待结果和失败原因，不自动进入导出。',
  },
  export: {
    label: '预览导出',
    eyebrow: 'Preview / export',
    summary: '检查预览文件、导出文件和最终 manifest。',
  },
};

const STAGE_SYSTEM_PROMPTS: Record<CommerceVideoStageId, string> = {
  materials:
    '系统提示词：当前只处理商品素材上传与素材确认。识别商品图/视频、卖点素材、缺失项和素材风险；完成后必须停下，询问用户是否进入剧本生成，不要生成脚本、分镜或成片。',
  script:
    '系统提示词：当前只处理剧本生成。输出标题、钩子、卖点、口播和 CTA；完成后必须停下，询问用户是否进入基础分镜，不要生成分镜或成片。',
  storyboard:
    '系统提示词：当前只处理基础分镜。输出镜头、时长、画面目标、素材建议和口播；完成后必须停下，询问用户是否进入一键成片，不要创建生成任务。',
  generation:
    '系统提示词：当前只处理一键成片任务创建。确认模型、比例、时长和输出文件并创建生成任务；任务创建后必须停下，询问用户是否进入任务进度，不要等待任务或导出。',
  progress:
    '系统提示词：当前只处理任务进度。观察/等待生成任务状态、进度和错误；任务完成后必须停下，询问用户是否进入预览导出，不要自动导出。',
  export:
    '系统提示词：当前只处理预览导出。读取预览文件、执行导出 manifest、提供下载/预览路径；不要回头重写脚本、分镜或重新生成成片。',
};

interface Props {
  projectId: string;
  files: ProjectFile[];
  onOpenFile?: (name: string) => void;
  onRequestAgentPrompt?: (prompt: string) => void;
}

const STORAGE_PREFIX = 'od:storyboard-editor:';
const SCRIPT_STORAGE_PREFIX = 'od:storyboard-script:';
const EXPORT_STORAGE_PREFIX = 'od:storyboard-export:';
const STORYBOARD_FILE_RE =
  /(^|[/\\])(storyboard|分镜|fenjing|shots?|scenes?)[^/\\]*\.(json|md|txt)$/i;

const EMPTY_ASSET = '';
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  resolution: '1080x1920',
  includeSubtitles: true,
  includeVoiceover: true,
  includeBgm: true,
  targetDuration: 15,
};

const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'pain-proof-offer',
    label: '痛点-证明-优惠',
    title: '便携榨汁杯 15 秒带货脚本',
    sellingPoints: '通勤早餐来不及\n一杯一榨即走\n杯体可拆洗\n限时组合优惠',
    body:
      '开场用高频痛点抓住注意力，随后展示商品真实使用动作和清洗证明，最后用优惠与行动引导收口。',
    cta: '现在下单，明早早餐直接带走。',
  },
  {
    id: 'demo-contrast',
    label: '前后对比演示',
    title: '商品效果对比脚本',
    sellingPoints: '使用前麻烦\n使用后更省时\n细节证明可信\n结尾给出购买理由',
    body:
      '用前后对比建立冲突，镜头中段给出真实操作细节，避免空泛参数，把卖点落到可见结果。',
    cta: '想省下这一步，直接点购物车。',
  },
  {
    id: 'creator-testimonial',
    label: '达人口吻种草',
    title: '达人口吻种草脚本',
    sellingPoints: '第一人称真实体验\n高频场景\n核心卖点一句话\n轻促销 CTA',
    body:
      '用口语化第一人称讲述真实体验，镜头保留手部动作和使用环境，让商品像自然被推荐出来。',
    cta: '我会回购的这款，链接放这里。',
  },
];

const DEFAULT_SHOTS: Array<Omit<StoryboardShot, 'assetName'>> = [
  {
    id: 'shot-1',
    title: '痛点钩子',
    sellingPoint: '高频痛点',
    visual: '前三秒直接展示用户痛点，画面要有强对比。',
    assetIn: 0,
    assetOut: 2.4,
    duration: 2.4,
    dialogue: '夏天通勤最怕晒黑又闷汗？',
    status: 'synced',
    version: 1,
  },
  {
    id: 'shot-2',
    title: '商品证明',
    sellingPoint: '商品细节证明',
    visual: '切到商品细节，强调材质、肤感和功能点。',
    assetIn: 0,
    assetOut: 3.2,
    duration: 3.2,
    dialogue: '这件冰丝外套上身轻薄，防晒也不黏。',
    status: 'synced',
    version: 1,
  },
  {
    id: 'shot-3',
    title: '使用场景',
    sellingPoint: '真实使用场景',
    visual: '展示通勤、户外或试穿场景，保留真人动作节奏。',
    assetIn: 0,
    assetOut: 4.4,
    duration: 4.4,
    dialogue: '开车、骑车、逛街都能直接穿。',
    status: 'synced',
    version: 1,
  },
  {
    id: 'shot-4',
    title: 'CTA 收口',
    sellingPoint: '转化行动',
    visual: '用字幕和近景收口，给出价格、优惠或行动引导。',
    assetIn: 0,
    assetOut: 3.6,
    duration: 3.6,
    dialogue: '现在下单，出门前就把防晒准备好。',
    status: 'synced',
    version: 1,
  },
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
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function mediaFiles(files: ProjectFile[]): ProjectFile[] {
  return files
    .filter((file) => file.kind === 'image' || file.kind === 'video')
    .sort((left, right) => left.name.localeCompare(right.name));
}

function storyboardSourceFile(files: ProjectFile[]): ProjectFile | null {
  return (
    files.find(
      (file) =>
        STORYBOARD_FILE_RE.test(file.name) && (file.kind === 'text' || file.kind === 'code'),
    ) ?? null
  );
}

function createDefaultShots(files: ProjectFile[]): StoryboardShot[] {
  const assets = mediaFiles(files);
  return DEFAULT_SHOTS.map((shot, index) => ({
    ...shot,
    assetName: assets[index % Math.max(assets.length, 1)]?.name ?? EMPTY_ASSET,
  }));
}

function defaultScriptEntity(): ScriptEntity {
  const template = SCRIPT_TEMPLATES[0]!;
  return {
    id: 'script-main',
    title: template.title,
    templateId: template.id,
    version: 1,
    sellingPoints: template.sellingPoints,
    body: template.body,
    cta: template.cta,
  };
}

function scriptFromTemplate(templateId: ScriptTemplateId, current?: ScriptEntity): ScriptEntity {
  const template =
    SCRIPT_TEMPLATES.find((item) => item.id === templateId) ?? SCRIPT_TEMPLATES[0]!;
  return {
    id: current?.id ?? 'script-main',
    title: template.title,
    templateId: template.id,
    version: (current?.version ?? 1) + 1,
    sellingPoints: template.sellingPoints,
    body: template.body,
    cta: template.cta,
  };
}

function sellingPointList(script: ScriptEntity): string[] {
  return script.sellingPoints
    .split(/\r?\n|[，,；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildShotsFromScript(script: ScriptEntity, files: ProjectFile[]): StoryboardShot[] {
  const points = sellingPointList(script);
  const assets = mediaFiles(files);
  const pointAt = (index: number, fallback: string) => points[index] ?? fallback;
  const slate = [
    {
      title: '痛点钩子',
      sellingPoint: pointAt(0, '高频痛点'),
      visual: `前三秒直接拍出“${pointAt(0, '用户痛点')}”，用强对比字幕抢注意力。`,
      dialogue: pointAt(0, '这个痛点你肯定遇到过。'),
      duration: 2.8,
    },
    {
      title: '卖点证明',
      sellingPoint: pointAt(1, '核心卖点'),
      visual: `给商品一个近景动作证明“${pointAt(1, '核心卖点')}”，避免只说参数。`,
      dialogue: pointAt(1, '这个设计省心很多。'),
      duration: 3.6,
    },
    {
      title: '场景演示',
      sellingPoint: pointAt(2, '真实场景'),
      visual: `切到真实使用场景，展示“${pointAt(2, '真实场景')}”带来的前后差异。`,
      dialogue: pointAt(2, '日常用起来更顺手。'),
      duration: 4.4,
    },
    {
      title: '信任与 CTA',
      sellingPoint: pointAt(3, '购买理由'),
      visual: `用细节、优惠或结果收口，字幕突出“${pointAt(3, '购买理由')}”。`,
      dialogue: script.cta || pointAt(3, '现在下单更划算。'),
      duration: 4.2,
    },
  ];

  return slate.map((shot, index) => ({
    id: `shot-${index + 1}`,
    ...shot,
    assetName: assets[index % Math.max(assets.length, 1)]?.name ?? EMPTY_ASSET,
    assetIn: 0,
    assetOut: shot.duration,
    status: 'dirty',
    version: 1,
  }));
}

function readStoredShots(projectId: string): StoryboardShot[] | null {
  if (typeof window === 'undefined') return null;
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
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(shots));
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function readStoredScript(projectId: string): ScriptEntity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${SCRIPT_STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    return normalizeScript(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function storeScript(projectId: string, script: ScriptEntity): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${SCRIPT_STORAGE_PREFIX}${projectId}`, JSON.stringify(script));
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function readStoredExports(projectId: string): ExportResult[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(`${EXPORT_STORAGE_PREFIX}${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ExportResult | null => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const format = stringValue(record.format) as ExportFormat;
        const resolution = stringValue(record.resolution) as ExportResolution;
        if (!['mp4', 'webm', 'mov'].includes(format)) return null;
        if (!['1080x1920', '720x1280', '1080x1080'].includes(resolution)) return null;
        return {
          id: stringValue(record.id) || `export-${Date.now()}`,
          name: stringValue(record.name) || '成片导出',
          format,
          resolution,
          duration: clampDuration(numberValue(record.duration) ?? 15),
          status: record.status === 'ready' ? 'ready' : 'requested',
          scriptVersion: Math.max(1, Math.round(numberValue(record.scriptVersion) ?? 1)),
        };
      })
      .filter((item): item is ExportResult => Boolean(item));
  } catch {
    return [];
  }
}

function storeExports(projectId: string, results: ExportResult[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${EXPORT_STORAGE_PREFIX}${projectId}`, JSON.stringify(results));
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function normalizeShots(value: unknown, assets: ProjectFile[]): StoryboardShot[] | null {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
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
      if (!shot || typeof shot !== 'object') return null;
      const item = shot as Record<string, unknown>;
      const id = stringValue(item.id) || `shot-${index + 1}`;
      const duration = clampDuration(
        numberValue(item.duration) ??
          numberValue(item.durationSec) ??
          numberValue(item.seconds) ??
          3,
      );
      const rawAsset =
        stringValue(item.assetName) || stringValue(item.asset) || stringValue(item.slice) || '';
      const assetName = assetNames.has(rawAsset)
        ? rawAsset
        : (assets[index % Math.max(assets.length, 1)]?.name ?? EMPTY_ASSET);
      const assetIn = clampAssetTime(numberValue(item.assetIn) ?? numberValue(item.start) ?? 0);
      const assetOut = clampAssetTime(
        numberValue(item.assetOut) ?? numberValue(item.end) ?? assetIn + duration,
      );
      return {
        id,
        title:
          stringValue(item.title) ||
          stringValue(item.name) ||
          stringValue(item.scene) ||
          `镜头 ${index + 1}`,
        sellingPoint:
          stringValue(item.sellingPoint) ||
          stringValue(item.point) ||
          stringValue(item.benefit) ||
          '',
        visual:
          stringValue(item.visual) ||
          stringValue(item.description) ||
          stringValue(item.prompt) ||
          stringValue(item.imagePrompt) ||
          '',
        assetName,
        assetIn,
        assetOut: Math.max(assetIn, assetOut),
        duration,
        dialogue:
          stringValue(item.dialogue) ||
          stringValue(item.voiceover) ||
          stringValue(item.line) ||
          stringValue(item.narration) ||
          '',
        status: 'synced',
        version: Math.max(1, Math.round(numberValue(item.version) ?? 1)),
      };
    })
    .filter((shot): shot is StoryboardShot => Boolean(shot));
  return normalized.length > 0 ? normalized : null;
}

function normalizeScript(value: unknown): ScriptEntity | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const templateId = stringValue(record.templateId) as ScriptTemplateId;
  const validTemplate = SCRIPT_TEMPLATES.some((template) => template.id === templateId);
  return {
    id: stringValue(record.id) || 'script-main',
    title: stringValue(record.title) || '商品带货脚本',
    templateId: validTemplate ? templateId : 'pain-proof-offer',
    version: Math.max(1, Math.round(numberValue(record.version) ?? 1)),
    sellingPoints: stringValue(record.sellingPoints) || stringValue(record.points),
    body: stringValue(record.body) || stringValue(record.script),
    cta: stringValue(record.cta) || '现在下单。',
  };
}

function scriptFromWorkflow(workflow: CommerceVideoWorkflow): ScriptEntity | null {
  if (!workflow.script) return null;
  return {
    id: 'script-main',
    title: workflow.script.title || '商品带货脚本',
    templateId: 'pain-proof-offer',
    version: 1,
    sellingPoints: workflow.script.sellingPoints.join('\n'),
    body: workflow.script.voiceover,
    cta: workflow.script.cta || '现在下单。',
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
      sellingPoint: shot.qaCheck || '',
      visual: shot.visualGoal || shot.prompt,
      assetName: requiredAsset,
      assetIn: 0,
      assetOut: clampDuration(shot.durationSec),
      duration: clampDuration(shot.durationSec),
      dialogue: shot.voiceover || shot.caption || '',
      status: 'synced',
      version: 1,
    };
  });
}

function workflowScriptInput(script: ScriptEntity) {
  const sellingPoints = sellingPointList(script);
  return {
    title: script.title || '商品带货脚本',
    hook: sellingPoints[0] || script.title || '商品卖点钩子',
    voiceover: script.body || script.cta || script.title || '商品带货口播',
    sellingPoints,
    ...(script.cta ? { cta: script.cta } : {}),
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
      qaCheck: shot.sellingPoint,
    })),
  };
}

function previewPathFromWorkflow(workflow: CommerceVideoWorkflow | null): string | null {
  return workflow?.generation?.output?.path ?? workflow?.export?.previewPath ?? null;
}

function downloadPathFromWorkflow(workflow: CommerceVideoWorkflow | null): string | null {
  return workflow?.export?.downloadPath ?? workflow?.generation?.output?.path ?? null;
}

function mergeRenderTask(
  current: RenderTaskState | null,
  snapshot: CommerceVideoJobWaitResponse,
): RenderTaskState {
  const priorProgress = current?.taskId === snapshot.taskId ? current.progress : [];
  return {
    taskId: snapshot.taskId,
    status: snapshot.status,
    progress: [...priorProgress, ...snapshot.progress],
    nextSince: snapshot.nextSince,
  };
}

function isTerminalTaskStatus(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'interrupted';
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return '排队';
    case 'running':
      return '生成中';
    case 'done':
      return '已完成';
    case 'failed':
      return '失败';
    case 'interrupted':
      return '已中断';
    default:
      return status || '等待生成';
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
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

function reorderShots(
  shots: StoryboardShot[],
  draggedId: string,
  targetId: string,
): StoryboardShot[] {
  if (draggedId === targetId) return shots;
  const from = shots.findIndex((shot) => shot.id === draggedId);
  const to = shots.findIndex((shot) => shot.id === targetId);
  if (from < 0 || to < 0) return shots;
  const next = shots.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return shots;
  next.splice(to, 0, moved);
  return next.map((shot) => ({ ...shot, status: shot.id === draggedId ? 'dirty' : shot.status }));
}

function buildAgentPrompt(
  shots: StoryboardShot[],
  changedIds: Set<string>,
  script: ScriptEntity,
): string {
  const changed = shots.filter((shot) => changedIds.has(shot.id));
  const changedSummary =
    changed.length > 0
      ? changed.map((shot, index) => `${index + 1}. ${shot.title} (${shot.id})`).join('\n')
      : '无显式脏分镜；请按当前分镜表做一次快速一致性检查。';
  const shotLines = shots
    .map((shot, index) => {
      const changedMark = changedIds.has(shot.id) ? ' [changed]' : '';
      return [
        `${index + 1}. ${shot.title}${changedMark}`,
        `   id: ${shot.id}`,
        `   duration: ${formatSeconds(shot.duration)}`,
        `   asset: ${shot.assetName || '待生成/待匹配素材'}`,
        `   slice: ${formatSeconds(shot.assetIn)}-${formatSeconds(shot.assetOut)}`,
        `   visual: ${shot.visual || '未填写'}`,
        `   dialogue: ${shot.dialogue || '无台词'}`,
        `   version: v${shot.version}`,
      ].join('\n');
    })
    .join('\n');

  return [
    '请基于当前项目执行分镜级干预，并快速重渲染整体视频。',
    '',
    `脚本实体：${script.title} v${script.version}`,
    `核心卖点：${sellingPointList(script).join(' / ') || '未填写'}`,
    `CTA：${script.cta || '未填写'}`,
    '',
    '要求：',
    '- 只对标记为 [changed] 的单个分镜做重生成、素材切片替换、时长或台词调整。',
    '- 未标记的分镜尽量复用已有素材、镜头和渲染结果，不要重做整片策略。',
    '- 局部刷新完成后再拼接整片，保持字幕、口播、节奏和画面连续性。',
    '- 如果项目已有可执行渲染脚本或 Hyperframes/Remotion 源文件，请直接更新源文件并输出新成片。',
    '',
    '变更分镜：',
    changedSummary,
    '',
    '当前分镜表：',
    shotLines,
  ].join('\n');
}

function buildStoryboardPrompt(script: ScriptEntity, shots: StoryboardShot[]): string {
  return [
    STAGE_SYSTEM_PROMPTS.storyboard,
    '',
    '请把当前商品卖点稳定串成“分镜脚本 -> 镜头计划”。',
    '',
    `脚本实体：${script.title} v${script.version}`,
    `模板：${SCRIPT_TEMPLATES.find((item) => item.id === script.templateId)?.label ?? script.templateId}`,
    `卖点：${sellingPointList(script).join(' / ') || '未填写'}`,
    `脚本正文：${script.body || '未填写'}`,
    `CTA：${script.cta || '未填写'}`,
    '',
    '输出要求：',
    '- 先给 15 秒内成片结构，再给镜头级计划。',
    '- 每个镜头必须包含绑定卖点、画面目标、口播/字幕、素材需求、时长和重生成提示。',
    '- 保持商品图片/商品链接到脚本、分镜、TTS/BGM/字幕、预览导出的连续链路。',
    '',
    '当前镜头计划：',
    shots
      .map(
        (shot, index) =>
          `${index + 1}. ${shot.title} / ${shot.sellingPoint || '未绑定卖点'} / ${formatSeconds(shot.duration)} / ${shot.assetName || '待生成素材'}`,
      )
      .join('\n'),
  ].join('\n');
}

function buildExportPrompt(
  script: ScriptEntity,
  shots: StoryboardShot[],
  settings: ExportSettings,
): string {
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  return [
    STAGE_SYSTEM_PROMPTS.generation,
    '',
    '请执行一键成片阶段：只创建生成任务，不要等待任务完成，不要自动导出。',
    '',
    '目标链路：商品输入 -> 脚本 -> 分镜 -> TTS/BGM/字幕 -> <=15s 成片 -> 预览/导出。',
    `脚本实体：${script.title} v${script.version}`,
    `脚本正文：${script.body || '未填写'}`,
    `CTA：${script.cta || '未填写'}`,
    '',
    '导出设置：',
    `format: ${settings.format}`,
    `resolution: ${settings.resolution}`,
    `target_duration: <=${formatSeconds(settings.targetDuration)}`,
    `current_duration: ${formatSeconds(totalDuration)}`,
    `subtitles: ${settings.includeSubtitles ? 'on' : 'off'}`,
    `tts: ${settings.includeVoiceover ? 'on' : 'off'}`,
    `bgm: ${settings.includeBgm ? 'on' : 'off'}`,
    '',
    '镜头计划：',
    shots
      .map((shot, index) =>
        [
          `${index + 1}. ${shot.title}`,
          `   selling_point: ${shot.sellingPoint || '未绑定'}`,
          `   duration: ${formatSeconds(shot.duration)}`,
          `   asset: ${shot.assetName || '待生成/待匹配素材'}`,
          `   visual: ${shot.visual || '未填写'}`,
          `   dialogue: ${shot.dialogue || '无台词'}`,
        ].join('\n'),
      )
      .join('\n'),
    '',
    '请返回：预览路径、导出文件路径、格式信息、失败重试建议和结果管理摘要。',
  ].join('\n');
}

function stageStatusLabel(stage: CommerceVideoStage): string {
  switch (stage.status) {
    case 'queued':
      return '排队';
    case 'running':
      return '进行中';
    case 'done':
      return '完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return '未开始';
  }
}

function defaultWorkflowStage(id: CommerceVideoStageId): CommerceVideoStage {
  return {
    id,
    label: WORKFLOW_STAGE_COPY[id].label,
    status: 'idle',
  };
}

function normalizedWorkflowStages(workflow: CommerceVideoWorkflow | null): CommerceVideoStage[] {
  return WORKFLOW_STAGE_IDS.map((id) => {
    const stage = workflow?.stages.find((item) => item.id === id);
    return stage ? { ...stage, label: WORKFLOW_STAGE_COPY[id].label } : defaultWorkflowStage(id);
  });
}

function currentWorkflowStageId(stages: CommerceVideoStage[]): CommerceVideoStageId {
  const active = stages.find((stage) => stage.status === 'running' || stage.status === 'queued');
  if (active) return active.id;
  const failed = stages.find((stage) => stage.status === 'failed' || stage.status === 'cancelled');
  if (failed) return failed.id;
  const next = stages.find((stage) => stage.status !== 'done');
  return next?.id ?? 'export';
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
  const [shots, setShots] = useState<StoryboardShot[]>(
    () => readStoredShots(projectId) ?? createDefaultShots(files),
  );
  const [script, setScript] = useState<ScriptEntity>(
    () => readStoredScript(projectId) ?? defaultScriptEntity(),
  );
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [exportResults, setExportResults] = useState<ExportResult[]>(() =>
    readStoredExports(projectId),
  );
  const [activeShotId, setActiveShotId] = useState(() => shots[0]?.id ?? 'shot-1');
  const [draggedShotId, setDraggedShotId] = useState<string | null>(null);
  const [changedShotIds, setChangedShotIds] = useState<Set<string>>(() => new Set());
  const [playTime, setPlayTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<CommerceVideoWorkflow | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [renderTask, setRenderTask] = useState<RenderTaskState | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [activeSidebarStage, setActiveSidebarStage] = useState<CommerceVideoStageId>('materials');
  const [currentFlowStageId, setCurrentFlowStageId] = useState<CommerceVideoStageId>('materials');
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

  useEffect(() => {
    const stored = readStoredShots(projectId);
    const next = stored ?? createDefaultShots(files);
    const nextScript = readStoredScript(projectId) ?? defaultScriptEntity();
    setShots(next);
    setScript(nextScript);
    setExportSettings(DEFAULT_EXPORT_SETTINGS);
    setExportResults(readStoredExports(projectId));
    setActiveShotId(next[0]?.id ?? 'shot-1');
    setChangedShotIds(new Set());
    setPlayTime(0);
    setPlaying(false);
    setWorkflow(null);
    setWorkflowError(null);
    setRenderTask(null);
    setPreviewPath(null);
    setDownloadPath(null);
    setActiveSidebarStage('materials');
    setCurrentFlowStageId('materials');
    setPendingNextStageId(null);
    loadedSourceRef.current = null;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setWorkflowLoading(true);
    setWorkflowError(null);
    void fetchCommerceVideoWorkflow(projectId)
      .then(({ workflow: nextWorkflow }) => {
        if (cancelled) return;
        setWorkflow(nextWorkflow);
        const nextStage = currentWorkflowStageId(normalizedWorkflowStages(nextWorkflow));
        setCurrentFlowStageId(nextStage);
        setActiveSidebarStage(nextStage);
        setPendingNextStageId(null);
        setPreviewPath(previewPathFromWorkflow(nextWorkflow));
        setDownloadPath(downloadPathFromWorkflow(nextWorkflow));
        const nextScript = scriptFromWorkflow(nextWorkflow);
        if (nextScript) setScript(nextScript);
        const nextShots = shotsFromWorkflow(nextWorkflow, assets);
        if (nextShots) {
          setShots(nextShots);
          setActiveShotId(nextShots[0]?.id ?? 'shot-1');
          setChangedShotIds(new Set());
          setPlayTime(0);
        }
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
    if (shots.length === 0 && files.length > 0) {
      const next = createDefaultShots(files);
      setShots(next);
      setActiveShotId(next[0]?.id ?? 'shot-1');
    }
  }, [files, shots.length]);

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
    const source = storyboardSourceFile(files);
    if (!source) return;
    if (changedShotIds.size > 0) return;
    const sourceKey = `${projectId}:${source.name}:${source.mtime}`;
    if (loadedSourceRef.current === sourceKey) return;
    loadedSourceRef.current = sourceKey;

    let cancelled = false;
    void fetchProjectFileText(projectId, source.name, {
      cache: 'no-store',
      cacheBustKey: source.mtime,
    }).then((text) => {
      if (cancelled || !text) return;
      try {
        const parsed = JSON.parse(text) as unknown;
        const normalized = normalizeShots(parsed, assets);
        if (!normalized) return;
        setShots(normalized);
        setActiveShotId(normalized[0]?.id ?? 'shot-1');
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
    [],
  );

  function isStageDone(stageId: CommerceVideoStageId): boolean {
    return workflowStages.find((stage) => stage.id === stageId)?.status === 'done';
  }

  function canOpenStage(stageId: CommerceVideoStageId): boolean {
    return stageIndex(stageId) <= stageIndex(currentFlowStageId) || isStageDone(stageId);
  }

  function openStage(stageId: CommerceVideoStageId): void {
    if (!canOpenStage(stageId)) {
      setNotice(`请先完成${WORKFLOW_STAGE_COPY[currentFlowStageId].label}，再确认进入${WORKFLOW_STAGE_COPY[stageId].label}`);
      return;
    }
    setActiveSidebarStage(stageId);
  }

  function markStageComplete(stageId: CommerceVideoStageId, prefix: string): void {
    const nextStage = nextWorkflowStageId(stageId);
    setCurrentFlowStageId(stageId);
    setActiveSidebarStage(stageId);
    setPendingNextStageId(nextStage);
    setNotice(
      nextStage
        ? `${prefix}是否进入${WORKFLOW_STAGE_COPY[nextStage].label}？`
        : `${prefix}全部流程已完成。`,
    );
  }

  function enterPendingStage(): void {
    if (!pendingNextStageId) return;
    const nextStage = pendingNextStageId;
    setCurrentFlowStageId(nextStage);
    setActiveSidebarStage(nextStage);
    setPendingNextStageId(null);
    setNotice(`已进入${WORKFLOW_STAGE_COPY[nextStage].label}`);
  }

  function materialWorkflowInput() {
    return {
      uploadedFiles: assets.map((asset) => ({
        path: asset.name,
        name: asset.name.split(/[\\/]/).pop() ?? asset.name,
        mime: asset.mime,
        size: asset.size,
      })),
      notes: 'confirmed from storyboard editor strict flow',
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
      current.map((shot) =>
        shot.id === shotId ? { ...shot, ...patch, status: patch.status ?? 'dirty' } : shot,
      ),
    );
    markChanged(shotId);
  }

  function updateScript(patch: Partial<ScriptEntity>): void {
    setScript((current) => ({ ...current, ...patch }));
  }

  function confirmMaterialsStage(): void {
    setActiveSidebarStage('materials');
    void saveCommerceVideoMaterials(projectId, materialWorkflowInput())
      .then(({ workflow: nextWorkflow }) => {
        setWorkflow(nextWorkflow);
        setWorkflowError(null);
        markStageComplete('materials', '商品素材上传已完成。');
      })
      .catch((error: unknown) => {
        setWorkflowError(error instanceof Error ? error.message : String(error));
        setNotice('商品素材写入失败，请查看 workflow 错误');
      });
  }

  function saveScriptVersion(): void {
    setActiveSidebarStage('script');
    setScript((current) => {
      const next = { ...current, version: current.version + 1 };
      void saveCommerceVideoScript(projectId, workflowScriptInput(next))
        .then(({ workflow: nextWorkflow }) => {
          setWorkflow(nextWorkflow);
          setWorkflowError(null);
          markStageComplete('script', '脚本实体已保存为新版本。');
        })
        .catch((error: unknown) => {
          setWorkflowError(error instanceof Error ? error.message : String(error));
        });
      return next;
    });
    setNotice('脚本实体已保存为新版本');
  }

  function applyScriptTemplate(): void {
    setScript((current) => scriptFromTemplate(current.templateId, current));
    setNotice('已应用脚本模板并生成新版本');
  }

  function generateShotPlan(): void {
    setActiveSidebarStage('storyboard');
    const next = buildShotsFromScript(script, files);
    setShots(next);
    setActiveShotId(next[0]?.id ?? 'shot-1');
    setChangedShotIds(new Set(next.map((shot) => shot.id)));
    setPlayTime(0);
    void saveCommerceVideoStoryboard(projectId, workflowStoryboardInput(next))
      .then(({ workflow: nextWorkflow }) => {
        setWorkflow(nextWorkflow);
        setWorkflowError(null);
        markStageComplete('storyboard', '已根据脚本卖点生成镜头计划。');
      })
      .catch((error: unknown) => {
        setWorkflowError(error instanceof Error ? error.message : String(error));
      });
    setNotice('已根据脚本卖点生成镜头计划');
  }

  function requestStoryboardPlan(): void {
    if (!onRequestAgentPrompt) {
      setNotice('当前会话不可接收分镜生成指令');
      return;
    }
    onRequestAgentPrompt(buildStoryboardPrompt(script, shots));
    setNotice('已把分镜脚本和镜头计划指令放入左侧输入框');
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
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveShotId(shotId);
      moveShotById(shotId, -1);
      return;
    }
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveShotId(shotId);
      moveShotById(shotId, 1);
      return;
    }
    if (event.key.toLowerCase() === 'r') {
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
    const sourceId = draggedShotId ?? event.dataTransfer.getData('text/plain');
    if (!sourceId) return;
    setShots((current) => reorderShots(current, sourceId, targetId));
    markChanged(sourceId);
    setDraggedShotId(null);
  }

  function refreshShot(shotId: string): void {
    updateShot(shotId, { status: 'refreshing' });
    const timer = window.setTimeout(() => {
      setShots((current) =>
        current.map((shot) =>
          shot.id === shotId ? { ...shot, status: 'refreshed', version: shot.version + 1 } : shot,
        ),
      );
      setNotice('单个分镜已局部刷新');
    }, 700);
    refreshTimersRef.current.push(timer);
  }

  function regenerateShot(shotId: string): void {
    setShots((current) =>
      current.map((shot) =>
        shot.id === shotId ? { ...shot, status: 'queued', version: shot.version + 1 } : shot,
      ),
    );
    markChanged(shotId);
  }

  function requestFastRender(): void {
    const prompt = buildAgentPrompt(shots, changedShotIds, script);
    if (!onRequestAgentPrompt) {
      setNotice('当前会话不可接收重渲染指令');
      return;
    }
    onRequestAgentPrompt(prompt);
    setNotice('已把分镜变更放入左侧输入框');
  }

  async function createGenerationTask(prompt: string, result: ExportResult): Promise<void> {
    setActiveSidebarStage('generation');
    setWorkflowError(null);
    setRenderTask(null);
    setPreviewPath(null);
    setDownloadPath(null);
    const generated = await generateCommerceVideo(projectId, {
      model: 'doubao-seedance-2-0-260128',
      prompt,
      aspect: exportSettings.resolution === '1080x1080' ? '1:1' : '9:16',
      lengthSec: Math.min(exportSettings.targetDuration, 15),
      output: `commerce-video/${result.id}.${exportSettings.format}`,
    });
    setWorkflow(generated.workflow);
    setRenderTask({
      taskId: generated.taskId,
      status: generated.status,
      progress: [],
      nextSince: 0,
    });
    markStageComplete(
      'generation',
      onRequestAgentPrompt ? '已创建成片生成任务。' : '已直接创建成片生成任务。',
    );
  }

  async function waitForGenerationTask(): Promise<void> {
    setActiveSidebarStage('progress');
    setWorkflowError(null);
    const taskId = renderTask?.taskId ?? workflow?.generation?.mediaTaskId;
    if (!taskId) {
      setNotice('还没有可等待的成片任务');
      return;
    }

    let since = renderTask?.nextSince ?? 0;
    let snapshot: CommerceVideoJobWaitResponse | null = null;
    do {
      snapshot = await waitCommerceVideoJob(taskId, { since, timeoutMs: 4_000 });
      since = snapshot.nextSince;
      setRenderTask((current) => mergeRenderTask(current, snapshot!));
    } while (snapshot && !isTerminalTaskStatus(snapshot.status));

    if (!snapshot || snapshot.status !== 'done') {
      const message =
        snapshot && typeof snapshot.error === 'object' && snapshot.error && 'message' in snapshot.error
          ? String((snapshot.error as { message?: unknown }).message)
          : '成片生成未完成';
      setExportResults((current) =>
        current.map((item) => (item.status === 'requested' ? { ...item, status: 'failed' } : item)),
      );
      throw new Error(message);
    }

    const previewResponse = await fetchCommerceVideoPreview(projectId);
    setWorkflow(previewResponse.workflow);
    setPreviewPath(previewResponse.preview?.path ?? previewResponse.export?.previewPath ?? null);
    setDownloadPath(previewResponse.export?.downloadPath ?? previewResponse.preview?.path ?? null);
    markStageComplete('progress', '任务已完成。');
  }

  async function runPreviewExport(): Promise<void> {
    setActiveSidebarStage('export');
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
      current.map((item) => (item.status === 'requested' ? { ...item, status: 'ready' } : item)),
    );
    setActiveSidebarStage('export');
    setCurrentFlowStageId('export');
    setPendingNextStageId(null);
    setNotice('成片已生成，可预览和导出');
  }

  function requestFinalExport(): void {
    const prompt = buildExportPrompt(script, shots, exportSettings);
    if (onRequestAgentPrompt) onRequestAgentPrompt(prompt);
    const result: ExportResult = {
      id: `export-${Date.now()}`,
      name: `${script.title || '成片'} v${script.version}`,
      format: exportSettings.format,
      resolution: exportSettings.resolution,
      duration: Math.min(exportSettings.targetDuration, totalDuration),
      status: 'requested',
      scriptVersion: script.version,
    };
    setExportResults((current) => [result, ...current].slice(0, 6));
    void createGenerationTask(prompt, result)
      .catch((error: unknown) => {
        setWorkflowError(error instanceof Error ? error.message : String(error));
        setNotice('成片任务创建失败，请查看任务进度');
      });
    setNotice(onRequestAgentPrompt ? '正在创建成片生成任务' : '正在直接创建成片生成任务');
  }

  if (!activeShot) {
    return (
      <section className={styles.shell} data-testid="storyboard-editor">
        <div className={styles.emptyState}>暂无分镜</div>
      </section>
    );
  }

  return (
    <section className={styles.shell} data-testid="storyboard-editor">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span>分镜剪辑 · 脚本 v{script.version}</span>
          <h2>{activeShot.title}</h2>
        </div>
        <div className={styles.headerStats}>
          <span>{shots.length} 镜</span>
          <span>{formatSeconds(totalDuration)}</span>
          <span>{changedShotIds.size} 处变更</span>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            onClick={() => refreshShot(activeShot.id)}
            title="局部刷新当前分镜"
          >
            <Icon name={activeShot.status === 'refreshing' ? 'spinner' : 'refresh'} size={14} />
            局部刷新
          </Button>
          <Button variant="primary" onClick={requestFastRender} disabled={shots.length === 0}>
            <Icon name="send" size={14} />
            快速重渲染
          </Button>
          <Button
            variant="primary-ghost"
            onClick={requestFinalExport}
            disabled={shots.length === 0 || currentFlowStageId !== 'generation'}
          >
            <Icon name="download" size={14} />
            成片导出
          </Button>
        </div>
      </header>

      <section className={styles.workflowRail} aria-label="任务进度">
        <div className={styles.workflowRailHeader}>
          <span>Commerce video workflow</span>
          <strong>
            {workflowLoading
              ? '同步中'
              : `当前阶段：${WORKFLOW_STAGE_COPY[currentStageId].label}`}
          </strong>
        </div>
        <div className={styles.workflowStages}>
          {workflowStages.map((stage) => {
            const isCurrent = stage.id === currentStageId;
            const isSelected = stage.id === activeSidebarStage;
            const locked = !canOpenStage(stage.id);
            return (
              <button
                key={stage.id}
                type="button"
                className={[
                  styles.workflowStage,
                  styles[`workflowStage_${stage.status}`],
                  isCurrent ? styles.workflowStageCurrent : '',
                  isSelected ? styles.workflowStageSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={isCurrent ? 'step' : undefined}
                aria-pressed={isSelected}
                disabled={locked}
                onClick={() => openStage(stage.id)}
              >
                <b>{WORKFLOW_STAGE_COPY[stage.id].label}</b>
                <small>{locked ? '待解锁' : `${isCurrent ? '当前 · ' : ''}${stageStatusLabel(stage)}`}</small>
              </button>
            );
          })}
        </div>
        {workflowError ? <p className={styles.workflowError}>{workflowError}</p> : null}
        {renderTask ? (
          <p className={styles.workflowTaskStatus}>
            <strong>{taskStatusLabel(renderTask.status)}</strong>
            <span>{renderTask.taskId}</span>
            {lastRenderProgress ? <small>{lastRenderProgress}</small> : null}
          </p>
        ) : null}
      </section>

      <div className={styles.body}>
        <aside className={styles.shotList} aria-label="分镜列表">
          {shots.map((shot, index) => {
            const selected = shot.id === activeShot.id;
            const asset = shot.assetName
              ? assets.find((item) => item.name === shot.assetName)
              : null;
            return (
              <button
                key={shot.id}
                type="button"
                className={`${styles.shotCard} ${selected ? styles.shotCardActive : ''}`}
                draggable
                aria-pressed={selected}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown R"
                onClick={() => selectShot(shot.id)}
                onKeyDown={(event) => handleShotKeyDown(event, shot.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', shot.id);
                  setDraggedShotId(shot.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => onDropShot(event, shot.id)}
                onDragEnd={() => setDraggedShotId(null)}
              >
                <span className={styles.shotThumb} data-kind={asset?.kind ?? 'empty'}>
                  {asset?.kind === 'image' ? (
                    <img src={projectFileUrl(projectId, asset.name)} alt="" />
                  ) : asset?.kind === 'video' ? (
                    <Icon name="play" size={16} />
                  ) : (
                    <Icon name="image" size={16} />
                  )}
                </span>
                <span className={styles.shotMeta}>
                  <span>
                    <b>{String(index + 1).padStart(2, '0')}</b>
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
          <section className={styles.scriptPanel} aria-label="脚本实体">
            <div className={styles.panelTitle}>
              <div>
                <span>Script entity</span>
                <h3>脚本实体与可复用模板</h3>
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
                  onChange={(event) =>
                    updateScript({ templateId: event.currentTarget.value as ScriptTemplateId })
                  }
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
              <span>商品卖点</span>
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
                <Input
                  value={script.cta}
                  onChange={(event) => updateScript({ cta: event.currentTarget.value })}
                />
              </label>
              <div className={styles.scriptActions}>
                <Button variant="ghost" onClick={applyScriptTemplate}>
                  <Icon name="copy" size={14} />
                  应用模板
                </Button>
                <Button variant="ghost" onClick={saveScriptVersion}>
                  <Icon name="history" size={14} />
                  保存版本
                </Button>
                <Button variant="primary-ghost" onClick={generateShotPlan}>
                  <Icon name="kanban" size={14} />
                  生成镜头计划
                </Button>
                <Button variant="primary" onClick={requestStoryboardPlan}>
                  <Icon name="sparkles" size={14} />
                  生成分镜脚本
                </Button>
              </div>
            </div>
          </section>

          <div className={styles.previewPanel}>
            <div className={styles.previewSurface}>
              {activeAsset?.kind === 'image' ? (
                <img src={projectFileUrl(projectId, activeAsset.name)} alt={activeAsset.name} />
              ) : activeAsset?.kind === 'video' ? (
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
                <strong>{activeShot.dialogue || '无台词'}</strong>
              </div>
            </div>
            <div className={styles.previewControls}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={playing ? '暂停预览' : '播放预览'}
                aria-keyshortcuts="Space"
                onClick={() => setPlaying((value) => !value)}
              >
                <Icon name={playing ? 'stop' : 'play'} size={14} />
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
              />
            </div>
          </div>

          <section className={styles.timeline} aria-label="分镜时间轴">
            <div className={styles.timelineRuler}>
              <span>0s</span>
              <span>{formatSeconds(totalDuration)}</span>
            </div>
            <div className={styles.timelineTrack}>
              {shots.map((shot, index) => {
                const width = `${Math.max(7, (shot.duration / Math.max(totalDuration, 1)) * 100)}%`;
                const selected = shot.id === activeShot.id;
                return (
                  <button
                    key={shot.id}
                    type="button"
                    draggable
                    className={`${styles.timelineBlock} ${selected ? styles.timelineBlockActive : ''}`}
                    style={{ width }}
                    onClick={() => selectShot(shot.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', shot.id);
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
                    setExportSettings((current) => ({
                      ...current,
                      format,
                    }));
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
                    setExportSettings((current) => ({
                      ...current,
                      resolution,
                    }));
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
                    const targetDuration = Math.min(
                      15,
                      clampDuration(Number.parseFloat(event.currentTarget.value)),
                    );
                    setExportSettings((current) => ({
                      ...current,
                      targetDuration,
                    }));
                  }}
                />
              </label>
              <label className={styles.checkboxField}>
                <Input
                  type="checkbox"
                  checked={exportSettings.includeSubtitles}
                  onChange={(event) => {
                    const includeSubtitles = event.currentTarget.checked;
                    setExportSettings((current) => ({
                      ...current,
                      includeSubtitles,
                    }));
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
                    setExportSettings((current) => ({
                      ...current,
                      includeVoiceover,
                    }));
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
                    setExportSettings((current) => ({
                      ...current,
                      includeBgm,
                    }));
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
                        id: 'generation',
                        label: 'Generation',
                        status: workflow.generation.status,
                      })
                    : '等待生成'}
              </strong>
              {lastRenderProgress ? <small>{lastRenderProgress}</small> : null}
              <div className={styles.exportPathActions}>
                {previewPath ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      onOpenFile ? onOpenFile(previewPath) : setNotice(`预览路径：${previewPath}`)
                    }
                  >
                    <Icon name="play" size={14} />
                    预览 {previewPath}
                  </Button>
                ) : null}
                {downloadPath ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      onOpenFile ? onOpenFile(downloadPath) : setNotice(`导出路径：${downloadPath}`)
                    }
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
                      {result.format.toUpperCase()} · {result.resolution} ·{' '}
                      {formatSeconds(result.duration)}
                    </span>
                    <small>
                      脚本 v{result.scriptVersion} ·{' '}
                      {result.status === 'ready' ? '已完成' : result.status === 'failed' ? '失败' : '待生成'}
                    </small>
                  </button>
                ))
              )}
            </div>
          </section>
        </main>

        <aside className={styles.stageSidebar} aria-label="阶段右侧栏" data-stage={activeSidebarStage}>
          <div className={styles.stageSidebarHeader}>
            <span>{WORKFLOW_STAGE_COPY[activeSidebarStage].eyebrow}</span>
            <div>
              <h3>{WORKFLOW_STAGE_COPY[activeSidebarStage].label}</h3>
              <strong>{activeSidebarStage === currentStageId ? '当前阶段' : stageStatusLabel(activeStage)}</strong>
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
                  className={`${styles.stageSidebarNavItem} ${stage.id === activeSidebarStage ? styles.stageSidebarNavItemActive : ''}`}
                  aria-current={stage.id === currentStageId ? 'step' : undefined}
                  aria-pressed={stage.id === activeSidebarStage}
                  disabled={locked}
                  onClick={() => openStage(stage.id)}
                >
                  <span>{WORKFLOW_STAGE_COPY[stage.id].label}</span>
                  <small>{locked ? '待解锁' : stage.id === currentStageId ? '当前' : stageStatusLabel(stage)}</small>
                </button>
              );
            })}
          </div>

          {pendingNextStageId && activeSidebarStage === currentFlowStageId ? (
            <div className={styles.stageGate} role="status">
              <strong>是否进入{WORKFLOW_STAGE_COPY[pendingNextStageId].label}？</strong>
              <small>当前流程已完成。确认后才会更新右侧栏并进入下一流程。</small>
              <Button variant="primary" onClick={enterPendingStage}>
                进入{WORKFLOW_STAGE_COPY[pendingNextStageId].label}
              </Button>
            </div>
          ) : null}

          {activeSidebarStage === 'materials' ? (
            <section className={styles.stagePanel} aria-label="商品素材阶段侧栏">
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.materials}</div>
              <div className={styles.stageFacts}>
                <span>
                  <b>{assets.length}</b>
                  项目图片/视频素材
                </span>
                <span>
                  <b>{workflow?.materials.productAssetIds.length ?? 0}</b>
                  商品素材记录
                </span>
                <span>
                  <b>{workflow?.materials.uploadedFiles.length ?? 0}</b>
                  已写入 workflow
                </span>
              </div>
              <div className={styles.stageList}>
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

          {activeSidebarStage === 'script' ? (
            <section className={styles.stagePanel} aria-label="剧本生成阶段侧栏">
              <strong>剧本工作台</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.script}</div>
              <label className={styles.field}>
                <span>脚本标题</span>
                <Input
                  value={script.title}
                  onChange={(event) => updateScript({ title: event.currentTarget.value })}
                />
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
                <span>CTA</span>
                <Input
                  value={script.cta}
                  onChange={(event) => updateScript({ cta: event.currentTarget.value })}
                />
              </label>
              <div className={styles.inspectorActions}>
                <Button variant="primary-ghost" onClick={saveScriptVersion}>
                  <Icon name="history" size={14} />
                  保存剧本
                </Button>
                <Button variant="primary" onClick={generateShotPlan}>
                  <Icon name="kanban" size={14} />
                  生成分镜
                </Button>
              </div>
            </section>
          ) : null}

          {activeSidebarStage === 'storyboard' ? (
            <section className={styles.stagePanel} aria-label="基础分镜阶段侧栏">
              <strong>基础分镜面板</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.storyboard}</div>
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
                  onChange={(event) =>
                    updateShot(activeShot.id, { sellingPoint: event.currentTarget.value })
                  }
                />
              </label>
              <label className={styles.field}>
                <span>素材切片</span>
                <Select
                  value={activeShot.assetName}
                  onChange={(event) =>
                    updateShot(activeShot.id, { assetName: event.currentTarget.value })
                  }
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
                        assetIn: clampAssetTime(Number.parseFloat(event.currentTarget.value)),
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
                        assetOut: clampAssetTime(Number.parseFloat(event.currentTarget.value)),
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
                        duration: clampDuration(Number.parseFloat(event.currentTarget.value)),
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
                  onChange={(event) =>
                    updateShot(activeShot.id, { dialogue: event.currentTarget.value })
                  }
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
            </section>
          ) : null}

          {activeSidebarStage === 'generation' ? (
            <section className={styles.stagePanel} aria-label="一键成片阶段侧栏">
              <strong>成片任务配置</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.generation}</div>
              <div className={styles.stageFacts}>
                <span>
                  <b>{exportSettings.resolution}</b>
                  输出尺寸
                </span>
                <span>
                  <b>{workflow?.generation?.model ?? '未选择'}</b>
                  模型
                </span>
                <span>
                  <b>{workflow?.generation?.lengthSec ?? Math.min(exportSettings.targetDuration, 15)}s</b>
                  目标时长
                </span>
              </div>
              <div className={styles.stageProgressBox}>
                <strong>{renderTask?.taskId ?? workflow?.generation?.mediaTaskId ?? '尚未创建任务'}</strong>
                <small>点击生成成片只会创建任务；确认后再进入任务进度。</small>
              </div>
              <Button variant="primary" onClick={requestFinalExport} disabled={shots.length === 0}>
                <Icon name="download" size={14} />
                生成成片
              </Button>
            </section>
          ) : null}

          {activeSidebarStage === 'progress' ? (
            <section className={styles.stagePanel} aria-label="任务进度阶段侧栏">
              <strong>任务进度</strong>
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.progress}</div>
              <div className={styles.stageFacts}>
                <span>
                  <b>{renderTask ? taskStatusLabel(renderTask.status) : stageStatusLabel(activeStage)}</b>
                  任务状态
                </span>
                <span>
                  <b>{renderTask?.taskId ?? workflow?.generation?.mediaTaskId ?? '无任务'}</b>
                  任务 ID
                </span>
              </div>
              <div className={styles.stageProgressBox}>
                <strong>{lastRenderProgress ?? '等待进度'}</strong>
                <small>{workflow?.generation?.error?.message ?? '任务完成后会询问是否进入预览导出。'}</small>
              </div>
              <Button
                variant="primary"
                onClick={() =>
                  void waitForGenerationTask().catch((error: unknown) => {
                    setWorkflowError(error instanceof Error ? error.message : String(error));
                    setNotice('任务进度检查失败，请查看错误');
                  })
                }
                disabled={!renderTask?.taskId && !workflow?.generation?.mediaTaskId}
              >
                <Icon name="spinner" size={14} />
                等待任务完成
              </Button>
            </section>
          ) : null}

          {activeSidebarStage === 'export' ? (
            <section className={styles.stagePanel} aria-label="预览导出阶段侧栏">
              <div className={styles.stagePrompt}>{STAGE_SYSTEM_PROMPTS.export}</div>
              <div className={styles.stageProgressBox}>
                <strong>{downloadPath ? '导出已就绪' : '等待生成结果'}</strong>
                <small>{workflow?.export?.manifestPath ?? '生成完成后会写入导出 manifest。'}</small>
              </div>
              <Button
                variant="primary"
                onClick={() =>
                  void runPreviewExport().catch((error: unknown) => {
                    setWorkflowError(error instanceof Error ? error.message : String(error));
                    setNotice('预览导出失败，请查看错误');
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
                    onClick={() =>
                      onOpenFile ? onOpenFile(previewPath) : setNotice(`预览路径：${previewPath}`)
                    }
                  >
                    <Icon name="play" size={14} />
                    预览 {previewPath}
                  </Button>
                ) : null}
                {downloadPath ? (
                  <Button
                    variant="primary-ghost"
                    onClick={() =>
                      onOpenFile ? onOpenFile(downloadPath) : setNotice(`导出路径：${downloadPath}`)
                    }
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
