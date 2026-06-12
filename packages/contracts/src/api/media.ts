export const MEDIA_EXECUTION_MODES = ["enabled", "question", "disabled"] as const;

export type MediaExecutionMode = (typeof MEDIA_EXECUTION_MODES)[number];

export type MediaSurface = "image" | "video" | "audio";

export const MEDIA_PROVIDER_TEST_KINDS = [
  "success",
  "missing_api_key",
  "auth_failed",
  "forbidden",
  "invalid_base_url",
  "rate_limited",
  "unsupported",
  "upstream_unavailable",
  "timeout",
  "network_error",
  "unknown"
] as const;

export type MediaProviderTestKind = (typeof MEDIA_PROVIDER_TEST_KINDS)[number];

export interface MediaProviderTestRequest {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface MediaProviderTestResponse {
  ok: boolean;
  providerId: string;
  kind: MediaProviderTestKind;
  latencyMs: number;
  status?: number;
  detail?: string;
  modelCount?: number;
  model?: string;
}

export type MediaUnderstandingKind = "image" | "audio" | "video";

export interface MediaUnderstandingRequest {
  /**
   * A remote http(s) URL or a data URI such as `data:image/png;base64,...`,
   * `data:audio/mpeg;base64,...`, or `data:video/mp4;base64,...`.
   * Local file paths are intentionally not part of
   * the HTTP contract; CLI wrappers can read a local file and send a data URI.
   */
  mediaUrl?: string;
  kind?: MediaUnderstandingKind;
  imageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  providerId?: string;
  prompt?: string;
  model?: string;
  fps?: number;
  mediaResolution?: "default" | "max";
}

export interface MediaUnderstandingResponse {
  ok: true;
  providerId: string;
  kind: MediaUnderstandingKind;
  model: string;
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface VideoUnderstandingRequest extends Omit<
  MediaUnderstandingRequest,
  "kind" | "mediaUrl" | "imageUrl" | "audioUrl" | "videoUrl"
> {
  videoUrl: string;
  kind?: "video";
  mediaUrl?: string;
}

export interface VideoUnderstandingResponse extends MediaUnderstandingResponse {
  kind: "video";
}

/**
 * Run-scoped policy controlling Open Design-owned media generation only.
 *
 * `allowedSurfaces` and `allowedModels` apply solely to `/api/tools/media/generate`
 * and in-run `od media generate`. External MCP media tools are intentionally
 * unaffected: provider policy for those belongs to the MCP server / orchestrator.
 */
export interface MediaExecutionPolicy {
  mode: MediaExecutionMode;
  allowedSurfaces?: MediaSurface[];
  allowedModels?: string[];
}

export const DEFAULT_MEDIA_EXECUTION_POLICY: MediaExecutionPolicy = {
  mode: "enabled"
};
