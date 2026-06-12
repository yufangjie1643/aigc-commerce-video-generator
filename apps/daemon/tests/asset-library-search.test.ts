import { describe, expect, it } from "vitest";

import {
  expandAssetLibrarySearchTerms,
  rankAssetLibrarySearchMatches,
  rankAssetLibrarySearchResults
} from "../src/asset-library-search.js";

describe("asset library search ranking", () => {
  it("expands skirt queries so 裙子 can find dress category assets", () => {
    expect(expandAssetLibrarySearchTerms("裙子")).toContain("裙");

    const results = rankAssetLibrarySearchResults(
      [
        { id: "shirt", text: "商品素材：通勤衬衫 类目：服饰 上衣" },
        { id: "dress", text: "商品素材：夏季白色衬衫裙 类目：服饰 连衣裙" }
      ],
      "裙子",
      {
        limit: 10,
        textFor: (asset) => asset.text,
        vectorFor: () => undefined
      }
    );

    expect(results.map((asset) => asset.id)).toEqual(["dress"]);
  });

  it("uses stored vectors when the query has no lexical overlap", () => {
    const results = rankAssetLibrarySearchResults(
      [
        { id: "unrelated", text: "商品素材：保温杯", vector: [0, 1] },
        { id: "semantic-dress", text: "商品素材：新品", vector: [0.98, 0.02] }
      ],
      "裙子",
      {
        limit: 10,
        queryVector: [1, 0],
        textFor: (asset) => asset.text,
        vectorFor: (asset) => asset.vector
      }
    );

    expect(results.map((asset) => asset.id)).toEqual(["semantic-dress"]);
  });

  it("uses explicit tags as a high-signal retrieval field", () => {
    const results = rankAssetLibrarySearchMatches(
      [
        { id: "generic-video", text: "带货视频：日常穿搭合集", tags: ["穿搭", "口播"] },
        { id: "dress-slice", text: "带货视频切片：新品展示", tags: ["连衣裙", "显瘦", "成交诱因"] }
      ],
      "",
      {
        limit: 10,
        tags: ["裙子"],
        textFor: (asset) => asset.text,
        tagsFor: (asset) => asset.tags,
        vectorFor: () => undefined
      }
    );

    expect(results.map((item) => item.asset.id)).toEqual(["dress-slice"]);
    expect(results[0]?.tagScore).toBeGreaterThan(0);
  });
});
