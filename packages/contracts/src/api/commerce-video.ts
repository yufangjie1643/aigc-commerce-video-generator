export const COMMERCE_VIDEO_WORKFLOW_FILE = "commerce-video.workflow.json";
export const COMMERCE_VIDEO_MATERIALS_DB_FILE = "commerce-video/materials.sqlite";

export const COMMERCE_VIDEO_STAGE_ORDER = [
  "materials",
  "script",
  "storyboard",
  "generation",
  "progress",
  "export"
] as const;

export const COMMERCE_VIDEO_MODEL_OPTIONS = [
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    provider: "volcengine",
    speed: "balanced"
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast",
    provider: "volcengine",
    speed: "fast"
  },
  {
    id: "doubao-seedance-1.5-pro",
    label: "Seedance 1.5 Pro",
    provider: "volcengine",
    speed: "quality"
  },
  {
    id: "minimax-video-01",
    label: "MiniMax Video 01",
    provider: "minimax",
    speed: "balanced"
  }
] as const;

export type CommerceVideoStageId = (typeof COMMERCE_VIDEO_STAGE_ORDER)[number];
export type CommerceVideoStageStatus = "idle" | "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";
export type CommerceVideoProductMaterialSourceKind = "manual" | "upload" | "crawler";
export type CommerceVideoProductMaterialStatus =
  | "ready"
  | "processing"
  | "needs_model"
  | "needs_embedding_config"
  | "failed";

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

export interface CommerceVideoProductMaterial {
  id: string;
  title: string;
  subject: string;
  category: string;
  sourceKind: CommerceVideoProductMaterialSourceKind;
  status: CommerceVideoProductMaterialStatus;
  files: CommerceVideoFileRef[];
  product: {
    sellingPoints: string[];
    constraints: string[];
    suggestedAngles: string[];
    summary?: string;
    embedding?: Record<string, unknown>;
  };
  analysis?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CommerceVideoProductMaterialInput {
  id?: string;
  title: string;
  subject?: string;
  category?: string;
  sourceKind?: CommerceVideoProductMaterialSourceKind;
  status?: CommerceVideoProductMaterialStatus;
  files?: CommerceVideoFileRef[];
  product?: {
    sellingPoints?: string[];
    constraints?: string[];
    suggestedAngles?: string[];
    summary?: string;
    embedding?: Record<string, unknown>;
  };
  analysis?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CommerceVideoMaterials {
  productMaterialIds: string[];
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
  referenceFiles?: CommerceVideoFileRef[];
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

export type CommerceVideoExportFormat = "mp4" | "webm" | "mov";
export type CommerceVideoExportResolution = "1080x1920" | "720x1280" | "1080x1080";

export interface CommerceVideoWorkbenchExportSettings {
  format?: CommerceVideoExportFormat;
  resolution?: CommerceVideoExportResolution;
  includeSubtitles?: boolean;
  includeVoiceover?: boolean;
  includeBgm?: boolean;
  targetDuration?: number;
}

export interface CommerceVideoWorkbenchState {
  activeStageId?: CommerceVideoStageId;
  pendingNextStageId?: CommerceVideoStageId | null;
  selectedModel?: string;
  exportSettings?: CommerceVideoWorkbenchExportSettings;
  updatedAt?: number;
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
  workbench?: CommerceVideoWorkbenchState;
  createdAt: number;
  updatedAt: number;
}

export interface CommerceVideoWorkflowResponse {
  workflow: CommerceVideoWorkflow;
  productMaterials?: CommerceVideoProductMaterial[];
}

export interface CommerceVideoMaterialsResponse extends CommerceVideoWorkflowResponse {
  productMaterials: CommerceVideoProductMaterial[];
}

export interface UpsertCommerceVideoMaterialsRequest {
  productMaterialIds?: string[];
  productMaterials?: CommerceVideoProductMaterialInput[];
  commerceVideoAssetIds?: string[];
  uploadedFiles?: CommerceVideoFileRef[];
  notes?: string;
}

export interface UpsertCommerceVideoScriptRequest extends CommerceVideoScript {}

export interface UpsertCommerceVideoStoryboardRequest {
  shots: Array<Partial<CommerceVideoStoryboardShot> & { visualGoal: string; prompt: string }>;
}

export interface UpsertCommerceVideoWorkbenchRequest extends CommerceVideoWorkbenchState {}

export interface GenerateCommerceVideoRequest {
  model: string;
  prompt?: string;
  output?: string;
  aspect?: string;
  lengthSec?: number;
  useReferenceImages?: boolean;
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
