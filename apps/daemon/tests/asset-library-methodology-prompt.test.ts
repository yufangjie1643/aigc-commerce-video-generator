import { describe, expect, it } from "vitest";

import {
  buildCommerceVideoMethodologyPrompt,
  buildQualityVideoMethodologyPrompt
} from "../src/routes/asset-library.js";

describe("asset library methodology prompt", () => {
  const stats = {
    videoCount: 1,
    sliceCount: 1,
    embeddedVideoCount: 1,
    embeddedSliceCount: 1
  };

  const source = {
    video: {
      id: "video-1",
      title: "痛点诊断带货视频",
      sourceKind: "manual",
      status: "ready",
      product: { subject: "课程", category: "知识付费" },
      video: { summary: "先诊断痛点，再拆关键词。" },
      methodology: {
        hooks: ["先问一个高频痛点"],
        structure: ["痛点", "诊断", "关键词拆解", "CTA"],
        sellingTriggers: ["权威背书"],
        styleTags: ["知识付费"]
      },
      metadata: {}
    },
    slices: [
      {
        id: "slice-1",
        startMs: 0,
        endMs: 3000,
        features: { hook: "你是不是也遇到这个问题？" },
        thumbnail: {},
        embedding: { dimensions: 1024 }
      }
    ]
  } as any;

  it("requires generated commerce child skill payloads to carry Chinese display copy", () => {
    const prompt = buildCommerceVideoMethodologyPrompt([source], stats);

    expect(prompt).toContain("child skill payload");
    expect(prompt).toContain("displayName");
    expect(prompt).toContain("descriptionI18n");
    expect(prompt).toContain("zh-CN");
    expect(prompt).toContain("用户可见的 name/description 必须提供中文展示文案");
  });

  it("requires generated quality-video child skill payloads to carry Chinese display copy", () => {
    const prompt = buildQualityVideoMethodologyPrompt([source], stats);

    expect(prompt).toContain("child skill payload");
    expect(prompt).toContain("displayName");
    expect(prompt).toContain("descriptionI18n");
    expect(prompt).toContain("zh-CN");
    expect(prompt).toContain("用户可见的 name/description 必须提供中文展示文案");
  });
});
