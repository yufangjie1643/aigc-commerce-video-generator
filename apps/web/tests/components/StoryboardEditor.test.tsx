// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoryboardEditor } from "../../src/components/StoryboardEditor";
import { buildLauncherActions } from "../../src/components/workspace/tab-launcher";
import type { ProjectFile } from "../../src/types";

vi.mock("../../src/providers/registry", () => ({
  fetchProjectFileText: vi.fn(async () => null),
  projectFileUrl: (projectId: string, name: string) => `/projects/${projectId}/files/${encodeURIComponent(name)}`
}));

const commerceVideoMocks = vi.hoisted(() => ({
  exportCommerceVideo: vi.fn(),
  fetchCommerceVideoPreview: vi.fn(),
  fetchCommerceVideoWorkflow: vi.fn(),
  generateCommerceVideo: vi.fn(),
  saveCommerceVideoMaterials: vi.fn(),
  saveCommerceVideoScript: vi.fn(),
  saveCommerceVideoStoryboard: vi.fn(),
  saveCommerceVideoWorkbench: vi.fn(),
  waitCommerceVideoJob: vi.fn()
}));

vi.mock("../../src/providers/commerce-video", () => commerceVideoMocks);

beforeEach(() => {
  commerceVideoMocks.fetchCommerceVideoWorkflow.mockReturnValue(new Promise(() => {}));
  commerceVideoMocks.generateCommerceVideo.mockResolvedValue({
    taskId: "task-final",
    status: "running",
    workflow: generatedWorkflow({ exportStatus: "idle" })
  });
  commerceVideoMocks.waitCommerceVideoJob.mockResolvedValue({
    taskId: "task-final",
    status: "done",
    progress: ["video render complete"],
    nextSince: 1,
    file: { path: "commerce-video/final.mp4" }
  });
  commerceVideoMocks.fetchCommerceVideoPreview.mockResolvedValue({
    workflow: generatedWorkflow({ exportStatus: "idle" }),
    preview: { path: "commerce-video/final.mp4", name: "final.mp4" },
    export: {
      status: "idle",
      previewPath: "commerce-video/final.mp4",
      downloadPath: "commerce-video/final.mp4"
    }
  });
  commerceVideoMocks.exportCommerceVideo.mockResolvedValue({
    workflow: generatedWorkflow({ exportStatus: "done" }),
    preview: { path: "commerce-video/final.mp4", name: "final.mp4" },
    export: {
      status: "done",
      previewPath: "commerce-video/final.mp4",
      downloadPath: "commerce-video/final.mp4",
      manifestPath: "commerce-video/export-manifest.json"
    }
  });
  commerceVideoMocks.saveCommerceVideoMaterials.mockResolvedValue({ workflow: defaultWorkflow() });
  commerceVideoMocks.saveCommerceVideoScript.mockResolvedValue({ workflow: defaultWorkflow() });
  commerceVideoMocks.saveCommerceVideoStoryboard.mockResolvedValue({ workflow: defaultWorkflow() });
  commerceVideoMocks.saveCommerceVideoWorkbench.mockResolvedValue({ workflow: defaultWorkflow() });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function projectFile(name: string, kind: ProjectFile["kind"]): ProjectFile {
  return {
    name,
    size: 1024,
    mtime: 1,
    kind,
    mime: kind === "video" ? "video/mp4" : "image/png"
  };
}

function seedStoredShots(projectId: string): void {
  window.sessionStorage.setItem(
    `od:storyboard-editor:${projectId}`,
    JSON.stringify([
      {
        id: "shot-1",
        title: "开场钩子",
        sellingPoint: "翻领显精神",
        visual: "模特全身入镜，突出白色翻领和腰线。",
        assetName: "",
        assetIn: 0,
        assetOut: 3,
        duration: 3,
        dialogue: "夏天通勤，一条白裙就够了。",
        status: "synced",
        version: 1
      },
      {
        id: "shot-2",
        title: "细节证明",
        sellingPoint: "腰带和金扣",
        visual: "切到金属扣和腰带特写。",
        assetName: "",
        assetIn: 0,
        assetOut: 4,
        duration: 4,
        dialogue: "翻领、腰带和金扣一起拉出精致感。",
        status: "synced",
        version: 1
      },
      {
        id: "shot-3",
        title: "CTA 收口",
        sellingPoint: "通勤约会都能穿",
        visual: "全身回看，字幕给出行动引导。",
        assetName: "",
        assetIn: 0,
        assetOut: 4,
        duration: 4,
        dialogue: "喜欢就现在下单。",
        status: "synced",
        version: 1
      }
    ])
  );
}

function defaultWorkflow() {
  return {
    version: 1,
    projectId: "project-workflow",
    fileName: "commerce-video.workflow.json",
    stages: [
      { id: "materials", label: "Materials", status: "done" },
      { id: "script", label: "Script", status: "done" },
      { id: "storyboard", label: "Storyboard", status: "running" },
      { id: "generation", label: "Generation", status: "idle" },
      { id: "progress", label: "Progress", status: "idle" },
      { id: "export", label: "Export", status: "idle" }
    ],
    materials: { productMaterialIds: ["material-1"], uploadedFiles: [] },
    script: {
      title: "白色牛仔裙 15 秒带货脚本",
      hook: "三秒显瘦",
      voiceover: "高腰 A 字版型，遮胯又显腿长。",
      sellingPoints: ["高腰显腿长", "A 字版型遮胯", "白色百搭"],
      cta: "现在下单。"
    },
    storyboard: {
      totalDurationSec: 12,
      shots: [
        {
          id: "shot-1",
          index: 1,
          durationSec: 3,
          visualGoal: "开场展示穿搭",
          prompt: "Vertical ecommerce opening shot",
          voiceover: "三秒显瘦",
          requiredAssets: []
        },
        {
          id: "shot-2",
          index: 2,
          durationSec: 4,
          visualGoal: "版型特写",
          prompt: "Close-up product proof",
          voiceover: "遮胯又显腿长",
          requiredAssets: []
        },
        {
          id: "shot-3",
          index: 3,
          durationSec: 5,
          visualGoal: "场景收口",
          prompt: "Lifestyle scene CTA",
          voiceover: "通勤出街都能穿",
          requiredAssets: []
        }
      ]
    },
    createdAt: 1,
    updatedAt: 2
  };
}

function generatedWorkflow({ exportStatus }: { exportStatus: "idle" | "done" }) {
  const workflow = defaultWorkflow();
  return {
    ...workflow,
    stages: workflow.stages.map((stage) =>
      stage.id === "storyboard"
        ? { ...stage, status: "done" }
        : stage.id === "progress"
          ? { ...stage, status: "done" }
          : stage.id === "generation"
            ? { ...stage, status: "done" }
            : stage.id === "export"
              ? { ...stage, status: exportStatus }
              : stage
    ),
    generation: {
      status: "done",
      mediaTaskId: "task-final",
      model: "doubao-seedance-2-0-260128",
      output: { path: "commerce-video/final.mp4", name: "final.mp4" }
    },
    export: {
      status: exportStatus,
      previewPath: "commerce-video/final.mp4",
      downloadPath: "commerce-video/final.mp4",
      ...(exportStatus === "done" ? { manifestPath: "commerce-video/export-manifest.json" } : {})
    }
  };
}

function storyboardPendingWorkflow() {
  const workflow = defaultWorkflow();
  const { storyboard: _storyboard, ...withoutStoryboard } = workflow;
  return {
    ...withoutStoryboard,
    stages: workflow.stages.map((stage) =>
      stage.id === "storyboard" ? { ...stage, status: "running", detail: "waiting for storyboard" } : stage
    )
  };
}

function storyboardAwaitingGenerationWorkflow() {
  const workflow = defaultWorkflow();
  return {
    ...workflow,
    stages: workflow.stages.map((stage) =>
      stage.id === "storyboard"
        ? { ...stage, status: "done", detail: "storyboard ready" }
        : stage.id === "generation"
          ? { ...stage, status: "idle" }
          : stage
    ),
    workbench: {
      activeStageId: "storyboard",
      pendingNextStageId: "generation",
      selectedModel: "doubao-seedance-2-0-fast-260128"
    }
  };
}

async function enterNextStage(sidebar: HTMLElement, label: RegExp): Promise<void> {
  const button = await waitFor(() => within(sidebar).getByRole("button", { name: label }));
  fireEvent.click(button);
  await waitFor(() => {
    expect(within(sidebar).queryByRole("button", { name: label })).toBeNull();
  });
}

async function advanceToGeneration(sidebar: HTMLElement): Promise<void> {
  fireEvent.click(within(sidebar).getByRole("button", { name: /完成素材上传/ }));
  await enterNextStage(sidebar, /进入剧本生成/);

  fireEvent.change(screen.getAllByLabelText("脚本标题")[0]!, {
    target: { value: "白裙 15 秒带货脚本" }
  });
  fireEvent.change(screen.getAllByLabelText("卖点摘要")[0]!, {
    target: { value: "翻领显精神\n收腰显比例\n通勤约会都能穿" }
  });
  fireEvent.change(screen.getAllByLabelText("脚本正文")[0]!, {
    target: { value: "夏天通勤约会，一条白色翻领连衣裙就能切换场景。" }
  });
  fireEvent.click(within(sidebar).getByRole("button", { name: /保存剧本/ }));
  await waitFor(() => {
    expect(commerceVideoMocks.saveCommerceVideoScript).toHaveBeenCalled();
  });
  await enterNextStage(sidebar, /进入基础分镜/);

  fireEvent.click(within(sidebar).getByRole("button", { name: /完成分镜/ }));
  await waitFor(() => {
    expect(commerceVideoMocks.saveCommerceVideoStoryboard).toHaveBeenCalled();
  });
  await enterNextStage(sidebar, /进入一键成片/);
}

function allStatusText(): string {
  return screen
    .getAllByRole("status")
    .map((item) => item.textContent ?? "")
    .join("\n");
}

describe("StoryboardEditor", () => {
  it("loads project workflow progress and syncs script saves to the backend", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow.mockResolvedValue({ workflow: defaultWorkflow() });

    render(<StoryboardEditor projectId="project-workflow" files={[]} />);

    expect(await screen.findByLabelText("阶段右侧栏")).toBeTruthy();
    expect(screen.getAllByText("商品素材").length).toBeGreaterThan(0);
    expect(screen.getByText(/当前阶段：基础分镜/)).toBeTruthy();

    const sidebar = screen.getByLabelText("阶段右侧栏");
    fireEvent.click(within(sidebar).getByRole("button", { name: /剧本生成/ }));
    expect(screen.getAllByDisplayValue("白色牛仔裙 15 秒带货脚本").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /保存版本/ }));

    expect(commerceVideoMocks.saveCommerceVideoScript).toHaveBeenCalledWith(
      "project-workflow",
      expect.objectContaining({
        title: "白色牛仔裙 15 秒带货脚本",
        hook: "高腰显腿长",
        voiceover: "高腰 A 字版型，遮胯又显腿长。"
      })
    );
  });

  it("keeps workflow navigation in the right sidebar without a duplicate rail layer", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow.mockResolvedValue({ workflow: defaultWorkflow() });

    render(<StoryboardEditor projectId="project-workflow-compact" files={[]} />);

    expect(await screen.findByLabelText("阶段右侧栏")).toBeTruthy();
    expect(screen.queryByLabelText("任务进度")).toBeNull();
    expect(screen.getByText(/当前阶段：基础分镜/)).toBeTruthy();
  });

  it("restores the current workflow stage when the same project is opened again", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow.mockResolvedValue({ workflow: defaultWorkflow() });

    const first = render(<StoryboardEditor projectId="project-workflow" files={[]} />);

    expect(await screen.findByText(/当前阶段：基础分镜/)).toBeTruthy();
    first.unmount();

    render(<StoryboardEditor projectId="project-workflow" files={[]} />);

    expect(await screen.findByText(/当前阶段：基础分镜/)).toBeTruthy();
    expect(commerceVideoMocks.fetchCommerceVideoWorkflow).toHaveBeenCalledWith("project-workflow");
    expect(commerceVideoMocks.fetchCommerceVideoWorkflow).toHaveBeenCalledTimes(2);
  });

  it("shows a dedicated right sidebar for each workflow stage and marks the current stage", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow.mockResolvedValue({
      workflow: generatedWorkflow({ exportStatus: "done" })
    });

    render(<StoryboardEditor projectId="project-stage-sidebar" files={[]} />);

    const sidebar = await screen.findByLabelText("阶段右侧栏");
    expect(sidebar.textContent).toContain("预览导出");
    expect(sidebar.textContent).toContain("当前阶段");
    expect(sidebar.textContent).toContain("导出已就绪");

    fireEvent.click(within(sidebar).getByRole("button", { name: /商品素材/ }));
    expect(sidebar.textContent).toContain("商品素材记录");
    expect(sidebar.textContent).toContain("等待从聊天上传或素材库导入商品图");

    fireEvent.click(within(sidebar).getByRole("button", { name: /剧本生成/ }));
    expect(sidebar.textContent).toContain("保存剧本");
    expect(sidebar.textContent).toContain("优质视频库");
    expect(sidebar.textContent).not.toContain("生成分镜");

    fireEvent.click(within(sidebar).getByRole("button", { name: /基础分镜/ }));
    expect(sidebar.textContent).toContain("镜头标题");
    expect(sidebar.textContent).toContain("完成分镜");

    fireEvent.click(within(sidebar).getByRole("button", { name: /一键成片/ }));
    expect(sidebar.textContent).toContain("成片任务配置");
    expect(sidebar.textContent).toContain("生成成片");

    fireEvent.click(within(sidebar).getByRole("button", { name: /任务进度/ }));
    expect(sidebar.textContent).toContain("任务状态");
    expect(sidebar.textContent).toContain("等待任务完成");

    fireEvent.click(within(sidebar).getByRole("button", { name: /预览导出/ }));
    expect(sidebar.textContent).toContain("导出已就绪");
    expect(sidebar.textContent).toContain("commerce-video/export-manifest.json");
  });

  it("switches the central workbench between stage-specific consoles", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow.mockResolvedValue({
      workflow: generatedWorkflow({ exportStatus: "done" }),
      productMaterials: [
        {
          id: "material-1",
          title: "白色无袖翻领连衣裙",
          subject: "通勤连衣裙",
          category: "女装",
          sourceKind: "upload",
          status: "ready",
          files: [{ path: "white-dress.jpg", name: "white-dress.jpg", mime: "image/jpeg" }],
          product: {
            sellingPoints: ["100% 棉", "侧插兜"],
            constraints: [],
            suggestedAngles: []
          },
          createdAt: 1,
          updatedAt: 2
        }
      ]
    });

    render(<StoryboardEditor projectId="project-stage-consoles" files={[projectFile("white-dress.jpg", "image")]} />);

    const sidebar = await screen.findByLabelText("阶段右侧栏");
    expect(screen.getByLabelText("预览导出控制台")).toBeTruthy();

    fireEvent.click(within(sidebar).getByRole("button", { name: /商品素材/ }));
    expect(screen.getByLabelText("商品素材控制台").textContent).toContain("白色无袖翻领连衣裙");

    fireEvent.click(within(sidebar).getByRole("button", { name: /剧本生成/ }));
    expect(screen.getByLabelText("剧本生成控制台").textContent).toContain("保存剧本");
    expect(screen.getByLabelText("剧本生成控制台").textContent).toContain("优质视频库");
    expect(screen.getByLabelText("剧本生成控制台").textContent).toContain("方法论模板");
    expect(screen.queryByLabelText("基础分镜面板")).toBeNull();

    fireEvent.click(within(sidebar).getByRole("button", { name: /基础分镜/ }));
    expect(screen.getByLabelText("基础分镜控制台").textContent).toContain("完成分镜");
    expect(screen.queryByLabelText("脚本实体")).toBeNull();

    fireEvent.click(within(sidebar).getByRole("button", { name: /一键成片/ }));
    expect(screen.getByLabelText("一键成片控制台").textContent).toContain("创建成片任务");

    fireEvent.click(within(sidebar).getByRole("button", { name: /任务进度/ }));
    expect(screen.getByLabelText("任务进度控制台").textContent).toContain("等待任务完成");

    fireEvent.click(within(sidebar).getByRole("button", { name: /预览导出/ }));
    expect(screen.getByLabelText("预览导出控制台").textContent).toContain("生成预览与导出");
    expect(screen.queryByLabelText("任务进度")).toBeNull();
  });

  it("requires confirmation before advancing strict commerce-video stages", async () => {
    render(<StoryboardEditor projectId="project-strict-flow" files={[projectFile("product.png", "image")]} />);

    const sidebar = screen.getByLabelText("阶段右侧栏");
    expect(sidebar.textContent).toContain("商品素材");
    expect(
      within(sidebar)
        .getByRole("button", { name: /剧本生成/ })
        .hasAttribute("disabled")
    ).toBe(true);

    fireEvent.click(within(sidebar).getByRole("button", { name: /完成素材上传/ }));
    await waitFor(() => {
      expect(commerceVideoMocks.saveCommerceVideoMaterials).toHaveBeenCalledWith(
        "project-strict-flow",
        expect.objectContaining({
          uploadedFiles: [expect.objectContaining({ path: "product.png" })]
        })
      );
    });
    expect(sidebar.textContent).toContain("是否进入剧本生成");

    await enterNextStage(sidebar, /进入剧本生成/);
    expect(sidebar.textContent).toContain("剧本工作台");

    fireEvent.change(screen.getAllByLabelText("脚本标题")[0]!, {
      target: { value: "白裙 15 秒带货脚本" }
    });
    fireEvent.change(screen.getAllByLabelText("卖点摘要")[0]!, {
      target: { value: "翻领显精神\n收腰显比例\n通勤约会都能穿" }
    });
    fireEvent.change(screen.getAllByLabelText("脚本正文")[0]!, {
      target: { value: "夏天想要一条省心白裙，翻领和收腰一起把通勤感拉满。" }
    });
    fireEvent.change(screen.getAllByLabelText("CTA")[0]!, {
      target: { value: "喜欢就现在下单。" }
    });

    fireEvent.click(within(sidebar).getByRole("button", { name: /保存剧本/ }));
    await waitFor(() => {
      expect(commerceVideoMocks.saveCommerceVideoScript).toHaveBeenCalled();
    });
    expect(sidebar.textContent).toContain("是否进入基础分镜");

    await enterNextStage(sidebar, /进入基础分镜/);
    expect(sidebar.textContent).toContain("基础分镜面板");
  });

  it("builds a targeted prompt for shot-level video rerendering", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow.mockResolvedValue({ workflow: defaultWorkflow() });
    const onRequestAgentPrompt = vi.fn();
    const assetA = projectFile("assets/opening.mp4", "video");
    const assetB = projectFile("assets/product-closeup.mp4", "video");

    render(
      <StoryboardEditor
        projectId="project-alpha"
        files={[assetA, assetB]}
        onRequestAgentPrompt={onRequestAgentPrompt}
      />
    );

    const sidebar = await screen.findByLabelText("阶段右侧栏");
    fireEvent.click(within(sidebar).getByRole("button", { name: /基础分镜/ }));

    fireEvent.change(screen.getByLabelText("时长"), { target: { value: "5.5" } });
    fireEvent.change(screen.getByLabelText("素材切片"), {
      target: { value: assetB.name }
    });
    fireEvent.change(screen.getByLabelText("台词 / 口播"), {
      target: { value: "新版口播，突出防晒卖点。" }
    });

    fireEvent.click(screen.getByRole("button", { name: /快速重渲染/ }));

    expect(onRequestAgentPrompt).toHaveBeenCalledTimes(1);
    const prompt = onRequestAgentPrompt.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("只对标记为 [changed] 的单个分镜");
    expect(prompt).toContain("镜头 1 [changed]");
    expect(prompt).toContain("duration: 5.5s");
    expect(prompt).toContain(`asset: ${assetB.name}`);
    expect(prompt).toContain("dialogue: 新版口播，突出防晒卖点。");
    expect(screen.getByRole("status").textContent).toContain("已把分镜变更");
  });

  it("keeps the script workbench empty until the AI or user fills it", async () => {
    render(<StoryboardEditor projectId="project-script" files={[]} />);

    const sidebar = screen.getByLabelText("阶段右侧栏");
    fireEvent.click(within(sidebar).getByRole("button", { name: /完成素材上传/ }));
    await enterNextStage(sidebar, /进入剧本生成/);

    expect(screen.queryByDisplayValue("便携榨汁杯 15 秒带货脚本")).toBeNull();
    expect(screen.queryByDisplayValue("达人口吻种草脚本")).toBeNull();
    expect(screen.queryByDisplayValue("夏天通勤最怕晒黑又闷汗？")).toBeNull();
    expect(screen.getByText("0 镜")).toBeTruthy();

    fireEvent.change(screen.getAllByLabelText("脚本标题")[0]!, {
      target: { value: "白裙新品脚本" }
    });
    expect(screen.getAllByDisplayValue("白裙新品脚本").length).toBeGreaterThan(0);

    fireEvent.click(within(sidebar).getByRole("button", { name: /保存剧本/ }));
    expect(screen.getByRole("status").textContent).toContain("请先补齐脚本标题、卖点摘要和脚本正文");
    expect(commerceVideoMocks.saveCommerceVideoScript).not.toHaveBeenCalled();
  });

  it("requests AI script generation from reference-video methodology instead of prefilling the workbench", async () => {
    const onRequestAgentPrompt = vi.fn();

    render(
      <StoryboardEditor
        projectId="project-script-prompt"
        files={[projectFile("white-dress.jpg", "image")]}
        onRequestAgentPrompt={onRequestAgentPrompt}
      />
    );

    const sidebar = screen.getByLabelText("阶段右侧栏");
    fireEvent.click(within(sidebar).getByRole("button", { name: /完成素材上传/ }));
    await enterNextStage(sidebar, /进入剧本生成/);

    fireEvent.click(within(sidebar).getByRole("button", { name: /生成剧本提示词/ }));

    expect(onRequestAgentPrompt).toHaveBeenCalledTimes(1);
    const prompt = onRequestAgentPrompt.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("优质视频库");
    expect(prompt).toContain("方法论模板");
    expect(prompt).toContain("只输出剧本");
    expect(prompt).toContain("不要生成基础分镜");
    expect(prompt).toContain("white-dress.jpg");
    expect(screen.queryByDisplayValue("便携榨汁杯 15 秒带货脚本")).toBeNull();
  });

  it("requests AI storyboard generation without locally inventing a shot plan", async () => {
    const onRequestAgentPrompt = vi.fn();

    render(<StoryboardEditor projectId="project-shot-plan" files={[]} onRequestAgentPrompt={onRequestAgentPrompt} />);

    const sidebar = screen.getByLabelText("阶段右侧栏");
    fireEvent.click(within(sidebar).getByRole("button", { name: /完成素材上传/ }));
    await enterNextStage(sidebar, /进入剧本生成/);

    fireEvent.change(screen.getAllByLabelText("脚本标题")[0]!, {
      target: { value: "白裙脚本" }
    });
    fireEvent.change(screen.getAllByLabelText("卖点摘要")[0]!, {
      target: { value: "早餐太赶\n30 秒榨好\n一冲即净\n限时优惠" }
    });
    fireEvent.change(screen.getAllByLabelText("脚本正文")[0]!, {
      target: { value: "只把商品事实交给 AI，前端不本地编造分镜。" }
    });
    fireEvent.click(within(sidebar).getByRole("button", { name: /保存剧本/ }));
    await enterNextStage(sidebar, /进入基础分镜/);
    fireEvent.click(within(sidebar).getByRole("button", { name: /生成分镜提示词/ }));

    expect(onRequestAgentPrompt).toHaveBeenCalledTimes(1);
    const prompt = onRequestAgentPrompt.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("当前只处理基础分镜");
    expect(prompt).toContain("早餐太赶");
    expect(prompt).toContain("不要创建生成任务");
    expect(prompt).toContain("od commerce-video storyboard");
    expect(prompt).toContain("--storyboard-json");
    expect(prompt).toContain('"visualGoal"');
    expect(prompt).toContain('"prompt"');
    expect(screen.getByRole("status").textContent).toContain("已把分镜生成提示词");
    expect(commerceVideoMocks.saveCommerceVideoStoryboard).not.toHaveBeenCalled();
    expect(screen.getByText("0 镜")).toBeTruthy();
  });

  it("syncs storyboard shots from the workflow after an agent writes them", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow
      .mockResolvedValueOnce({ workflow: storyboardPendingWorkflow() })
      .mockResolvedValueOnce({ workflow: defaultWorkflow() });

    render(<StoryboardEditor projectId="project-agent-storyboard" files={[]} />);

    expect(await screen.findByText("0 镜")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /同步工作台/ }));

    await waitFor(() => {
      expect(screen.getByText("3 镜")).toBeTruthy();
    });
    expect(screen.getAllByText("镜头 1").length).toBeGreaterThan(0);
    expect(commerceVideoMocks.fetchCommerceVideoWorkflow).toHaveBeenCalledTimes(2);
  });

  it("keeps an agent-written completed stage waiting for user confirmation from the workflow file", async () => {
    commerceVideoMocks.fetchCommerceVideoWorkflow.mockResolvedValue({
      workflow: storyboardAwaitingGenerationWorkflow()
    });

    render(<StoryboardEditor projectId="project-agent-gated-stage" files={[]} />);

    const sidebar = await screen.findByLabelText("阶段右侧栏");
    await waitFor(() => {
      expect(screen.getByText(/当前阶段：基础分镜/)).toBeTruthy();
    });
    expect(sidebar.textContent).toContain("是否进入一键成片");
    expect(screen.getByLabelText("基础分镜控制台")).toBeTruthy();
    expect(screen.queryByLabelText("一键成片控制台")).toBeNull();
  });

  it("saves the selected video model to workflow state and uses it for final generation", async () => {
    seedStoredShots("project-model-select");
    render(<StoryboardEditor projectId="project-model-select" files={[]} />);

    const sidebar = screen.getByLabelText("阶段右侧栏");
    await advanceToGeneration(sidebar);

    fireEvent.change(within(sidebar).getByLabelText("视频生成模型"), {
      target: { value: "doubao-seedance-2-0-fast-260128" }
    });

    await waitFor(() => {
      expect(commerceVideoMocks.saveCommerceVideoWorkbench).toHaveBeenCalledWith(
        "project-model-select",
        expect.objectContaining({
          selectedModel: "doubao-seedance-2-0-fast-260128"
        })
      );
    });

    fireEvent.click(within(sidebar).getByRole("button", { name: /生成成片/ }));

    await waitFor(() => {
      expect(commerceVideoMocks.generateCommerceVideo).toHaveBeenCalledWith(
        "project-model-select",
        expect.objectContaining({
          model: "doubao-seedance-2-0-fast-260128"
        })
      );
    });
  });

  it("splits one-click generation, task progress, and export into gated stages", async () => {
    const onRequestAgentPrompt = vi.fn();
    seedStoredShots("project-export");

    render(<StoryboardEditor projectId="project-export" files={[]} onRequestAgentPrompt={onRequestAgentPrompt} />);

    const sidebar = screen.getByLabelText("阶段右侧栏");
    await advanceToGeneration(sidebar);

    fireEvent.change(screen.getByLabelText("格式"), { target: { value: "webm" } });
    fireEvent.change(screen.getByLabelText("尺寸"), { target: { value: "720x1280" } });
    fireEvent.click(within(sidebar).getByRole("button", { name: /生成成片/ }));

    expect(onRequestAgentPrompt).toHaveBeenCalledTimes(1);
    const prompt = onRequestAgentPrompt.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("一键成片阶段");
    expect(prompt).toContain("商品输入 -> 脚本 -> 分镜 -> TTS/BGM/字幕 -> <=15s 成片");
    expect(prompt).toContain("format: webm");
    expect(prompt).toContain("resolution: 720x1280");
    expect(prompt).toContain("subtitles: on");
    expect(screen.getByText("请求 1")).toBeTruthy();
    await waitFor(() => {
      expect(allStatusText()).toContain("已创建成片生成任务");
    });
    await waitFor(() => {
      expect(commerceVideoMocks.generateCommerceVideo).toHaveBeenCalledWith(
        "project-export",
        expect.objectContaining({
          model: "doubao-seedance-2-0-260128",
          output: expect.stringMatching(/^commerce-video\/export-\d+\.webm$/)
        })
      );
    });
    expect(commerceVideoMocks.waitCommerceVideoJob).not.toHaveBeenCalled();
    expect(commerceVideoMocks.exportCommerceVideo).not.toHaveBeenCalled();
    expect(sidebar.textContent).toContain("是否进入任务进度");

    await enterNextStage(sidebar, /进入任务进度/);
    fireEvent.click(within(sidebar).getByRole("button", { name: /等待任务完成/ }));

    await waitFor(() => {
      expect(commerceVideoMocks.waitCommerceVideoJob).toHaveBeenCalledWith("task-final", {
        since: 0,
        timeoutMs: 4000
      });
    });
    expect(commerceVideoMocks.exportCommerceVideo).not.toHaveBeenCalled();
    expect(sidebar.textContent).toContain("是否进入预览导出");

    await enterNextStage(sidebar, /进入预览导出/);
    fireEvent.click(within(sidebar).getByRole("button", { name: /生成预览与导出/ }));

    await waitFor(() => {
      expect(commerceVideoMocks.exportCommerceVideo).toHaveBeenCalledWith("project-export");
    });
    expect(commerceVideoMocks.waitCommerceVideoJob).toHaveBeenCalledWith("task-final", {
      since: 0,
      timeoutMs: 4000
    });
    expect(screen.getAllByText("video render complete").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/commerce-video\/final\.mp4/).length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain("成片已生成，可预览和导出");
  });

  it("can start final generation without a chat prompt callback", async () => {
    seedStoredShots("project-direct-export");
    render(<StoryboardEditor projectId="project-direct-export" files={[]} />);

    const sidebar = screen.getByLabelText("阶段右侧栏");
    await advanceToGeneration(sidebar);
    fireEvent.click(within(sidebar).getByRole("button", { name: /生成成片/ }));

    await waitFor(() => {
      expect(commerceVideoMocks.generateCommerceVideo).toHaveBeenCalledWith(
        "project-direct-export",
        expect.objectContaining({
          model: "doubao-seedance-2-0-260128"
        })
      );
    });
    expect(allStatusText()).toContain("已直接创建成片生成任务");
    expect(commerceVideoMocks.waitCommerceVideoJob).not.toHaveBeenCalled();
  });

  it("does not offer progress-stage confirmation when generation already failed", async () => {
    seedStoredShots("project-generation-failed");
    commerceVideoMocks.generateCommerceVideo.mockResolvedValueOnce({
      taskId: "task-auth-failed",
      status: "failed",
      workflow: {
        ...generatedWorkflow({ exportStatus: "idle" }),
        stages: generatedWorkflow({ exportStatus: "idle" }).stages.map((stage) =>
          stage.id === "generation"
            ? { ...stage, status: "done" }
            : stage.id === "progress"
              ? { ...stage, status: "failed", detail: "volcengine task create 401" }
              : stage
        ),
        generation: {
          status: "failed",
          mediaTaskId: "task-auth-failed",
          model: "doubao-seedance-2-0-260128",
          error: { message: "volcengine task create 401" }
        }
      }
    });

    render(<StoryboardEditor projectId="project-generation-failed" files={[]} />);

    const sidebar = screen.getByLabelText("阶段右侧栏");
    await advanceToGeneration(sidebar);
    fireEvent.click(within(sidebar).getByRole("button", { name: /生成成片/ }));

    await waitFor(() => {
      expect(allStatusText()).toContain("volcengine task create 401");
    });
    expect(allStatusText()).not.toContain("已创建成片生成任务");
    expect(sidebar.textContent).not.toContain("是否进入任务进度");
  });

  it("registers a workspace launcher action for the editor surface", () => {
    const createStoryboardEditor = vi.fn();
    const actions = buildLauncherActions({
      projectId: "project-alpha",
      openTab: vi.fn(),
      createStoryboardEditor
    });

    const action = actions.find((item) => item.id === "storyboard-editor");
    expect(action?.label).toBe("分镜剪辑");

    action?.run({
      projectId: "project-alpha",
      openTab: vi.fn(),
      createStoryboardEditor
    });

    expect(createStoryboardEditor).toHaveBeenCalledTimes(1);
  });
});
