// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listCommerceVideoAssetsMock, listQualityVideoAssetsMock } = vi.hoisted(() => ({
  listCommerceVideoAssetsMock: vi.fn(),
  listQualityVideoAssetsMock: vi.fn()
}));

vi.mock("../../src/providers/asset-library", () => ({
  batchProcessCommerceVideoAssets: vi.fn(),
  createQualityVideoAsset: vi.fn(),
  deleteCommerceVideoAsset: vi.fn(),
  deleteQualityVideoAsset: vi.fn(),
  embedCommerceVideoAsset: vi.fn(),
  embedQualityVideoAsset: vi.fn(),
  getCommerceVideoAsset: vi.fn(),
  getQualityVideoAsset: vi.fn(),
  importCrawlerCommerceVideo: vi.fn(),
  importQualityVideoSearch: vi.fn(),
  listCommerceVideoAssets: listCommerceVideoAssetsMock,
  listQualityVideoAssets: listQualityVideoAssetsMock,
  processCommerceVideoAsset: vi.fn(),
  processQualityVideoAsset: vi.fn(),
  sliceCommerceVideoAsset: vi.fn(),
  updateCommerceVideoAsset: vi.fn(),
  updateQualityVideoAsset: vi.fn(),
  uploadCommerceVideoAsset: vi.fn(),
  uploadQualityVideoAsset: vi.fn(),
  waitAssetLibraryJob: vi.fn()
}));

import { AssetLibraryView } from "../../src/components/AssetLibraryView";

describe("AssetLibraryView", () => {
  beforeEach(() => {
    listCommerceVideoAssetsMock.mockResolvedValue({ videos: [] });
    listQualityVideoAssetsMock.mockResolvedValue({ videos: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("omits project-owned product materials from the global material library workbench", async () => {
    render(<AssetLibraryView />);

    expect(await screen.findByRole("heading", { name: "素材库工作台" })).toBeTruthy();

    await waitFor(() => {
      expect(listCommerceVideoAssetsMock).toHaveBeenCalled();
      expect(listQualityVideoAssetsMock).toHaveBeenCalled();
    });

    expect(screen.queryByRole("tab", { name: /商品素材/ })).toBeNull();
    expect(screen.queryByText("Product Intake")).toBeNull();
    expect(screen.queryByRole("heading", { name: "录入商品素材" })).toBeNull();
    expect(screen.queryByRole("button", { name: /上传商品素材/ })).toBeNull();
    expect(screen.queryByText("白色短款牛仔裙")).toBeNull();
    expect(screen.getByRole("tab", { name: /带货视频库/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /优质视频库/ })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索视频标题、商品、类目或方法论")).toBeTruthy();
  });

  it("renders repeated product and video labels without React key warnings", async () => {
    listCommerceVideoAssetsMock.mockResolvedValue({
      videos: [
        {
          id: "video-duplicate-labels",
          title: "灰色无袖牛仔连衣裙视频",
          sourceKind: "upload",
          status: "ready",
          product: {
            subject: "灰色无袖牛仔连衣裙",
            category: "女装"
          },
          video: {
            summary: "重复方法论标签也必须保持稳定渲染。"
          },
          methodology: {
            hooks: ["灰色无袖牛仔连衣裙", "灰色无袖牛仔连衣裙"],
            structure: ["上身展示"],
            sellingTriggers: ["灰色无袖牛仔连衣裙"],
            styleTags: []
          },
          metadata: {},
          createdAt: 1,
          updatedAt: 2
        }
      ]
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(<AssetLibraryView />);

      expect(await screen.findByText("灰色无袖牛仔连衣裙视频")).toBeTruthy();
      expect(screen.queryByRole("tab", { name: /商品素材/ })).toBeNull();

      const keyWarnings = consoleError.mock.calls.filter((call) =>
        call.some((part) => String(part).includes("same key"))
      );
      expect(keyWarnings).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("deduplicates the initial material refresh under React StrictMode", async () => {
    render(
      <StrictMode>
        <AssetLibraryView />
      </StrictMode>
    );

    await waitFor(() => {
      expect(listCommerceVideoAssetsMock).toHaveBeenCalled();
      expect(listQualityVideoAssetsMock).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listCommerceVideoAssetsMock).toHaveBeenCalledTimes(1);
    expect(listQualityVideoAssetsMock).toHaveBeenCalledTimes(1);
  });

  it("does not preload source videos from list cards", async () => {
    listCommerceVideoAssetsMock.mockResolvedValue({
      videos: [
        {
          id: "video-file",
          title: "素材视频",
          sourceKind: "upload",
          status: "ready",
          file: { path: "commerce-videos/video-file/original.mp4", mime: "video/mp4" },
          product: {
            subject: "连衣裙",
            category: "女装"
          },
          video: {
            durationMs: 15_000,
            summary: "列表卡片不应为了封面预加载源视频。"
          },
          methodology: {
            hooks: ["上身展示"],
            structure: ["开场", "展示"],
            sellingTriggers: ["效果直观"],
            styleTags: []
          },
          metadata: {},
          createdAt: 1,
          updatedAt: 2
        }
      ]
    });

    const { container } = render(<AssetLibraryView />);

    expect(await screen.findByText("素材视频")).toBeTruthy();
    expect(container.querySelector('video[src*="commerce-videos/video-file/original.mp4"]')).toBeNull();
  });
});
