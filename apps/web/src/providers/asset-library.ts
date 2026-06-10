import type {
  AssetLibraryConfigResponse,
  AssetLibraryJob,
  AssetLibraryJobResponse,
  AssetLibraryJobWaitResponse,
  AssetLibraryToolConfig,
  AssetLibraryToolTestResponse,
  BatchProcessCommerceVideosRequest,
  BatchProcessCommerceVideosResponse,
  CommerceVideoAsset,
  CommerceVideoAssetResponse,
  CommerceVideoAssetsResponse,
  CommerceVideoMethodologySummaryRequest,
  CommerceVideoMethodologySummaryResponse,
  CreateCommerceVideoAssetRequest,
  CreateProductAssetRequest,
  DeleteCommerceVideoAssetResponse,
  DeleteProductAssetResponse,
  EmbedAssetLibraryAssetRequest,
  EmbeddingProviderConfig,
  EmbeddingProviderTestResponse,
  ImportProductImageResponse,
  ImportProductImagesResponse,
  ImportCommerceVideoCrawlerRequest,
  ImportCommerceVideoSearchRequest,
  ImportQualityVideoSearchRequest,
  ProductAssetResponse,
  ProductAssetsResponse,
  QualityVideoAsset,
  QualityVideoAssetResponse,
  QualityVideoAssetsResponse,
  SearchQualityVideosRequest,
  SearchQualityVideosResponse,
  UpdateCommerceVideoAssetRequest,
  UpdateProductAssetRequest
} from "@open-design/contracts";

async function jsonRequest<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.body)
        })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      typeof data?.error === "string" ? data.error : (data?.error?.message ?? `Request failed with ${response.status}`);
    throw new Error(message);
  }
  return data as T;
}

export function fetchAssetLibraryConfig(): Promise<AssetLibraryConfigResponse> {
  return jsonRequest("/api/asset-library/config");
}

export function saveAssetLibraryToolConfig(
  tools: Partial<AssetLibraryToolConfig>
): Promise<{ tools: AssetLibraryToolConfig }> {
  return jsonRequest("/api/asset-library/tool-config", { method: "PUT", body: { tools } });
}

export function testAssetLibraryToolConfig(
  tools: Partial<AssetLibraryToolConfig>
): Promise<AssetLibraryToolTestResponse & { tools: AssetLibraryToolConfig }> {
  return jsonRequest("/api/asset-library/tool-config/test", { method: "POST", body: { tools } });
}

export function saveEmbeddingConfig(
  embedding: Partial<EmbeddingProviderConfig>
): Promise<{ embedding: EmbeddingProviderConfig }> {
  return jsonRequest("/api/asset-library/embedding-config", { method: "PUT", body: { embedding } });
}

export function testEmbeddingConfig(
  embedding: Partial<EmbeddingProviderConfig>
): Promise<EmbeddingProviderTestResponse> {
  return jsonRequest("/api/asset-library/embedding-config/test", { method: "POST", body: { embedding } });
}

export function listProductAssets(query?: string): Promise<ProductAssetsResponse> {
  const params = new URLSearchParams();
  if (query?.trim()) params.set("query", query.trim());
  return jsonRequest(`/api/asset-library/products${params.size ? `?${params}` : ""}`);
}

export function createProductAsset(input: CreateProductAssetRequest): Promise<ProductAssetResponse> {
  return jsonRequest("/api/asset-library/products", { method: "POST", body: input });
}

export async function uploadProductAssetImage(
  file: File,
  input: Partial<CreateProductAssetRequest> = {}
): Promise<ImportProductImageResponse> {
  const form = new FormData();
  form.append("file", file);
  if (input.title?.trim()) form.append("title", input.title.trim());
  if (input.subject?.trim()) form.append("subject", input.subject.trim());
  if (input.category?.trim()) form.append("category", input.category.trim());
  if (input.sellingPoints?.length) form.append("sellingPoints", input.sellingPoints.join("\n"));
  if (input.constraints?.length) form.append("constraints", input.constraints.join("\n"));
  if (input.suggestedAngles?.length) form.append("suggestedAngles", input.suggestedAngles.join("\n"));
  if (input.summary?.trim()) form.append("summary", input.summary.trim());
  if (input.metadata) form.append("metadataJson", JSON.stringify(input.metadata));
  const response = await fetch("/api/asset-library/products/import/upload", {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : (data?.error?.message ?? "Upload failed"));
  }
  return data;
}

export async function uploadProductAssetImages(files: File[]): Promise<ImportProductImagesResponse> {
  const form = new FormData();
  const relativePaths = files.map(productUploadRelativePath);
  files.forEach((file, index) => {
    form.append("files", file, relativePaths[index] || file.name);
  });
  form.append("relativePaths", JSON.stringify(relativePaths));
  const response = await fetch("/api/asset-library/products/import/uploads", {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : (data?.error?.message ?? "Upload failed"));
  }
  return data;
}

export function updateProductAsset(id: string, input: UpdateProductAssetRequest): Promise<ProductAssetResponse> {
  return jsonRequest(`/api/asset-library/products/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function deleteProductAsset(id: string): Promise<DeleteProductAssetResponse> {
  return jsonRequest(`/api/asset-library/products/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function processProductAsset(id: string): Promise<AssetLibraryJobResponse> {
  return jsonRequest(`/api/asset-library/products/${encodeURIComponent(id)}/process`, { method: "POST" });
}

export function embedProductAsset(
  id: string,
  input: EmbedAssetLibraryAssetRequest = {}
): Promise<AssetLibraryJobResponse> {
  return jsonRequest(`/api/asset-library/products/${encodeURIComponent(id)}/embed`, { method: "POST", body: input });
}

export function listCommerceVideoAssets(query?: string): Promise<CommerceVideoAssetsResponse> {
  const params = new URLSearchParams();
  if (query?.trim()) params.set("query", query.trim());
  return jsonRequest(`/api/asset-library/commerce-videos${params.size ? `?${params}` : ""}`);
}

export function getCommerceVideoAsset(id: string): Promise<CommerceVideoAssetResponse> {
  return jsonRequest(`/api/asset-library/commerce-videos/${encodeURIComponent(id)}`);
}

export function createCommerceVideoAsset(
  input: CreateCommerceVideoAssetRequest
): Promise<{ video: CommerceVideoAsset }> {
  return jsonRequest("/api/asset-library/commerce-videos", { method: "POST", body: input });
}

export function updateCommerceVideoAsset(
  id: string,
  input: UpdateCommerceVideoAssetRequest
): Promise<CommerceVideoAssetResponse> {
  return jsonRequest(`/api/asset-library/commerce-videos/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function deleteCommerceVideoAsset(id: string): Promise<DeleteCommerceVideoAssetResponse> {
  return jsonRequest(`/api/asset-library/commerce-videos/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadCommerceVideoAsset(
  file: File,
  title?: string
): Promise<{ video: CommerceVideoAsset; job: AssetLibraryJob }> {
  const form = new FormData();
  form.append("file", file);
  if (title?.trim()) form.append("title", title.trim());
  const response = await fetch("/api/asset-library/commerce-videos/import/upload", {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : (data?.error?.message ?? "Upload failed"));
  }
  return data;
}

export function importCrawlerCommerceVideo(
  input: ImportCommerceVideoCrawlerRequest
): Promise<{ video: CommerceVideoAsset; job: AssetLibraryJob; importJob?: AssetLibraryJob }> {
  return jsonRequest("/api/asset-library/commerce-videos/import/crawler", {
    method: "POST",
    body: input
  });
}

export function importCrawlerCommerceVideoSearch(input: ImportCommerceVideoSearchRequest): Promise<{
  videos: CommerceVideoAsset[];
  job: AssetLibraryJob;
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
}> {
  return jsonRequest("/api/asset-library/commerce-videos/import/search", {
    method: "POST",
    body: input
  });
}

export function processCommerceVideoAsset(id: string): Promise<AssetLibraryJobResponse> {
  return jsonRequest(`/api/asset-library/commerce-videos/${encodeURIComponent(id)}/process`, { method: "POST" });
}

export function sliceCommerceVideoAsset(id: string): Promise<AssetLibraryJobResponse> {
  return jsonRequest(`/api/asset-library/commerce-videos/${encodeURIComponent(id)}/slice`, { method: "POST" });
}

export function batchProcessCommerceVideoAssets(
  input: BatchProcessCommerceVideosRequest
): Promise<BatchProcessCommerceVideosResponse> {
  return jsonRequest("/api/asset-library/commerce-videos/batch-process", { method: "POST", body: input });
}

export function embedCommerceVideoAsset(
  id: string,
  input: EmbedAssetLibraryAssetRequest = {}
): Promise<AssetLibraryJobResponse> {
  return jsonRequest(`/api/asset-library/commerce-videos/${encodeURIComponent(id)}/embed`, {
    method: "POST",
    body: input
  });
}

export function buildCommerceVideoMethodologySummary(
  input: CommerceVideoMethodologySummaryRequest
): Promise<CommerceVideoMethodologySummaryResponse> {
  return jsonRequest("/api/asset-library/commerce-videos/methodology-summary", { method: "POST", body: input });
}

export function listQualityVideoAssets(query?: string): Promise<QualityVideoAssetsResponse> {
  const params = new URLSearchParams();
  if (query?.trim()) params.set("query", query.trim());
  return jsonRequest(`/api/asset-library/quality-videos${params.size ? `?${params}` : ""}`);
}

export function getQualityVideoAsset(id: string): Promise<QualityVideoAssetResponse> {
  return jsonRequest(`/api/asset-library/quality-videos/${encodeURIComponent(id)}`);
}

export function createQualityVideoAsset(input: {
  title: string;
  sourceName: string;
  sourceUrl?: string;
  sourceVideoId?: string;
  category?: string;
  keyword?: string;
  video?: Record<string, unknown>;
  methodology?: Record<string, unknown>;
  report?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<QualityVideoAssetResponse> {
  return jsonRequest("/api/asset-library/quality-videos", { method: "POST", body: input });
}

export function searchQualityVideos(input: SearchQualityVideosRequest): Promise<SearchQualityVideosResponse> {
  return jsonRequest("/api/asset-library/quality-videos/search", { method: "POST", body: input });
}

export function importQualityVideoSearch(input: ImportQualityVideoSearchRequest): Promise<{
  videos: QualityVideoAsset[];
  job: AssetLibraryJob;
  search: SearchQualityVideosResponse["search"];
  items: SearchQualityVideosResponse["items"];
}> {
  return jsonRequest("/api/asset-library/quality-videos/import/search", { method: "POST", body: input });
}

export async function uploadQualityVideoAsset(
  file: File,
  input: { title?: string; sourceName?: string; category?: string; keyword?: string } = {}
): Promise<{ video: QualityVideoAsset; job: AssetLibraryJob }> {
  const form = new FormData();
  form.append("file", file);
  if (input.title?.trim()) form.append("title", input.title.trim());
  if (input.sourceName?.trim()) form.append("sourceName", input.sourceName.trim());
  if (input.category?.trim()) form.append("category", input.category.trim());
  if (input.keyword?.trim()) form.append("keyword", input.keyword.trim());
  const response = await fetch("/api/asset-library/quality-videos/import/upload", {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : (data?.error?.message ?? "Upload failed"));
  }
  return data;
}

export function updateQualityVideoAsset(
  id: string,
  input: UpdateCommerceVideoAssetRequest
): Promise<QualityVideoAssetResponse> {
  return jsonRequest(`/api/asset-library/quality-videos/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function deleteQualityVideoAsset(id: string): Promise<DeleteCommerceVideoAssetResponse> {
  return jsonRequest(`/api/asset-library/quality-videos/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function processQualityVideoAsset(id: string): Promise<AssetLibraryJobResponse> {
  return jsonRequest(`/api/asset-library/quality-videos/${encodeURIComponent(id)}/process`, { method: "POST" });
}

export function embedQualityVideoAsset(
  id: string,
  input: EmbedAssetLibraryAssetRequest = {}
): Promise<AssetLibraryJobResponse> {
  return jsonRequest(`/api/asset-library/quality-videos/${encodeURIComponent(id)}/embed`, {
    method: "POST",
    body: input
  });
}

export function buildQualityVideoMethodologySummary(
  input: CommerceVideoMethodologySummaryRequest
): Promise<CommerceVideoMethodologySummaryResponse> {
  return jsonRequest("/api/asset-library/quality-videos/methodology-summary", { method: "POST", body: input });
}

export async function waitAssetLibraryJob(
  job: AssetLibraryJob,
  timeoutMs = 120_000,
  onUpdate?: (job: AssetLibraryJob, progress: string[]) => void
): Promise<AssetLibraryJob> {
  let latest = job;
  let since = Array.isArray(job.progress) ? job.progress.length : 0;
  const startedAt = Date.now();
  while (!["done", "failed", "interrupted"].includes(latest.status) && Date.now() - startedAt < timeoutMs) {
    const data = await jsonRequest<AssetLibraryJobWaitResponse>(
      `/api/asset-library/jobs/${encodeURIComponent(latest.id)}/wait`,
      {
        method: "POST",
        body: { since, timeoutMs: Math.min(25_000, Math.max(1_000, timeoutMs - (Date.now() - startedAt))) }
      }
    );
    latest = data.job ?? latest;
    const progress = Array.isArray(data.progress) ? data.progress : [];
    if (progress.length > 0) onUpdate?.(latest, progress);
    since = Array.isArray(latest.progress) ? latest.progress.length : since;
  }
  return latest;
}

function productUploadRelativePath(file: File): string {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");
}
