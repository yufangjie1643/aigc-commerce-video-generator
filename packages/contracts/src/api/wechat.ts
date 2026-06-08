import type { AgentInfo } from './registry.js';

export type WeChatAgentBridgeCommandKind = 'connect' | 'refresh';

export type WeChatAgentBridgePhase =
  | 'idle'
  | 'selecting_agent'
  | 'connected'
  | 'failed'
  | 'canceled';

export interface WeChatAgentBridgeAgent {
  id: string;
  name: string;
  available: boolean;
  authStatus?: AgentInfo['authStatus'];
  path?: string;
  version?: string | null;
}

export interface WeChatAgentBridgeSnapshot {
  phase: WeChatAgentBridgePhase;
  running: boolean;
  commandKind?: WeChatAgentBridgeCommandKind;
  command: string[];
  agentId?: string;
  agentName?: string;
  agentVersion?: string | null;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  output: string;
  terminalQr?: string;
  qrSvg?: string;
  qrPayload?: string;
  pairingToken?: string;
  expiresAt?: string;
  detectedUrls: string[];
  error?: string;
}

export interface WeChatAgentBridgeStatusResponse {
  agentAvailable: boolean;
  selectedAgent?: WeChatAgentBridgeAgent;
  connected: boolean;
  bridgeStatus?: string;
  agents: WeChatAgentBridgeAgent[];
  login: WeChatAgentBridgeSnapshot;
  checkedAt: string;
  error?: string;
}

export interface WeChatAgentBridgeStartResponse {
  ok: boolean;
  alreadyRunning?: boolean;
  login: WeChatAgentBridgeSnapshot;
  error?: string;
}

export interface WeChatAgentBridgeCancelResponse {
  ok: boolean;
  canceled: boolean;
  login: WeChatAgentBridgeSnapshot;
}

export interface WeChatAgentBridgeCommandResponse {
  ok: boolean;
  command: string[];
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
}
