// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listCommerceVideoAssetsMock, listProductAssetsMock, listQualityVideoAssetsMock } = vi.hoisted(() => ({
  listCommerceVideoAssetsMock: vi.fn(),
  listProductAssetsMock: vi.fn(),
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
  listProductAssets: listProductAssetsMock,
  listQualityVideoAssets: listQualityVideoAssetsMock,
  processCommerceVideoAsset: vi.fn(),
  processQualityVideoAsset: vi.fn(),
  sliceCommerceVideoAsset: vi.fn(),
  updateCommerceVideoAsset: vi.fn(),
  updateQualityVideoAsset: vi.fn(),
  uploadCommerceVideoAsset: vi.fn(),
  uploadProductAssetImage: vi.fn(),
  uploadQualityVideoAsset: vi.fn(),
  waitAssetLibraryJob: vi.fn()
}));

import { AssetLibraryView } from "../../src/components/AssetLibraryView";

describe("AssetLibraryView", () => {
  beforeEach(() => {
    listProductAssetsMock.mockResolvedValue({
      products: [
        {
          id: "product-1",
          title: "白色短款牛仔裙",
          subject: "牛仔裙",
          category: "女装",
          sourceKind: "upload",
          status: "ready",
          files: [{ path: "products/product-1/main.png", name: "main.png", mime: "image/png" }],
          product: {
            sellingPoints: ["高腰显腿长", "A 字版型遮胯"],
            constraints: [],
            suggestedAngles: ["通勤穿搭"],
            summary: "适合 15 秒带货短片的商品图"
          },
          createdAt: 1,
          updatedAt: 2
        }
      ]
    });
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

    expect(listProductAssetsMock).not.toHaveBeenCalled();
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
    listProductAssetsMock.mockResolvedValue({
      products: [
        {
          id: "product-duplicate-labels",
          title: "灰色无袖牛仔连衣裙",
          subject: "灰色无袖牛仔连衣裙",
          category: "灰色无袖牛仔连衣裙",
          sourceKind: "upload",
          status: "ready",
          files: [{ path: "products/product-duplicate-labels/main.png", name: "main.png", mime: "image/png" }],
          product: {
            sellingPoints: ["灰色无袖牛仔连衣裙", "高腰显腿长", "灰色无袖牛仔连衣裙"],
            constraints: [],
            suggestedAngles: ["通勤穿搭"],
            summary: "重复标签来自模型识别的商品名、类目和卖点。"
          },
          createdAt: 1,
          updatedAt: 2
        }
      ]
    });
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

    expect(listProductAssetsMock).not.toHaveBeenCalled();
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
