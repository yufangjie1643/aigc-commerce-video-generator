// Use Everywhere — modal entry for the WeChat/internal-agent automation status bridge.
// Reachable from the entry top-bar and from Settings → Integrations as a
// sibling of the existing external MCP configuration surface.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { WeChatAgentBridgeSnapshot, WeChatAgentBridgeStatusResponse } from '@open-design/contracts';
import { useAnalytics } from '../analytics/provider';
import { trackIntegrationsUseEverywhereTabClick } from '../analytics/events';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import { modalOverlay, modalContent } from '../motion';
import type { Dict } from '../i18n/types';
import {
  cancelWeChatAgentBridge,
  connectWeChatAgentBridge,
  fetchWeChatAgentBridgeStatus,
  refreshWeChatAgentBridge,
} from '../providers/daemon';
import { buildAgentGuideMarkdown, type AgentGuideOptions } from './use-everywhere/agent-guide';

interface Props {
  onClose: () => void;
  /** Live daemon URL when known (e.g. http://127.0.0.1:7456). */
  daemonUrl?: string;
  /** Optional Open Design version string surfaced in the agent guide header. */
  versionHint?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';
type WeChatAction = 'connect' | 'refresh' | 'cancel' | null;

const COPY_RESET_MS = 1600;
const WECHAT_STATUS_POLL_MS = 1200;

export function UseEverywhereModal({ onClose, daemonUrl, versionHint }: Props) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <motion.div
      className="use-everywhere-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('useEverywhere.modalAria')}
      data-testid="use-everywhere-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      variants={modalOverlay}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="use-everywhere-modal"
        variants={modalContent}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <header className="use-everywhere-modal__head">
          <div className="use-everywhere-modal__head-titles">
            <span className="use-everywhere-modal__kicker">{t('integrations.kicker')}</span>
            <h2 className="use-everywhere-modal__title">{t('useEverywhere.modalTitle')}</h2>
            <p className="use-everywhere-modal__subtitle">{t('useEverywhere.modalSubtitle')}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="use-everywhere-modal__close"
            onClick={onClose}
            aria-label={t('useEverywhere.closeAria')}
            title={t('useEverywhere.closeTitle')}
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        <UseEverywhereGuidePanel daemonUrl={daemonUrl} versionHint={versionHint} />
      </motion.div>
    </motion.div>
  );
}

export function UseEverywhereGuidePanel({ daemonUrl, versionHint }: Omit<Props, 'onClose'>) {
  const t = useT();
  const analytics = useAnalytics();
  const [guideCopy, setGuideCopy] = useState<CopyState>('idle');
  const [wechatStatus, setWechatStatus] = useState<WeChatAgentBridgeStatusResponse | null>(null);
  const [wechatAction, setWechatAction] = useState<WeChatAction>(null);
  const [wechatError, setWechatError] = useState<string>('');

  const guideOptions: AgentGuideOptions = useMemo(() => {
    const opts: AgentGuideOptions = {};
    if (daemonUrl) opts.daemonUrl = daemonUrl;
    if (versionHint) opts.versionHint = versionHint;
    return opts;
  }, [daemonUrl, versionHint]);

  const fullGuide = useMemo(() => buildAgentGuideMarkdown(guideOptions), [guideOptions]);

  const refreshWeChatStatus = useCallback(async () => {
    const next = await fetchWeChatAgentBridgeStatus();
    if (next) {
      setWechatStatus(next);
      if (next.login.phase !== 'failed' && next.agentAvailable !== false) {
        setWechatError('');
      }
    }
  }, []);

  useEffect(() => {
    void refreshWeChatStatus();
  }, [refreshWeChatStatus]);

  useEffect(() => {
    if (!wechatStatus?.login.running) return undefined;
    const id = window.setInterval(() => {
      void refreshWeChatStatus();
    }, WECHAT_STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshWeChatStatus, wechatStatus?.login.running]);

  const login = wechatStatus?.login ?? null;
  const isRunning = login?.running === true;
  const busy = wechatAction !== null;
  const terminalQr = login?.terminalQr?.trim() ?? '';
  const qrSvg = login?.qrSvg?.trim() ?? '';
  const qrImageSrc = qrSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}` : '';
  const output = login?.output?.trim() ?? '';
  const statusLabel = wechatStatusLabel(wechatStatus, login);
  const statusIcon: IconName = isRunning ? 'spinner' : wechatStatus?.connected ? 'check' : 'terminal';
  const displayWechatError =
    wechatError ||
    (login?.phase === 'failed' ? login.error ?? '' : '') ||
    (wechatStatus?.agentAvailable === false ? wechatStatus.error ?? '' : '');
  const qrPlaceholderText = wechatQrPlaceholderText(wechatStatus, login, isRunning, displayWechatError);

  function applyLoginSnapshot(snapshot: WeChatAgentBridgeSnapshot) {
    const clearsConnection = snapshot.phase === 'canceled' || snapshot.phase === 'failed';
    setWechatStatus((prev) => ({
      agentAvailable: snapshot.agentId ? true : clearsConnection ? false : prev?.agentAvailable ?? false,
      selectedAgent: snapshot.agentId
        ? {
            id: snapshot.agentId,
            name: snapshot.agentName ?? snapshot.agentId,
            available: true,
            ...(snapshot.agentVersion !== undefined ? { version: snapshot.agentVersion } : {}),
          }
        : clearsConnection
          ? undefined
          : prev?.selectedAgent,
      connected: snapshot.phase === 'connected' ? true : clearsConnection ? false : prev?.connected === true,
      bridgeStatus: prev?.bridgeStatus,
      agents: prev?.agents ?? [],
      checkedAt: new Date().toISOString(),
      login: snapshot,
      error: prev?.error,
    }));
  }

  async function onCopyGuide() {
    const state = await copyText(fullGuide);
    setGuideCopy(state);
    if (state !== 'idle') {
      window.setTimeout(() => setGuideCopy('idle'), COPY_RESET_MS);
    }
  }

  async function runWeChatConnect() {
    setWechatAction('connect');
    setWechatError('');
    trackIntegrationsUseEverywhereTabClick(analytics.track, {
      page_name: 'integrations',
      area: 'use_everywhere_tab',
      element: 'wechat_agent_connect',
    });
    const result = await connectWeChatAgentBridge();
    applyLoginSnapshot(result.login);
    if (!result.ok && result.error) setWechatError(result.error);
    setWechatAction(null);
    window.setTimeout(() => void refreshWeChatStatus(), 400);
  }

  async function refreshWeChatBridge() {
    setWechatAction('refresh');
    setWechatError('');
    trackIntegrationsUseEverywhereTabClick(analytics.track, {
      page_name: 'integrations',
      area: 'use_everywhere_tab',
      element: 'wechat_agent_refresh',
    });
    const result = await refreshWeChatAgentBridge();
    applyLoginSnapshot(result.login);
    if (!result.ok) {
      setWechatError(result.error || result.stderr || '内置 Agent 桥刷新失败');
    }
    setWechatAction(null);
    await refreshWeChatStatus();
  }

  async function cancelWeChatBridge() {
    setWechatAction('cancel');
    setWechatError('');
    const result = await cancelWeChatAgentBridge();
    applyLoginSnapshot(result.login);
    if (!result.ok) setWechatError('取消微信登录进程失败');
    setWechatAction(null);
  }

  return (
    <>
      <div className="use-everywhere-modal__body">
        <section
          className="wechat-bridge"
          aria-labelledby="wechat-bridge-heading"
          data-testid="use-everywhere-wechat-qr"
        >
          <div className="wechat-bridge__qr-panel">
            <div className="wechat-bridge__qr-frame wechat-bridge__qr-frame--terminal">
              {qrImageSrc ? (
                <img className="wechat-bridge__qr-image" src={qrImageSrc} alt="微信内置 Agent 连接二维码" />
              ) : terminalQr ? (
                <pre className="wechat-bridge__terminal-qr" aria-label="WeChat agent bridge code">
                  {terminalQr}
                </pre>
              ) : (
                <div className="wechat-bridge__qr-placeholder">
                  <Icon name={isRunning ? 'spinner' : 'terminal'} size={22} />
                  <span>{qrPlaceholderText}</span>
                </div>
              )}
            </div>
            <span className="wechat-bridge__qr-caption">
              {qrImageSrc || terminalQr ? '微信连接码' : wechatStatus?.selectedAgent?.name ?? '内置 Agent 桥'}
            </span>
          </div>
          <div className="wechat-bridge__content">
            <div className="wechat-bridge__status">
              <Icon name={statusIcon} size={13} />
              <span>{statusLabel}</span>
            </div>
            <h3 id="wechat-bridge-heading" className="wechat-bridge__heading">
              {t('useEverywhere.section.overview.heading')}
            </h3>
            <p className="wechat-bridge__intro">{t('useEverywhere.section.overview.intro')}</p>
            <div className="wechat-bridge__actions" aria-label="WeChat agent bridge actions">
              <button
                type="button"
                className="use-everywhere-modal__primary"
                onClick={() => void runWeChatConnect()}
                disabled={busy || isRunning}
              >
                <Icon name={wechatAction === 'connect' ? 'spinner' : 'play'} size={13} />
                连接内置 Agent
              </button>
              <button
                type="button"
                className="use-everywhere-modal__secondary"
                onClick={() => void refreshWeChatBridge()}
                disabled={busy || isRunning}
              >
                <Icon name={wechatAction === 'refresh' ? 'spinner' : 'refresh'} size={13} />
                刷新 Agent 状态
              </button>
              {isRunning ? (
                <button
                  type="button"
                  className="use-everywhere-modal__secondary"
                  onClick={() => void cancelWeChatBridge()}
                  disabled={wechatAction === 'cancel'}
                >
                  <Icon name={wechatAction === 'cancel' ? 'spinner' : 'stop'} size={13} />
                  取消
                </button>
              ) : null}
            </div>
            {displayWechatError ? (
              <p className="wechat-bridge__error" role="status">
                {displayWechatError}
              </p>
            ) : null}
            {login?.detectedUrls?.length ? (
              <div className="wechat-bridge__links">
                {login.detectedUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    登录链接
                    <Icon name="external-link" size={12} />
                  </a>
                ))}
              </div>
            ) : null}
            {output ? (
              <pre className="wechat-bridge__log" aria-label="WeChat agent bridge output">
                {output}
              </pre>
            ) : null}
            <div className="wechat-bridge__capabilities" aria-label={t('useEverywhere.tabsAria')}>
              <span>{t('useEverywhere.section.overview.bullet2')}</span>
              <span>{t('useEverywhere.section.overview.bullet3')}</span>
              <span>{t('useEverywhere.section.overview.bullet4')}</span>
            </div>
          </div>
        </section>
      </div>

      <footer className="use-everywhere-modal__foot">
        <div className="use-everywhere-modal__foot-info">
          <strong>{t('useEverywhere.footStrong')}</strong> <span>{t('useEverywhere.footBody')}</span>
        </div>
        <div className="use-everywhere-modal__foot-actions">
          <button
            type="button"
            className="use-everywhere-modal__primary"
            onClick={() => {
              trackIntegrationsUseEverywhereTabClick(analytics.track, {
                page_name: 'integrations',
                area: 'use_everywhere_tab',
                element: 'copy_guide_for_agent',
              });
              void onCopyGuide();
            }}
            data-testid="use-everywhere-copy-guide"
          >
            <Icon name="copy" size={13} />
            {copyLabel(guideCopy, t('useEverywhere.copyGuide'), t)}
          </button>
        </div>
      </footer>
    </>
  );
}

async function copyText(text: string): Promise<CopyState> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return 'failed';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function copyLabel(state: CopyState, idle: string, t: (key: keyof Dict) => string): string {
  if (state === 'copied') return t('useEverywhere.copied');
  if (state === 'failed') return t('useEverywhere.copyFailed');
  return idle;
}

function wechatStatusLabel(
  status: WeChatAgentBridgeStatusResponse | null,
  login: WeChatAgentBridgeSnapshot | null,
): string {
  if (login?.running) {
    if (login.phase === 'selecting_agent') return '正在选择内置 Agent';
    return '正在连接微信桥';
  }
  if (status?.connected || login?.phase === 'connected') {
    const agentName = status?.selectedAgent?.name ?? login?.agentName;
    return agentName ? `已连接 ${agentName}` : '微信桥已连接';
  }
  if (login?.phase === 'failed') return '微信连接失败';
  if (status?.agentAvailable === false) return '需要连接内置 Agent';
  return '微信状态入口';
}

function wechatQrPlaceholderText(
  status: WeChatAgentBridgeStatusResponse | null,
  login: WeChatAgentBridgeSnapshot | null,
  isRunning: boolean,
  error: string,
): string {
  if (isRunning) return '正在连接内置 Agent';
  if (login?.phase === 'connected' || status?.connected) return '内置 Agent 桥已就绪';
  if (login?.phase === 'failed' || error) return '连接失败，查看下方错误原因';
  if (status?.agentAvailable === false) return '先连接 OpenCode 等内置 Agent';
  return '点击按钮连接内置 Agent';
}
