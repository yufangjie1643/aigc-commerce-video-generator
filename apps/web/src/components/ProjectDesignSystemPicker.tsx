// Project-page commerce style picker — small dropdown rendered in the
// composer chrome. It presents a curated selling-style preset list while
// still PATCHing `project.designSystemId`, so the next chat run carries
// the mapped design-system metadata into the agent's system prompt.
//
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  COMMERCE_STYLE_PRESETS,
  commerceStyleDisplayForLocale,
  type DesignSystemSummary,
} from '@open-design/contracts';
import { useI18n } from '../i18n';
import { fetchDesignSystemPreview } from '../providers/registry';
import { Icon } from './Icon';

const COMMERCE_STYLE_PICKER_COPY = {
  zh: {
    select: '选择带货风格',
    loading: '正在加载带货风格…',
    searchPlaceholder: '搜索带货风格',
    noneTitle: '不套用带货风格',
    empty: '没有匹配的带货风格',
    noPreview: '暂无预览，仍会按该带货风格生成。',
    previewHint: '将鼠标悬停在左侧风格上查看预览',
  },
  en: {
    select: 'Choose selling style',
    loading: 'Loading selling styles…',
    searchPlaceholder: 'Search selling styles',
    noneTitle: 'No selling style',
    empty: 'No matching selling styles',
    noPreview: 'No preview yet. Generation will still use this selling style.',
    previewHint: 'Hover a style on the left to preview it',
  },
};

function commerceCopyKey(locale: string): 'zh' | 'en' {
  return locale.startsWith('zh') ? 'zh' : 'en';
}

interface PopoverAnchor {
  left: number;
  width: number;
  maxHeight: number;
  // Vertical placement: when the trigger sits near the bottom of the
  // viewport (e.g. the composer-top picker) the popover opens upward,
  // anchored by `bottom`; otherwise it opens downward, anchored by `top`.
  top?: number;
  bottom?: number;
}

interface Props {
  designSystems: DesignSystemSummary[];
  selectedId: string | null;
  loading?: boolean;
  onChange: (id: string | null) => void;
}

export function ProjectDesignSystemPicker({ designSystems, selectedId, loading, onChange }: Props) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hovered, setHovered] = useState<DesignSystemSummary | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const commerceLocale = commerceCopyKey(locale);
  const pickerCopy = COMMERCE_STYLE_PICKER_COPY[commerceLocale];

  const commerceStyleOptions = useMemo(() => {
    const byId = new Map(designSystems.map((designSystem) => [designSystem.id, designSystem]));
    const presets = COMMERCE_STYLE_PRESETS.flatMap((preset) => {
      const designSystem = byId.get(preset.id);
      if (!designSystem) return [];
      const display = commerceStyleDisplayForLocale(preset, locale);
      return [
        {
          ...designSystem,
          title: display.title,
          summary: display.summary,
          category: display.category,
          swatches: designSystem.swatches && designSystem.swatches.length > 0 ? designSystem.swatches : preset.swatches,
        },
      ];
    });
    return presets;
  }, [designSystems, locale]);

  const selected = useMemo(
    () => commerceStyleOptions.find((d) => d.id === selectedId) ?? null,
    [commerceStyleOptions, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (fullscreenPreview) return;
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (fullscreenPreview) return;
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [fullscreenPreview, open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    function updateAnchor() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewport = window.innerWidth;
      const popoverWidth = Math.min(440, Math.max(280, viewport - 24));
      const left = Math.max(8, Math.min(viewport - popoverWidth - 8, rect.left));
      const gap = 6;
      const margin = 12;
      const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
      const spaceAbove = rect.top - gap - margin;
      // Open upward when there isn't enough room below (the composer-top
      // picker is near the viewport bottom) but there is more room above.
      const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
      if (openUp) {
        setAnchor({
          bottom: window.innerHeight - rect.top + gap,
          left,
          width: popoverWidth,
          maxHeight: Math.max(220, Math.min(420, spaceAbove)),
        });
      } else {
        setAnchor({
          top: rect.bottom + gap,
          left,
          width: popoverWidth,
          maxHeight: Math.max(220, Math.min(420, spaceBelow)),
        });
      }
    }
    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    return () => {
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
      setHovered(null);
      setFullscreenPreview(false);
    }
  }, [open]);

  useEffect(() => {
    if (!fullscreenPreview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreenPreview(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreenPreview]);

  const previewTarget = open ? (hovered ?? selected) : null;

  useEffect(() => {
    if (!previewTarget) {
      setPreviewHtml(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void fetchDesignSystemPreview(previewTarget.id)
      .then((html) => {
        if (cancelled) return;
        setPreviewHtml(html);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewHtml(null);
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewTarget?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return commerceStyleOptions;
    return commerceStyleOptions.filter((d) => {
      const haystack = `${d.title} ${d.category} ${d.summary}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query, commerceStyleOptions]);

  const selectDesignSystem = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const selectDesignSystemOnKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string | null) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectDesignSystem(id);
  };

  return (
    <div ref={wrapRef} className={`project-ds-picker${open ? ' open' : ''}`} data-testid="project-ds-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`project-ds-picker-trigger${selected ? ' picked' : ''}`}
        data-testid="project-ds-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        title={selected?.title ?? pickerCopy.select}
      >
        {selected && selected.swatches && selected.swatches.length > 0 ? (
          <span className="project-ds-picker-swatches" aria-hidden>
            {selected.swatches.slice(0, 3).map((sw, i) => (
              <span key={`pdsp-sw-${i}`} className="project-ds-picker-swatch" style={{ background: sw }} />
            ))}
          </span>
        ) : (
          <Icon name="palette" size={13} />
        )}
        <span className="project-ds-picker-label">
          {loading ? pickerCopy.loading : (selected?.title ?? pickerCopy.select)}
        </span>
        <Icon name="chevron-down" size={11} />
      </button>
      {open && anchor && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="project-ds-picker-popover"
              data-testid="project-ds-picker-popover"
              data-placement={anchor.bottom !== undefined ? 'up' : 'down'}
              style={{
                top: anchor.top,
                bottom: anchor.bottom,
                left: anchor.left,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
              }}
            >
              <div className="project-ds-picker-search">
                <Icon name="search" size={12} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={pickerCopy.searchPlaceholder}
                  data-testid="project-ds-picker-search"
                />
              </div>
              <div className="project-ds-picker-body">
                <div className="project-ds-picker-list" role="listbox">
                  <button
                    type="button"
                    className={`project-ds-picker-option${selectedId == null ? ' active' : ''}`}
                    role="option"
                    aria-selected={selectedId == null}
                    onMouseEnter={() => setHovered(null)}
                    onFocus={() => setHovered(null)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectDesignSystem(null);
                    }}
                    onKeyDown={(event) => selectDesignSystemOnKeyDown(event, null)}
                  >
                    <div className="project-ds-picker-option-head">
                      <span className="project-ds-picker-option-title">{pickerCopy.noneTitle}</span>
                      {selectedId == null ? (
                        <span
                          className="project-ds-picker-option-check"
                          data-testid="project-ds-picker-option-none-check"
                        >
                          <Icon name="check" size={13} strokeWidth={2} />
                        </span>
                      ) : null}
                    </div>
                  </button>
                  {filtered.map((d) => {
                    const active = d.id === selectedId;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`project-ds-picker-option${active ? ' active' : ''}`}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setHovered(d)}
                        onFocus={() => setHovered(d)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectDesignSystem(d.id);
                        }}
                        onKeyDown={(event) => selectDesignSystemOnKeyDown(event, d.id)}
                        data-testid={`project-ds-picker-option-${d.id}`}
                      >
                        <div className="project-ds-picker-option-head">
                          <span className="project-ds-picker-option-title">{d.title}</span>
                          {active ? (
                            <span
                              className="project-ds-picker-option-check"
                              data-testid={`project-ds-picker-option-${d.id}-check`}
                            >
                              <Icon name="check" size={13} strokeWidth={2} />
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                  {filtered.length === 0 ? <div className="project-ds-picker-empty">{pickerCopy.empty}</div> : null}
                </div>
                <div className="project-ds-picker-preview" data-testid="project-ds-picker-preview">
                  {previewTarget ? (
                    <>
                      <div className="project-ds-picker-preview-head">
                        <strong>{previewTarget.title}</strong>
                      </div>
                      {previewTarget.summary ? (
                        <p className="project-ds-picker-preview-summary">{previewTarget.summary}</p>
                      ) : null}
                      {previewTarget.swatches && previewTarget.swatches.length > 0 ? (
                        <div className="project-ds-picker-preview-swatches">
                          {previewTarget.swatches.slice(0, 12).map((sw, i) => (
                            <span
                              key={`${previewTarget.id}-pv-sw-${i}`}
                              className="project-ds-picker-preview-swatch"
                              style={{ background: sw }}
                              title={sw}
                            />
                          ))}
                        </div>
                      ) : null}
                      {previewLoading ? (
                        <div className="project-ds-picker-preview-stage">
                          <div className="project-ds-picker-preview-loading">
                            {t('designSystemPicker.loadingPreview')}
                          </div>
                        </div>
                      ) : previewHtml ? (
                        <div className="project-ds-picker-preview-stage">
                          <iframe
                            className="project-ds-picker-preview-frame"
                            data-testid="project-ds-picker-preview-frame"
                            srcDoc={previewHtml}
                            sandbox="allow-scripts"
                            scrolling="no"
                            title={t('designSystemPicker.previewFrameTitle', { title: previewTarget.title })}
                          />
                          <button
                            type="button"
                            className="project-ds-picker-preview-expand"
                            data-testid="project-ds-picker-preview-expand"
                            onClick={() => setFullscreenPreview(true)}
                            title={t('designSystemPicker.openPreview')}
                            aria-label={t('designSystemPicker.openPreview')}
                          >
                            <Icon name="eye" size={13} strokeWidth={1.9} />
                            <span>{t('designSystemPicker.openPreview')}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="project-ds-picker-preview-stage">
                          <div className="project-ds-picker-preview-empty">{pickerCopy.noPreview}</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="project-ds-picker-preview-stage">
                      <div className="project-ds-picker-preview-empty">{pickerCopy.previewHint}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {fullscreenPreview && previewTarget && previewHtml && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="project-ds-picker-fullscreen"
              role="dialog"
              aria-label={t('designSystemPicker.fullscreenAria', { title: previewTarget.title })}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setFullscreenPreview(false);
                }
              }}
            >
              <div className="project-ds-picker-fullscreen-frame">
                <div className="project-ds-picker-fullscreen-head">
                  <div className="project-ds-picker-fullscreen-title">
                    <strong>{previewTarget.title}</strong>
                    {previewTarget.category ? (
                      <span className="project-ds-picker-preview-cat">{previewTarget.category}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="project-ds-picker-fullscreen-close"
                    onClick={() => setFullscreenPreview(false)}
                    aria-label={t('designSystemPicker.closeFullscreen')}
                    title={t('designSystemPicker.closeEsc')}
                  >
                    <Icon name="close" size={18} strokeWidth={2.1} />
                  </button>
                </div>
                <iframe
                  className="project-ds-picker-fullscreen-iframe"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  title={t('designSystemPicker.fullscreenFrameTitle', { title: previewTarget.title })}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
