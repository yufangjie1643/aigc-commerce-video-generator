import type { CSSProperties } from "react";

import { Icon } from "./Icon";
import styles from "./VideoDashboardView.module.css";

type MetricId = "ctr" | "complete" | "addCart" | "conversion" | "roas";

interface CompletedVideo {
  id: string;
  title: string;
  product: string;
  channel: string;
  duration: string;
  strategy: string;
  factorTags: string[];
  accent: string;
  background: string;
  stats: {
    views: number;
    ctr: number;
    complete: number;
    addCart: number;
    conversion: number;
    roas: number;
    lift: number;
  };
}

interface FactorRow {
  id: string;
  name: string;
  group: string;
  description: string;
  values: Record<MetricId, number>;
  confidence: number;
}

interface BubblePoint {
  id: string;
  label: string;
  product: string;
  x: number;
  y: number;
  size: number;
  conversion: number;
  factor: string;
  accent: string;
}

interface Contribution {
  factor: string;
  score: number;
  sample: string;
}

interface Diagnostic {
  title: string;
  impact: string;
  confidence: string;
  action: string;
}

const METRICS: ReadonlyArray<{ id: MetricId; label: string; helper: string }> = [
  { id: "ctr", label: "点击率", helper: "CTR lift" },
  { id: "complete", label: "完播率", helper: "Completion" },
  { id: "addCart", label: "加购率", helper: "ATC" },
  { id: "conversion", label: "成交转化", helper: "CVR lift" },
  { id: "roas", label: "ROAS", helper: "Revenue" }
];

const COMPLETED_VIDEOS: CompletedVideo[] = [
  {
    id: "vd-001",
    title: "夏季防晒冰丝外套",
    product: "轻薄防晒衣",
    channel: "TikTok Shop",
    duration: "14.8s",
    strategy: "前三秒痛点钩子 + 细节特写",
    factorTags: ["防晒痛点", "肤感特写", "通勤场景"],
    accent: "#0f8f7a",
    background: "#dff6ef",
    stats: { views: 128400, ctr: 12.8, complete: 58.2, addCart: 8.1, conversion: 4.9, roas: 3.4, lift: 26 }
  },
  {
    id: "vd-002",
    title: "白色衬衫裙日常穿搭",
    product: "白色衬衫裙",
    channel: "Instagram Reels",
    duration: "12.3s",
    strategy: "穿搭前后对比 + 柔和 BGM",
    factorTags: ["OOTD", "前后对比", "轻柔音乐"],
    accent: "#4f6fdd",
    background: "#e8edff",
    stats: { views: 96400, ctr: 10.9, complete: 61.5, addCart: 6.8, conversion: 3.7, roas: 2.6, lift: 18 }
  },
  {
    id: "vd-003",
    title: "便携榨汁杯上班族早餐",
    product: "便携榨汁杯",
    channel: "TikTok Shop",
    duration: "15.0s",
    strategy: "真实使用场景 + 一镜到底",
    factorTags: ["早餐场景", "一镜到底", "利益点字幕"],
    accent: "#d76a1f",
    background: "#fff1df",
    stats: { views: 151300, ctr: 13.6, complete: 54.4, addCart: 9.4, conversion: 5.6, roas: 3.9, lift: 32 }
  },
  {
    id: "vd-004",
    title: "小户型收纳抽屉盒",
    product: "透明收纳盒",
    channel: "Shopee Video",
    duration: "13.6s",
    strategy: "杂乱对照 + 价格 CTA",
    factorTags: ["整理前后", "透明质感", "限时优惠"],
    accent: "#7a58b8",
    background: "#f0eafd",
    stats: { views: 83200, ctr: 9.7, complete: 49.8, addCart: 7.2, conversion: 3.9, roas: 2.8, lift: 14 }
  }
];

const FACTOR_ROWS: FactorRow[] = [
  {
    id: "hook-pain",
    name: "前三秒痛点钩子",
    group: "剧本因子",
    description: "开场直接提出高频使用痛点",
    values: { ctr: 18, complete: 9, addCart: 13, conversion: 16, roas: 14 },
    confidence: 92
  },
  {
    id: "detail-shot",
    name: "商品细节特写",
    group: "素材因子",
    description: "纹理、接口、材质、尺码对比",
    values: { ctr: 7, complete: 12, addCart: 18, conversion: 21, roas: 19 },
    confidence: 88
  },
  {
    id: "proof",
    name: "真实使用证明",
    group: "内容因子",
    description: "上身、试用、整理前后、用户语气",
    values: { ctr: 11, complete: 16, addCart: 15, conversion: 18, roas: 22 },
    confidence: 86
  },
  {
    id: "offer",
    name: "价格与优惠 CTA",
    group: "交易因子",
    description: "限时优惠、包邮、组合装",
    values: { ctr: 6, complete: -3, addCart: 21, conversion: 24, roas: 17 },
    confidence: 81
  },
  {
    id: "caption-density",
    name: "高密度字幕卖点",
    group: "剪辑因子",
    description: "每 2 秒切换一个利益点",
    values: { ctr: 9, complete: -7, addCart: 6, conversion: 4, roas: 3 },
    confidence: 74
  },
  {
    id: "soft-bgm",
    name: "轻柔 BGM 氛围",
    group: "声音因子",
    description: "低干扰音乐承接产品质感",
    values: { ctr: 3, complete: 14, addCart: 5, conversion: 7, roas: 9 },
    confidence: 78
  }
];

const BUBBLE_POINTS: BubblePoint[] = [
  {
    id: "p1",
    label: "冰丝外套 A",
    product: "防晒衣",
    x: 82,
    y: 74,
    size: 22,
    conversion: 4.9,
    factor: "痛点钩子",
    accent: "#0f8f7a"
  },
  {
    id: "p2",
    label: "榨汁杯 B",
    product: "榨汁杯",
    x: 88,
    y: 82,
    size: 25,
    conversion: 5.6,
    factor: "场景证明",
    accent: "#d76a1f"
  },
  {
    id: "p3",
    label: "衬衫裙 C",
    product: "衬衫裙",
    x: 63,
    y: 57,
    size: 18,
    conversion: 3.7,
    factor: "穿搭对比",
    accent: "#4f6fdd"
  },
  {
    id: "p4",
    label: "收纳盒 D",
    product: "收纳",
    x: 56,
    y: 61,
    size: 16,
    conversion: 3.9,
    factor: "优惠 CTA",
    accent: "#7a58b8"
  },
  {
    id: "p5",
    label: "外套 B",
    product: "防晒衣",
    x: 74,
    y: 67,
    size: 19,
    conversion: 4.4,
    factor: "细节特写",
    accent: "#179b9b"
  },
  {
    id: "p6",
    label: "榨汁杯 C",
    product: "榨汁杯",
    x: 48,
    y: 39,
    size: 13,
    conversion: 2.8,
    factor: "字幕密集",
    accent: "#b2472d"
  }
];

const CONTRIBUTIONS: Contribution[] = [
  { factor: "商品细节特写", score: 23, sample: "白底细节图 + 使用场景视频切片" },
  { factor: "前三秒痛点钩子", score: 19, sample: "防晒、早餐、收纳三个类目均有效" },
  { factor: "真实使用证明", score: 17, sample: "前后对比比单纯展示更稳" },
  { factor: "价格与优惠 CTA", score: 11, sample: "加购提升明显，完播略降" },
  { factor: "高密度字幕卖点", score: -6, sample: "信息过载导致完播下降" }
];

const DIAGNOSTICS: Diagnostic[] = [
  {
    title: "保留强痛点开场",
    impact: "+16% 转化贡献",
    confidence: "92% 置信",
    action: "下一批剧本继续把痛点放在前 2 秒，并避免先展示品牌口号。"
  },
  {
    title: "增加材质细节镜头",
    impact: "+21% 成交提升",
    confidence: "88% 置信",
    action: "项目商品素材优先补齐面料、接口、尺寸对比和上身细节图。"
  },
  {
    title: "收敛字幕密度",
    impact: "-7% 完播风险",
    confidence: "74% 置信",
    action: "15 秒内最多保留 4 个主卖点，把参数说明改为画面证明。"
  }
];

const TREND_POINTS = "0,78 42,74 84,66 126,63 168,51 210,47 252,38 294,34";

function formatCompact(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}%`;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function heatClass(value: number): string {
  if (value >= 18) return styles.heatStrong!;
  if (value >= 10) return styles.heatGood!;
  if (value >= 4) return styles.heatMild!;
  if (value >= 0) return styles.heatFlat!;
  return styles.heatRisk!;
}

function bubbleStyle(point: BubblePoint): CSSProperties {
  return {
    left: `${point.x}%`,
    bottom: `${point.y}%`,
    width: `${point.size}px`,
    height: `${point.size}px`,
    background: point.accent
  };
}

function contributionStyle(item: Contribution): CSSProperties {
  const width = `${(Math.min(Math.abs(item.score), 24) / 24) * 100}%`;
  return { "--bar-size": width } as CSSProperties;
}

function posterStyle(video: CompletedVideo): CSSProperties {
  return {
    "--poster-accent": video.accent,
    "--poster-bg": video.background
  } as CSSProperties;
}

function VideoResultCard({ video, rank }: { video: CompletedVideo; rank: number }) {
  return (
    <article className={styles.videoCard}>
      <div className={styles.poster} style={posterStyle(video)}>
        <div className={styles.posterHeader}>
          <span>#{rank}</span>
          <span>{video.duration}</span>
        </div>
        <div className={styles.posterProduct}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.posterCaption}>
          <strong>{video.product}</strong>
          <span>{video.strategy}</span>
        </div>
        <div className={styles.playBadge} aria-hidden>
          <Icon name="play" size={14} />
        </div>
      </div>
      <div className={styles.videoBody}>
        <div>
          <span className={styles.statusPill}>已完成</span>
          <h3>{video.title}</h3>
          <p>{video.channel}</p>
        </div>
        <div className={styles.videoStats}>
          <span>
            <strong>{formatPercent(video.stats.conversion)}</strong>
            转化率
          </span>
          <span>
            <strong>{video.stats.roas.toFixed(1)}</strong>
            ROAS
          </span>
          <span>
            <strong>{formatCompact(video.stats.views)}</strong>
            曝光
          </span>
        </div>
        <div className={styles.factorTags}>
          {video.factorTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
    </article>
  );
}

function Heatmap() {
  return (
    <div className={styles.heatmap} role="table" aria-label="生成因子与转化效果热力图">
      <div className={styles.heatmapHeader} role="row">
        <div role="columnheader">生成因子</div>
        {METRICS.map((metric) => (
          <div key={metric.id} role="columnheader">
            <strong>{metric.label}</strong>
            <span>{metric.helper}</span>
          </div>
        ))}
        <div role="columnheader">置信度</div>
      </div>
      {FACTOR_ROWS.map((row) => (
        <div key={row.id} className={styles.heatmapRow} role="row">
          <div className={styles.factorCell} role="cell">
            <span>{row.group}</span>
            <strong>{row.name}</strong>
            <small>{row.description}</small>
          </div>
          {METRICS.map((metric) => {
            const value = row.values[metric.id];
            return (
              <div key={metric.id} className={`${styles.heatCell} ${heatClass(value)}`} role="cell">
                {signedPercent(value)}
              </div>
            );
          })}
          <div className={styles.confidenceCell} role="cell">
            <span style={{ width: `${row.confidence}%` }} />
            <strong>{row.confidence}%</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function BubbleChart() {
  return (
    <div className={styles.bubbleChart} aria-label="视频因子命中度与转化提升分布">
      <div className={styles.chartAxisX}>生成因子命中度</div>
      <div className={styles.chartAxisY}>转化提升</div>
      <div className={styles.chartGrid} aria-hidden />
      {BUBBLE_POINTS.map((point) => (
        <div
          key={point.id}
          className={styles.bubblePoint}
          style={bubbleStyle(point)}
          aria-label={`${point.label}，${point.factor}，转化率 ${formatPercent(point.conversion)}`}
          title={`${point.label} / ${point.factor} / ${formatPercent(point.conversion)}`}
        />
      ))}
      <div className={styles.bubbleLegend}>
        <span>气泡大小 = 曝光量</span>
        <span>越靠右上，因子命中和转化越好</span>
      </div>
    </div>
  );
}

function ContributionList() {
  return (
    <div className={styles.contributionList}>
      {CONTRIBUTIONS.map((item) => {
        const positive = item.score >= 0;
        return (
          <div key={item.factor} className={styles.contributionItem}>
            <div className={styles.contributionText}>
              <strong>{item.factor}</strong>
              <span>{item.sample}</span>
            </div>
            <div className={styles.contributionTrack}>
              <span
                className={positive ? styles.contributionPositive : styles.contributionNegative}
                style={contributionStyle(item)}
              />
            </div>
            <strong className={positive ? styles.scorePositive : styles.scoreNegative}>
              {item.score >= 0 ? "+" : ""}
              {item.score}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export function VideoDashboardView() {
  const totalViews = COMPLETED_VIDEOS.reduce((sum, video) => sum + video.stats.views, 0);
  const avgConversion = average(COMPLETED_VIDEOS.map((video) => video.stats.conversion));
  const avgComplete = average(COMPLETED_VIDEOS.map((video) => video.stats.complete));
  const bestVideo = COMPLETED_VIDEOS.slice().sort((a, b) => b.stats.conversion - a.stats.conversion)[0]!;

  return (
    <section className={styles.shell} aria-label="带货视频数据看板">
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>数据看板</p>
          <h1>成果视频与转化诊断</h1>
          <p>聚合已完成带货视频的曝光、完播、加购、成交与 ROAS，把生成策略、素材因子和转化效果放在同一张分析视图里。</p>
        </div>
        <div className={styles.heroInsight} aria-label="当前最佳视频">
          <span>本周最佳</span>
          <strong>{bestVideo.title}</strong>
          <p>{bestVideo.strategy}</p>
          <div>
            <b>{formatPercent(bestVideo.stats.conversion)}</b>
            <small>成交转化率</small>
          </div>
        </div>
      </header>

      <div className={styles.metricsGrid} aria-label="成果概览">
        <div className={styles.metricCard}>
          <span>已完成视频</span>
          <strong>{COMPLETED_VIDEOS.length}</strong>
          <small>可预览成果</small>
        </div>
        <div className={styles.metricCard}>
          <span>总曝光</span>
          <strong>{formatCompact(totalViews)}</strong>
          <small>近 7 天诊断样本</small>
        </div>
        <div className={styles.metricCard}>
          <span>平均转化率</span>
          <strong>{formatPercent(avgConversion)}</strong>
          <small>较基线 +22%</small>
        </div>
        <div className={styles.metricCard}>
          <span>平均完播率</span>
          <strong>{formatPercent(avgComplete)}</strong>
          <small>短视频 15s 内</small>
        </div>
      </div>

      <section className={styles.resultsSection} aria-labelledby="video-results-title">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionKicker}>Video outcomes</p>
            <h2 id="video-results-title">已完成视频成果</h2>
          </div>
          <span>{COMPLETED_VIDEOS.length} 条成片</span>
        </div>
        <div className={styles.videoGrid}>
          {COMPLETED_VIDEOS.map((video, index) => (
            <VideoResultCard key={video.id} video={video} rank={index + 1} />
          ))}
        </div>
      </section>

      <section className={styles.analysisGrid} aria-label="生成因子与转化效果分析">
        <div className={`${styles.panel} ${styles.heatmapPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.sectionKicker}>Factor attribution</p>
              <h2>生成因子 × 转化效果</h2>
            </div>
            <span>按 lift 着色</span>
          </div>
          <Heatmap />
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.sectionKicker}>Distribution</p>
              <h2>因子命中与转化分布</h2>
            </div>
          </div>
          <BubbleChart />
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.sectionKicker}>Contribution</p>
              <h2>转化贡献排行</h2>
            </div>
            <span>归因分</span>
          </div>
          <ContributionList />
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.sectionKicker}>Trend</p>
              <h2>转化率走势</h2>
            </div>
            <span>7 天</span>
          </div>
          <div className={styles.trendChart}>
            <svg viewBox="0 0 294 96" role="img" aria-label="转化率从 3.1% 上升到 4.8%">
              <path d="M0 86H294" />
              <path d="M0 56H294" />
              <path d="M0 26H294" />
              <polyline points={TREND_POINTS} />
              <circle cx="294" cy="34" r="4" />
            </svg>
            <div className={styles.trendSummary}>
              <strong>4.8%</strong>
              <span>当前综合转化率</span>
              <small>高于上周基线 1.1 个百分点</small>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.diagnostics} aria-labelledby="diagnostics-title">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.sectionKicker}>Diagnosis</p>
            <h2 id="diagnostics-title">下一轮生成建议</h2>
          </div>
        </div>
        <div className={styles.diagnosticGrid}>
          {DIAGNOSTICS.map((item) => (
            <article key={item.title} className={styles.diagnosticCard}>
              <span>{item.confidence}</span>
              <h3>{item.title}</h3>
              <strong>{item.impact}</strong>
              <p>{item.action}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
