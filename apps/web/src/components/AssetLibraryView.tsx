import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@open-design/components";
import type {
  AssetLibraryJob,
  AssetLibrarySourceKind,
  AssetLibraryStatus,
  CommerceVideoAsset,
  CommerceVideoSlice,
  ProductAsset
} from "@open-design/contracts";
import {
  batchProcessCommerceVideoAssets,
  createProductAsset,
  embedCommerceVideoAsset,
  embedProductAsset,
  getCommerceVideoAsset,
  importCrawlerCommerceVideo,
  listCommerceVideoAssets,
  listProductAssets,
  processCommerceVideoAsset,
  processProductAsset,
  sliceCommerceVideoAsset,
  uploadCommerceVideoAsset,
  uploadProductAssetImage,
  waitAssetLibraryJob
} from "../providers/asset-library";
import { Icon } from "./Icon";
import styles from "./AssetLibraryView.module.css";

type AssetTab = "products" | "commerce-videos";
type VideoImportMode = "upload" | "crawler";
type CrawlerConnector = "youtube" | "tiktok" | "douyin" | "bilibili";

type ProductFormState = {
  title: string;
  subject: string;
  category: string;
  sellingPoints: string;
};

interface AssetLibraryViewProps {
  onOpenSettings?: () => void;
}

const EMPTY_PRODUCT_FORM: ProductFormState = {
  title: "",
  subject: "",
  category: "",
  sellingPoints: ""
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

function createEmptyProductForm(): ProductFormState {
  return { ...EMPTY_PRODUCT_FORM };
}

function normalizeProductForm(value: Partial<ProductFormState> | null | undefined): ProductFormState {
  return {
    title: value?.title ?? "",
    subject: value?.subject ?? "",
    category: value?.category ?? "",
    sellingPoints: value?.sellingPoints ?? ""
  };
}

export function AssetLibraryView({ onOpenSettings }: AssetLibraryViewProps) {
  const [tab, setTab] = useState<AssetTab>("products");
  const [products, setProducts] = useState<ProductAsset[]>([]);
  const [videos, setVideos] = useState<CommerceVideoAsset[]>([]);
  const [videoDetails, setVideoDetails] = useState<Record<string, CommerceVideoSlice[]>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchJob, setBatchJob] = useState<AssetLibraryJob | null>(null);
  const [batchProgress, setBatchProgress] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [productForm, setProductForm] = useState<ProductFormState>(() => createEmptyProductForm());
  const [productFile, setProductFile] = useState<File | null>(null);
  const [videoImportMode, setVideoImportMode] = useState<VideoImportMode>("upload");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [crawlerConnector, setCrawlerConnector] = useState<CrawlerConnector>("douyin");
  const [crawlerUrl, setCrawlerUrl] = useState("");
  const [crawlerTitle, setCrawlerTitle] = useState("");

  async function refreshLibrary() {
    setLoading(true);
    setError(null);
    try {
      const [productData, videoData] = await Promise.all([listProductAssets(), listCommerceVideoAssets()]);
      setProducts(productData.products ?? []);
      setVideos(videoData.videos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshLibrary();
  }, []);

  const productCount = products.length;
  const videoCount = videos.length;
  const safeProductForm = normalizeProductForm(productForm);
  const searchQuery = query.trim().toLowerCase();
  const filteredProducts = useMemo(
    () => products.filter((product) => matchesProduct(product, searchQuery)),
    [products, searchQuery]
  );
  const filteredVideos = useMemo(
    () => videos.filter((video) => matchesVideo(video, searchQuery)),
    [videos, searchQuery]
  );
  const allAssets = useMemo(() => [...products, ...videos], [products, videos]);
  const readyCount = allAssets.filter((asset) => asset.status === "ready").length;
  const needsConfigCount = allAssets.filter(
    (asset) => asset.status === "needs_embedding_config" || asset.status === "needs_model"
  ).length;
  const processingCount = allAssets.filter((asset) => asset.status === "processing").length;
  const activeCount = tab === "products" ? filteredProducts.length : filteredVideos.length;
  const activeTotal = tab === "products" ? productCount : videoCount;

  function updateProductForm(patch: Partial<ProductFormState>) {
    setProductForm((current) => ({
      ...normalizeProductForm(current),
      ...patch
    }));
  }

  async function submitProduct() {
    const form = normalizeProductForm(productForm);
    if (!form.title.trim() && !productFile) return;
    setBusy("product-import");
    setError(null);
    try {
      const input = {
        title: form.title.trim(),
        subject: form.subject.trim(),
        category: form.category.trim(),
        sellingPoints: splitList(form.sellingPoints)
      };
      if (productFile) {
        await uploadProductAssetImage(productFile, {
          ...input,
          title: input.title || productFile.name
        });
      } else {
        await createProductAsset(input);
      }
      setProductForm(createEmptyProductForm());
      setProductFile(null);
      setTab("products");
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitUpload() {
    if (!uploadFile) return;
    setBusy("video-upload");
    setError(null);
    try {
      await uploadCommerceVideoAsset(uploadFile, uploadTitle);
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
    try {
      await importCrawlerCommerceVideo({
        connectorId: crawlerConnector,
        url: crawlerUrl.trim(),
        title: crawlerTitle.trim() || undefined
      });
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

  async function processProduct(id: string) {
    setBusy(`product-${id}`);
    setError(null);
    try {
      const data = await processProductAsset(id);
      await waitAssetLibraryJob(data.job);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function embedProduct(id: string) {
    setBusy(`product-embed-${id}`);
    setError(null);
    try {
      const data = await embedProductAsset(id);
      await waitAssetLibraryJob(data.job);
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
      const data = await processCommerceVideoAsset(id);
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
      const data = await embedCommerceVideoAsset(id, { includeSlices: true });
      await waitAssetLibraryJob(data.job);
      await refreshVideoDetails(id);
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
    const data = await getCommerceVideoAsset(id);
    setVideoDetails((current) => ({ ...current, [id]: data.slices ?? [] }));
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
          <h1 className={styles.title}>素材生产工作台</h1>
          <p className={styles.subtitle}>
            商品素材服务商家带货生成；带货视频库沉淀爬虫和上传视频中的爆款结构、镜头节奏与可复用方法论。
          </p>
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
          <StatCard label="商品素材" value={productCount} helper="可直接进入创作链路" />
          <StatCard label="带货视频" value={videoCount} helper="用于拆解方法论" />
          <StatCard label="可用资产" value={readyCount} helper={`${processingCount} 个处理中`} />
          <StatCard
            label="待配置"
            value={needsConfigCount}
            helper="模型或向量化设置"
            tone={needsConfigCount > 0 ? "warn" : "neutral"}
          />
        </div>
      </header>

      <div className={styles.controlBar}>
        <div className={styles.tabs} role="tablist" aria-label="素材库分区">
          <button
            type="button"
            className={`${styles.tab}${tab === "products" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setTab("products")}
            role="tab"
            aria-selected={tab === "products"}
          >
            <Icon name="folder" size={16} />
            <span>
              <strong>商品素材</strong>
              <small>商家生成带货视频</small>
            </span>
            <b>{productCount}</b>
          </button>
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
        </div>
        <label className={styles.searchBox}>
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "products" ? "搜索商品、主体、类目或卖点" : "搜索标题、平台、摘要或方法论"}
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
        {tab === "products" ? (
          <>
            <aside className={styles.intakePanel}>
              <PanelHeader
                eyebrow="Product Intake"
                title="录入商品素材"
                body="先补齐主体、类目和卖点；处理后会生成商品摘要、约束和适合的视频方向。"
              />
              <div className={styles.form}>
                <label className={styles.field}>
                  <span>标题</span>
                  <input
                    value={safeProductForm.title}
                    onChange={(event) => updateProductForm({ title: event.target.value })}
                    placeholder="例如：夏季防晒冰丝外套"
                  />
                </label>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>主体</span>
                    <input
                      value={safeProductForm.subject}
                      onChange={(event) => updateProductForm({ subject: event.target.value })}
                      placeholder="商品主体"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>类目</span>
                    <input
                      value={safeProductForm.category}
                      onChange={(event) => updateProductForm({ category: event.target.value })}
                      placeholder="服饰 / 美妆 / 食品"
                    />
                  </label>
                </div>
                <label className={styles.field}>
                  <span>商品图片</span>
                  <input
                    className={styles.fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(event) => setProductFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                {productFile ? <p className={styles.fileHint}>{productFile.name}</p> : null}
                <label className={styles.field}>
                  <span>卖点</span>
                  <textarea
                    value={safeProductForm.sellingPoints}
                    onChange={(event) => updateProductForm({ sellingPoints: event.target.value })}
                    placeholder="一行一个卖点，也可以用逗号分隔"
                  />
                </label>
                <Button
                  variant="primary"
                  onClick={() => void submitProduct()}
                  disabled={(!safeProductForm.title.trim() && !productFile) || busy === "product-import"}
                >
                  <Icon name={busy === "product-import" ? "spinner" : productFile ? "upload" : "plus"} size={14} />
                  {productFile ? "上传入库" : "入库商品"}
                </Button>
              </div>
            </aside>
            <LibraryPane
              icon="folder"
              title="商品素材"
              subtitle="用于脚本、分镜和创作模块消费"
              count={activeCount}
              total={activeTotal}
              loading={loading}
              emptyLabel={searchQuery ? "没有匹配的商品素材" : "暂无商品素材"}
              emptyHint={searchQuery ? "换个关键词试试，或清空搜索查看全部。" : "从左侧录入第一个商品素材。"}
            >
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  busy={busy}
                  onProcess={() => void processProduct(product.id)}
                  onEmbed={() => void embedProduct(product.id)}
                />
              ))}
            </LibraryPane>
          </>
        ) : (
          <>
            <aside className={styles.intakePanel}>
              <PanelHeader
                eyebrow="Video Intake"
                title="导入带货视频"
                body="上传商家视频或从爬虫 API 接入素材，后续会切片、理解并沉淀方法论。"
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
                    <input
                      className={styles.fileInput}
                      type="file"
                      accept="video/*"
                      onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {uploadFile ? <p className={styles.fileHint}>{uploadFile.name}</p> : null}
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
                      placeholder="https://..."
                    />
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
              emptyLabel={searchQuery ? "没有匹配的带货视频" : "暂无带货视频"}
              emptyHint={searchQuery ? "换个标题、平台或方法论关键词试试。" : "从左侧上传视频，或导入一个爬虫链接。"}
            >
              {filteredVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  slices={videoDetails[video.id]}
                  busy={busy}
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

function BatchProgressPanel({ job, progress }: { job: AssetLibraryJob; progress: string[] }) {
  const visible = progress.slice(-80);
  return (
    <div className={styles.batchProgress}>
      <div className={styles.batchProgressHead}>
        <div>
          <strong>批量解析进度</strong>
          <span>下载/探测/切片/向量化按队列逐条执行</span>
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

function ProductCard({
  product,
  busy,
  onProcess,
  onEmbed
}: {
  product: ProductAsset;
  busy: string | null;
  onProcess: () => void;
  onEmbed: () => void;
}) {
  const sellingPoints = product.product.sellingPoints.slice(0, 3);
  return (
    <article className={styles.assetCard}>
      <div className={styles.cardMain}>
        <div className={styles.cardTopline}>
          <StatusPill status={product.status} />
          <span>{SOURCE_LABELS[product.sourceKind]}</span>
          <span>{formatDate(product.updatedAt)}</span>
        </div>
        <h3>{product.title}</h3>
        <div className={styles.assetMeta}>
          <span>{product.category || "未分类"}</span>
          <span>{product.subject || "未填写主体"}</span>
          {product.files.length > 0 ? <span>{product.files.length} 张图片</span> : null}
        </div>
        <p className={styles.summary}>
          {product.product.summary ||
            product.product.sellingPoints.join("，") ||
            "等待处理提取商品主体、类目、卖点和创作约束。"}
        </p>
        {sellingPoints.length > 0 ? (
          <div className={styles.chipRow}>
            {sellingPoints.map((point) => (
              <span key={point} className={styles.chip}>
                {point}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className={styles.cardActions}>
        <Button variant="subtle" onClick={onProcess} disabled={busy === `product-${product.id}`}>
          <Icon name={busy === `product-${product.id}` ? "spinner" : "sparkles"} size={14} />
          处理
        </Button>
        <Button variant="subtle" onClick={onEmbed} disabled={busy === `product-embed-${product.id}`}>
          <Icon name={busy === `product-embed-${product.id}` ? "spinner" : "sparkles"} size={14} />
          向量化
        </Button>
      </div>
    </article>
  );
}

function VideoCard({
  video,
  slices,
  busy,
  onDetails,
  onSlice,
  onProcess,
  onEmbed
}: {
  video: CommerceVideoAsset;
  slices?: CommerceVideoSlice[];
  busy: string | null;
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
  const sliceBusy = busy === `video-slice-${video.id}` || busy === `details-${video.id}`;
  return (
    <article className={styles.assetCard}>
      <div className={styles.cardMain}>
        <div className={styles.cardTopline}>
          <StatusPill status={video.status} />
          <span>{SOURCE_LABELS[video.sourceKind]}</span>
          <span>{video.sourceConnectorId || "本地"}</span>
          <span>{video.video.durationMs ? formatMs(video.video.durationMs) : "待识别时长"}</span>
        </div>
        <h3>{video.title}</h3>
        <div className={styles.assetMeta}>
          <span>{video.product.category || "未识别类目"}</span>
          <span>{video.product.subject || "未识别商品"}</span>
        </div>
        <p className={styles.summary}>
          {video.video.summary || "等待处理提炼整体摘要、爆款结构、镜头节奏和成交诱因。"}
        </p>
        {tags.length > 0 ? (
          <div className={styles.chipRow}>
            {tags.map((tag) => (
              <span key={tag} className={styles.chip}>
                {tag}
              </span>
            ))}
          </div>
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
        <Button variant="subtle" onClick={hasLoadedSlices && hasSlices ? onDetails : onSlice} disabled={sliceBusy}>
          <Icon name={sliceBusy ? "spinner" : hasLoadedSlices && hasSlices ? "eye-off" : "play"} size={14} />
          {hasLoadedSlices && hasSlices ? "收起" : "切片"}
        </Button>
        <Button variant="subtle" onClick={onProcess} disabled={busy === `video-${video.id}`}>
          <Icon name={busy === `video-${video.id}` ? "spinner" : "sparkles"} size={14} />
          处理
        </Button>
        <Button variant="subtle" onClick={onEmbed} disabled={busy === `video-embed-${video.id}`}>
          <Icon name={busy === `video-embed-${video.id}` ? "spinner" : "sparkles"} size={14} />
          向量化
        </Button>
      </div>
    </article>
  );
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

function matchesProduct(product: ProductAsset, query: string): boolean {
  if (!query) return true;
  return searchable([
    product.title,
    product.subject,
    product.category,
    product.product.summary,
    ...product.product.sellingPoints,
    ...product.product.suggestedAngles
  ]).includes(query);
}

function matchesVideo(video: CommerceVideoAsset, query: string): boolean {
  if (!query) return true;
  return searchable([
    video.title,
    video.sourceKind,
    video.sourceConnectorId,
    video.sourceUrl,
    video.product.subject,
    video.product.category,
    video.video.summary,
    ...video.methodology.hooks,
    ...video.methodology.structure,
    ...video.methodology.sellingTriggers,
    ...video.methodology.styleTags
  ]).includes(query);
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
