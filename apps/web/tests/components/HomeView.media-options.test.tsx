// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "../../src/components/HomeView";
import { HOME_HERO_CHIPS } from "../../src/components/home-hero/chips";
import { homeHeroPromptText, setHomeHeroPrompt } from "../helpers/home-hero-lexical";

const NEW_GENERATION_FIELDS = [
  {
    name: "artifactKind",
    type: "string",
    required: true,
    label: "Artifact kind",
    placeholder: "landing page"
  },
  {
    name: "audience",
    type: "string",
    required: true,
    label: "Audience",
    placeholder: "VC partners at a Series A SaaS round"
  },
  {
    name: "topic",
    type: "string",
    required: true,
    label: "Topic",
    placeholder: "shipping faster product pipelines"
  }
];

const NEW_GENERATION_PLUGIN = {
  id: "od-new-generation",
  title: "New generation",
  version: "0.1.0",
  trust: "bundled" as const,
  sourceKind: "bundled" as const,
  source: "/tmp/new-generation",
  capabilitiesGranted: ["prompt:inject"],
  fsPath: "/tmp/new-generation",
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: "od-new-generation",
    title: "New generation",
    version: "0.1.0",
    description: "Run a prompt-driven workbench task",
    tags: ["workflow"],
    od: {
      kind: "scenario",
      taskKind: "new-generation",
      mode: "other",
      useCase: { query: "{{prompt}}" },
      inputs: NEW_GENERATION_FIELDS
    }
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("HomeView workbench task chips", () => {
  it("renders the comprehensive workbench task rail", async () => {
    stubFetch();
    renderHome();

    expect(screen.getByTestId("session-mode-trigger").textContent).toContain("Comprehensive");
    for (const chip of HOME_HERO_CHIPS.filter((item) => item.group === "create")) {
      expect(await screen.findByTestId(`home-hero-rail-${chip.id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("home-hero-rail-image")).toBeNull();
    expect(screen.queryByTestId("home-hero-rail-video")).toBeNull();
    expect(screen.queryByTestId("home-hero-rail-hyperframes")).toBeNull();
    expect(screen.queryByTestId("home-hero-rail-audio")).toBeNull();
  });

  it("injects a task-specific system prompt instead of media option controls", async () => {
    stubFetch();
    renderHome();

    await clickHomeRailChip("video-crawler");

    await waitFor(() => {
      expect(screen.getByTestId("home-hero-active-type-chip").textContent).toContain("视频爬取");
      expect(homeHeroPromptText()).toContain("你是带货视频数据采集助手");
      expect(homeHeroPromptText()).toContain("commerce-videos search");
      expect((screen.getByTestId("home-hero-submit") as HTMLButtonElement).disabled).toBe(false);
    });
    expect(screen.queryByTestId("home-hero-footer-option-designSystem")).toBeNull();
    expect(screen.queryByTestId("home-hero-footer-option-model")).toBeNull();
    expect(screen.queryByTestId("home-hero-footer-option-ratio")).toBeNull();
    expect(screen.queryByTestId("home-hero-footer-option-duration")).toBeNull();
  });

  it("submits crawler search import requests to the agent for selection", async () => {
    const onSubmit = vi.fn();
    const fetchMock = stubFetch();
    renderHome({ onSubmit });

    await clickHomeRailChip("video-crawler");
    await setHomePrompt(
      "使用已连接的 Bilibili/抖音/小红书类连接器，搜索「AI 数字人 带货」，抓取前 20 个公开视频并加入素材库。"
    );
    await submitHome();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("AI 数字人 带货"),
          conversationMode: "comprehensive",
          pluginId: null,
          appliedPluginSnapshotId: null,
          projectKind: "other",
          projectMetadata: expect.objectContaining({
            kind: "other",
            skipDiscoveryBrief: true
          })
        })
      );
    });
    expect(onSubmit.mock.calls[0]?.[0]?.prompt).toContain("AI 数字人 带货");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/asset-library/commerce-videos/import/search")).toBe(
      false
    );
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/asset-library/commerce-videos/import/crawler")).toBe(
      false
    );
    expect(screen.queryByTestId("home-hero-workflow-status")).toBeNull();
  });

  it("submits crawler planning tasks with the generic discovery brief disabled", async () => {
    const onSubmit = vi.fn();
    stubFetch();
    renderHome({ onSubmit });

    await clickHomeRailChip("video-crawler");
    await setHomePrompt("先整理 AI 数字人带货视频采集任务上下文。");
    await submitHome();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationMode: "comprehensive",
          pluginId: null,
          appliedPluginSnapshotId: null,
          projectKind: "other",
          projectMetadata: expect.objectContaining({
            kind: "other",
            skipDiscoveryBrief: true
          })
        })
      );
    });
  });

  it("submits video generation as a prompt-driven video task", async () => {
    const onSubmit = vi.fn();
    stubFetch();
    renderHome({ onSubmit });

    await clickHomeRailChip("video-generation");
    await waitFor(() => expect(homeHeroPromptText()).toContain("你是带货视频六阶段工作流助手"));
    expect(homeHeroPromptText()).toContain("先判断任务类型");
    expect(homeHeroPromptText()).toContain(
      "请用我刚上传的商品素材生成一条 9:16 竖版带货短视频。严格按 commerce-video 六阶段流程执行"
    );
    expect(homeHeroPromptText()).toContain("用户已明确要求一键成片");
    expect(homeHeroPromptText()).toContain("商品素材上传 -> 剧本生成 -> 基础分镜 -> 一键成片 -> 任务进度 -> 预览导出");
    expect(homeHeroPromptText()).toContain("每次只完成当前阶段");
    expect(homeHeroPromptText()).toContain("一键成片阶段只创建生成任务");
    expect(homeHeroPromptText()).not.toContain("直接进入一键链路");
    expect(homeHeroPromptText()).not.toContain("media generate");
    await setHomePrompt("Generate a <=15s product-selling video for a portable blender with preview/export.");
    await submitHome();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Generate a <=15s product-selling video for a portable blender with preview/export.",
          conversationMode: "comprehensive",
          pluginId: null,
          appliedPluginSnapshotId: null,
          projectKind: "video",
          projectMetadata: expect.objectContaining({
            kind: "video",
            skipDiscoveryBrief: true
          })
        })
      );
    });
  });

  it("routes comprehensive mode through the agent without a scenario plugin snapshot", async () => {
    const onSubmit = vi.fn();
    stubFetch();
    renderHome({ onSubmit });

    await clickHomeRailChip("video-generation");
    await setHomePrompt("生成一个便携榨汁杯带货视频，并提取可复用的方法论。");
    await submitHome();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "生成一个便携榨汁杯带货视频，并提取可复用的方法论。",
          conversationMode: "comprehensive",
          pluginId: null,
          appliedPluginSnapshotId: null,
          pluginTitle: null,
          taskKind: null,
          projectKind: "video",
          projectMetadata: expect.objectContaining({
            kind: "video",
            skipDiscoveryBrief: true
          })
        })
      );
    });
  });

  it("routes Bilibili download requests through the agent", async () => {
    const onSubmit = vi.fn();
    const fetchMock = stubFetch();
    renderHome({ onSubmit });

    await clickHomeRailChip("video-crawler");
    await waitFor(() => expect(screen.getByTestId("home-hero-active-type-chip").textContent).toContain("视频爬取"));
    await setHomePrompt("下载 https://www.bilibili.com/video/BV1abcde1234/ 到素材库");
    await submitHome();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("下载 https://www.bilibili.com/video/BV1abcde1234/ 到素材库"),
          conversationMode: "comprehensive",
          pluginId: null,
          appliedPluginSnapshotId: null,
          projectKind: "other",
          projectMetadata: expect.objectContaining({
            kind: "other",
            skipDiscoveryBrief: true
          })
        })
      );
    });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/asset-library/commerce-videos/import/crawler")).toBe(
      false
    );
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/asset-library/commerce-videos/import/search")).toBe(
      false
    );
    expect(screen.queryByTestId("home-hero-workflow-status")).toBeNull();
  });

  it("keeps task buttons usable when the bundled task plugin is unavailable", async () => {
    const onSubmit = vi.fn();
    stubFetch({ plugins: [] });
    renderHome({ onSubmit });

    await clickHomeRailChip("video-crawler");

    await waitFor(() => {
      expect(homeHeroPromptText()).toContain("你是带货视频数据采集助手");
      expect((screen.getByTestId("home-hero-submit") as HTMLButtonElement).disabled).toBe(false);
    });
    await submitHome();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("你是带货视频数据采集助手"),
          projectKind: "other",
          projectMetadata: expect.objectContaining({
            kind: "other",
            skipDiscoveryBrief: true
          })
        })
      );
    });
  });
});

function renderHome(overrides: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  return render(
    <HomeView
      projects={[]}
      onSubmit={() => undefined}
      onOpenProject={() => undefined}
      onViewAllProjects={() => undefined}
      {...overrides}
    />
  );
}

function stubFetch(options: { plugins?: unknown[] } = {}) {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (typeof url === "string" && url === "/api/plugins") {
      return json({ plugins: options.plugins ?? [NEW_GENERATION_PLUGIN] });
    }
    if (typeof url === "string" && url === "/api/mcp/servers") {
      return json({ servers: [], templates: [] });
    }
    if (typeof url === "string" && url.includes("/api/plugins/od-new-generation/apply")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        inputs?: Record<string, unknown>;
        projectKind?: string;
      };
      return json({
        query: "{{prompt}}",
        contextItems: [],
        inputs: NEW_GENERATION_FIELDS,
        assets: [],
        mcpServers: [],
        trust: "trusted",
        capabilitiesGranted: ["prompt:inject"],
        capabilitiesRequired: ["prompt:inject"],
        appliedPlugin: {
          snapshotId: "snap-od-new-generation",
          pluginId: "od-new-generation",
          pluginVersion: "0.1.0",
          manifestSourceDigest: "c".repeat(64),
          inputs: body.inputs ?? {},
          resolvedContext: { items: [] },
          capabilitiesGranted: ["prompt:inject"],
          capabilitiesRequired: ["prompt:inject"],
          assetsStaged: [],
          taskKind: "new-generation",
          appliedAt: 0,
          connectorsRequired: [],
          connectorsResolved: [],
          mcpServers: [],
          status: "fresh"
        },
        projectMetadata: {
          kind: body.projectKind ?? "other"
        }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function clickHomeRailChip(id: string) {
  const activeChip = screen.queryByTestId("home-hero-active-type-chip");
  if (activeChip) {
    fireEvent.click(activeChip);
  }
  fireEvent.click(await screen.findByTestId(`home-hero-rail-${id}`));
}

async function setHomePrompt(value: string) {
  setHomeHeroPrompt(value);
  await act(async () => {
    await Promise.resolve();
  });
}

async function submitHome() {
  await waitFor(() => expect((screen.getByTestId("home-hero-submit") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId("home-hero-submit"));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
