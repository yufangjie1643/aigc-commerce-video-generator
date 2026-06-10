import { describe, expect, it } from "vitest";

import {
  COMMERCE_VIDEO_STAGE_ORDER,
  COMMERCE_VIDEO_WORKFLOW_FILE,
  type CommerceVideoWorkflow
} from "../src/api/commerce-video.js";

describe("commerce video workflow contract", () => {
  it("defines the P0 workflow file and ordered user-visible stages", () => {
    expect(COMMERCE_VIDEO_WORKFLOW_FILE).toBe("commerce-video.workflow.json");
    expect(COMMERCE_VIDEO_STAGE_ORDER).toEqual([
      "materials",
      "script",
      "storyboard",
      "generation",
      "progress",
      "export"
    ]);
  });

  it("represents a complete 15 second ecommerce video workflow", () => {
    const workflow: CommerceVideoWorkflow = {
      version: 1,
      projectId: "project_1",
      fileName: COMMERCE_VIDEO_WORKFLOW_FILE,
      stages: COMMERCE_VIDEO_STAGE_ORDER.map((id) => ({
        id,
        status: "done",
        label: id
      })),
      materials: {
        productAssetIds: ["product_1"],
        uploadedFiles: [{ path: "uploads/product.png", name: "product.png", mime: "image/png" }]
      },
      script: {
        title: "牛仔裙 15 秒带货短片",
        hook: "三秒看懂显瘦秘诀",
        voiceover: "这条短款牛仔裙抬高腰线，日常通勤和周末出街都能穿。",
        sellingPoints: ["高腰显腿长", "A 字版型遮胯", "白色百搭"]
      },
      storyboard: {
        totalDurationSec: 15,
        shots: [
          {
            id: "shot_1",
            index: 1,
            durationSec: 3,
            visualGoal: "开场展示整身穿搭",
            prompt: "Vertical ecommerce video opening shot of a white denim skirt outfit",
            voiceover: "三秒看懂显瘦秘诀",
            requiredAssets: ["product_1"]
          },
          {
            id: "shot_2",
            index: 2,
            durationSec: 4,
            visualGoal: "腰线和版型特写",
            prompt: "Close-up of high waist white denim skirt fit and fabric",
            voiceover: "高腰 A 字版型，遮胯又显腿长。",
            requiredAssets: ["product_1"]
          },
          {
            id: "shot_3",
            index: 3,
            durationSec: 4,
            visualGoal: "日常场景上身",
            prompt: "Lifestyle scene with the white denim skirt in motion",
            voiceover: "上班通勤和周末出街都能穿。",
            requiredAssets: ["product_1"]
          }
        ]
      },
      generation: {
        status: "done",
        mediaTaskId: "task_1",
        model: "doubao-seedance-2-0-260128",
        aspect: "9:16",
        lengthSec: 15,
        output: { path: "commerce-video/final.mp4", mime: "video/mp4" }
      },
      export: {
        status: "done",
        manifestPath: "commerce-video/export-manifest.json",
        downloadPath: "commerce-video/final.mp4"
      },
      createdAt: 1,
      updatedAt: 2
    };

    expect(workflow.storyboard?.shots.length).toBeGreaterThanOrEqual(3);
    expect(workflow.storyboard?.shots.length).toBeLessThanOrEqual(6);
    expect(workflow.storyboard?.totalDurationSec).toBeLessThanOrEqual(15);
    expect(workflow.generation?.output?.mime).toBe("video/mp4");
  });
});
