// Stage B of plugin-driven-flow-plan — Home intent rail.
//
// The Home input card sits naked above an unstructured prompt. New
// users frequently type a request without knowing which scenario
// plugin to apply, which lands them in the generic agent path and
// stretches the convergence loop. This chip rail exposes high-signal
// NewProjectModal categories plus a small set of lower-row shortcuts
// (plugin authoring / Figma / template), so the same Enter
// keystroke can hit a scenario-bound run. The generic "other" path stays
// in the free-form prompt instead of becoming a redundant chip.
//
// The catalog stays a pure data table:
//   - `id` — stable React key + test selector.
//   - `label` — English copy. Localisation can layer on later by
//     swapping this for a Dict lookup; keeping it inline lets the
//     rail ship without burning through 17 locale files for two
//     new strings (see plan §B / open questions).
//   - `icon` — name from the shared Icon registry.
//   - `action` — discriminated union the HomeView dispatcher matches
//     on. The rail component itself stays presentational.

import type { ProjectKind, ProjectMetadata } from '@open-design/contracts';
import type { DefaultScenarioPluginId } from '@open-design/contracts';
import type { IconName } from '../Icon';

// Plugin ids the chip rail can dispatch to. Most chips route to a
// `DefaultScenarioPluginId` so the same fallback table the daemon
// uses for naked Home queries stays the source of truth. Specialised
// chips (HyperFrames lives under `plugins/_official/examples/hyperframes/`
// and surfaces as the `example-hyperframes` bundled plugin id) bypass
// the default table by carrying their own plugin id directly. The
// curated union keeps typo safety while letting the rail evolve
// independently of the default-binding mapping.
export type ChipScenarioPluginId =
  | DefaultScenarioPluginId
  | 'example-hyperframes';

export type ChipAction =
  | {
      kind: 'apply-scenario';
      pluginId: ChipScenarioPluginId;
      projectKind: ProjectKind;
      inputs?: Record<string, unknown>;
      queryTemplate?: string;
      projectMetadata?: ProjectMetadata;
    }
  | {
      kind: 'apply-figma-migration';
      pluginId: 'od-figma-migration';
      projectKind: ProjectKind;
      inputs?: Record<string, unknown>;
      projectMetadata?: ProjectMetadata;
    }
  | { kind: 'create-plugin' }
  | { kind: 'open-template-picker' };

// Two intent groups: "create" = integrated commerce workbench tasks, "migrate"
// = lower-row starter shortcuts such as templates. The grouping is structural
// only — HomeHero renders the two groups in separate flex containers so they
// wrap onto separate rows on narrow viewports without horizontal scrolling.
export type ChipGroup = 'create' | 'migrate';

export interface HomeHeroChip {
  id: string;
  label: string;
  icon: IconName;
  group: ChipGroup;
  hint?: string;
  action: ChipAction;
}

function newGenerationStarterInputs(
  artifactKind: string,
  topic: string,
): Record<string, string> {
  return {
    artifactKind,
    audience: 'commerce video workflow operator',
    topic,
  };
}

function newGenerationProjectMetadata(kind: ProjectKind): ProjectMetadata {
  return { kind, skipDiscoveryBrief: true };
}

export const HOME_HERO_CHIPS: ReadonlyArray<HomeHeroChip> = [
  {
    id: 'video-crawler',
    label: '视频爬取',
    icon: 'search',
    group: 'create',
    hint: '用已连接的搜索或平台连接器收集高热度带货视频样本。',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-new-generation',
      projectKind: 'other',
      inputs: newGenerationStarterInputs(
        'commerce video crawler workflow',
        'collecting public high-performing selling video samples',
      ),
      projectMetadata: newGenerationProjectMetadata('other'),
      queryTemplate:
        '你是带货视频数据采集助手。围绕用户给出的商品、关键词、平台或类目，由 agent 调用后台素材库/连接器工具完成：先用 commerce-videos search 预览公开视频候选，再根据相关性、播放/点赞/收藏/评论/分享等热度信号、疑似带货证据、重复风险和数据限制筛选，最后只把选中的样本写入素材库。优先返回标题、作者、链接、平台 ID、发布时间、可获得互动指标、选择/淘汰理由和采集限制。不要在首页直接 mock 成功，不要默认批量导入全部结果，不要承诺绕过登录、验证码或平台风控。',
    },
  },
  {
    id: 'asset-analysis',
    label: '素材库分析',
    icon: 'grid',
    group: 'create',
    hint: '盘点商品图、参考视频、卖点、品牌约束和缺口。',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-new-generation',
      projectKind: 'other',
      inputs: newGenerationStarterInputs(
        'commerce asset library analysis',
        'assessing product materials for selling video readiness',
      ),
      projectMetadata: newGenerationProjectMetadata('other'),
      queryTemplate:
        '你是带货视频素材库分析助手。通过 agent 调用素材库接口完成真实流程：先用 od assets commerce-videos batch-process --query/--ids --wait --json 批量解析并观察进度，再用 od assets commerce-videos methodology-summary --query/--ids --json 取得结构化上下文；参考 video-storyboard-analysis 的切片/关键帧分析流程和 video-generation-pipeline 的方法论格式，汇总多条参考视频的爆款打法。基于商品素材库和带货视频库，输出：1）商品维度；2）视频维度；3）slice 维度；4）可直接用于生成的素材；5）缺失素材；6）素材质量风险；7）适合的镜头/首帧/卖点用法；8）可复用方法论和下一步补齐/向量化建议。不要在首页 mock 成功。',
    },
  },
  {
    id: 'script-storyboard',
    label: '脚本分镜',
    icon: 'kanban',
    group: 'create',
    hint: '把商品资料转成钩子、口播、镜头和生成提示词。',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-new-generation',
      projectKind: 'other',
      inputs: newGenerationStarterInputs(
        'commerce video script and storyboard',
        'turning product materials into shot-level selling video plans',
      ),
      projectMetadata: newGenerationProjectMetadata('other'),
      queryTemplate:
        '你是带货视频脚本与分镜助手。基于用户给出的商品、素材、目标平台和时长，输出可执行的短视频方案：开场钩子、痛点/卖点结构、口播稿、字幕节奏、镜头清单、每镜头时长、画面目标、所需素材、图片/视频生成提示词、音效/音乐建议、CTA 和质检要点。',
    },
  },
  {
    id: 'video-generation',
    label: '视频生成',
    icon: 'play',
    group: 'create',
    hint: '根据素材、脚本或分镜组织竖屏带货视频生成任务。',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-new-generation',
      projectKind: 'video',
      inputs: newGenerationStarterInputs(
        'vertical commerce video generation brief',
        'preparing product-selling video generation tasks',
      ),
      projectMetadata: newGenerationProjectMetadata('video'),
      queryTemplate:
        '你是带货视频生成助手。根据用户提供的商品素材、脚本、分镜或参考视频，组织一次可执行的视频生成任务。先确认平台、比例、时长、模型、是否需要参考图/首帧、字幕和配音；再输出镜头级生成提示词、负面约束、画面连续性要求、渲染参数和失败重试建议。',
    },
  },
  {
    id: 'generation-diagnostics',
    label: '生成诊断',
    icon: 'sliders',
    group: 'create',
    hint: '检查生成结果、错误信息、素材缺口和重试方案。',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-new-generation',
      projectKind: 'other',
      inputs: newGenerationStarterInputs(
        'commerce video generation diagnostics',
        'debugging failed or low-quality selling video generations',
      ),
      projectMetadata: newGenerationProjectMetadata('other'),
      queryTemplate:
        '你是带货视频生成诊断助手。检查用户当前项目的生成记录、失败日志、模型配置、素材输入、提示词、时长/比例/分辨率、字幕/配音和输出结果。区分素材缺失、提示词不清、模型能力、配置、额度或网络问题，输出可执行的修复步骤、重试提示词和需要用户补充的信息。',
    },
  },
  {
    id: 'template',
    label: '任务模板',
    icon: 'file-code',
    group: 'migrate',
    hint: 'Start from a crawler, asset-analysis, storyboard, generation, or diagnostics template.',
    action: { kind: 'open-template-picker' },
  },
];

export function chipsForGroup(group: ChipGroup): HomeHeroChip[] {
  return HOME_HERO_CHIPS.filter((c) => c.group === group);
}

// Helper used by tests + the rail component to pull the chip metadata
// off a click target without round-tripping through React state.
export function findChip(id: string): HomeHeroChip | undefined {
  return HOME_HERO_CHIPS.find((c) => c.id === id);
}
