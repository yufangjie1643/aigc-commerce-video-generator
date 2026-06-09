import { useEffect, useMemo, useState } from 'react';
import { Button } from '@open-design/components';
import type {
  AssetLibraryToolConfig,
  EmbeddingProviderConfig,
} from '@open-design/contracts';
import {
  fetchAssetLibraryConfig,
  saveAssetLibraryToolConfig,
  saveEmbeddingConfig,
  testAssetLibraryToolConfig,
  testEmbeddingConfig,
} from '../providers/asset-library';
import { Icon } from './Icon';
import styles from './AssetLibrarySettingsSection.module.css';

type Status = { kind: 'idle' } | { kind: 'ok' | 'error'; message: string };

export function AssetLibrarySettingsSection() {
  const [tools, setTools] = useState<AssetLibraryToolConfig | null>(null);
  const [embedding, setEmbedding] = useState<EmbeddingProviderConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [headersJson, setHeadersJson] = useState('{}');
  const [mappingJson, setMappingJson] = useState('{}');
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function reload() {
    setLoading(true);
    setStatus({ kind: 'idle' });
    try {
      const config = await fetchAssetLibraryConfig();
      setTools(config.tools);
      setEmbedding(config.embedding);
      setApiKey('');
      setHeadersJson(JSON.stringify(config.embedding.headers ?? {}, null, 2));
      setMappingJson(JSON.stringify(config.embedding.inputMapping ?? {}, null, 2));
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const endpoint = useMemo(() => {
    if (!embedding) return '';
    return `${embedding.baseUrl.replace(/\/+$/, '')}${embedding.endpointPath.startsWith('/') ? embedding.endpointPath : `/${embedding.endpointPath}`}`;
  }, [embedding]);

  async function saveTools() {
    if (!tools) return;
    setBusy('tools-save');
    try {
      const result = await saveAssetLibraryToolConfig(tools);
      setTools(result.tools);
      setStatus({ kind: 'ok', message: 'Local tool paths saved.' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function testTools() {
    if (!tools) return;
    setBusy('tools-test');
    try {
      const result = await testAssetLibraryToolConfig(tools);
      setTools(result.tools);
      setStatus({
        kind: result.ok ? 'ok' : 'error',
        message: result.ok
          ? 'ffmpeg and ffprobe are available.'
          : result.tools.lastVerificationError ?? 'Tool verification failed.',
      });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function saveEmbedding() {
    if (!embedding) return;
    setBusy('embedding-save');
    try {
      const payload = embeddingPayload(embedding, apiKey, headersJson, mappingJson);
      const result = await saveEmbeddingConfig(payload);
      setEmbedding(result.embedding);
      setApiKey('');
      setStatus({ kind: 'ok', message: 'Vectorization provider saved.' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function testEmbedding() {
    if (!embedding) return;
    setBusy('embedding-test');
    try {
      const result = await testEmbeddingConfig(embeddingPayload(embedding, apiKey, headersJson, mappingJson));
      setStatus({
        kind: result.ok ? 'ok' : 'error',
        message: result.ok
          ? `Embedding connection OK${result.dimensions ? `, ${result.dimensions} dimensions` : ''}.`
          : result.detail ?? result.kind,
      });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  if (loading || !tools || !embedding) {
    return (
      <section className={styles.section}>
        <div className={`${styles.card} ${styles.loadingCard}`}>
          <Icon name="spinner" size={15} />
          正在读取素材库设置...
        </div>
      </section>
    );
  }

  const toolsState = tools.lastVerificationError ? 'error' : tools.lastVerifiedAt ? 'ok' : 'idle';
  const toolsStateLabel =
    toolsState === 'ok' ? '已验证' : toolsState === 'error' ? '需检查' : '待验证';
  const providerLabel = embedding.providerId === 'custom' ? 'Custom endpoint' : 'Volcengine Ark';
  const keyLabel = embedding.apiKeyConfigured ? `已配置 ...${embedding.apiKeyTail ?? ''}` : '未配置 Key';

  return (
    <section className={styles.section}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.titleBlock}>
            <div className={styles.titleRow}>
              <span className={styles.iconTile}>
                <Icon name="terminal" size={15} />
              </span>
              <h3>本地视频处理工具</h3>
              <span className={`${styles.badge} ${styles[`badge-${toolsState}`]}`}>
                {toolsStateLabel}
              </span>
            </div>
            <p>切片、抽帧和探测元数据会优先使用这里的本地路径。</p>
          </div>
          <div className={styles.headerActions}>
            <Button variant="subtle" onClick={() => void testTools()} disabled={busy === 'tools-test'}>
              <Icon name={busy === 'tools-test' ? 'spinner' : 'terminal'} size={14} />
              测试工具
            </Button>
            <Button variant="primary" onClick={() => void saveTools()} disabled={busy === 'tools-save'}>
              <Icon name={busy === 'tools-save' ? 'spinner' : 'check'} size={14} />
              保存路径
            </Button>
          </div>
        </div>
        <div className={styles.settingList}>
          <label className={styles.field}>
            <span className={styles.labelRow}>
              <span>FFmpeg 路径</span>
              <span className={styles.fieldHint}>视频切片 / 转码</span>
            </span>
            <input
              className={styles.monoInput}
              value={tools.ffmpegPath}
              onChange={(event) => setTools((current) => current ? { ...current, ffmpegPath: event.target.value } : current)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>
              <span>FFprobe 路径</span>
              <span className={styles.fieldHint}>读取时长 / 分辨率</span>
            </span>
            <input
              className={styles.monoInput}
              value={tools.ffprobePath}
              onChange={(event) => setTools((current) => current ? { ...current, ffprobePath: event.target.value } : current)}
            />
          </label>
          <label className={styles.toggleRow}>
            <span className={styles.toggleCopy}>
              <strong>PATH 自动探测</strong>
              <span>配置路径不可用时，继续尝试系统 PATH 中的 ffmpeg / ffprobe。</span>
            </span>
            <input
              type="checkbox"
              checked={tools.autoDetectEnabled}
              onChange={(event) => setTools((current) => current ? { ...current, autoDetectEnabled: event.target.checked } : current)}
            />
            <span className={styles.switchTrack} aria-hidden="true" />
          </label>
        </div>
        <div className={styles.metaStrip}>
          {tools.lastVerifiedAt ? (
            <span>
              <Icon name="check" size={13} />
              上次验证：{formatTimestamp(tools.lastVerifiedAt)}
            </span>
          ) : (
            <span>
              <Icon name="info" size={13} />
              保存后可直接运行工具测试。
            </span>
          )}
          {tools.lastVerificationError ? (
            <span className={styles.errorText}>
              <Icon name="alert-triangle" size={13} />
              {tools.lastVerificationError}
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.titleBlock}>
            <div className={styles.titleRow}>
              <span className={styles.iconTile}>
                <Icon name="sparkles" size={15} />
              </span>
              <h3>向量化模型</h3>
              <span className={`${styles.badge} ${embedding.apiKeyConfigured ? styles['badge-ok'] : styles['badge-idle']}`}>
                {keyLabel}
              </span>
            </div>
            <p>用于摘要、标签、关键帧和多模态检索向量生成。</p>
          </div>
          <div className={styles.headerActions}>
            <Button variant="subtle" onClick={() => void testEmbedding()} disabled={busy === 'embedding-test'}>
              <Icon name={busy === 'embedding-test' ? 'spinner' : 'sparkles'} size={14} />
              测试连接
            </Button>
            <Button variant="primary" onClick={() => void saveEmbedding()} disabled={busy === 'embedding-save'}>
              <Icon name={busy === 'embedding-save' ? 'spinner' : 'check'} size={14} />
              保存向量化
            </Button>
          </div>
        </div>
        <div className={styles.providerSummary}>
          <span className={styles.providerMark}>{embedding.providerId === 'custom' ? 'API' : 'Ark'}</span>
          <div>
            <strong>{providerLabel}</strong>
            <span>{embedding.model}</span>
          </div>
        </div>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.labelRow}>供应商</span>
            <select
              value={embedding.providerId}
              onChange={(event) => setEmbedding((current) => current ? { ...current, providerId: event.target.value as EmbeddingProviderConfig['providerId'] } : current)}
            >
              <option value="volcengine-ark">Volcengine Ark</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>模型</span>
            <input
              value={embedding.model}
              onChange={(event) => setEmbedding((current) => current ? { ...current, model: event.target.value } : current)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Base URL</span>
            <input
              value={embedding.baseUrl}
              onChange={(event) => setEmbedding((current) => current ? { ...current, baseUrl: event.target.value } : current)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Endpoint Path</span>
            <input
              value={embedding.endpointPath}
              onChange={(event) => setEmbedding((current) => current ? { ...current, endpointPath: event.target.value } : current)}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.labelRow}>
              <span>API Key</span>
              <span className={styles.fieldHint}>留空会保留已保存密钥</span>
            </span>
            <span className={styles.secretField}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={embedding.apiKeyConfigured ? `Configured ...${embedding.apiKeyTail ?? ''}` : 'Paste API key'}
              />
              <button
                type="button"
                className={styles.secretButton}
                onClick={() => setShowApiKey((current) => !current)}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                <Icon name={showApiKey ? 'eye-off' : 'eye'} size={14} />
              </button>
            </span>
          </label>
        </div>
        <details className={styles.advanced}>
          <summary>
            <span>高级请求设置</span>
            <Icon name="chevron-down" size={14} />
          </summary>
          <div className={styles.grid}>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.labelRow}>Headers JSON</span>
              <textarea value={headersJson} onChange={(event) => setHeadersJson(event.target.value)} spellCheck={false} />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.labelRow}>Input Mapping JSON</span>
              <textarea value={mappingJson} onChange={(event) => setMappingJson(event.target.value)} spellCheck={false} />
            </label>
          </div>
        </details>
        <div className={styles.endpointPreview}>
          <span>Endpoint</span>
          <code>{endpoint}</code>
        </div>
      </div>

      {status.kind !== 'idle' ? (
        <p
          className={`${styles.status} ${status.kind === 'ok' ? styles.statusOk : styles.statusError}`}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          <Icon name={status.kind === 'ok' ? 'check' : 'alert-triangle'} size={14} />
          {status.message}
        </p>
      ) : null}
    </section>
  );
}

function embeddingPayload(
  embedding: EmbeddingProviderConfig,
  apiKey: string,
  headersJson: string,
  mappingJson: string,
): Partial<EmbeddingProviderConfig> & { preserveApiKey?: boolean } {
  return {
    ...embedding,
    apiKey,
    ...(!apiKey && embedding.apiKeyConfigured ? { preserveApiKey: true } : {}),
    headers: parseStringJsonObject(headersJson, 'Headers JSON'),
    inputMapping: parseJsonObject(mappingJson, 'Input Mapping JSON') as EmbeddingProviderConfig['inputMapping'],
  };
}

function parseStringJsonObject(value: string, label: string): Record<string, string> {
  const parsed = parseJsonObject(value, label);
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function formatTimestamp(value: string | number | Date): string {
  return new Date(value).toLocaleString();
}
