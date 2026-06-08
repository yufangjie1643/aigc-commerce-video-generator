export const MEDIA_EXECUTION_MODES = [
  'enabled',
  'question',
  'disabled',
] as const;

export type MediaExecutionMode = (typeof MEDIA_EXECUTION_MODES)[number];

export type MediaSurface = 'image' | 'video' | 'audio';

export const MEDIA_PROVIDER_TEST_KINDS = [
  'success',
  'missing_api_key',
  'auth_failed',
  'forbidden',
  'invalid_base_url',
  'rate_limited',
  'unsupported',
  'upstream_unavailable',
  'timeout',
  'network_error',
  'unknown',
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
  mode: 'enabled',
};
