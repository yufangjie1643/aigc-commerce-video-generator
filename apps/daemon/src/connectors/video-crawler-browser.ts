import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { WebSocket } from 'undici';

import { ConnectorServiceError, type ConnectorCredentialMaterial } from './service.js';
import { getVideoCrawlerPlatformConfig, VIDEO_CRAWLER_CREDENTIAL_PROVIDER } from './video-crawler.js';

const CONTROLLED_BROWSER_TTL_MS = 15 * 60 * 1000;
const CONTROLLED_BROWSER_CONNECT_TIMEOUT_MS = 12_000;
const CDP_REQUEST_TIMEOUT_MS = 10_000;

let videoCrawlerBrowserDataDir = path.join(process.cwd(), '.od', 'connectors', 'browser-sessions');

interface VideoCrawlerBrowserSession {
  connectorId: string;
  sessionId: string;
  port: number;
  userDataDir: string;
  process?: ChildProcess;
  expiresAtMs: number;
}

interface CdpCookie {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
}

const sessions = new Map<string, VideoCrawlerBrowserSession>();

export function configureVideoCrawlerBrowserDataDir(dataDir: string): void {
  videoCrawlerBrowserDataDir = path.join(dataDir, 'connectors', 'browser-sessions');
}

export async function startVideoCrawlerControlledBrowserLogin(connectorId: string): Promise<{
  kind: 'pending';
  providerConnectionId: string;
  expiresAt: string;
}> {
  const platform = getVideoCrawlerPlatformConfig(connectorId);
  if (!platform) {
    throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'video crawler connector not found', 404, { connectorId });
  }

  cancelVideoCrawlerControlledBrowserLogin(connectorId);
  const expiresAtMs = Date.now() + CONTROLLED_BROWSER_TTL_MS;
  const sessionId = `browser_${connectorId}_${Date.now().toString(36)}`;

  if (process.env.OD_VIDEO_CRAWLER_BROWSER_MOCK === '1') {
    sessions.set(connectorId, {
      connectorId,
      sessionId,
      port: 0,
      userDataDir: '',
      expiresAtMs,
    });
    return {
      kind: 'pending',
      providerConnectionId: sessionId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  const browserPath = findControlledBrowserExecutable();
  if (!browserPath) {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      'No controllable Chrome or Edge browser was found. Install Chrome/Edge or set OD_CONTROLLED_BROWSER_PATH.',
      501,
      { connectorId },
    );
  }

  const port = await allocateLoopbackPort();
  const userDataDir = path.join(videoCrawlerBrowserDataDir, sanitizeConnectorId(connectorId));
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  const child = spawn(
    browserPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      platform.loginUrl,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  );
  child.unref();

  const session: VideoCrawlerBrowserSession = {
    connectorId,
    sessionId,
    port,
    userDataDir,
    process: child,
    expiresAtMs,
  };
  sessions.set(connectorId, session);
  child.once('exit', () => {
    if (sessions.get(connectorId)?.sessionId === sessionId) sessions.delete(connectorId);
  });

  await waitForDevtools(port);
  return {
    kind: 'pending',
    providerConnectionId: sessionId,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function cancelVideoCrawlerControlledBrowserLogin(connectorId: string): void {
  const session = sessions.get(connectorId);
  sessions.delete(connectorId);
  try {
    session?.process?.kill();
  } catch {
    /* Browser may already be closed by the user. */
  }
}

export async function captureVideoCrawlerControlledBrowserCookies(
  connectorId: string,
): Promise<ConnectorCredentialMaterial> {
  const platform = getVideoCrawlerPlatformConfig(connectorId);
  if (!platform) {
    throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'video crawler connector not found', 404, { connectorId });
  }
  const session = sessions.get(connectorId);
  if (!session || session.expiresAtMs <= Date.now()) {
    sessions.delete(connectorId);
    throw new ConnectorServiceError(
      'CONNECTOR_NOT_CONNECTED',
      `${platform.name} browser login session is missing or expired. Start login again.`,
      403,
      { connectorId },
    );
  }

  if (process.env.OD_VIDEO_CRAWLER_BROWSER_MOCK === '1') {
    cancelVideoCrawlerControlledBrowserLogin(connectorId);
    return {
      provider: VIDEO_CRAWLER_CREDENTIAL_PROVIDER,
      platform: connectorId,
      cookie: `${connectorId}_session=mock;`,
      accountLabel: `${platform.name} browser session`,
    };
  }

  const cookies = await readCookiesFromDevtools(session.port, platform.cookieDomains);
  if (cookies.length === 0) {
    throw new ConnectorServiceError(
      'CONNECTOR_NOT_CONNECTED',
      `No ${platform.name} cookies were captured. Finish login in the controlled browser, then try again.`,
      403,
      { connectorId },
    );
  }
  const cookie = cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
  cancelVideoCrawlerControlledBrowserLogin(connectorId);
  return {
    provider: VIDEO_CRAWLER_CREDENTIAL_PROVIDER,
    platform: connectorId,
    cookie,
    accountLabel: `${platform.name} browser session`,
  };
}

async function readCookiesFromDevtools(
  port: number,
  cookieDomains: readonly string[],
): Promise<
  Array<{
    name: string;
    value: string;
    domain: string;
  }>
> {
  const targets = await fetchJson<Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>>(
    `http://127.0.0.1:${port}/json/list`,
  );
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Controlled browser page is not available', 502);
  }
  const payload = await cdpCall<{ cookies?: CdpCookie[] }>(page.webSocketDebuggerUrl, 'Network.getAllCookies');
  const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
  return cookies
    .map((cookie) => ({
      name: typeof cookie.name === 'string' ? cookie.name : '',
      value: typeof cookie.value === 'string' ? cookie.value : '',
      domain: typeof cookie.domain === 'string' ? cookie.domain : '',
    }))
    .filter((cookie) => cookie.name && domainMatchesAny(cookie.domain, cookieDomains));
}

async function cdpCall<T>(webSocketUrl: string, method: string, params?: Record<string, unknown>): Promise<T> {
  const ws = new WebSocket(webSocketUrl);
  const id = 1;
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      reject(new Error(`CDP request timed out: ${method}`));
    }, CDP_REQUEST_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
    };
    const onOpen = () => {
      ws.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }));
    };
    const onMessage = (event: { data: unknown }) => {
      const text = webSocketDataToString(event.data);
      if (!text) return;
      const payload = JSON.parse(text) as { id?: number; result?: T; error?: { message?: string } };
      if (payload.id !== id) return;
      cleanup();
      try {
        ws.close();
      } catch {
        /* noop */
      }
      if (payload.error) {
        reject(new Error(payload.error.message ?? `CDP request failed: ${method}`));
      } else {
        resolve((payload.result ?? {}) as T);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error('Controlled browser DevTools connection failed'));
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
  });
}

function webSocketDataToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return '';
}

async function waitForDevtools(port: number): Promise<void> {
  const deadline = Date.now() + CONTROLLED_BROWSER_CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new ConnectorServiceError(
    'CONNECTOR_EXECUTION_FAILED',
    'Controlled browser did not start DevTools in time',
    502,
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function allocateLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('failed to allocate browser debug port'));
      });
    });
    server.on('error', reject);
  });
}

function domainMatchesAny(cookieDomain: string, domains: readonly string[]): boolean {
  const normalizedCookieDomain = cookieDomain.toLowerCase().replace(/^\./, '');
  return domains.some((domain) => {
    const normalizedDomain = domain.toLowerCase().replace(/^\./, '');
    return normalizedCookieDomain === normalizedDomain || normalizedCookieDomain.endsWith(`.${normalizedDomain}`);
  });
}

function sanitizeConnectorId(connectorId: string): string {
  return connectorId.replace(/[^a-z0-9_-]/gi, '_');
}

function findControlledBrowserExecutable(): string | undefined {
  const configured = process.env.OD_CONTROLLED_BROWSER_PATH?.trim() || process.env.CHROME_PATH?.trim();
  if (configured) return configured;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate));
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    return candidates.find((candidate) => fs.existsSync(candidate));
  }
  return 'google-chrome';
}
