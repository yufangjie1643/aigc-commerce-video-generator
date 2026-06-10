import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@open-design/components";
import type {
  AssetLibraryFileRef,
  AssetLibraryJob,
  AssetLibrarySourceKind,
  AssetLibraryStatus,
  CommerceVideoAsset,
  CommerceVideoSlice,
  QualityVideoAsset
} from "@open-design/contracts";
import {
  batchProcessCommerceVideoAssets,
  createQualityVideoAsset,
  deleteCommerceVideoAsset,
  deleteQualityVideoAsset,
  embedCommerceVideoAsset,
  embedQualityVideoAsset,
  getCommerceVideoAsset,
  getQualityVideoAsset,
  importCrawlerCommerceVideo,
  importQualityVideoSearch,
  listCommerceVideoAssets,
  listQualityVideoAssets,
  processCommerceVideoAsset,
  processQualityVideoAsset,
  sliceCommerceVideoAsset,
  updateCommerceVideoAsset,
  updateQualityVideoAsset,
  uploadCommerceVideoAsset,
  uploadQualityVideoAsset,
  waitAssetLibraryJob
} from "../providers/asset-library";
import { Icon } from "./Icon";
import styles from "./AssetLibraryView.module.css";

type AssetTab = "commerce-videos" | "quality-videos";
type VideoImportMode = "upload" | "crawler";
type QualityImportMode = "reference" | "search" | "upload";
type CrawlerConnector = "youtube" | "tiktok" | "douyin" | "bilibili";

type VideoEditFormState = {
  title: string;
  subject: string;
  category: string;
  sourceUrl: string;
  sourceVideoId: string;
  summary: string;
  hooks: string;
  structure: string;
  sellingTriggers: string;
  styleTags: string;
};

type QualityVideoFormState = {
  title: string;
  sourceName: string;
  sourceUrl: string;
  sourceVideoId: string;
  category: string;
  keyword: string;
  summary: string;
  hookMethods: string;
  sellingPoints: string;
  storyboard: string;
  styleTags: string;
  searchQuery: string;
};

type AssetLibrarySearchResults = {
  query: string;
  videos: CommerceVideoAsset[];
  qualityVideos: QualityVideoAsset[];
};

type PendingApproval = { kind: "save-video"; id: string } | { kind: "delete-video"; id: string };

type PreviewTarget = { kind: "video"; id: string };
type IconToken = Parameters<typeof Icon>[0]["name"];

type PreviewClip = {
  id: string;
  label: string;
  path: string;
  thumbnailPath?: string;
  time?: string;
};

interface AssetLibraryViewProps {
  onOpenSettings?: () => void;
}

const EMPTY_VIDEO_EDIT_FORM: VideoEditFormState = {
  title: "",
  subject: "",
  category: "",
  sourceUrl: "",
  sourceVideoId: "",
  summary: "",
  hooks: "",
  structure: "",
  sellingTriggers: "",
  styleTags: ""
};

const EMPTY_QUALITY_VIDEO_FORM: QualityVideoFormState = {
  title: "",
  sourceName: "bilibili",
  sourceUrl: "",
  sourceVideoId: "",
  category: "",
  keyword: "",
  summary: "",
  hookMethods: "",
  sellingPoints: "",
  storyboard: "",
  styleTags: "",
  searchQuery: ""
};

const STATUS_LABELS: Record<AssetLibraryStatus, string> = {
  ready: "可用",
  processing: "处理中",
  needs_model: "待配置模型",
  needs_video_file: "待下载视频",
  needs_embedding_config: "待配置向量",
  failed: "失败"
};

const SOURCE_LABELS: Record<AssetLibrarySourceKind, string> = {
  manual: "手动录入",
  upload: "商家上传",
  crawler: "爬虫导入"
};

const CONNECTOR_LABELS: Record<CrawlerConnector, string> = {
  douyin: "Douyin",
  bilibili: "Bilibili",
  tiktok: "TikTok",
  youtube: "YouTube"
};

const ASSET_LIBRARY_STEPS: Array<{ icon: IconToken; label: string; body: string }> = [
  { icon: "upload", label: "入库", body: "自有视频或公开链接" },
  { icon: "sparkles", label: "理解", body: "主体、卖点、摘要与约束" },
  { icon: "play", label: "切片", body: "镜头片段、Hook 与节奏" },
  { icon: "search", label: "召回", body: "检索后供脚本和创作调用" }
];

function createEmptyVideoEditForm(): VideoEditFormState {
  return { ...EMPTY_VIDEO_EDIT_FORM };
}

function createEmptyQualityVideoForm(): QualityVideoFormState {
  return { ...EMPTY_QUALITY_VIDEO_FORM };
}

function normalizeQualityVideoForm(value: Partial<QualityVideoFormState> | null | undefined): QualityVideoFormState {
  return {
    title: value?.title ?? "",
    sourceName: value?.sourceName ?? EMPTY_QUALITY_VIDEO_FORM.sourceName,
    sourceUrl: value?.sourceUrl ?? "",
    sourceVideoId: value?.sourceVideoId ?? "",
    category: value?.category ?? "",
    keyword: value?.keyword ?? "",
    summary: value?.summary ?? "",
    hookMethods: value?.hookMethods ?? "",
    sellingPoints: value?.sellingPoints ?? "",
    storyboard: value?.storyboard ?? "",
    styleTags: value?.styleTags ?? "",
    searchQuery: value?.searchQuery ?? ""
  };
}

function videoToEditForm(video: CommerceVideoAsset): VideoEditFormState {
  return {
    title: video.title,
    subject: video.product.subject ?? "",
    category: video.product.category ?? "",
    sourceUrl: video.sourceUrl ?? "",
    sourceVideoId: video.sourceVideoId ?? "",
    summary: video.video.summary ?? "",
    hooks: joinList(video.methodology.hooks),
    structure: joinList(video.methodology.structure),
    sellingTriggers: joinList(video.methodology.sellingTriggers),
    styleTags: joinList(video.methodology.styleTags)
  };
}

export function AssetLibraryView({ onOpenSettings }: AssetLibraryViewProps) {
  const [tab, setTab] = useState<AssetTab>("commerce-videos");
  const [videos, setVideos] = useState<CommerceVideoAsset[]>([]);
  const [qualityVideos, setQualityVideos] = useState<QualityVideoAsset[]>([]);
  const [videoDetails, setVideoDetails] = useState<Record<string, CommerceVideoSlice[]>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchJob, setBatchJob] = useState<AssetLibraryJob | null>(null);
  const [batchProgress, setBatchProgress] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AssetLibrarySearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [videoImportMode, setVideoImportMode] = useState<VideoImportMode>("upload");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [videoImportJob, setVideoImportJob] = useState<AssetLibraryJob | null>(null);
  const [videoImportProgress, setVideoImportProgress] = useState<string[]>([]);
  const [crawlerConnector, setCrawlerConnector] = useState<CrawlerConnector>("douyin");
  const [crawlerUrl, setCrawlerUrl] = useState("");
  const [crawlerTitle, setCrawlerTitle] = useState("");
  const [qualityImportMode, setQualityImportMode] = useState<QualityImportMode>("reference");
  const [qualityForm, setQualityForm] = useState<QualityVideoFormState>(() => createEmptyQualityVideoForm());
  const [qualityUploadFile, setQualityUploadFile] = useState<File | null>(null);
  const [qualityJob, setQualityJob] = useState<AssetLibraryJob | null>(null);
  const [qualityProgress, setQualityProgress] = useState<string[]>([]);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [videoEditForm, setVideoEditForm] = useState<VideoEditFormState>(() => createEmptyVideoEditForm());
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  function refreshLibrary(): Promise<void> {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    let request: Promise<void>;
    request = (async () => {
      setLoading(true);
      setError(null);
      try {
        const [videoData, qualityData] = await Promise.all([listCommerceVideoAssets(), listQualityVideoAssets()]);
        setQualityVideos(qualityData.videos ?? []);
        setVideos((videoData.videos ?? []).filter((video) => !isQualityVideo(video)));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })().finally(() => {
      if (refreshPromiseRef.current === request) refreshPromiseRef.current = null;
    });
    refreshPromiseRef.current = request;
    return request;
  }

  useEffect(() => {
    void refreshLibrary();
  }, []);

  useEffect(() => {
    setPendingApproval(null);
  }, [tab]);

  const videoCount = videos.length;
  const qualityVideoCount = qualityVideos.length;
  const safeQualityForm = normalizeQualityVideoForm(qualityForm);
  const searchInput = query.trim();
  const searchQuery = searchInput.toLowerCase();

  useEffect(() => {
    if (!searchInput) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(() => {
      setSearchLoading(true);
      Promise.all([listCommerceVideoAssets(searchInput), listQualityVideoAssets(searchInput)])
        .then(([videoData, qualityData]) => {
          if (cancelled) return;
          setSearchResults({
            query: searchInput,
            videos: (videoData.videos ?? []).filter((video) => !isQualityVideo(video)),
            qualityVideos: qualityData.videos ?? []
          });
        })
        .catch(() => {
          if (cancelled) return;
          setSearchResults(null);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchInput, videoCount, qualityVideoCount]);

  const activeSearchResults = searchResults?.query === searchInput ? searchResults : null;
  const filteredVideos = useMemo(
    () => activeSearchResults?.videos ?? videos.filter((video) => matchesVideo(video, searchQuery)),
    [activeSearchResults, videos, searchQuery]
  );
  const filteredQualityVideos = useMemo(
    () => activeSearchResults?.qualityVideos ?? qualityVideos.filter((video) => matchesVideo(video, searchQuery)),
    [activeSearchResults, qualityVideos, searchQuery]
  );
  const allAssets = useMemo(() => [...videos, ...qualityVideos], [videos, qualityVideos]);
  const needsConfigCount = allAssets.filter(
    (asset) => asset.status === "needs_embedding_config" || asset.status === "needs_model"
  ).length;
  const processingCount = allAssets.filter((asset) => asset.status === "processing").length;
  const structuredVideoCount = videos.filter(hasVideoStructure).length + qualityVideos.filter(hasVideoStructure).length;
  const structuredCount = structuredVideoCount;
  const vectorReadyCount = videos.filter(hasVideoEmbedding).length + qualityVideos.filter(hasVideoEmbedding).length;
  const activeCount = tab === "commerce-videos" ? filteredVideos.length : filteredQualityVideos.length;
  const activeTotal = tab === "commerce-videos" ? videoCount : qualityVideoCount;
  const previewVideo =
    previewTarget?.kind === "video"
      ? [...videos, ...qualityVideos].find((video) => video.id === previewTarget.id)
      : null;
  function updateQualityForm(patch: Partial<QualityVideoFormState>) {
    setQualityForm((current) => ({
      ...normalizeQualityVideoForm(current),
      ...patch
    }));
  }

  function startVideoEdit(video: CommerceVideoAsset) {
    setPreviewTarget(null);
    setEditingVideoId(video.id);
    setVideoEditForm(videoToEditForm(video));
    setPendingApproval(null);
  }

  function cancelVideoEdit() {
    setEditingVideoId(null);
    setVideoEditForm(createEmptyVideoEditForm());
    setPendingApproval(null);
  }

  function updateVideoEditForm(patch: Partial<VideoEditFormState>) {
    setVideoEditForm((current) => ({ ...current, ...patch }));
    setPendingApproval(null);
  }

  function findVideoAsset(id: string): CommerceVideoAsset | QualityVideoAsset | undefined {
    return videos.find((video) => video.id === id) ?? qualityVideos.find((video) => video.id === id);
  }

  function mergeVideoAssetDetails(video: CommerceVideoAsset | QualityVideoAsset) {
    if (isQualityVideo(video)) {
      setQualityVideos((current) => current.map((item) => (item.id === video.id ? video : item)));
      setSearchResults((current) =>
        current
          ? {
              ...current,
              qualityVideos: current.qualityVideos.map((item) => (item.id === video.id ? video : item))
            }
          : current
      );
      return;
    }
    setVideos((current) => current.map((item) => (item.id === video.id ? video : item)));
    setSearchResults((current) =>
      current
        ? {
            ...current,
            videos: current.videos.map((item) => (item.id === video.id ? video : item))
          }
        : current
    );
  }

  async function openVideoPreview(video: CommerceVideoAsset) {
    if (!video.file?.path) return;
    setPendingApproval(null);
    setPreviewTarget({ kind: "video", id: video.id });
    if (videoDetails[video.id] === undefined) {
      await loadVideoPreviewSlices(video.id);
    }
  }

  async function submitUpload() {
    if (!uploadFile) return;
    setBusy("video-upload");
    setError(null);
    setVideoImportJob(null);
    setVideoImportProgress([]);
    try {
      const data = await uploadCommerceVideoAsset(uploadFile, uploadTitle);
      setVideoImportJob(data.job);
      setVideoImportProgress(data.job.progress ?? []);
      const finalJob = await waitAssetLibraryJob(data.job, 15 * 60_000, (job, progress) => {
        setVideoImportJob(job);
        setVideoImportProgress((current) => [...current, ...progress].slice(-240));
      });
      setVideoImportJob(finalJob);
      setVideoImportProgress(finalJob.progress ?? []);
      setUploadTitle("");
      setUploadFile(null);
      setTab("commerce-videos");
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitCrawler() {
    if (!crawlerUrl.trim()) return;
    setBusy("crawler-import");
    setError(null);
    setVideoImportJob(null);
    setVideoImportProgress([]);
    try {
      const data = await importCrawlerCommerceVideo({
        connectorId: crawlerConnector,
        url: crawlerUrl.trim(),
        title: crawlerTitle.trim() || undefined
      });
      const importProgress = data.importJob?.progress ?? [];
      setVideoImportJob(data.job);
      setVideoImportProgress([...(importProgress.length > 0 ? importProgress : []), ...(data.job.progress ?? [])]);
      const finalJob = await waitAssetLibraryJob(data.job, 15 * 60_000, (job, progress) => {
        setVideoImportJob(job);
        setVideoImportProgress((current) => [...current, ...progress].slice(-240));
      });
      setVideoImportJob(finalJob);
      setVideoImportProgress(finalJob.progress ?? []);
      setCrawlerUrl("");
      setCrawlerTitle("");
      setTab("commerce-videos");
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitQualityReference() {
    const form = normalizeQualityVideoForm(qualityForm);
    if (!form.title.trim() || !form.sourceName.trim() || (!form.sourceUrl.trim() && !form.sourceVideoId.trim())) return;
    setBusy("quality-reference");
    setError(null);
    setQualityJob(null);
    setQualityProgress([]);
    try {
      await createQualityVideoAsset({
        title: form.title.trim(),
        sourceName: form.sourceName.trim(),
        sourceUrl: form.sourceUrl.trim() || undefined,
        sourceVideoId: form.sourceVideoId.trim() || undefined,
        category: form.category.trim() || undefined,
        keyword: form.keyword.trim() || undefined,
        video: { summary: form.summary.trim() },
        report: {
          hookMethods: splitList(form.hookMethods),
          sellingPoints: splitList(form.sellingPoints),
          storyboard: splitList(form.storyboard),
          styleTags: splitList(form.styleTags),
          notes: form.summary.trim()
        },
        methodology: {
          hooks: splitList(form.hookMethods),
          structure: splitList(form.storyboard),
          sellingTriggers: splitList(form.sellingPoints),
          styleTags: splitList(form.styleTags)
        }
      });
      setQualityForm(createEmptyQualityVideoForm());
      setTab("quality-videos");
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitQualitySearchImport() {
    const form = normalizeQualityVideoForm(qualityForm);
    const queryText = form.searchQuery.trim() || form.keyword.trim() || form.category.trim();
    if (!queryText) return;
    setBusy("quality-search");
    setError(null);
    setQualityJob(null);
    setQualityProgress([]);
    try {
      const data = await importQualityVideoSearch({
        connectorId: form.sourceName.trim() || "bilibili",
        sourceName: form.sourceName.trim() || "bilibili",
        query: queryText,
        category: form.category.trim() || undefined,
        keyword: form.keyword.trim() || undefined,
        limit: 12,
        sort: "hot"
      });
      setQualityJob(data.job);
      setQualityProgress(data.job.progress ?? []);
      setTab("quality-videos");
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitQualityUpload() {
    const form = normalizeQualityVideoForm(qualityForm);
    if (!qualityUploadFile) return;
    setBusy("quality-upload");
    setError(null);
    setQualityJob(null);
    setQualityProgress([]);
    try {
      const data = await uploadQualityVideoAsset(qualityUploadFile, {
        title: form.title.trim() || undefined,
        sourceName: form.sourceName.trim() || "owned-upload",
        category: form.category.trim() || undefined,
        keyword: form.keyword.trim() || undefined
      });
      setQualityJob(data.job);
      setQualityProgress(data.job.progress ?? []);
      const finalJob = await waitAssetLibraryJob(data.job, 15 * 60_000, (job, progress) => {
        setQualityJob(job);
        setQualityProgress((current) => [...current, ...progress].slice(-240));
      });
      setQualityJob(finalJob);
      setQualityProgress(finalJob.progress ?? []);
      setQualityUploadFile(null);
      setQualityForm(createEmptyQualityVideoForm());
      setTab("quality-videos");
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function processVideo(id: string) {
    setBusy(`video-${id}`);
    setError(null);
    try {
      const current = findVideoAsset(id);
      if (!current) {
        setError("没有找到视频素材。请刷新后重试。");
        return;
      }
      const data = isQualityVideo(current) ? await processQualityVideoAsset(id) : await processCommerceVideoAsset(id);
      await waitAssetLibraryJob(data.job);
      await refreshVideoDetails(id);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function embedVideo(id: string) {
    setBusy(`video-embed-${id}`);
    setError(null);
    try {
      const current = findVideoAsset(id);
      if (!current) {
        setError("没有找到视频素材。请刷新后重试。");
        return;
      }
      const data = isQualityVideo(current)
        ? await embedQualityVideoAsset(id, { includeSlices: true })
        : await embedCommerceVideoAsset(id, { includeSlices: true });
      await waitAssetLibraryJob(data.job);
      await refreshVideoDetails(id);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveVideoEdit(id: string) {
    if (!videoEditForm.title.trim()) return;
    setBusy(`video-update-${id}`);
    setError(null);
    try {
      const current = findVideoAsset(id);
      if (!current) {
        setError("没有找到视频素材。请刷新后重试。");
        return;
      }
      const update = isQualityVideo(current) ? updateQualityVideoAsset : updateCommerceVideoAsset;
      await update(id, {
        title: videoEditForm.title.trim(),
        sourceUrl: videoEditForm.sourceUrl.trim(),
        sourceVideoId: videoEditForm.sourceVideoId.trim(),
        product: {
          subject: videoEditForm.subject.trim(),
          category: videoEditForm.category.trim()
        },
        video: {
          summary: videoEditForm.summary.trim()
        },
        methodology: {
          hooks: splitList(videoEditForm.hooks),
          structure: splitList(videoEditForm.structure),
          sellingTriggers: splitList(videoEditForm.sellingTriggers),
          styleTags: splitList(videoEditForm.styleTags)
        }
      });
      cancelVideoEdit();
      await refreshVideoDetails(id).catch(() => undefined);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeVideo(id: string) {
    setBusy(`video-delete-${id}`);
    setError(null);
    try {
      const current = findVideoAsset(id);
      if (!current) {
        setError("没有找到视频素材。请刷新后重试。");
        return;
      }
      if (isQualityVideo(current)) await deleteQualityVideoAsset(id);
      else await deleteCommerceVideoAsset(id);
      if (editingVideoId === id) cancelVideoEdit();
      setVideoDetails((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setPendingApproval(null);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function sliceVideo(id: string) {
    setBusy(`video-slice-${id}`);
    setError(null);
    try {
      const current = findVideoAsset(id);
      if (!current) {
        setError("没有找到视频素材。请刷新后重试。");
        return;
      }
      if (isQualityVideo(current)) {
        if (!current.file?.path) {
          setError("优质视频库的公开视频只保存结构化报告；上传自有视频后才能做本地切片。");
          return;
        }
        const data = await processQualityVideoAsset(id);
        await waitAssetLibraryJob(data.job);
        await refreshVideoDetails(id);
        await refreshLibrary();
        return;
      }
      const data = await sliceCommerceVideoAsset(id);
      await waitAssetLibraryJob(data.job);
      await refreshVideoDetails(id);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function batchProcessVideos() {
    if (filteredVideos.length === 0) return;
    setBusy("video-batch");
    setError(null);
    setBatchJob(null);
    setBatchProgress([]);
    try {
      const data = await batchProcessCommerceVideoAssets({
        ids: filteredVideos.map((video) => video.id),
        includeEmbeddings: true
      });
      setBatchJob(data.job);
      setBatchProgress(data.job.progress ?? []);
      const finalJob = await waitAssetLibraryJob(data.job, 15 * 60_000, (job, progress) => {
        setBatchJob(job);
        setBatchProgress((current) => [...current, ...progress].slice(-240));
      });
      setBatchJob(finalJob);
      setBatchProgress(finalJob.progress ?? []);
      await refreshLibrary();
      await Promise.all(Object.keys(videoDetails).map((id) => refreshVideoDetails(id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function refreshVideoDetails(id: string) {
    const current = findVideoAsset(id);
    if (!current) return;
    const data = isQualityVideo(current) ? await getQualityVideoAsset(id) : await getCommerceVideoAsset(id);
    mergeVideoAssetDetails(data.video);
    setVideoDetails((current) => ({ ...current, [id]: data.slices ?? [] }));
  }

  async function loadVideoPreviewSlices(id: string) {
    setPreviewLoadingId(id);
    setError(null);
    try {
      await refreshVideoDetails(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function toggleVideoDetails(id: string) {
    if (videoDetails[id]) {
      setVideoDetails((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setBusy(`details-${id}`);
    setError(null);
    try {
      await refreshVideoDetails(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.shell} aria-label="本地全局素材库">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>素材库</p>
          <h1 className={styles.title}>素材库工作台</h1>
          <p className={styles.subtitle}>
            围绕“爆款参考视频 + 优质公开视频报告”组织资产，沉淀主体、卖点、切片、向量和可复用方法论，
            给剧本生成与一键成片提供可召回的素材上下文。
          </p>
          <div className={styles.workflowStrip} aria-label="素材库生产链路">
            {ASSET_LIBRARY_STEPS.map((step) => (
              <span key={step.label} className={styles.workflowStep}>
                <span className={styles.workflowIcon}>
                  <Icon name={step.icon} size={14} />
                </span>
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.body}</small>
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className={styles.heroActions}>
          {onOpenSettings ? (
            <Button variant="subtle" onClick={onOpenSettings}>
              <Icon name="settings" size={14} />
              素材库设置
            </Button>
          ) : null}
          <Button variant="subtle" onClick={() => void refreshLibrary()} disabled={loading}>
            <Icon name={loading ? "spinner" : "refresh"} size={14} />
            刷新
          </Button>
        </div>
        <div className={styles.stats} aria-label="素材库概览">
          <StatCard label="带货视频" value={videoCount} helper="Hook、结构、节奏和证据" />
          <StatCard label="优质视频" value={qualityVideoCount} helper="来源、Hook、分镜和风格" />
          <StatCard label="已结构化" value={structuredCount} helper={`${structuredVideoCount} 视频`} />
          <StatCard label="向量可召回" value={vectorReadyCount} helper="可用于检索与智能匹配" />
          <StatCard
            label="待配置"
            value={needsConfigCount}
            helper={processingCount > 0 ? `${processingCount} 个处理中` : "模型或向量化设置"}
            tone={needsConfigCount > 0 ? "warn" : "neutral"}
          />
        </div>
      </header>

      <div className={styles.controlBar}>
        <div className={styles.tabs} role="tablist" aria-label="素材库分区">
          <button
            type="button"
            className={`${styles.tab}${tab === "commerce-videos" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setTab("commerce-videos")}
            role="tab"
            aria-selected={tab === "commerce-videos"}
          >
            <Icon name="play" size={16} />
            <span>
              <strong>带货视频库</strong>
              <small>提炼爆款方法论</small>
            </span>
            <b>{videoCount}</b>
          </button>
          <button
            type="button"
            className={`${styles.tab}${tab === "quality-videos" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setTab("quality-videos")}
            role="tab"
            aria-selected={tab === "quality-videos"}
          >
            <Icon name="sparkles" size={16} />
            <span>
              <strong>优质视频库</strong>
              <small>只存结构化拆解</small>
            </span>
            <b>{qualityVideoCount}</b>
          </button>
        </div>
        <label className={styles.searchBox}>
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              tab === "quality-videos" ? "搜索来源、类目、关键词、Hook 或分镜" : "搜索视频标题、商品、类目或方法论"
            }
          />
        </label>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          <Icon name="alert-triangle" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className={styles.workspace}>
        {tab === "commerce-videos" ? (
          <>
            <aside className={styles.intakePanel}>
              <PanelHeader
                eyebrow="Video Intake"
                title="导入带货视频"
                body="上传自有视频或下载公开参考，入库后自动探测时长、切片、理解镜头并生成可复用方法论。"
              />
              <ModeSummary
                items={[
                  { label: "本地", value: "商家自有素材" },
                  { label: "链接", value: "公开参考视频" },
                  { label: "批量", value: "筛选后统一解析" }
                ]}
              />
              <div className={styles.importMode} role="tablist" aria-label="导入方式">
                <button
                  type="button"
                  className={videoImportMode === "upload" ? styles.importModeActive : ""}
                  onClick={() => setVideoImportMode("upload")}
                  role="tab"
                  aria-selected={videoImportMode === "upload"}
                >
                  <Icon name="upload" size={14} />
                  本地上传
                </button>
                <button
                  type="button"
                  className={videoImportMode === "crawler" ? styles.importModeActive : ""}
                  onClick={() => setVideoImportMode("crawler")}
                  role="tab"
                  aria-selected={videoImportMode === "crawler"}
                >
                  <Icon name="download" size={14} />
                  爬虫 API
                </button>
              </div>

              {videoImportMode === "upload" ? (
                <div className={styles.form}>
                  <label className={styles.field}>
                    <span>视频标题</span>
                    <input
                      value={uploadTitle}
                      onChange={(event) => setUploadTitle(event.target.value)}
                      placeholder="不填则使用文件名"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>本地视频</span>
                    <label className={styles.videoDropZone}>
                      <input
                        className={styles.fileInput}
                        type="file"
                        accept="video/*"
                        onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                      />
                      <Icon name="upload" size={17} />
                      <strong>{uploadFile ? uploadFile.name : "选择一个带货视频文件"}</strong>
                      <small>MP4 / MOV / WebM 等浏览器支持的视频格式</small>
                    </label>
                  </label>
                  <Button
                    variant="primary"
                    onClick={() => void submitUpload()}
                    disabled={!uploadFile || busy === "video-upload"}
                  >
                    <Icon name={busy === "video-upload" ? "spinner" : "upload"} size={14} />
                    上传入库
                  </Button>
                </div>
              ) : (
                <div className={styles.form}>
                  <label className={styles.field}>
                    <span>平台</span>
                    <select
                      value={crawlerConnector}
                      onChange={(event) => setCrawlerConnector(event.target.value as CrawlerConnector)}
                    >
                      {Object.entries(CONNECTOR_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>视频 URL</span>
                    <input
                      value={crawlerUrl}
                      onChange={(event) => setCrawlerUrl(event.target.value)}
                      placeholder={crawlerConnector === "douyin" ? "https://v.douyin.com/..." : "https://..."}
                    />
                    {crawlerConnector === "douyin" ? (
                      <small>支持抖音公开视频分享链接；不会登录抓取、去水印或绕过平台限制。</small>
                    ) : null}
                  </label>
                  <label className={styles.field}>
                    <span>标题</span>
                    <input
                      value={crawlerTitle}
                      onChange={(event) => setCrawlerTitle(event.target.value)}
                      placeholder="不填则由视频信息推断"
                    />
                  </label>
                  <Button
                    variant="primary"
                    onClick={() => void submitCrawler()}
                    disabled={!crawlerUrl.trim() || busy === "crawler-import"}
                  >
                    <Icon name={busy === "crawler-import" ? "spinner" : "download"} size={14} />
                    导入链接
                  </Button>
                </div>
              )}
              {videoImportJob ? (
                <BatchProgressPanel
                  job={videoImportJob}
                  progress={videoImportProgress}
                  title="视频入库进度"
                  body="导入、探测、切片、理解和向量化会连续执行"
                />
              ) : null}
            </aside>
            <LibraryPane
              icon="play"
              title="带货视频库"
              subtitle="用于拆解爆款结构、话术套路和成交诱因"
              count={activeCount}
              total={activeTotal}
              loading={loading}
              actions={
                <Button
                  variant="subtle"
                  onClick={() => void batchProcessVideos()}
                  disabled={filteredVideos.length === 0 || busy === "video-batch"}
                >
                  <Icon name={busy === "video-batch" ? "spinner" : "sparkles"} size={14} />
                  批量解析
                </Button>
              }
              beforeList={batchJob ? <BatchProgressPanel job={batchJob} progress={batchProgress} /> : null}
              emptyLabel={
                searchQuery && searchLoading && !activeSearchResults
                  ? "正在检索带货视频"
                  : searchQuery
                    ? "没有匹配的带货视频"
                    : "暂无带货视频"
              }
              emptyHint={
                searchQuery && searchLoading && !activeSearchResults
                  ? "请稍候。"
                  : searchQuery
                    ? "换个标题、平台或方法论关键词试试。"
                    : "从左侧上传视频，或导入一个爬虫链接。"
              }
            >
              {filteredVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  slices={videoDetails[video.id]}
                  busy={busy}
                  isEditing={editingVideoId === video.id}
                  editForm={videoEditForm}
                  pendingApproval={pendingApproval}
                  onStartEdit={() => startVideoEdit(video)}
                  onChangeEdit={updateVideoEditForm}
                  onCancelEdit={cancelVideoEdit}
                  onRequestSave={() => setPendingApproval({ kind: "save-video", id: video.id })}
                  onConfirmSave={() => void saveVideoEdit(video.id)}
                  onRequestDelete={() => setPendingApproval({ kind: "delete-video", id: video.id })}
                  onConfirmDelete={() => void removeVideo(video.id)}
                  onCancelApproval={() => setPendingApproval(null)}
                  onPreview={() => void openVideoPreview(video)}
                  onDetails={() => void toggleVideoDetails(video.id)}
                  onSlice={() => void sliceVideo(video.id)}
                  onProcess={() => void processVideo(video.id)}
                  onEmbed={() => void embedVideo(video.id)}
                />
              ))}
            </LibraryPane>
          </>
        ) : (
          <>
            <aside className={styles.intakePanel}>
              <PanelHeader
                eyebrow="Quality Videos"
                title="优质视频库"
                body="按来源、类目和关键词沉淀爆款视频拆解。公开视频只保存结构化报告和来源声明；自有视频可上传后做本地拆解。"
              />
              <ModeSummary
                items={[
                  { label: "公开视频", value: "只存报告和来源" },
                  { label: "检索", value: "连接器返回候选" },
                  { label: "自有视频", value: "上传后切片拆解" }
                ]}
              />
              <div className={styles.importMode} role="tablist" aria-label="优质视频入库方式">
                <button
                  type="button"
                  className={qualityImportMode === "reference" ? styles.importModeActive : ""}
                  onClick={() => setQualityImportMode("reference")}
                  role="tab"
                  aria-selected={qualityImportMode === "reference"}
                >
                  <Icon name="edit" size={14} />
                  结构化引用
                </button>
                <button
                  type="button"
                  className={qualityImportMode === "search" ? styles.importModeActive : ""}
                  onClick={() => setQualityImportMode("search")}
                  role="tab"
                  aria-selected={qualityImportMode === "search"}
                >
                  <Icon name="search" size={14} />
                  检索保存
                </button>
                <button
                  type="button"
                  className={qualityImportMode === "upload" ? styles.importModeActive : ""}
                  onClick={() => setQualityImportMode("upload")}
                  role="tab"
                  aria-selected={qualityImportMode === "upload"}
                >
                  <Icon name="upload" size={14} />
                  自有上传
                </button>
              </div>

              <div className={styles.form}>
                {qualityImportMode === "search" ? (
                  <>
                    <div className={styles.fieldRow}>
                      <label className={styles.field}>
                        <span>来源/连接器</span>
                        <input
                          value={safeQualityForm.sourceName}
                          onChange={(event) => updateQualityForm({ sourceName: event.target.value })}
                          placeholder="bilibili / facebook / instagram"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>类目</span>
                        <input
                          value={safeQualityForm.category}
                          onChange={(event) => updateQualityForm({ category: event.target.value })}
                          placeholder="美妆 / 家居 / 服饰"
                        />
                      </label>
                    </div>
                    <label className={styles.field}>
                      <span>关键词</span>
                      <input
                        value={safeQualityForm.searchQuery}
                        onChange={(event) => updateQualityForm({ searchQuery: event.target.value })}
                        placeholder="便携榨汁杯 爆款 带货"
                      />
                    </label>
                    <Button
                      variant="primary"
                      onClick={() => void submitQualitySearchImport()}
                      disabled={
                        !(
                          safeQualityForm.searchQuery.trim() ||
                          safeQualityForm.keyword.trim() ||
                          safeQualityForm.category.trim()
                        ) || busy === "quality-search"
                      }
                    >
                      <Icon name={busy === "quality-search" ? "spinner" : "search"} size={14} />
                      检索并保存报告
                    </Button>
                  </>
                ) : qualityImportMode === "upload" ? (
                  <>
                    <label className={styles.field}>
                      <span>视频标题</span>
                      <input
                        value={safeQualityForm.title}
                        onChange={(event) => updateQualityForm({ title: event.target.value })}
                        placeholder="不填则使用文件名"
                      />
                    </label>
                    <div className={styles.fieldRow}>
                      <label className={styles.field}>
                        <span>来源声明</span>
                        <input
                          value={safeQualityForm.sourceName}
                          onChange={(event) => updateQualityForm({ sourceName: event.target.value })}
                          placeholder="owned-upload"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>类目/关键词</span>
                        <input
                          value={safeQualityForm.keyword}
                          onChange={(event) => updateQualityForm({ keyword: event.target.value })}
                          placeholder="商品或打法关键词"
                        />
                      </label>
                    </div>
                    <label className={styles.field}>
                      <span>自有视频</span>
                      <label className={styles.videoDropZone}>
                        <input
                          className={styles.fileInput}
                          type="file"
                          accept="video/*"
                          onChange={(event) => setQualityUploadFile(event.target.files?.[0] ?? null)}
                        />
                        <Icon name="upload" size={17} />
                        <strong>{qualityUploadFile ? qualityUploadFile.name : "选择一个自有视频文件"}</strong>
                        <small>上传后使用本地素材做拆解，不用于公开视频复刻</small>
                      </label>
                    </label>
                    <Button
                      variant="primary"
                      onClick={() => void submitQualityUpload()}
                      disabled={!qualityUploadFile || busy === "quality-upload"}
                    >
                      <Icon name={busy === "quality-upload" ? "spinner" : "upload"} size={14} />
                      上传并拆解
                    </Button>
                  </>
                ) : (
                  <>
                    <label className={styles.field}>
                      <span>标题</span>
                      <input
                        value={safeQualityForm.title}
                        onChange={(event) => updateQualityForm({ title: event.target.value })}
                        placeholder="公开视频标题或内部命名"
                      />
                    </label>
                    <div className={styles.fieldRow}>
                      <label className={styles.field}>
                        <span>素材来源</span>
                        <input
                          value={safeQualityForm.sourceName}
                          onChange={(event) => updateQualityForm({ sourceName: event.target.value })}
                          placeholder="facebook / instagram / tiktok"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>类目</span>
                        <input
                          value={safeQualityForm.category}
                          onChange={(event) => updateQualityForm({ category: event.target.value })}
                          placeholder="类目"
                        />
                      </label>
                    </div>
                    <label className={styles.field}>
                      <span>公开视频 URL</span>
                      <input
                        value={safeQualityForm.sourceUrl}
                        onChange={(event) => updateQualityForm({ sourceUrl: event.target.value })}
                        placeholder="https://..."
                      />
                    </label>
                    <label className={styles.field}>
                      <span>平台视频 ID</span>
                      <input
                        value={safeQualityForm.sourceVideoId}
                        onChange={(event) => updateQualityForm({ sourceVideoId: event.target.value })}
                        placeholder="可选；无 URL 时必填"
                      />
                    </label>
                    <label className={styles.field}>
                      <span>摘要/限制</span>
                      <textarea
                        value={safeQualityForm.summary}
                        onChange={(event) => updateQualityForm({ summary: event.target.value })}
                        placeholder="说明该报告来自公开信息、人工观察或授权数据"
                      />
                    </label>
                    <div className={styles.fieldRow}>
                      <label className={styles.field}>
                        <span>Hook 手法</span>
                        <textarea
                          value={safeQualityForm.hookMethods}
                          onChange={(event) => updateQualityForm({ hookMethods: event.target.value })}
                          placeholder="一行一个 Hook"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>卖点</span>
                        <textarea
                          value={safeQualityForm.sellingPoints}
                          onChange={(event) => updateQualityForm({ sellingPoints: event.target.value })}
                          placeholder="一行一个卖点"
                        />
                      </label>
                    </div>
                    <div className={styles.fieldRow}>
                      <label className={styles.field}>
                        <span>分镜</span>
                        <textarea
                          value={safeQualityForm.storyboard}
                          onChange={(event) => updateQualityForm({ storyboard: event.target.value })}
                          placeholder="首帧/演示/证明/CTA"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>风格</span>
                        <textarea
                          value={safeQualityForm.styleTags}
                          onChange={(event) => updateQualityForm({ styleTags: event.target.value })}
                          placeholder="口播、测评、剧情、直播切片"
                        />
                      </label>
                    </div>
                    <Button
                      variant="primary"
                      onClick={() => void submitQualityReference()}
                      disabled={
                        !safeQualityForm.title.trim() ||
                        !safeQualityForm.sourceName.trim() ||
                        (!safeQualityForm.sourceUrl.trim() && !safeQualityForm.sourceVideoId.trim()) ||
                        busy === "quality-reference"
                      }
                    >
                      <Icon name={busy === "quality-reference" ? "spinner" : "plus"} size={14} />
                      保存结构化报告
                    </Button>
                  </>
                )}
                {qualityJob ? (
                  <BatchProgressPanel
                    job={qualityJob}
                    progress={qualityProgress}
                    title="优质视频作业进度"
                    body="来源声明、结构化报告、自有视频拆解和向量化按任务执行"
                  />
                ) : null}
              </div>
            </aside>
            <LibraryPane
              icon="play"
              title="优质视频库"
              subtitle="按类目/关键词检索爆款来源，只沉淀可复用结构化报告"
              count={activeCount}
              total={activeTotal}
              loading={loading}
              emptyLabel={
                searchQuery && searchLoading && !activeSearchResults
                  ? "正在检索优质视频"
                  : searchQuery
                    ? "没有匹配的优质视频"
                    : "暂无优质视频报告"
              }
              emptyHint={
                searchQuery && searchLoading && !activeSearchResults
                  ? "请稍候。"
                  : searchQuery
                    ? "换个来源、类目、关键词或 Hook 试试。"
                    : "从左侧保存一个公开视频结构化报告，或上传自有视频做拆解。"
              }
            >
              {filteredQualityVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  slices={videoDetails[video.id]}
                  busy={busy}
                  isEditing={editingVideoId === video.id}
                  editForm={videoEditForm}
                  pendingApproval={pendingApproval}
                  onStartEdit={() => startVideoEdit(video)}
                  onChangeEdit={updateVideoEditForm}
                  onCancelEdit={cancelVideoEdit}
                  onRequestSave={() => setPendingApproval({ kind: "save-video", id: video.id })}
                  onConfirmSave={() => void saveVideoEdit(video.id)}
                  onRequestDelete={() => setPendingApproval({ kind: "delete-video", id: video.id })}
                  onConfirmDelete={() => void removeVideo(video.id)}
                  onCancelApproval={() => setPendingApproval(null)}
                  onPreview={() => void openVideoPreview(video)}
                  onDetails={() => void toggleVideoDetails(video.id)}
                  onSlice={() => void sliceVideo(video.id)}
                  onProcess={() => void processVideo(video.id)}
                  onEmbed={() => void embedVideo(video.id)}
                />
              ))}
            </LibraryPane>
          </>
        )}
      </div>

      {previewTarget?.kind === "video" && previewVideo ? (
        <VideoPreviewDialog
          video={previewVideo}
          slices={videoDetails[previewVideo.id]}
          loadingSlices={previewLoadingId === previewVideo.id}
          onLoadSlices={() => void loadVideoPreviewSlices(previewVideo.id)}
          onClose={() => setPreviewTarget(null)}
        />
      ) : null}
    </section>
  );
}

function StatCard({
  label,
  value,
  helper,
  tone = "neutral"
}: {
  label: string;
  value: number;
  helper: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className={`${styles.statCard}${tone === "warn" ? ` ${styles.statCardWarn}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function PanelHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className={styles.panelHeader}>
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function ModeSummary({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className={styles.modeSummary} aria-label="入库模式概览">
      {items.map((item) => (
        <span key={item.label}>
          <strong>{item.label}</strong>
          <small>{item.value}</small>
        </span>
      ))}
    </div>
  );
}

function LibraryPane({
  icon,
  title,
  subtitle,
  count,
  total,
  loading,
  actions,
  beforeList,
  emptyLabel,
  emptyHint,
  children
}: {
  icon: "folder" | "play";
  title: string;
  subtitle: string;
  count: number;
  total: number;
  loading: boolean;
  actions?: ReactNode;
  beforeList?: ReactNode;
  emptyLabel: string;
  emptyHint: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.libraryPane}>
      <div className={styles.libraryHead}>
        <div className={styles.libraryTitle}>
          <span className={styles.libraryIcon}>
            <Icon name={icon} size={16} />
          </span>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className={styles.libraryActions}>
          {actions}
          <span className={styles.resultCount}>
            {count}/{total}
          </span>
        </div>
      </div>
      {beforeList}
      {loading ? (
        <EmptyState icon="spinner" title="正在同步素材库" hint="读取本地资产和最新处理状态。" />
      ) : count === 0 ? (
        <EmptyState icon="search" title={emptyLabel} hint={emptyHint} />
      ) : (
        <div className={styles.assetList}>{children}</div>
      )}
    </section>
  );
}

function ReadinessStrip({
  items
}: {
  items: Array<{ label: string; value: string; state: "ready" | "pending" | "warn" }>;
}) {
  return (
    <div className={styles.readinessStrip} aria-label="素材结构化状态">
      {items.map((item) => (
        <span
          key={item.label}
          className={`${styles.readinessItem} ${
            item.state === "ready"
              ? styles.readinessReady
              : item.state === "warn"
                ? styles.readinessWarn
                : styles.readinessPending
          }`}
        >
          <Icon
            name={item.state === "ready" ? "check" : item.state === "warn" ? "alert-triangle" : "minus"}
            size={12}
          />
          <strong>{item.label}</strong>
          <small>{item.value}</small>
        </span>
      ))}
    </div>
  );
}

function BatchProgressPanel({
  job,
  progress,
  title = "批量解析进度",
  body = "下载/探测/切片/向量化按队列逐条执行"
}: {
  job: AssetLibraryJob;
  progress: string[];
  title?: string;
  body?: string;
}) {
  const visible = progress.slice(-80);
  return (
    <div className={styles.batchProgress}>
      <div className={styles.batchProgressHead}>
        <div>
          <strong>{title}</strong>
          <span>{body}</span>
        </div>
        <StatusPill status={job.status === "failed" ? "failed" : job.status === "done" ? "ready" : "processing"} />
      </div>
      <div className={styles.progressLog} role="log" aria-live="polite">
        {visible.length === 0 ? (
          <code>等待任务开始...</code>
        ) : (
          visible.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)
        )}
      </div>
      {job.error?.message ? <p className={styles.batchError}>{job.error.message}</p> : null}
    </div>
  );
}

function VideoCard({
  video,
  slices,
  busy,
  isEditing,
  editForm,
  pendingApproval,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onRequestSave,
  onConfirmSave,
  onRequestDelete,
  onConfirmDelete,
  onCancelApproval,
  onPreview,
  onDetails,
  onSlice,
  onProcess,
  onEmbed
}: {
  video: CommerceVideoAsset;
  slices?: CommerceVideoSlice[];
  busy: string | null;
  isEditing: boolean;
  editForm: VideoEditFormState;
  pendingApproval: PendingApproval | null;
  onStartEdit: () => void;
  onChangeEdit: (patch: Partial<VideoEditFormState>) => void;
  onCancelEdit: () => void;
  onRequestSave: () => void;
  onConfirmSave: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelApproval: () => void;
  onPreview: () => void;
  onDetails: () => void;
  onSlice: () => void;
  onProcess: () => void;
  onEmbed: () => void;
}) {
  const tags = [
    ...video.methodology.hooks,
    ...video.methodology.structure,
    ...video.methodology.sellingTriggers,
    ...video.methodology.styleTags
  ].slice(0, 4);
  const hasLoadedSlices = slices !== undefined;
  const hasSlices = (slices?.length ?? 0) > 0;
  const previewUrl = video.file?.path ? assetFileUrl(video.file.path) : null;
  const quality = isQualityVideo(video);
  const sourceDeclaration =
    video.metadata?.sourceDeclaration && typeof video.metadata.sourceDeclaration === "object"
      ? (video.metadata.sourceDeclaration as Record<string, unknown>)
      : {};
  const sourceName = stringOrUndefined(sourceDeclaration.sourceName) || video.sourceConnectorId || "本地";
  const sliceBusy = busy === `video-slice-${video.id}` || busy === `details-${video.id}`;
  const structured = hasVideoStructure(video);
  const embedded = hasVideoEmbedding(video);
  const saveApproval = pendingApproval?.kind === "save-video" && pendingApproval.id === video.id;
  const deleteApproval = pendingApproval?.kind === "delete-video" && pendingApproval.id === video.id;
  const updateBusy = busy === `video-update-${video.id}`;
  const deleteBusy = busy === `video-delete-${video.id}`;
  return (
    <article className={styles.assetCard}>
      <button
        type="button"
        className={styles.assetMedia}
        onClick={onPreview}
        disabled={!previewUrl}
        aria-label={previewUrl ? `预览 ${video.title}` : `${video.title} 暂无本地视频预览`}
      >
        {previewUrl ? (
          <span className={styles.mediaPlaceholder}>
            <Icon name="play" size={18} />
            预览
          </span>
        ) : (
          <span className={styles.mediaPlaceholder}>
            <Icon name={quality ? "sparkles" : "play"} size={18} />
            {quality ? "报告" : "待下载"}
          </span>
        )}
      </button>
      <div className={styles.cardMain}>
        <div className={styles.cardTopline}>
          <StatusPill status={video.status} />
          <span>{SOURCE_LABELS[video.sourceKind]}</span>
          <span>{sourceName}</span>
          <span>{video.video.durationMs ? formatMs(video.video.durationMs) : "待识别时长"}</span>
        </div>
        <h3>{video.title}</h3>
        <div className={styles.assetMeta}>
          <span>{video.product.category || "未识别类目"}</span>
          <span>{video.product.subject || "未识别商品"}</span>
        </div>
        <ReadinessStrip
          items={[
            {
              label: "视频",
              value: previewUrl ? "已入库" : quality ? "公开视频报告" : "待下载",
              state: previewUrl || quality ? "ready" : video.status === "needs_video_file" ? "warn" : "pending"
            },
            {
              label: "理解",
              value: structured ? "有摘要" : "待处理",
              state: structured ? "ready" : video.status === "failed" ? "warn" : "pending"
            },
            {
              label: "切片",
              value: hasLoadedSlices ? `${slices?.length ?? 0} 段` : "按需加载",
              state: hasLoadedSlices && hasSlices ? "ready" : "pending"
            },
            {
              label: "向量",
              value: embedded ? "可召回" : video.status === "needs_embedding_config" ? "待配置" : "待生成",
              state: embedded ? "ready" : video.status === "needs_embedding_config" ? "warn" : "pending"
            }
          ]}
        />
        <p className={styles.summary}>
          {video.video.summary || "等待处理提炼整体摘要、爆款结构、镜头节奏和成交诱因。"}
        </p>
        {tags.length > 0 ? (
          <div className={styles.chipRow}>
            {tags.map((tag, index) => (
              <span key={displayValueKey(`video-${video.id}-tag`, tag, index)} className={styles.chip}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {isEditing ? <VideoEditFields form={editForm} disabled={updateBusy} onChange={onChangeEdit} /> : null}
        {saveApproval ? (
          <ApprovalPanel
            title="确认保存视频素材修改"
            body="保存后会覆盖该视频的商品信息、来源、摘要和方法论字段，后续复盘与脚本参考会使用新内容。"
            confirmLabel="确认保存"
            disabled={updateBusy || !editForm.title.trim()}
            onConfirm={onConfirmSave}
            onCancel={onCancelApproval}
          />
        ) : null}
        {deleteApproval ? (
          <ApprovalPanel
            tone="danger"
            title={quality ? "确认删除优质视频报告" : "确认删除带货视频素材"}
            body={
              quality
                ? "删除会移除该优质视频的结构化报告、关联处理任务和自有上传文件。这个操作不能在素材库中撤销。"
                : "删除会移除该视频素材、切片、处理任务和本地媒体文件。这个操作不能在素材库中撤销。"
            }
            confirmLabel="确认删除"
            disabled={deleteBusy}
            onConfirm={onConfirmDelete}
            onCancel={onCancelApproval}
          />
        ) : null}
        {slices ? (
          <div className={styles.sliceSection}>
            <div className={styles.sliceHeader}>
              <strong>切片特征</strong>
              <span>{slices.length} slices</span>
            </div>
            <div className={styles.sliceGrid}>
              {slices.length === 0 ? <div className={styles.slice}>暂无切片，先运行处理。</div> : null}
              {slices.map((slice, index) => (
                <div key={slice.id} className={styles.slice}>
                  <strong>#{index + 1}</strong>
                  <span>
                    {formatMs(slice.startMs)} - {formatMs(slice.endMs)}
                  </span>
                  <p>
                    {slice.features.scene || slice.features.hook || slice.features.sellingPoint || "待补充细粒度特征"}
                  </p>
                  <small>{slice.features.pace || slice.features.tags.slice(0, 2).join(" / ") || "steady"}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className={styles.cardActions}>
        <div className={styles.cardActionGroup} aria-label="查看和管理">
          <Button variant="subtle" onClick={onPreview} disabled={!previewUrl}>
            <Icon name="eye" size={14} />
            预览
          </Button>
          {isEditing ? (
            <>
              <Button variant="primary" onClick={onRequestSave} disabled={updateBusy || !editForm.title.trim()}>
                <Icon name={updateBusy ? "spinner" : "check"} size={14} />
                保存
              </Button>
              <Button variant="subtle" onClick={onCancelEdit} disabled={updateBusy}>
                <Icon name="close" size={14} />
                取消
              </Button>
            </>
          ) : (
            <Button variant="subtle" onClick={onStartEdit} disabled={Boolean(busy)}>
              <Icon name="edit" size={14} />
              编辑
            </Button>
          )}
          <Button
            variant="subtle"
            className={styles.dangerButton}
            onClick={onRequestDelete}
            disabled={deleteBusy || updateBusy}
          >
            <Icon name={deleteBusy ? "spinner" : "trash"} size={14} />
            删除
          </Button>
        </div>
        <div className={styles.cardActionGroup} aria-label="结构化处理">
          <Button
            variant="subtle"
            onClick={quality && !previewUrl ? onDetails : hasLoadedSlices && hasSlices ? onDetails : onSlice}
            disabled={sliceBusy}
          >
            <Icon
              name={
                sliceBusy
                  ? "spinner"
                  : quality && !previewUrl
                    ? "eye"
                    : hasLoadedSlices && hasSlices
                      ? "eye-off"
                      : "play"
              }
              size={14}
            />
            {hasLoadedSlices && hasSlices ? "收起" : quality && !previewUrl ? "报告" : "切片"}
          </Button>
          <Button variant="subtle" onClick={onProcess} disabled={busy === `video-${video.id}`}>
            <Icon name={busy === `video-${video.id}` ? "spinner" : "sparkles"} size={14} />
            处理
          </Button>
          <Button variant="subtle" onClick={onEmbed} disabled={busy === `video-embed-${video.id}`}>
            <Icon name={busy === `video-embed-${video.id}` ? "spinner" : "search"} size={14} />
            向量化
          </Button>
        </div>
      </div>
    </article>
  );
}

function VideoEditFields({
  form,
  disabled,
  onChange
}: {
  form: VideoEditFormState;
  disabled: boolean;
  onChange: (patch: Partial<VideoEditFormState>) => void;
}) {
  return (
    <div className={styles.editPanel}>
      <div className={styles.editGrid}>
        <label className={`${styles.field} ${styles.fullWidthField}`}>
          <span>标题</span>
          <input value={form.title} disabled={disabled} onChange={(event) => onChange({ title: event.target.value })} />
        </label>
        <label className={styles.field}>
          <span>主体</span>
          <input
            value={form.subject}
            disabled={disabled}
            onChange={(event) => onChange({ subject: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>类目</span>
          <input
            value={form.category}
            disabled={disabled}
            onChange={(event) => onChange({ category: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>视频 URL</span>
          <input
            value={form.sourceUrl}
            disabled={disabled}
            onChange={(event) => onChange({ sourceUrl: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>平台视频 ID</span>
          <input
            value={form.sourceVideoId}
            disabled={disabled}
            onChange={(event) => onChange({ sourceVideoId: event.target.value })}
          />
        </label>
        <label className={`${styles.field} ${styles.fullWidthField}`}>
          <span>摘要</span>
          <textarea
            value={form.summary}
            disabled={disabled}
            onChange={(event) => onChange({ summary: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>钩子</span>
          <textarea
            value={form.hooks}
            disabled={disabled}
            onChange={(event) => onChange({ hooks: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>结构</span>
          <textarea
            value={form.structure}
            disabled={disabled}
            onChange={(event) => onChange({ structure: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>成交诱因</span>
          <textarea
            value={form.sellingTriggers}
            disabled={disabled}
            onChange={(event) => onChange({ sellingTriggers: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>风格标签</span>
          <textarea
            value={form.styleTags}
            disabled={disabled}
            onChange={(event) => onChange({ styleTags: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function ApprovalPanel({
  tone = "neutral",
  title,
  body,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel
}: {
  tone?: "neutral" | "danger";
  title: string;
  body: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={`${styles.approvalPanel}${tone === "danger" ? ` ${styles.approvalDanger}` : ""}`}>
      <span className={styles.approvalIcon}>
        <Icon name="alert-triangle" size={15} />
      </span>
      <div className={styles.approvalCopy}>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <div className={styles.approvalActions}>
        <Button
          variant={tone === "danger" ? "subtle" : "primary"}
          className={tone === "danger" ? styles.confirmDangerButton : undefined}
          onClick={onConfirm}
          disabled={disabled}
        >
          <Icon name="check" size={14} />
          {confirmLabel}
        </Button>
        <Button variant="subtle" onClick={onCancel} disabled={disabled}>
          <Icon name="close" size={14} />
          取消
        </Button>
      </div>
    </div>
  );
}

function PreviewShell({
  title,
  eyebrow,
  onClose,
  children,
  details
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  details: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={styles.previewOverlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.previewDialog} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.previewHeader}>
          <div>
            <span>{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <Button variant="subtle" size="icon" onClick={onClose} aria-label="关闭预览">
            <Icon name="close" size={15} />
          </Button>
        </header>
        <div className={styles.previewBody}>
          {children}
          <aside className={styles.previewInfo}>{details}</aside>
        </div>
      </section>
    </div>
  );
}

function VideoPreviewDialog({
  video,
  slices,
  loadingSlices,
  onLoadSlices,
  onClose
}: {
  video: CommerceVideoAsset;
  slices?: CommerceVideoSlice[];
  loadingSlices: boolean;
  onLoadSlices: () => void;
  onClose: () => void;
}) {
  const metadata = video.metadata ?? {};
  const sourceDeclaration =
    metadata.sourceDeclaration && typeof metadata.sourceDeclaration === "object"
      ? (metadata.sourceDeclaration as Record<string, unknown>)
      : {};
  const report =
    metadata.qualityReport && typeof metadata.qualityReport === "object"
      ? (metadata.qualityReport as Record<string, unknown>)
      : {};
  const [activeClipPath, setActiveClipPath] = useState<string | null>(video.file?.path ?? null);

  useEffect(() => {
    setActiveClipPath(video.file?.path ?? null);
  }, [video.id, video.file?.path]);

  const originalPosterPath = slices?.find((slice) => slice.thumbnail?.path)?.thumbnail?.path;
  const clips: PreviewClip[] = [
    ...(video.file?.path
      ? [{ id: "original", label: "原视频", path: video.file.path, thumbnailPath: originalPosterPath }]
      : []),
    ...(slices ?? [])
      .filter((slice) => slice.file?.path)
      .map((slice, index) => ({
        id: slice.id,
        label: `切片 ${index + 1}`,
        path: slice.file?.path ?? "",
        thumbnailPath: slice.thumbnail?.path,
        time: `${formatMs(slice.startMs)} - ${formatMs(slice.endMs)}`
      }))
  ];
  const activeClip = clips.find((clip) => clip.path === activeClipPath) ?? clips[0];
  const activeUrl = activeClip ? assetFileUrl(activeClip.path) : null;

  return (
    <PreviewShell
      title={video.title}
      eyebrow="带货视频预览"
      onClose={onClose}
      details={
        <>
          <PreviewMeta
            label="来源"
            value={`${SOURCE_LABELS[video.sourceKind]} / ${
              stringOrUndefined(sourceDeclaration.sourceName) || video.sourceConnectorId || "本地"
            }`}
          />
          <PreviewMeta label="类目" value={video.product.category || "未识别类目"} />
          <PreviewMeta label="主体" value={video.product.subject || "未识别商品"} />
          <PreviewMeta label="时长" value={video.video.durationMs ? formatMs(video.video.durationMs) : "待识别"} />
          {video.file ? <PreviewMeta label="文件" value={video.file.name || pathLeaf(video.file.path)} /> : null}
          <PreviewText title="视频摘要" value={video.video.summary || "等待处理提炼整体摘要。"} />
          <PreviewList title="钩子" values={video.methodology.hooks} />
          <PreviewList title="结构" values={video.methodology.structure} />
          <PreviewList title="成交诱因" values={video.methodology.sellingTriggers} />
          <PreviewList title="风格标签" values={video.methodology.styleTags} />
          {isQualityVideo(video) ? (
            <>
              <PreviewList title="Hook 手法" values={stringArray(report.hookMethods)} />
              <PreviewList title="拆解卖点" values={stringArray(report.sellingPoints)} />
              <PreviewList title="分镜报告" values={stringArray(report.storyboard)} />
              <PreviewText
                title="合规边界"
                value="公开视频只保存结构化分析结果和来源声明，不保存、复刻或混剪原视频。"
              />
            </>
          ) : null}
        </>
      }
    >
      <div className={styles.previewMain}>
        <div className={styles.previewStage}>
          {activeUrl ? (
            <video
              key={activeUrl}
              src={activeUrl}
              controls
              preload="metadata"
              playsInline
              poster={activeClip?.thumbnailPath ? assetFileUrl(activeClip.thumbnailPath) : undefined}
            />
          ) : (
            <div className={styles.previewEmpty}>
              <Icon name={isQualityVideo(video) ? "sparkles" : "play"} size={24} />
              {isQualityVideo(video) ? "公开视频仅保存结构化报告" : "暂无本地视频文件"}
            </div>
          )}
        </div>
        <div className={styles.clipStrip}>
          <div className={styles.clipStripHead}>
            <strong>片段</strong>
            {slices === undefined ? (
              <Button variant="subtle" onClick={onLoadSlices} disabled={loadingSlices}>
                <Icon name={loadingSlices ? "spinner" : "download"} size={13} />
                加载切片
              </Button>
            ) : (
              <span>{slices.length} 个切片</span>
            )}
          </div>
          {clips.length === 0 ? (
            <p className={styles.clipHint}>该素材还没有可播放文件。</p>
          ) : (
            <div className={styles.clipGrid}>
              {clips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className={`${styles.clipCard}${clip.path === activeClip?.path ? ` ${styles.clipCardActive}` : ""}`}
                  onClick={() => setActiveClipPath(clip.path)}
                >
                  <span className={styles.clipThumb}>
                    {clip.thumbnailPath ? (
                      <img src={assetFileUrl(clip.thumbnailPath)} alt={clip.label} loading="lazy" />
                    ) : (
                      <Icon name={clip.id === "original" ? "play" : "image"} size={16} />
                    )}
                  </span>
                  <span>
                    <strong>{clip.label}</strong>
                    <small>{clip.time ?? "完整视频"}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {slices?.length === 0 ? <p className={styles.clipHint}>暂无切片，先运行处理或切片。</p> : null}
        </div>
      </div>
    </PreviewShell>
  );
}

function PreviewMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.previewMeta}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreviewText({ title, value }: { title: string; value: string }) {
  return (
    <section className={styles.previewTextBlock}>
      <h3>{title}</h3>
      <p>{value}</p>
    </section>
  );
}

function PreviewList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <section className={styles.previewTextBlock}>
      <h3>{title}</h3>
      <div className={styles.previewChipRow}>
        {values.map((value, index) => (
          <span key={displayValueKey(title, value, index)}>{value}</span>
        ))}
      </div>
    </section>
  );
}

function displayValueKey(scope: string, value: string, index: number): string {
  return `${scope}:${index}:${value}`;
}

function StatusPill({ status }: { status: AssetLibraryStatus }) {
  return <span className={`${styles.statusPill} ${statusClass(status)}`}>{STATUS_LABELS[status]}</span>;
}

function EmptyState({ icon, title, hint }: { icon: "search" | "spinner"; title: string; hint: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={18} />
      </span>
      <strong>{title}</strong>
      <p>{hint}</p>
    </div>
  );
}

function matchesVideo(video: CommerceVideoAsset, query: string): boolean {
  if (!query) return true;
  const metadata = video.metadata ?? {};
  const sourceDeclaration =
    metadata.sourceDeclaration && typeof metadata.sourceDeclaration === "object"
      ? (metadata.sourceDeclaration as Record<string, unknown>)
      : {};
  const report =
    metadata.qualityReport && typeof metadata.qualityReport === "object"
      ? (metadata.qualityReport as Record<string, unknown>)
      : {};
  return matchesSearchableValues(
    [
      video.title,
      video.sourceKind,
      video.sourceConnectorId,
      video.sourceUrl,
      video.product.subject,
      video.product.category,
      video.video.summary,
      stringOrUndefined(sourceDeclaration.sourceName),
      stringOrUndefined(metadata.category),
      stringOrUndefined(metadata.keyword),
      ...stringArray(report.hookMethods),
      ...stringArray(report.sellingPoints),
      ...stringArray(report.storyboard),
      ...stringArray(report.styleTags),
      ...video.methodology.hooks,
      ...video.methodology.structure,
      ...video.methodology.sellingTriggers,
      ...video.methodology.styleTags
    ],
    query
  );
}

function hasVideoStructure(video: CommerceVideoAsset): boolean {
  return Boolean(
    video.video.durationMs ||
    video.video.summary?.trim() ||
    video.methodology.hooks.length > 0 ||
    video.methodology.structure.length > 0 ||
    video.methodology.sellingTriggers.length > 0 ||
    video.methodology.styleTags.length > 0
  );
}

function hasVideoEmbedding(video: CommerceVideoAsset): boolean {
  return Boolean(video.video.embedding?.dimensions);
}

function isQualityVideo(video: CommerceVideoAsset | undefined): video is QualityVideoAsset {
  return video?.metadata?.libraryKind === "quality-videos";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function matchesSearchableValues(values: Array<string | undefined>, query: string): boolean {
  const text = searchable(values).replace(/\s+/g, "");
  return expandSearchTerms(query).some((term) => text.includes(term.replace(/\s+/g, "")));
}

function expandSearchTerms(query: string): string[] {
  const terms = new Set<string>([query]);
  for (const part of query.split(/[\s,，、/|]+/u)) {
    if (part) terms.add(part);
  }
  if (/(裙子|裙装|裙|连衣裙|半身裙|短裙|长裙|衬衫裙|吊带裙|百褶裙|a字裙)/iu.test(query)) {
    ["裙", "裙子", "裙装", "连衣裙", "半身裙", "短裙", "长裙", "衬衫裙", "吊带裙", "百褶裙", "a字裙"].forEach((term) =>
      terms.add(term)
    );
  }
  return Array.from(terms).filter(Boolean);
}

function searchable(values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

function assetFileUrl(filePath: AssetLibraryFileRef["path"]): string {
  const clean = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `/api/asset-library/files/${clean
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function pathLeaf(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? filePath) : filePath;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function statusClass(status: AssetLibraryStatus): string {
  if (status === "ready") return styles.statusReady ?? "";
  if (status === "processing") return styles.statusProcessing ?? "";
  if (status === "failed") return styles.statusFailed ?? "";
  return styles.statusNeedsConfig ?? "";
}

function formatMs(value: number): string {
  if (value >= 60_000) {
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
