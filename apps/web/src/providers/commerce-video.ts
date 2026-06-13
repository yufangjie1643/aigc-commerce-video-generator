import type {
  CommerceVideoJobsResponse,
  CommerceVideoJobWaitRequest,
  CommerceVideoJobWaitResponse,
  CommerceVideoMaterialsResponse,
  CommerceVideoPreviewResponse,
  CommerceVideoWorkflowResponse,
  ExportCommerceVideoResponse,
  GenerateCommerceVideoRequest,
  GenerateCommerceVideoResponse,
  UpsertCommerceVideoMaterialsRequest,
  UpsertCommerceVideoScriptRequest,
  UpsertCommerceVideoStoryboardRequest,
  UpsertCommerceVideoWorkbenchRequest
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

export function fetchCommerceVideoWorkflow(projectId: string): Promise<CommerceVideoWorkflowResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/workflow`);
}

export function saveCommerceVideoMaterials(
  projectId: string,
  input: UpsertCommerceVideoMaterialsRequest
): Promise<CommerceVideoMaterialsResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`, {
    method: "POST",
    body: input
  });
}

export function saveCommerceVideoScript(
  projectId: string,
  input: UpsertCommerceVideoScriptRequest
): Promise<CommerceVideoWorkflowResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/script`, {
    method: "POST",
    body: input
  });
}

export function saveCommerceVideoStoryboard(
  projectId: string,
  input: UpsertCommerceVideoStoryboardRequest
): Promise<CommerceVideoWorkflowResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/storyboard`, {
    method: "POST",
    body: input
  });
}

export function saveCommerceVideoWorkbench(
  projectId: string,
  input: UpsertCommerceVideoWorkbenchRequest
): Promise<CommerceVideoWorkflowResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/workbench`, {
    method: "POST",
    body: input
  });
}

export function generateCommerceVideo(
  projectId: string,
  input: GenerateCommerceVideoRequest
): Promise<GenerateCommerceVideoResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/generate`, {
    method: "POST",
    body: input
  });
}

export function listCommerceVideoJobs(projectId: string): Promise<CommerceVideoJobsResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/jobs`);
}

export function waitCommerceVideoJob(
  taskId: string,
  input: CommerceVideoJobWaitRequest = {}
): Promise<CommerceVideoJobWaitResponse> {
  return jsonRequest(`/api/commerce-video/jobs/${encodeURIComponent(taskId)}/wait`, {
    method: "POST",
    body: input
  });
}

export function fetchCommerceVideoPreview(projectId: string): Promise<CommerceVideoPreviewResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/preview`);
}

export function exportCommerceVideo(projectId: string): Promise<ExportCommerceVideoResponse> {
  return jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/commerce-video/export`, {
    method: "POST"
  });
}
