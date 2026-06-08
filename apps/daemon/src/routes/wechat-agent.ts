import type { Express, RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import type {
  AgentInfo,
  WeChatAgentBridgeAgent,
  WeChatAgentBridgeCancelResponse,
  WeChatAgentBridgeCommandResponse,
  WeChatAgentBridgeSnapshot,
  WeChatAgentBridgeStartResponse,
  WeChatAgentBridgeStatusResponse
} from "@open-design/contracts";

import { readAppConfig } from "../app-config.js";
import { detectAgents } from "../agents.js";
import { createQrSvg } from "../qr-code.js";
import type { PathDeps, RouteDeps } from "../server-context.js";

export interface RegisterWeChatAgentRoutesDeps extends RouteDeps<"http"> {
  paths: Pick<PathDeps, "RUNTIME_DATA_DIR">;
}

const PREFERRED_WECHAT_AGENT_IDS = ["opencode", "amr", "claude", "codex", "gemini", "cursor-agent", "qwen", "deepseek"];
const PAIRING_TOKEN_TTL_MS = 10 * 60 * 1000;

let bridgeSnapshot: WeChatAgentBridgeSnapshot = idleSnapshot();

function idleSnapshot(): WeChatAgentBridgeSnapshot {
  return {
    phase: "idle",
    running: false,
    command: [],
    output: "",
    detectedUrls: []
  };
}

function currentSnapshot(): WeChatAgentBridgeSnapshot {
  return { ...bridgeSnapshot };
}

function setSnapshot(next: WeChatAgentBridgeSnapshot): void {
  bridgeSnapshot = {
    ...next,
    output: trimOutput(next.output),
    detectedUrls: [...new Set(next.detectedUrls)].slice(0, 8)
  };
}

function trimOutput(output: string): string {
  const max = 16_000;
  if (output.length <= max) return output;
  return output.slice(output.length - max);
}

function commandLine(kind: "connect" | "refresh", agentId?: string): string[] {
  return ["od", "wechat", kind, ...(agentId ? ["--agent", agentId] : [])];
}

function summarizeAgent(agent: AgentInfo): WeChatAgentBridgeAgent {
  return {
    id: agent.id,
    name: agent.name,
    available: agent.available,
    ...(agent.authStatus ? { authStatus: agent.authStatus } : {}),
    ...(agent.path ? { path: agent.path } : {}),
    ...(agent.version !== undefined ? { version: agent.version } : {})
  };
}

export function chooseWeChatBridgeAgent(agents: AgentInfo[]): AgentInfo | null {
  const readyAgents = agents.filter((agent) => agent.available && agent.authStatus !== "missing");
  for (const id of PREFERRED_WECHAT_AGENT_IDS) {
    const agent = readyAgents.find((candidate) => candidate.id === id);
    if (agent) return agent;
  }
  return readyAgents[0] ?? null;
}

async function readDetectedAgents(runtimeDataDir: string): Promise<AgentInfo[]> {
  const config = await readAppConfig(runtimeDataDir);
  return detectAgents(config.agentCliEnv ?? {}) as Promise<AgentInfo[]>;
}

function noAgentError(agents: AgentInfo[]): string {
  if (agents.length === 0) {
    return "未检测到内置 Agent。请先在 Open Design 的账号和 API / 代码智能体设置里连接 OpenCode、Claude Code、Codex CLI 等任一 Agent。";
  }
  return "没有可用于微信桥的内置 Agent。请先完成 OpenCode、Claude Code、Codex CLI 等任一 Agent 的安装或登录，然后重试连接。";
}

function bridgeOutput(agent: AgentInfo): string {
  return [
    `微信连接器已绑定内置 Agent：${agent.name}（${agent.id}）。`,
    "后续微信网关收到问题时，应把消息转发给 Open Design daemon，由该 Agent 读取自动化运行状态、Orbit 摘要进度和实时看板新鲜度后回复。",
    "当前桥保持只读状态；需要触发自动化动作时，应先在产品里显式启用写入权限。"
  ].join("\n");
}

function createPairingCode(): { pairingToken: string; qrPayload: string; qrSvg: string; expiresAt: string } {
  const pairingToken = randomBytes(18).toString("base64url");
  const qrPayload = `open-design-wechat:${pairingToken}`;
  return {
    pairingToken,
    qrPayload,
    qrSvg: createQrSvg(qrPayload),
    expiresAt: new Date(Date.now() + PAIRING_TOKEN_TTL_MS).toISOString()
  };
}

async function readBridgeStatus(runtimeDataDir: string): Promise<WeChatAgentBridgeStatusResponse> {
  const checkedAt = new Date().toISOString();
  let agents: AgentInfo[] = [];
  try {
    agents = await readDetectedAgents(runtimeDataDir);
  } catch (error) {
    return {
      agentAvailable: false,
      connected: false,
      agents: [],
      login: currentSnapshot(),
      checkedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const selectedAgent = chooseWeChatBridgeAgent(agents);
  const connected =
    bridgeSnapshot.phase === "connected" && selectedAgent !== null && selectedAgent.id === bridgeSnapshot.agentId;
  const summarizedSelected = selectedAgent ? summarizeAgent(selectedAgent) : undefined;
  return {
    agentAvailable: selectedAgent !== null,
    ...(summarizedSelected ? { selectedAgent: summarizedSelected } : {}),
    connected,
    bridgeStatus: selectedAgent
      ? `内置 Agent 桥已选择 ${selectedAgent.name}（${selectedAgent.id}）`
      : noAgentError(agents),
    agents: agents.map(summarizeAgent),
    login: currentSnapshot(),
    checkedAt,
    ...(selectedAgent ? {} : { error: noAgentError(agents) })
  };
}

async function connectBridge(runtimeDataDir: string): Promise<WeChatAgentBridgeStartResponse> {
  if (bridgeSnapshot.running) {
    return { ok: false, alreadyRunning: true, login: currentSnapshot(), error: "wechat agent bridge already running" };
  }

  const startedAt = new Date().toISOString();
  setSnapshot({
    phase: "selecting_agent",
    running: true,
    commandKind: "connect",
    command: commandLine("connect"),
    startedAt,
    updatedAt: startedAt,
    output: "正在选择 Open Design 内置 Agent...",
    detectedUrls: []
  });

  let agents: AgentInfo[] = [];
  try {
    agents = await readDetectedAgents(runtimeDataDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSnapshot({
      ...bridgeSnapshot,
      phase: "failed",
      running: false,
      completedAt: new Date().toISOString(),
      error: message,
      output: message
    });
    return { ok: false, login: currentSnapshot(), error: message };
  }

  const selectedAgent = chooseWeChatBridgeAgent(agents);
  if (!selectedAgent) {
    const message = noAgentError(agents);
    setSnapshot({
      ...bridgeSnapshot,
      phase: "failed",
      running: false,
      completedAt: new Date().toISOString(),
      error: message,
      output: message
    });
    return { ok: false, login: currentSnapshot(), error: message };
  }

  const pairing = createPairingCode();
  setSnapshot({
    phase: "connected",
    running: false,
    commandKind: "connect",
    command: commandLine("connect", selectedAgent.id),
    agentId: selectedAgent.id,
    agentName: selectedAgent.name,
    agentVersion: selectedAgent.version ?? null,
    startedAt,
    completedAt: new Date().toISOString(),
    pairingToken: pairing.pairingToken,
    qrPayload: pairing.qrPayload,
    qrSvg: pairing.qrSvg,
    expiresAt: pairing.expiresAt,
    output: bridgeOutput(selectedAgent),
    detectedUrls: ["/api/integrations/wechat/agent/status", "/api/routines", "/api/orbit/status"]
  });
  return { ok: true, login: currentSnapshot() };
}

async function refreshBridge(runtimeDataDir: string): Promise<WeChatAgentBridgeCommandResponse> {
  const result = await connectBridge(runtimeDataDir);
  return {
    ok: result.ok,
    command: result.login.command.length > 0 ? result.login.command : commandLine("refresh"),
    stdout: result.login.output,
    stderr: "",
    exitCode: result.ok ? 0 : 1,
    signal: null,
    ...(result.error ? { error: result.error } : {})
  };
}

function cancelBridge(): WeChatAgentBridgeCancelResponse {
  const wasActive = bridgeSnapshot.phase !== "idle";
  setSnapshot({
    ...idleSnapshot(),
    phase: "canceled",
    completedAt: new Date().toISOString()
  });
  return { ok: true, canceled: wasActive, login: currentSnapshot() };
}

export function registerWeChatAgentRoutes(app: Express, ctx: RegisterWeChatAgentRoutesDeps): void {
  const requireLocalDaemonRequest: RequestHandler = ctx.http.requireLocalDaemonRequest;
  const runtimeDataDir = ctx.paths.RUNTIME_DATA_DIR;

  app.get("/api/integrations/wechat/agent/status", async (_req, res) => {
    try {
      res.json(await readBridgeStatus(runtimeDataDir));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/integrations/wechat/agent/connect", requireLocalDaemonRequest, async (_req, res) => {
    const result = await connectBridge(runtimeDataDir);
    res.status(result.ok ? 202 : result.alreadyRunning ? 409 : 500).json(result);
  });

  app.post("/api/integrations/wechat/agent/cancel", requireLocalDaemonRequest, (_req, res) => {
    res.json(cancelBridge());
  });

  app.post("/api/integrations/wechat/agent/refresh", requireLocalDaemonRequest, async (_req, res) => {
    const result = await refreshBridge(runtimeDataDir);
    res.status(result.ok ? 200 : 500).json(result);
  });
}
