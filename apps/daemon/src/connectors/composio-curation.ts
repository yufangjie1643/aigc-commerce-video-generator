import type { ConnectorToolCuration } from './catalog.js';

const DAILY_DIGEST_CURATION: ConnectorToolCuration = {
  useCases: ['personal_daily_digest'],
};

export const COMPOSIO_CURATION_OVERLAY: Readonly<Record<string, Readonly<Record<string, ConnectorToolCuration>>>> = {
  github: {
    github_get_issue: { ...DAILY_DIGEST_CURATION, reason: 'Repo-scoped issue detail supports a personal digest.' },
    github_list_pull_requests: { ...DAILY_DIGEST_CURATION, reason: 'Repo-scoped PR listing fits a digest when bounded to owned repos.' },
    github_get_pull_request: { ...DAILY_DIGEST_CURATION, reason: 'PR detail is digest-friendly and repo-scoped.' },
    github_list_issues: { ...DAILY_DIGEST_CURATION, reason: 'Repo-scoped issue listing fits a digest when bounded.' },
    github_list_notifications: { ...DAILY_DIGEST_CURATION, reason: 'Authenticated-user notifications are directly digest-relevant.' },
    github_list_events: { ...DAILY_DIGEST_CURATION, reason: 'Recent repo/account events can support a digest when bounded.' },
    github_list_commits: { ...DAILY_DIGEST_CURATION, reason: 'Repo-scoped commit history is digest-friendly.' },
  },
  youtube: {
    youtube_search_videos: { ...DAILY_DIGEST_CURATION, reason: 'Recent video search can surface relevant YouTube updates for a digest.' },
    youtube_get_video: { ...DAILY_DIGEST_CURATION, reason: 'Video detail is useful for concise watch and publishing summaries.' },
  },
  tiktok: {
    tiktok_search_videos: { ...DAILY_DIGEST_CURATION, reason: 'Short-video search can surface current creator and campaign activity.' },
    tiktok_get_video: { ...DAILY_DIGEST_CURATION, reason: 'Short-video detail supports a concise digest entry.' },
  },
  douyin: {
    douyin_search_videos: { ...DAILY_DIGEST_CURATION, reason: 'Domestic short-video search can surface current Douyin activity.' },
    douyin_get_video: { ...DAILY_DIGEST_CURATION, reason: 'Douyin video detail supports a concise digest entry.' },
  },
  bilibili: {
    bilibili_search_videos: { ...DAILY_DIGEST_CURATION, reason: 'Bilibili video search can surface recent creator and channel activity.' },
    bilibili_get_video: { ...DAILY_DIGEST_CURATION, reason: 'Bilibili video detail supports a concise digest entry.' },
  },
};
