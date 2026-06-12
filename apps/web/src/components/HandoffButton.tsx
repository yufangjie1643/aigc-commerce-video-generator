// Header action for opening the current project folder in the OS file manager.

import { useEffect, useState } from 'react';
import type { AgentInfo, HostEditorId, HostEditorsResponse } from '@open-design/contracts';
import { fetchHostEditors, openProjectInEditor } from '../providers/registry';
import { useT } from '../i18n';
import { EditorIcon } from './EditorIcon';

interface Props {
  projectId: string;
  projectName?: string;
  projectDir?: string | null;
  agents?: AgentInfo[];
  // Optional renderer-side fallback for shells that can reveal locally even if
  // the daemon-side file-manager launch fails.
  onRequestRevealInFinder?: () => void;
}

function fileManagerIdForPlatform(platform: HostEditorsResponse['platform']): HostEditorId {
  if (platform === 'win32') return 'explorer';
  if (platform === 'linux') return 'file-manager';
  return 'finder';
}

export function HandoffButton({ projectId, onRequestRevealInFinder }: Props) {
  const t = useT();
  const [platform, setPlatform] = useState<HostEditorsResponse['platform']>('unknown');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHostEditors()
      .then((resp) => {
        if (cancelled) return;
        setPlatform(resp.platform);
      })
      .catch(() => {
        if (cancelled) return;
        setPlatform('unknown');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;

  const fileManagerId = fileManagerIdForPlatform(platform);
  const label = t('workingDirPicker.showInFileManager');

  async function openInFileManager() {
    setError(null);
    setBusy(true);
    try {
      await openProjectInEditor(projectId, fileManagerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try {
        onRequestRevealInFinder?.();
      } catch {
        // Best-effort fallback only.
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="handoff-wrap handoff-wrap--solo" data-testid="handoff-wrap">
      <button
        type="button"
        className="handoff-trigger handoff-trigger--solo od-tooltip"
        title={label}
        data-tooltip={label}
        data-tooltip-placement="bottom"
        data-testid="handoff-trigger"
        aria-label={label}
        disabled={busy}
        onClick={() => void openInFileManager()}
      >
        <EditorIcon editorId={fileManagerId} size={20} />
        <span className="handoff-trigger-label">{label}</span>
      </button>
      {error ? (
        <div className="handoff-menu-error" role="alert" data-testid="handoff-fallback-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
