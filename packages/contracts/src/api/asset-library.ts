export type AssetLibrarySection = "products" | "commerce-videos" | "quality-videos";

export type AssetLibrarySourceKind = "manual" | "upload" | "crawler";

export type AssetLibraryStatus =
  | "ready"
  | "processing"
  | "needs_model"
  | "needs_video_file"
  | "needs_embedding_config"
  | "failed";

export type AssetLibraryJobStatus = "queued" | "running" | "done" | "failed" | "interrupted";

export type AssetLibraryJobKind =
  | "ingest"
  | "product-image-folder-ingest"
  | "process"
  | "slice"
  | "understand"
  | "embed"
  | "crawler-import"
  | "batch-process"
  | "methodology-summary";

export interface AssetLibraryFileRef {
  path: string;
  name?: string;
  mime?: string;
  size?: number;
}

export interface ProductAsset {
  id: string;
  title: string;
  subject: string;
  category: string;
  sourceKind: AssetLibrarySourceKind;
  status: AssetLibraryStatus;
  files: AssetLibraryFileRef[];
  product: {
    sellingPoints: string[];
    constraints: string[];
    suggestedAngles: string[];
    summary?: string;
    embedding?: AssetLibraryEmbeddingSummary;
  };
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CommerceVideoAsset {
  id: string;
  title: string;
  sourceKind: AssetLibrarySourceKind;
  sourceConnectorId?: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  file?: AssetLibraryFileRef;
  sha256?: string;
  status: AssetLibraryStatus;
  product: {
    subject?: string;
    category?: string;
  };
  video: {
    durationMs?: number;
    summary?: string;
    understanding?: AssetLibraryMediaUnderstandingSummary;
    embedding?: AssetLibraryEmbeddingSummary;
  };
  methodology: {
    hooks: string[];
    structure: string[];
    sellingTriggers: string[];
    styleTags: string[];
  };
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface QualityVideoSourceDeclaration {
  sourceName: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  public: boolean;
  declaredAt: number;
  declaredBy?: "user" | "crawler" | "upload" | "agent";
}

export interface QualityVideoStructuredReport {
  hookMethods: string[];
  sellingPoints: string[];
  storyboard: string[];
  styleTags: string[];
  notes?: string;
}

export interface QualityVideoAsset extends CommerceVideoAsset {
  metadata?: Record<string, unknown> & {
    libraryKind?: "quality-videos";
    sourceDeclaration?: QualityVideoSourceDeclaration;
    qualityReport?: QualityVideoStructuredReport;
    dataLimitations?: string[];
    compliance?: {
      publicVideoOriginalStored: boolean;
      originalVideoRemixed: boolean;
      sourceDeclared: boolean;
    };
  };
}

export interface CommerceVideoSlice {
  id: string;
  assetId: string;
  startMs: number;
  endMs: number;
  file?: AssetLibraryFileRef;
  thumbnail?: AssetLibraryFileRef;
  features: {
    scene?: string;
    visualActions: string[];
    spokenText: string[];
    onScreenText: string[];
    productMentions: string[];
    hook?: string;
    transition?: string;
    pace?: string;
    sellingPoint?: string;
    tags: string[];
  };
  embedding?: AssetLibraryEmbeddingSummary;
  createdAt: number;
  updatedAt: number;
}

export interface AssetLibraryEmbeddingSummary {
  providerId: string;
  model: string;
  dimensions?: number;
  vector?: number[];
  createdAt: number;
}

export interface AssetLibraryMediaUnderstandingSummary {
  providerId: string;
  model: string;
  content?: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  createdAt: number;
}

export interface AssetLibraryJob {
  id: string;
  assetKind: AssetLibrarySection;
  assetId: string;
  kind: AssetLibraryJobKind;
  status: AssetLibraryJobStatus;
  progress: string[];
  error?: {
    code?: string;
    message: string;
    status?: number;
  };
  startedAt?: number;
  endedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface EmbeddingProviderConfig {
  providerId: "volcengine-ark" | "custom";
  label?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  apiKeyTail?: string;
  baseUrl: string;
  endpointPath: string;
  model: string;
  headers?: Record<string, string>;
  inputMapping?: {
    textType: string;
    imageUrlType: string;
    imageUrlField: string;
  };
}

export interface AssetLibraryToolConfig {
  ffmpegPath: string;
  ffprobePath: string;
  autoDetectEnabled: boolean;
  lastVerifiedAt?: number;
  lastVerificationError?: string;
}

export interface AssetLibraryConfigResponse {
  embedding: EmbeddingProviderConfig;
  tools: AssetLibraryToolConfig;
}

export interface AssetLibraryToolTestResponse {
  ok: boolean;
  ffmpeg?: {
    path: string;
    ok: boolean;
    version?: string;
    error?: string;
  };
  ffprobe?: {
    path: string;
    ok: boolean;
    version?: string;
    error?: string;
  };
}

export interface EmbeddingProviderTestResponse {
  ok: boolean;
  providerId: string;
  model: string;
  latencyMs: number;
  status?: number;
  dimensions?: number;
  detail?: string;
  kind:
    | "success"
    | "missing_api_key"
    | "invalid_base_url"
    | "auth_failed"
    | "forbidden"
    | "rate_limited"
    | "upstream_unavailable"
    | "network_error"
    | "bad_response"
    | "unknown";
}

export interface ProductAssetsResponse {
  products: ProductAsset[];
}

export interface ProductAssetResponse {
  product: ProductAsset;
}

export interface DeleteProductAssetResponse {
  product: ProductAsset;
  removedFiles: boolean;
  warning?: string;
}

export interface ImportProductImageResponse {
  product: ProductAsset;
  job: AssetLibraryJob;
}

export interface ImportProductImagesResponse {
  job: AssetLibraryJob;
  count: number;
}

export interface ProductImageFolderIngestRequest {
  path: string;
  recursive?: boolean;
  dryRun?: boolean;
  mode?: "serial" | "parallel";
  concurrency?: number;
  limit?: number;
  providerId?: string;
  model?: string;
  prompt?: string;
  processImported?: boolean;
}

export interface ProductImageFolderIngestSkippedFile {
  path: string;
  relativePath: string;
  reason: "video" | "unsupported" | "directory" | "read_error";
  mime?: string;
  error?: string;
}

export interface ProductImageFolderIngestImageResult {
  path: string;
  relativePath: string;
  fileName: string;
  productId?: string;
  processJobId?: string;
  title?: string;
  subject?: string;
  category?: string;
  clusterId?: string;
  vision?: Record<string, unknown>;
  visionText?: string;
  error?: string;
}

export interface ProductImageFolderIngestCluster {
  id: string;
  category: string;
  subject: string;
  images: ProductImageFolderIngestImageResult[];
}

export interface ProductImageFolderIngestResponse {
  ok: boolean;
  dryRun: boolean;
  rootPath: string;
  recursive: boolean;
  mode: "serial" | "parallel";
  concurrency: number;
  scanned: {
    imageCount: number;
    skippedCount: number;
  };
  clusters: ProductImageFolderIngestCluster[];
  imported: ProductImageFolderIngestImageResult[];
  failed: ProductImageFolderIngestImageResult[];
  skipped: ProductImageFolderIngestSkippedFile[];
}

export interface CommerceVideoAssetsResponse {
  videos: CommerceVideoAsset[];
}

export interface CommerceVideoAssetResponse {
  video: CommerceVideoAsset;
  slices: CommerceVideoSlice[];
}

export interface QualityVideoAssetsResponse {
  videos: QualityVideoAsset[];
}

export interface QualityVideoAssetResponse {
  video: QualityVideoAsset;
  slices: CommerceVideoSlice[];
}

export type AssetLibrarySearchKind = AssetLibrarySection | "all";

export type AssetLibrarySearchGranularity = "asset" | "slice" | "all";

export interface AssetLibrarySearchRequest {
  query?: string;
  tags?: string[];
  kind?: AssetLibrarySearchKind | AssetLibrarySearchKind[];
  granularity?: AssetLibrarySearchGranularity;
  limit?: number;
  includeVectors?: boolean;
}

export interface AssetLibrarySearchMatch {
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
  score: number;
  lexicalScore: number;
  tagScore: number;
  vectorScore?: number;
  vectorDimensions?: number;
  product?: ProductAsset;
  video?: CommerceVideoAsset | QualityVideoAsset;
  slice?: CommerceVideoSlice;
}

export interface AssetLibrarySearchResponse {
  query: string;
  tags: string[];
  kinds: AssetLibrarySection[];
  granularity: AssetLibrarySearchGranularity;
  limit: number;
  vectorizedQuery: boolean;
  results: AssetLibrarySearchMatch[];
}

export interface DeleteCommerceVideoAssetResponse {
  video: CommerceVideoAsset;
  removedFiles: boolean;
  warning?: string;
}

export interface AssetLibraryJobResponse {
  job: AssetLibraryJob;
}

export interface AssetLibraryJobWaitResponse {
  job: AssetLibraryJob;
  progress: string[];
}

export interface CreateProductAssetRequest {
  title: string;
  subject?: string;
  category?: string;
  sellingPoints?: string[];
  constraints?: string[];
  suggestedAngles?: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProductAssetRequest {
  title?: string;
  subject?: string;
  category?: string;
  sellingPoints?: string[];
  constraints?: string[];
  suggestedAngles?: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportCommerceVideoCrawlerRequest {
  connectorId: "youtube" | "tiktok" | "douyin" | "bilibili";
  toolName?: string;
  input?: Record<string, unknown>;
  url?: string;
  videoId?: string;
  title?: string;
  publicTest?: boolean;
}

export interface ImportCommerceVideoSearchRequest {
  connectorId: "bilibili" | "youtube" | "tiktok" | "douyin";
  toolName?: string;
  query: string;
  limit?: number;
  sort?: "hot" | "relevance" | "newest" | "comments" | "favorites" | string;
  input?: Record<string, unknown>;
}

export interface SearchCommerceVideosRequest {
  connectorId: "bilibili" | "youtube" | "tiktok" | "douyin";
  toolName?: string;
  query: string;
  limit?: number;
  sort?: "hot" | "relevance" | "newest" | "comments" | "favorites" | string;
  input?: Record<string, unknown>;
}

export interface SearchCommerceVideosResponse {
  items: Array<Record<string, unknown>>;
  search: {
    connectorId: string;
    toolName: string;
    provider: string;
    query: string;
    limit: number;
    sort: string;
    count: number;
    totalAvailable?: number | null;
    nextCursor?: string | null;
    limitations: string[];
  };
}

export interface SearchQualityVideosRequest {
  connectorId?: "bilibili" | "youtube" | "tiktok" | "douyin" | "facebook" | "instagram" | string;
  sourceName?: string;
  toolName?: string;
  query: string;
  category?: string;
  keyword?: string;
  limit?: number;
  sort?: "hot" | "relevance" | "newest" | "comments" | "favorites" | string;
  input?: Record<string, unknown>;
}

export interface ImportQualityVideoSearchRequest extends SearchQualityVideosRequest {}

export interface SearchQualityVideosResponse extends SearchCommerceVideosResponse {
  search: SearchCommerceVideosResponse["search"] & {
    sourceName: string;
    category?: string;
    keyword?: string;
  };
}

export interface ImportQualityVideoSearchResponse extends SearchQualityVideosResponse {
  videos: QualityVideoAsset[];
  job: AssetLibraryJob;
}

export interface CreateCommerceVideoAssetRequest {
  title: string;
  sourceKind?: AssetLibrarySourceKind;
  sourceConnectorId?: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  product?: Record<string, unknown>;
  video?: Record<string, unknown>;
  methodology?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateQualityVideoAssetRequest {
  title: string;
  sourceName: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  category?: string;
  keyword?: string;
  product?: Record<string, unknown>;
  video?: Record<string, unknown>;
  methodology?: Record<string, unknown>;
  report?: Partial<QualityVideoStructuredReport>;
  metadata?: Record<string, unknown>;
}

export interface UpdateCommerceVideoAssetRequest {
  title?: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  product?: {
    subject?: string;
    category?: string;
  };
  video?: {
    durationMs?: number;
    summary?: string;
  };
  methodology?: {
    hooks?: string[];
    structure?: string[];
    sellingTriggers?: string[];
    styleTags?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface EmbedAssetLibraryAssetRequest {
  text?: string;
  includeSlices?: boolean;
}

export interface BatchProcessCommerceVideosRequest {
  ids?: string[];
  query?: string;
  limit?: number;
  onlyUnprocessed?: boolean;
  includeEmbeddings?: boolean;
}

export interface BatchProcessCommerceVideosResponse {
  job: AssetLibraryJob;
  count: number;
  ids: string[];
}

export interface CommerceVideoMethodologySource {
  video: CommerceVideoAsset;
  slices: CommerceVideoSlice[];
}

export interface CommerceVideoMethodologySummaryRequest {
  ids?: string[];
  query?: string;
  limit?: number;
  includeSlices?: boolean;
}

export interface CommerceVideoMethodologySummaryResponse {
  sources: CommerceVideoMethodologySource[];
  stats: {
    videoCount: number;
    sliceCount: number;
    embeddedVideoCount: number;
    embeddedSliceCount: number;
  };
  prompt: string;
}

export interface ProjectAssetLibraryContextRef {
  productAssetId?: string;
  commerceVideoAssetId?: string;
  sliceId?: string;
  purpose?: string;
  note?: string;
}

export interface ProjectAssetLibraryContextRequest {
  refs: ProjectAssetLibraryContextRef[];
}

export interface ProjectAssetLibraryContextResponse {
  refs: ProjectAssetLibraryContextRef[];
}
