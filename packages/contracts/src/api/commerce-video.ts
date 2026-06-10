export const COMMERCE_VIDEO_WORKFLOW_FILE = "commerce-video.workflow.json";

export const COMMERCE_VIDEO_STAGE_ORDER = ["materials", "script", "storyboard", "generation", "progress", "export"] as const;

export type CommerceVideoStageId = (typeof COMMERCE_VIDEO_STAGE_ORDER)[number];
export type CommerceVideoStageStatus = "idle" | "queued" | "running" | "done" | "failed" | "cancelled";

export interface CommerceVideoStage {
  id: CommerceVideoStageId;
  label: string;
  status: CommerceVideoStageStatus;
  detail?: string;
  updatedAt?: number;
}

export interface CommerceVideoFileRef {
  path: string;
  name?: string;
  mime?: string;
  size?: number;
}

export interface CommerceVideoMaterials {
  productAssetIds: string[];
  commerceVideoAssetIds?: string[];
  uploadedFiles: CommerceVideoFileRef[];
  notes?: string;
}

export interface CommerceVideoScript {
  title: string;
  hook: string;
  voiceover: string;
  sellingPoints: string[];
  cta?: string;
}

export interface CommerceVideoStoryboardShot {
  id: string;
  index: number;
  durationSec: number;
  visualGoal: string;
  prompt: string;
  voiceover?: string;
  caption?: string;
  camera?: string;
  requiredAssets: string[];
  qaCheck?: string;
}

export interface CommerceVideoStoryboard {
  totalDurationSec: number;
  shots: CommerceVideoStoryboardShot[];
}

export interface CommerceVideoGeneration {
  status: CommerceVideoStageStatus;
  mediaTaskId?: string;
  model?: string;
  aspect?: string;
  lengthSec?: number;
  prompt?: string;
  output?: CommerceVideoFileRef;
  error?: {
    code?: string;
    message: string;
    status?: number;
  };
}

export interface CommerceVideoExport {
  status: CommerceVideoStageStatus;
  manifestPath?: string;
  downloadPath?: string;
  previewPath?: string;
}

export interface CommerceVideoWorkflow {
  version: 1;
  projectId: string;
  fileName: typeof COMMERCE_VIDEO_WORKFLOW_FILE;
  stages: CommerceVideoStage[];
  materials: CommerceVideoMaterials;
  script?: CommerceVideoScript;
  storyboard?: CommerceVideoStoryboard;
  generation?: CommerceVideoGeneration;
  export?: CommerceVideoExport;
  createdAt: number;
  updatedAt: number;
}

export interface CommerceVideoWorkflowResponse {
  workflow: CommerceVideoWorkflow;
}

export interface UpsertCommerceVideoMaterialsRequest {
  productAssetIds?: string[];
  commerceVideoAssetIds?: string[];
  uploadedFiles?: CommerceVideoFileRef[];
  notes?: string;
}

export interface UpsertCommerceVideoScriptRequest extends CommerceVideoScript {}

export interface UpsertCommerceVideoStoryboardRequest {
  shots: Array<Partial<CommerceVideoStoryboardShot> & { visualGoal: string; prompt: string }>;
}

export interface GenerateCommerceVideoRequest {
  model: string;
  prompt?: string;
  output?: string;
  aspect?: string;
  lengthSec?: number;
}

export interface GenerateCommerceVideoResponse extends CommerceVideoWorkflowResponse {
  taskId: string;
  status: CommerceVideoStageStatus;
}

export interface CommerceVideoJobWaitRequest {
  since?: number;
  timeoutMs?: number;
}

export interface CommerceVideoJobWaitResponse {
  taskId: string;
  status: string;
  progress: string[];
  nextSince: number;
  startedAt?: number;
  endedAt?: number | null;
  file?: unknown;
  error?: unknown;
}

export interface CommerceVideoJobsResponse {
  jobs: Array<{
    taskId: string;
    status: string;
    surface?: string;
    model?: string;
    progress: string[];
    file?: unknown;
    error?: unknown;
    startedAt?: number;
    endedAt?: number | null;
  }>;
}

export interface CommerceVideoPreviewResponse {
  workflow: CommerceVideoWorkflow;
  preview?: CommerceVideoFileRef;
  export?: CommerceVideoExport;
}

export interface ExportCommerceVideoResponse extends CommerceVideoPreviewResponse {}
