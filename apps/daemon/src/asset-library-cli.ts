// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolveDaemonUrl } from "./daemon-url.js";

const STRING_FLAGS = new Set([
  "daemon-url",
  "ffmpeg-path",
  "ffprobe-path",
  "provider",
  "api-key",
  "base-url",
  "endpoint-path",
  "model",
  "label",
  "headers-json",
  "input-mapping-json",
  "title",
  "subject",
  "category",
  "selling-points",
  "constraints",
  "suggested-angles",
  "summary",
  "text",
  "metadata-json",
  "report-json",
  "patch-json",
  "source-name",
  "source-url",
  "source-video-id",
  "duration-ms",
  "hooks",
  "structure",
  "selling-triggers",
  "style-tags",
  "connector",
  "tool",
  "url",
  "video-id",
  "resolution",
  "input-json",
  "product-json",
  "video-json",
  "methodology-json",
  "project",
  "purpose",
  "note",
  "limit",
  "concurrency",
  "mode",
  "ids",
  "query",
  "keyword",
  "tag",
  "tags",
  "kind",
  "kinds",
  "granularity",
  "sort",
  "prompt",
  "prompt-file",
  "path"
]);

const BOOLEAN_FLAGS = new Set([
  "help",
  "h",
  "json",
  "auto-detect",
  "no-auto-detect",
  "preserve-api-key",
  "wait",
  "public-test",
  "include-slices",
  "no-include-slices",
  "include-embeddings",
  "no-include-embeddings",
  "include-vectors",
  "only-unprocessed",
  "recursive",
  "no-recursive",
  "dry-run",
  "process",
  "no-process",
  "yes"
]);

export async function runAssetsCli(args: string[]): Promise<{ exitCode: number }> {
  if (args.length === 0 || args[0] === "help" || args.includes("--help") || args.includes("-h")) {
    printAssetsHelp();
    return { exitCode: args.length === 0 ? 2 : 0 };
  }

  let flags: Record<string, any>;
  try {
    flags = parseFlags(args, { string: STRING_FLAGS, boolean: BOOLEAN_FLAGS });
  } catch (error: any) {
    console.error(error.message);
    printAssetsHelp();
    return { exitCode: 2 };
  }

  const positionals = positionalArgs(args, STRING_FLAGS);
  const [section, action, first, second] = positionals;
  if (!section || (section !== "status" && section !== "search" && !action)) {
    printAssetsHelp();
    return { exitCode: 2 };
  }

  const base = (await resolveDaemonUrl({ flagUrl: flags["daemon-url"] })).replace(/\/$/, "");
  try {
    switch (section) {
      case "status":
        await runAssetStatus(base, action, flags);
        return { exitCode: 0 };
      case "tools":
        await runAssetTools(base, action, flags);
        return { exitCode: 0 };
      case "embedding":
        await runAssetEmbedding(base, action, flags);
        return { exitCode: 0 };
      case "search":
        await runAssetSearch(base, action, first, flags);
        return { exitCode: 0 };
      case "products":
        await runAssetProducts(base, action, first, second, flags);
        return { exitCode: 0 };
      case "commerce-videos":
      case "commerce":
        await runCommerceVideos(base, action, first, second, flags);
        return { exitCode: 0 };
      case "quality-videos":
      case "quality":
        await runQualityVideos(base, action, first, second, flags);
        return { exitCode: 0 };
      case "jobs":
        await runAssetJobs(base, action, first, flags);
        return { exitCode: 0 };
      default:
        console.error(`unknown subcommand: od assets ${section}`);
        printAssetsHelp();
        return { exitCode: 2 };
    }
  } catch (error: any) {
    if (flags.json) {
      writeJson({ ok: false, error: { message: error.message, status: error.status, data: error.data } });
    } else {
      console.error(`[assets] ${error.message}`);
    }
    return { exitCode: error.status ? 1 : 2 };
  }
}

async function runAssetStatus(base: string, action: string | undefined, flags: Record<string, any>) {
  if (action && action !== "get") {
    throw new Error("usage: od assets status [--json]");
  }
  const [tools, embedding, productsData, videosData, qualityData] = await Promise.all([
    requestJson(base, "/api/asset-library/tool-config"),
    requestJson(base, "/api/asset-library/embedding-config"),
    requestJson(base, "/api/asset-library/products"),
    requestJson(base, "/api/asset-library/commerce-videos"),
    requestJson(base, "/api/asset-library/quality-videos")
  ]);
  const products = Array.isArray(productsData.products) ? productsData.products : [];
  const videos = Array.isArray(videosData.videos) ? videosData.videos : [];
  const qualityVideos = Array.isArray(qualityData.videos) ? qualityData.videos : [];
  const status = {
    ok: true,
    tools: tools.tools ?? tools,
    embedding: embedding.embedding ?? embedding,
    products: {
      count: products.length,
      byStatus: countByStatus(products),
      recent: products.slice(0, 10).map(productSummary)
    },
    commerceVideos: {
      count: videos.length,
      byStatus: countByStatus(videos),
      recent: videos.slice(0, 10).map(commerceVideoSummary)
    },
    qualityVideos: {
      count: qualityVideos.length,
      byStatus: countByStatus(qualityVideos),
      recent: qualityVideos.slice(0, 10).map(commerceVideoSummary)
    }
  };
  if (flags.json) return writeJson(status);

  const toolConfig = status.tools ?? {};
  const embeddingConfig = status.embedding ?? {};
  console.log(
    `[assets] products=${status.products.count} commerceVideos=${status.commerceVideos.count} qualityVideos=${status.qualityVideos.count}`
  );
  console.log(
    `tools=ffmpeg:${toolConfig.ffmpegPath ? "configured" : "missing"} ffprobe:${toolConfig.ffprobePath ? "configured" : "missing"}`
  );
  console.log(
    `embedding=${embeddingConfig.apiKeyConfigured ? "configured" : "missing"} provider=${embeddingConfig.providerId ?? "-"} model=${embeddingConfig.model ?? "-"}`
  );
  if (status.products.recent.length > 0) {
    console.log("recent products:");
    for (const product of status.products.recent) {
      console.log(`  ${product.id}\t${product.status}\t${product.category || "-"}\t${product.title}`);
    }
  }
  if (status.commerceVideos.recent.length > 0) {
    console.log("recent commerce videos:");
    for (const video of status.commerceVideos.recent) {
      console.log(
        `  ${video.id}\t${video.status}\t${video.sourceConnectorId || video.sourceKind || "-"}\t${video.title}`
      );
    }
  }
  if (status.qualityVideos.recent.length > 0) {
    console.log("recent quality videos:");
    for (const video of status.qualityVideos.recent) {
      console.log(
        `  ${video.id}\t${video.status}\t${video.sourceConnectorId || video.sourceKind || "-"}\t${video.title}`
      );
    }
  }
}

async function runAssetTools(base: string, action: string, flags: Record<string, any>) {
  switch (action) {
    case "get": {
      const data = await requestJson(base, "/api/asset-library/tool-config");
      return outputTools(data, flags);
    }
    case "set": {
      const data = await requestJson(base, "/api/asset-library/tool-config", {
        method: "PUT",
        body: toolBodyFromFlags(flags)
      });
      return outputTools(data, flags);
    }
    case "test": {
      const data = await requestJson(base, "/api/asset-library/tool-config/test", {
        method: "POST",
        body: { tools: toolBodyFromFlags(flags) }
      });
      if (flags.json) return writeJson(data);
      const ffmpeg = data.ffmpeg?.ok ? "ok" : (data.ffmpeg?.error ?? "failed");
      const ffprobe = data.ffprobe?.ok ? "ok" : (data.ffprobe?.error ?? "failed");
      console.log(`[assets] tools ${data.ok ? "ok" : "failed"} ffmpeg=${ffmpeg} ffprobe=${ffprobe}`);
      return;
    }
    default:
      throw new Error("usage: od assets tools <get|set|test> [--json]");
  }
}

async function runAssetEmbedding(base: string, action: string, flags: Record<string, any>) {
  switch (action) {
    case "get": {
      const data = await requestJson(base, "/api/asset-library/embedding-config");
      return outputEmbedding(data, flags);
    }
    case "set": {
      const data = await requestJson(base, "/api/asset-library/embedding-config", {
        method: "PUT",
        body: { embedding: embeddingBodyFromFlags(flags) }
      });
      return outputEmbedding(data, flags);
    }
    case "test": {
      const data = await requestJson(base, "/api/asset-library/embedding-config/test", {
        method: "POST",
        body: { embedding: embeddingBodyFromFlags(flags) }
      });
      if (flags.json) return writeJson(data);
      const suffix = data.dimensions ? ` dimensions=${data.dimensions}` : data.detail ? ` ${data.detail}` : "";
      console.log(`[assets] embedding ${data.ok ? "ok" : data.kind}${suffix}`);
      return;
    }
    default:
      throw new Error("usage: od assets embedding <get|set|test> [--json]");
  }
}

async function runAssetSearch(
  base: string,
  action: string | undefined,
  first: string | undefined,
  flags: Record<string, any>
) {
  const prompt = await readPromptFromFlags(flags);
  const query = flags.query ?? flags.keyword ?? prompt ?? action ?? first;
  const tags = splitList(flags.tags ?? flags.tag);
  if (!query && tags.length === 0) {
    throw new Error(
      "usage: od assets search [--query <text>|--prompt-file <path|->] [--tags a,b] [--kind products|commerce-videos|quality-videos|all] [--granularity asset|slice|all] [--limit <n>] [--json]"
    );
  }
  const body = {
    ...(query ? { query } : {}),
    ...(tags.length ? { tags } : {}),
    ...(flags.kind || flags.kinds ? { kind: splitList(flags.kind ?? flags.kinds) } : {}),
    ...(flags.granularity ? { granularity: flags.granularity } : {}),
    ...(flags.limit ? { limit: Number(flags.limit) } : {}),
    ...(flags["include-vectors"] ? { includeVectors: true } : {})
  };
  const data = await requestJson(base, "/api/asset-library/search", { method: "POST", body });
  if (flags.json) return writeJson(data);
  return printAssetSearchResults(data);
}

async function runAssetProducts(
  base: string,
  action: string,
  first: string | undefined,
  second: string | undefined,
  flags: Record<string, any>
) {
  switch (action) {
    case "list": {
      const query = new URLSearchParams();
      if (flags.query) query.set("query", flags.query);
      if (flags.limit) query.set("limit", flags.limit);
      const data = await requestJson(base, `/api/asset-library/products${query.size ? `?${query}` : ""}`);
      if (flags.json) return writeJson(data);
      for (const product of data.products ?? []) {
        console.log(`${product.id}\t${product.status}\t${product.category || "-"}\t${product.title}`);
      }
      return;
    }
    case "get": {
      if (!first) throw new Error("usage: od assets products get <id> [--json]");
      const data = await requestJson(base, `/api/asset-library/products/${encodeURIComponent(first)}`);
      return flags.json ? writeJson(data) : printProduct(data.product);
    }
    case "import": {
      const prompt = await readPromptFromFlags(flags);
      const metadata = {
        ...jsonFlag(flags["metadata-json"], {}),
        ...(prompt ? { prompt } : {})
      };
      const body = {
        title: flags.title ?? first,
        subject: flags.subject,
        category: flags.category,
        sellingPoints: splitList(flags["selling-points"]),
        constraints: splitList(flags.constraints),
        suggestedAngles: splitList(flags["suggested-angles"]),
        summary: flags.summary,
        metadata
      };
      if (!body.title) throw new Error("usage: od assets products import --title <title> [--subject <text>]");
      const data = await requestJson(base, "/api/asset-library/products", { method: "POST", body });
      return flags.json ? writeJson(data) : console.log(`[assets] product imported ${data.product?.id ?? "-"}`);
    }
    case "import-image":
    case "import-upload": {
      const localPath = flags.path ?? first;
      if (!localPath) {
        throw new Error(
          "usage: od assets products import-image <localpath> [--title <title>] [--subject <text>] [--category <text>]"
        );
      }
      const data = await uploadProductImage(base, localPath, flags);
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] product image imported ${out.product?.id ?? "-"} job=${out.job?.id ?? "-"}`);
    }
    case "import-folder":
    case "ingest-folder": {
      const folderPath = flags.path ?? first;
      if (!folderPath) {
        throw new Error(
          "usage: od assets products import-folder <folder> [--mode serial|parallel] [--concurrency <n>] [--dry-run] [--json]"
        );
      }
      const prompt = await readPromptFromFlags(flags);
      const body = {
        path: folderPath,
        recursive: flags["no-recursive"] ? false : true,
        dryRun: Boolean(flags["dry-run"]),
        mode: flags.mode === "serial" ? "serial" : "parallel",
        concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
        limit: flags.limit ? Number(flags.limit) : undefined,
        providerId: flags.provider,
        model: flags.model,
        ...(prompt ? { prompt } : {}),
        ...(flags["no-process"] ? { processImported: false } : flags.process ? { processImported: true } : {})
      };
      const data = await requestJson(base, "/api/asset-library/products/import/folder", {
        method: "POST",
        body
      });
      if (flags.wait && !data.dryRun) {
        for (const item of data.imported ?? []) {
          if (item.processJobId) {
            item.processJob = await waitForJob(base, { id: item.processJobId }, flags);
          }
        }
      }
      return flags.json ? writeJson(data) : printProductFolderIngest(data);
    }
    case "process": {
      if (!first) throw new Error("usage: od assets products process <id> [--wait] [--json]");
      const data = await requestJson(base, `/api/asset-library/products/${encodeURIComponent(first)}/process`, {
        method: "POST"
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] product job ${out.job?.id ?? "-"} ${out.job?.status ?? "-"}`);
    }
    case "update": {
      if (!first)
        throw new Error("usage: od assets products update <id> --yes [--title <title>] [--patch-json <json>] [--json]");
      if (!flags.yes) {
        throw new Error(`dangerous operation: re-run with --yes to update product asset ${first}`);
      }
      const body = productUpdateBodyFromFlags(flags);
      const data = await requestJson(base, `/api/asset-library/products/${encodeURIComponent(first)}`, {
        method: "PATCH",
        body
      });
      return flags.json ? writeJson(data) : console.log(`[assets] product updated ${data.product?.id ?? "-"}`);
    }
    case "delete": {
      if (!first) throw new Error("usage: od assets products delete <id> --yes [--json]");
      if (!flags.yes) {
        throw new Error(`dangerous operation: re-run with --yes to delete product asset ${first}`);
      }
      const data = await requestJson(base, `/api/asset-library/products/${encodeURIComponent(first)}`, {
        method: "DELETE"
      });
      if (flags.json) return writeJson(data);
      console.log(`[assets] product deleted ${data.product?.id ?? first}`);
      if (data.warning) console.warn(`[assets] warning: ${data.warning}`);
      return;
    }
    case "embed": {
      if (!first)
        throw new Error(
          "usage: od assets products embed <id> [--text <text>|--prompt-file <path|->] [--wait] [--json]"
        );
      const prompt = await readPromptFromFlags(flags);
      const data = await requestJson(base, `/api/asset-library/products/${encodeURIComponent(first)}/embed`, {
        method: "POST",
        body: { ...(flags.text || prompt ? { text: flags.text ?? prompt } : {}) }
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] product embedding job ${out.job?.id ?? "-"} ${out.job?.status ?? "-"}`);
    }
    case "context": {
      const projectId = flags.project ?? first;
      const assetId = flags.project ? first : second;
      if (!projectId || !assetId) {
        throw new Error("usage: od assets products context <projectId> <assetId> [--purpose <text>] [--note <text>]");
      }
      const data = await requestJson(base, `/api/projects/${encodeURIComponent(projectId)}/asset-library/context`, {
        method: "POST",
        body: { refs: [{ productAssetId: assetId, purpose: flags.purpose, note: flags.note }] }
      });
      return flags.json
        ? writeJson(data)
        : console.log(`[assets] project ${projectId} context set (${data.refs?.length ?? 0})`);
    }
    default:
      throw new Error(
        "usage: od assets products <list|get|import|import-image|import-folder|import-upload|update|delete|process|embed|context>"
      );
  }
}

async function runCommerceVideos(
  base: string,
  action: string,
  first: string | undefined,
  second: string | undefined,
  flags: Record<string, any>
) {
  switch (action) {
    case "list": {
      const query = new URLSearchParams();
      if (flags.query) query.set("query", flags.query);
      if (flags.limit) query.set("limit", flags.limit);
      const data = await requestJson(base, `/api/asset-library/commerce-videos${query.size ? `?${query}` : ""}`);
      if (flags.json) return writeJson(data);
      for (const video of data.videos ?? []) {
        console.log(`${video.id}\t${video.status}\t${video.sourceKind}\t${video.title}`);
      }
      return;
    }
    case "get": {
      if (!first) throw new Error("usage: od assets commerce-videos get <id> [--json]");
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}`);
      return flags.json ? writeJson(data) : printCommerceVideo(data.video, data.slices);
    }
    case "import-crawler": {
      const prompt = await readPromptFromFlags(flags);
      const input = {
        ...jsonFlag(flags["input-json"], {}),
        ...(flags.resolution ? { resolution: flags.resolution } : {}),
        ...(prompt ? { prompt } : {})
      };
      const body = {
        connectorId: flags.connector ?? first,
        toolName: flags.tool,
        url: flags.url,
        videoId: flags["video-id"],
        title: flags.title,
        publicTest: Boolean(flags["public-test"]),
        input
      };
      if (!body.connectorId)
        throw new Error(
          "usage: od assets commerce-videos import-crawler --connector <youtube|tiktok|douyin|bilibili> [--url <url>] [--public-test]"
        );
      const data = await requestJson(base, "/api/asset-library/commerce-videos/import/crawler", {
        method: "POST",
        body
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] crawler import ${out.video?.id ?? "-"} job=${out.job?.id ?? "-"}`);
    }
    case "search": {
      const body = {
        connectorId: flags.connector ?? first ?? "bilibili",
        toolName: flags.tool,
        query: flags.query ?? second,
        limit: flags.limit ? Number(flags.limit) : undefined,
        sort: flags.sort ?? "hot",
        input: jsonFlag(flags["input-json"], {})
      };
      if (!body.query)
        throw new Error(
          "usage: od assets commerce-videos search --query <text> [--connector bilibili] [--limit <n>] [--json]"
        );
      const data = await requestJson(base, "/api/asset-library/commerce-videos/search", { method: "POST", body });
      if (flags.json) return writeJson(data);
      console.log(`[assets] found ${data.items?.length ?? 0} candidate videos query=${body.query}`);
      for (const item of data.items ?? []) {
        const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
        const playable = metrics.play ?? metrics.view ?? metrics.views ?? "-";
        const likes = metrics.like ?? metrics.likes ?? "-";
        console.log(
          `${item.videoId ?? item.bvid ?? "-"}\t${item.title ?? "-"}\t${item.author ?? "-"}\tplay=${playable}\tlike=${likes}\t${item.url ?? "-"}`
        );
      }
      return;
    }
    case "import-search": {
      const body = {
        connectorId: flags.connector ?? first ?? "bilibili",
        toolName: flags.tool,
        query: flags.query ?? second,
        limit: flags.limit ? Number(flags.limit) : undefined,
        sort: flags.sort ?? "hot",
        input: jsonFlag(flags["input-json"], {})
      };
      if (!body.query)
        throw new Error(
          "usage: od assets commerce-videos import-search --query <text> [--connector bilibili] [--limit <n>] [--json]"
        );
      const data = await requestJson(base, "/api/asset-library/commerce-videos/import/search", {
        method: "POST",
        body
      });
      return flags.json
        ? writeJson(data)
        : console.log(`[assets] imported ${data.videos?.length ?? 0} search results query=${body.query}`);
    }
    case "import-upload": {
      const localPath = flags.path ?? first;
      if (!localPath) throw new Error("usage: od assets commerce-videos import-upload <localpath> [--title <title>]");
      const data = await uploadCommerceVideo(base, localPath, flags);
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] uploaded ${out.video?.id ?? "-"} job=${out.job?.id ?? "-"}`);
    }
    case "import": {
      const prompt = await readPromptFromFlags(flags);
      const metadata = {
        ...jsonFlag(flags["metadata-json"], {}),
        ...(prompt ? { prompt } : {})
      };
      const product = {
        ...jsonFlag(flags["product-json"], {}),
        ...(typeof flags.subject === "string" ? { subject: flags.subject } : {}),
        ...(typeof flags.category === "string" ? { category: flags.category } : {})
      };
      const video = {
        ...jsonFlag(flags["video-json"], {}),
        ...(typeof flags.summary === "string" ? { summary: flags.summary } : {})
      };
      const body = {
        title: flags.title ?? first,
        sourceKind: flags.connector ? "crawler" : undefined,
        sourceConnectorId: flags.connector,
        sourceUrl: flags["source-url"],
        sourceVideoId: flags["source-video-id"],
        product,
        video,
        methodology: jsonFlag(flags["methodology-json"], {}),
        metadata
      };
      if (!body.title) throw new Error("usage: od assets commerce-videos import --title <title>");
      const data = await requestJson(base, "/api/asset-library/commerce-videos", { method: "POST", body });
      return flags.json ? writeJson(data) : console.log(`[assets] commerce video imported ${data.video?.id ?? "-"}`);
    }
    case "process": {
      if (!first) throw new Error("usage: od assets commerce-videos process <id> [--wait] [--json]");
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}/process`, {
        method: "POST"
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] commerce video job ${out.job?.id ?? "-"} ${out.job?.status ?? "-"}`);
    }
    case "slice": {
      if (!first) throw new Error("usage: od assets commerce-videos slice <id> [--wait] [--json]");
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}/slice`, {
        method: "POST"
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] commerce video slice job ${out.job?.id ?? "-"} ${out.job?.status ?? "-"}`);
    }
    case "batch-process": {
      const body = {
        ids: splitList(flags.ids),
        query: flags.query ?? (flags.ids ? undefined : first),
        limit: flags.limit ? Number(flags.limit) : undefined,
        onlyUnprocessed: Boolean(flags["only-unprocessed"]),
        ...(flags["no-include-embeddings"]
          ? { includeEmbeddings: false }
          : flags["include-embeddings"]
            ? { includeEmbeddings: true }
            : {})
      };
      const data = await requestJson(base, "/api/asset-library/commerce-videos/batch-process", {
        method: "POST",
        body
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(
            `[assets] commerce video batch ${out.job?.id ?? "-"} ${out.job?.status ?? "-"} count=${out.count ?? 0}`
          );
    }
    case "update": {
      if (!first)
        throw new Error(
          "usage: od assets commerce-videos update <id> --yes [--title <title>] [--patch-json <json>] [--json]"
        );
      if (!flags.yes) {
        throw new Error(`dangerous operation: re-run with --yes to update commerce video asset ${first}`);
      }
      const body = commerceVideoUpdateBodyFromFlags(flags);
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}`, {
        method: "PATCH",
        body
      });
      return flags.json ? writeJson(data) : console.log(`[assets] commerce video updated ${data.video?.id ?? "-"}`);
    }
    case "delete": {
      if (!first) throw new Error("usage: od assets commerce-videos delete <id> --yes [--json]");
      if (!flags.yes) {
        throw new Error(`dangerous operation: re-run with --yes to delete commerce video asset ${first}`);
      }
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}`, {
        method: "DELETE"
      });
      if (flags.json) return writeJson(data);
      console.log(`[assets] commerce video deleted ${data.video?.id ?? first}`);
      if (data.warning) console.warn(`[assets] warning: ${data.warning}`);
      return;
    }
    case "embed": {
      if (!first)
        throw new Error(
          "usage: od assets commerce-videos embed <id> [--text <text>|--prompt-file <path|->] [--include-slices|--no-include-slices] [--wait] [--json]"
        );
      const prompt = await readPromptFromFlags(flags);
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}/embed`, {
        method: "POST",
        body: {
          ...(flags.text || prompt ? { text: flags.text ?? prompt } : {}),
          ...(flags["include-slices"] ? { includeSlices: true } : {}),
          ...(flags["no-include-slices"] ? { includeSlices: false } : {})
        }
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] commerce video embedding job ${out.job?.id ?? "-"} ${out.job?.status ?? "-"}`);
    }
    case "slices": {
      if (!first) throw new Error("usage: od assets commerce-videos slices <id> [--json]");
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}`);
      if (flags.json) return writeJson({ slices: data.slices ?? [] });
      for (const slice of data.slices ?? []) {
        console.log(`${slice.id}\t${slice.startMs}-${slice.endMs}\t${slice.features?.pace ?? "-"}`);
      }
      return;
    }
    case "methodology": {
      if (!first) throw new Error("usage: od assets commerce-videos methodology <id> [--json]");
      const data = await requestJson(base, `/api/asset-library/commerce-videos/${encodeURIComponent(first)}`);
      if (flags.json) return writeJson({ methodology: data.video?.methodology ?? {} });
      const methodology = data.video?.methodology ?? {};
      console.log(`Hooks: ${(methodology.hooks ?? []).join(", ") || "-"}`);
      console.log(`Structure: ${(methodology.structure ?? []).join(" > ") || "-"}`);
      console.log(`Triggers: ${(methodology.sellingTriggers ?? []).join(", ") || "-"}`);
      return;
    }
    case "methodology-summary": {
      const body = {
        ids: splitList(flags.ids),
        query: flags.query ?? (flags.ids ? undefined : first),
        limit: flags.limit ? Number(flags.limit) : undefined,
        ...(flags["no-include-slices"] ? { includeSlices: false } : {})
      };
      const data = await requestJson(base, "/api/asset-library/commerce-videos/methodology-summary", {
        method: "POST",
        body
      });
      if (flags.json) return writeJson(data);
      console.log(data.prompt ?? "");
      return;
    }
    default:
      throw new Error(
        "usage: od assets commerce-videos <list|get|search|import|import-crawler|import-search|import-upload|update|delete|process|slice|batch-process|embed|slices|methodology|methodology-summary>"
      );
  }
}

async function runQualityVideos(
  base: string,
  action: string,
  first: string | undefined,
  second: string | undefined,
  flags: Record<string, any>
) {
  switch (action) {
    case "list": {
      const query = new URLSearchParams();
      if (flags.query) query.set("query", flags.query);
      if (flags.category) query.set("category", flags.category);
      if (flags.keyword) query.set("keyword", flags.keyword);
      if (flags.limit) query.set("limit", flags.limit);
      const data = await requestJson(base, `/api/asset-library/quality-videos${query.size ? `?${query}` : ""}`);
      if (flags.json) return writeJson(data);
      for (const video of data.videos ?? []) {
        const source = video.metadata?.sourceDeclaration?.sourceName ?? video.sourceConnectorId ?? video.sourceKind;
        console.log(`${video.id}\t${video.status}\t${source || "-"}\t${video.title}`);
      }
      return;
    }
    case "get": {
      if (!first) throw new Error("usage: od assets quality-videos get <id> [--json]");
      const data = await requestJson(base, `/api/asset-library/quality-videos/${encodeURIComponent(first)}`);
      return flags.json ? writeJson(data) : printCommerceVideo(data.video, data.slices);
    }
    case "search": {
      const body = qualityVideoSearchBodyFromFlags(flags, first, second);
      if (!body.query) {
        throw new Error(
          "usage: od assets quality-videos search --query <text> [--source-name <name>] [--connector <id>] [--limit <n>] [--json]"
        );
      }
      const data = await requestJson(base, "/api/asset-library/quality-videos/search", { method: "POST", body });
      if (flags.json) return writeJson(data);
      console.log(
        `[assets] found ${data.items?.length ?? 0} quality video candidates source=${body.sourceName ?? body.connectorId}`
      );
      for (const item of data.items ?? []) {
        const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
        const views = metrics.play ?? metrics.view ?? metrics.views ?? "-";
        const likes = metrics.like ?? metrics.likes ?? "-";
        console.log(
          `${item.videoId ?? item.bvid ?? item.id ?? "-"}\t${item.title ?? "-"}\t${item.author ?? "-"}\tviews=${views}\tlike=${likes}\t${item.url ?? item.permalink ?? "-"}`
        );
      }
      return;
    }
    case "import-search": {
      const body = qualityVideoSearchBodyFromFlags(flags, first, second);
      if (!body.query) {
        throw new Error(
          "usage: od assets quality-videos import-search --query <text> [--source-name <name>] [--connector <id>] [--limit <n>] [--json]"
        );
      }
      const data = await requestJson(base, "/api/asset-library/quality-videos/import/search", {
        method: "POST",
        body
      });
      return flags.json
        ? writeJson(data)
        : console.log(`[assets] saved ${data.videos?.length ?? 0} quality video reports query=${body.query}`);
    }
    case "import-upload": {
      const localPath = flags.path ?? first;
      if (!localPath) {
        throw new Error(
          "usage: od assets quality-videos import-upload <localpath> [--title <title>] [--source-name owned-upload] [--wait] [--json]"
        );
      }
      const data = await uploadQualityVideo(base, localPath, flags);
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] uploaded owned quality video ${out.video?.id ?? "-"} job=${out.job?.id ?? "-"}`);
    }
    case "import": {
      const body = qualityVideoImportBodyFromFlags(flags, first);
      const prompt = await readPromptFromFlags(flags);
      if (prompt) body.metadata = { ...(body.metadata ?? {}), prompt };
      if (!body.title || !body.sourceName || (!body.sourceUrl && !body.sourceVideoId)) {
        throw new Error(
          "usage: od assets quality-videos import --title <title> --source-name <name> [--source-url <url>|--source-video-id <id>] [--report-json <json>] [--json]"
        );
      }
      const data = await requestJson(base, "/api/asset-library/quality-videos", { method: "POST", body });
      return flags.json ? writeJson(data) : console.log(`[assets] quality video report saved ${data.video?.id ?? "-"}`);
    }
    case "update": {
      if (!first)
        throw new Error(
          "usage: od assets quality-videos update <id> --yes [--title <title>] [--patch-json <json>] [--json]"
        );
      if (!flags.yes) {
        throw new Error(`dangerous operation: re-run with --yes to update quality video asset ${first}`);
      }
      const data = await requestJson(base, `/api/asset-library/quality-videos/${encodeURIComponent(first)}`, {
        method: "PATCH",
        body: commerceVideoUpdateBodyFromFlags(flags)
      });
      return flags.json ? writeJson(data) : console.log(`[assets] quality video updated ${data.video?.id ?? "-"}`);
    }
    case "delete": {
      if (!first) throw new Error("usage: od assets quality-videos delete <id> --yes [--json]");
      if (!flags.yes) {
        throw new Error(`dangerous operation: re-run with --yes to delete quality video asset ${first}`);
      }
      const data = await requestJson(base, `/api/asset-library/quality-videos/${encodeURIComponent(first)}`, {
        method: "DELETE"
      });
      if (flags.json) return writeJson(data);
      console.log(`[assets] quality video deleted ${data.video?.id ?? first}`);
      if (data.warning) console.warn(`[assets] warning: ${data.warning}`);
      return;
    }
    case "process": {
      if (!first) throw new Error("usage: od assets quality-videos process <id> [--wait] [--json]");
      const data = await requestJson(base, `/api/asset-library/quality-videos/${encodeURIComponent(first)}/process`, {
        method: "POST"
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] quality video job ${out.job?.id ?? "-"} ${out.job?.status ?? "-"}`);
    }
    case "embed": {
      if (!first)
        throw new Error(
          "usage: od assets quality-videos embed <id> [--text <text>|--prompt-file <path|->] [--include-slices|--no-include-slices] [--wait] [--json]"
        );
      const prompt = await readPromptFromFlags(flags);
      const data = await requestJson(base, `/api/asset-library/quality-videos/${encodeURIComponent(first)}/embed`, {
        method: "POST",
        body: {
          ...(flags.text || prompt ? { text: flags.text ?? prompt } : {}),
          ...(flags["include-slices"] ? { includeSlices: true } : {}),
          ...(flags["no-include-slices"] ? { includeSlices: false } : {})
        }
      });
      const out = flags.wait ? { ...data, job: await waitForJob(base, data.job, flags) } : data;
      return flags.json
        ? writeJson(out)
        : console.log(`[assets] quality video embedding job ${out.job?.id ?? "-"} ${out.job?.status ?? "-"}`);
    }
    case "methodology":
    case "report": {
      if (!first) throw new Error("usage: od assets quality-videos report <id> [--json]");
      const data = await requestJson(base, `/api/asset-library/quality-videos/${encodeURIComponent(first)}`);
      const report = data.video?.metadata?.qualityReport ?? {};
      if (flags.json) return writeJson({ report, methodology: data.video?.methodology ?? {} });
      console.log(`Hook methods: ${(report.hookMethods ?? data.video?.methodology?.hooks ?? []).join(", ") || "-"}`);
      console.log(
        `Selling points: ${(report.sellingPoints ?? data.video?.methodology?.sellingTriggers ?? []).join(", ") || "-"}`
      );
      console.log(`Storyboard: ${(report.storyboard ?? data.video?.methodology?.structure ?? []).join(" > ") || "-"}`);
      console.log(`Style: ${(report.styleTags ?? data.video?.methodology?.styleTags ?? []).join(", ") || "-"}`);
      return;
    }
    case "methodology-summary": {
      const body = {
        ids: splitList(flags.ids),
        query: flags.query ?? (flags.ids ? undefined : first),
        limit: flags.limit ? Number(flags.limit) : undefined,
        ...(flags["no-include-slices"] ? { includeSlices: false } : {})
      };
      const data = await requestJson(base, "/api/asset-library/quality-videos/methodology-summary", {
        method: "POST",
        body
      });
      if (flags.json) return writeJson(data);
      console.log(data.prompt ?? "");
      return;
    }
    default:
      throw new Error(
        "usage: od assets quality-videos <list|get|search|import|import-search|import-upload|update|delete|process|embed|report|methodology-summary>"
      );
  }
}

async function runAssetJobs(base: string, action: string, first: string | undefined, flags: Record<string, any>) {
  switch (action) {
    case "get": {
      if (!first) throw new Error("usage: od assets jobs get <jobId> [--json]");
      const data = await requestJson(base, `/api/asset-library/jobs/${encodeURIComponent(first)}`);
      if (flags.json) return writeJson(data);
      return printJob(data.job);
    }
    case "wait": {
      if (!first) throw new Error("usage: od assets jobs wait <jobId> [--json]");
      const data = await requestJson(base, `/api/asset-library/jobs/${encodeURIComponent(first)}`);
      const job = await waitForJob(base, data.job, flags);
      return flags.json ? writeJson({ job }) : printJob(job);
    }
    default:
      throw new Error("usage: od assets jobs <get|wait> <jobId> [--json]");
  }
}

function toolBodyFromFlags(flags: Record<string, any>) {
  const body: Record<string, any> = {};
  if (typeof flags["ffmpeg-path"] === "string") body.ffmpegPath = flags["ffmpeg-path"];
  if (typeof flags["ffprobe-path"] === "string") body.ffprobePath = flags["ffprobe-path"];
  if (flags["auto-detect"]) body.autoDetectEnabled = true;
  if (flags["no-auto-detect"]) body.autoDetectEnabled = false;
  return body;
}

function embeddingBodyFromFlags(flags: Record<string, any>) {
  const body: Record<string, any> = {};
  if (typeof flags.provider === "string") body.providerId = flags.provider === "custom" ? "custom" : "volcengine-ark";
  if (typeof flags.label === "string") body.label = flags.label;
  if (typeof flags["api-key"] === "string") body.apiKey = flags["api-key"];
  if (flags["preserve-api-key"]) body.preserveApiKey = true;
  if (typeof flags["base-url"] === "string") body.baseUrl = flags["base-url"];
  if (typeof flags["endpoint-path"] === "string") body.endpointPath = flags["endpoint-path"];
  if (typeof flags.model === "string") body.model = flags.model;
  if (typeof flags["headers-json"] === "string") body.headers = jsonFlag(flags["headers-json"], {});
  if (typeof flags["input-mapping-json"] === "string") body.inputMapping = jsonFlag(flags["input-mapping-json"], {});
  return body;
}

function productUpdateBodyFromFlags(flags: Record<string, any>) {
  const body: Record<string, any> = { ...jsonFlag(flags["patch-json"], {}) };
  if (typeof flags.title === "string") body.title = flags.title;
  if (typeof flags.subject === "string") body.subject = flags.subject;
  if (typeof flags.category === "string") body.category = flags.category;
  if (typeof flags["selling-points"] === "string") body.sellingPoints = splitList(flags["selling-points"]);
  if (typeof flags.constraints === "string") body.constraints = splitList(flags.constraints);
  if (typeof flags["suggested-angles"] === "string") body.suggestedAngles = splitList(flags["suggested-angles"]);
  if (typeof flags.summary === "string") body.summary = flags.summary;
  if (typeof flags["metadata-json"] === "string") body.metadata = jsonFlag(flags["metadata-json"], {});
  return body;
}

function commerceVideoUpdateBodyFromFlags(flags: Record<string, any>) {
  const body: Record<string, any> = { ...jsonFlag(flags["patch-json"], {}) };
  if (typeof flags.title === "string") body.title = flags.title;
  if (typeof flags["source-url"] === "string") body.sourceUrl = flags["source-url"];
  if (typeof flags["source-video-id"] === "string") body.sourceVideoId = flags["source-video-id"];
  const product: Record<string, any> = { ...(body.product ?? {}), ...jsonFlag(flags["product-json"], {}) };
  if (typeof flags.subject === "string") product.subject = flags.subject;
  if (typeof flags.category === "string") product.category = flags.category;
  if (Object.keys(product).length > 0) body.product = product;
  const video: Record<string, any> = { ...(body.video ?? {}), ...jsonFlag(flags["video-json"], {}) };
  if (typeof flags["duration-ms"] === "string") video.durationMs = Number(flags["duration-ms"]);
  if (typeof flags.summary === "string") video.summary = flags.summary;
  if (Object.keys(video).length > 0) body.video = video;
  const methodology: Record<string, any> = { ...(body.methodology ?? {}), ...jsonFlag(flags["methodology-json"], {}) };
  if (typeof flags.hooks === "string") methodology.hooks = splitList(flags.hooks);
  if (typeof flags.structure === "string") methodology.structure = splitList(flags.structure);
  if (typeof flags["selling-triggers"] === "string") methodology.sellingTriggers = splitList(flags["selling-triggers"]);
  if (typeof flags["style-tags"] === "string") methodology.styleTags = splitList(flags["style-tags"]);
  if (Object.keys(methodology).length > 0) body.methodology = methodology;
  if (typeof flags["metadata-json"] === "string") body.metadata = jsonFlag(flags["metadata-json"], {});
  return body;
}

function qualityVideoSearchBodyFromFlags(
  flags: Record<string, any>,
  first: string | undefined,
  second: string | undefined
) {
  return {
    connectorId: flags.connector ?? first ?? flags["source-name"] ?? "bilibili",
    sourceName: flags["source-name"] ?? flags.connector ?? first ?? "bilibili",
    toolName: flags.tool,
    query: flags.query ?? second ?? flags.keyword ?? flags.category,
    category: flags.category,
    keyword: flags.keyword,
    limit: flags.limit ? Number(flags.limit) : undefined,
    sort: flags.sort ?? "hot",
    input: jsonFlag(flags["input-json"], {})
  };
}

function qualityVideoImportBodyFromFlags(flags: Record<string, any>, first: string | undefined) {
  const methodology = {
    ...jsonFlag(flags["methodology-json"], {}),
    ...(typeof flags.hooks === "string" ? { hooks: splitList(flags.hooks) } : {}),
    ...(typeof flags.structure === "string" ? { structure: splitList(flags.structure) } : {}),
    ...(typeof flags["selling-triggers"] === "string" ? { sellingTriggers: splitList(flags["selling-triggers"]) } : {}),
    ...(typeof flags["style-tags"] === "string" ? { styleTags: splitList(flags["style-tags"]) } : {})
  };
  const report = {
    ...jsonFlag(flags["report-json"], {}),
    ...(typeof flags.hooks === "string" ? { hookMethods: splitList(flags.hooks) } : {}),
    ...(typeof flags["selling-points"] === "string" ? { sellingPoints: splitList(flags["selling-points"]) } : {}),
    ...(typeof flags.structure === "string" ? { storyboard: splitList(flags.structure) } : {}),
    ...(typeof flags["style-tags"] === "string" ? { styleTags: splitList(flags["style-tags"]) } : {})
  };
  return {
    title: flags.title ?? first,
    sourceName: flags["source-name"] ?? flags.connector,
    sourceUrl: flags["source-url"] ?? flags.url,
    sourceVideoId: flags["source-video-id"] ?? flags["video-id"],
    category: flags.category,
    keyword: flags.keyword ?? flags.query,
    video: {
      ...jsonFlag(flags["video-json"], {}),
      ...(typeof flags.summary === "string" ? { summary: flags.summary } : {})
    },
    methodology,
    report,
    metadata: {
      ...jsonFlag(flags["metadata-json"], {})
    }
  };
}

async function uploadCommerceVideo(base: string, localPath: string, flags: Record<string, any>) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const bytes = await fs.readFile(localPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/octet-stream" }), path.basename(localPath));
  if (flags.title) form.append("title", flags.title);
  const resp = await fetch(`${base}/api/asset-library/commerce-videos/import/upload`, {
    method: "POST",
    body: form
  });
  return parseResponse(resp);
}

async function uploadQualityVideo(base: string, localPath: string, flags: Record<string, any>) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const bytes = await fs.readFile(localPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/octet-stream" }), path.basename(localPath));
  appendFormText(form, "title", flags.title);
  appendFormText(form, "sourceName", flags["source-name"]);
  appendFormText(form, "category", flags.category);
  appendFormText(form, "keyword", flags.keyword ?? flags.query);
  appendFormText(form, "metadataJson", flags["metadata-json"]);
  appendFormText(form, "reportJson", flags["report-json"]);
  const resp = await fetch(`${base}/api/asset-library/quality-videos/import/upload`, {
    method: "POST",
    body: form
  });
  return parseResponse(resp);
}

async function uploadProductImage(base: string, localPath: string, flags: Record<string, any>) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const bytes = await fs.readFile(localPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeForPath(localPath) }), path.basename(localPath));
  appendFormText(form, "title", flags.title);
  appendFormText(form, "subject", flags.subject);
  appendFormText(form, "category", flags.category);
  appendFormText(form, "sellingPoints", flags["selling-points"]);
  appendFormText(form, "constraints", flags.constraints);
  appendFormText(form, "suggestedAngles", flags["suggested-angles"]);
  appendFormText(form, "summary", flags.summary);
  appendFormText(form, "metadataJson", flags["metadata-json"]);
  const resp = await fetch(`${base}/api/asset-library/products/import/upload`, {
    method: "POST",
    body: form
  });
  return parseResponse(resp);
}

function appendFormText(form: FormData, key: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) form.append(key, value);
}

function mimeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function requestJson(base: string, route: string, options: { method?: string; body?: any } = {}) {
  const resp = await fetch(`${base}${route}`, {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.body)
        })
  });
  return parseResponse(resp);
}

async function parseResponse(resp: Response) {
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    const message = typeof data?.error === "string" ? data.error : (data?.error?.message ?? `HTTP ${resp.status}`);
    throw Object.assign(new Error(message), { status: resp.status, data });
  }
  return data;
}

async function waitForJob(base: string, job: any, flags: Record<string, any>) {
  if (!job?.id) return job;
  let latest = job;
  let since = Array.isArray(job.progress) ? job.progress.length : 0;
  while (!["done", "failed", "interrupted"].includes(latest.status)) {
    const data = await requestJson(base, `/api/asset-library/jobs/${encodeURIComponent(job.id)}/wait`, {
      method: "POST",
      body: { since, timeoutMs: 25_000 }
    });
    latest = data.job ?? latest;
    const progress = Array.isArray(data.progress) ? data.progress : [];
    if (!flags.json) for (const line of progress) console.log(`[assets] ${line}`);
    since = Array.isArray(latest.progress) ? latest.progress.length : since + progress.length;
  }
  return latest;
}

function outputTools(data: any, flags: Record<string, any>) {
  if (flags.json) return writeJson(data);
  const tools = data.tools ?? data;
  console.log(`ffmpegPath=${tools.ffmpegPath ?? ""}`);
  console.log(`ffprobePath=${tools.ffprobePath ?? ""}`);
  console.log(`autoDetectEnabled=${tools.autoDetectEnabled !== false}`);
  if (tools.lastVerifiedAt) console.log(`lastVerifiedAt=${new Date(tools.lastVerifiedAt).toISOString()}`);
  if (tools.lastVerificationError) console.log(`lastVerificationError=${tools.lastVerificationError}`);
}

function outputEmbedding(data: any, flags: Record<string, any>) {
  if (flags.json) return writeJson(data);
  const embedding = data.embedding ?? data;
  console.log(`provider=${embedding.providerId ?? ""}`);
  console.log(`model=${embedding.model ?? ""}`);
  console.log(`endpoint=${(embedding.baseUrl ?? "").replace(/\/$/, "")}${embedding.endpointPath ?? ""}`);
  console.log(`apiKey=${embedding.apiKeyConfigured ? `configured (...${embedding.apiKeyTail ?? "****"})` : "missing"}`);
}

function printAssetSearchResults(data: any) {
  const results = Array.isArray(data.results) ? data.results : [];
  console.log(
    `[assets] matches=${results.length} query=${data.query || "-"} vectorized=${data.vectorizedQuery ? "yes" : "no"}`
  );
  for (const result of results) {
    const ref = result.sliceId ? `${result.assetId}#${result.sliceId}` : result.assetId;
    const score = typeof result.score === "number" ? result.score.toFixed(3) : "-";
    const vector = typeof result.vectorScore === "number" ? ` vector=${result.vectorScore.toFixed(3)}` : "";
    const tags = Array.isArray(result.tags) && result.tags.length ? ` tags=${result.tags.slice(0, 5).join(",")}` : "";
    const subtitle = result.subtitle ? ` (${result.subtitle})` : "";
    console.log(
      `${result.kind}\t${result.granularity}\t${ref}\tscore=${score}${vector}\t${result.title}${subtitle}${tags}`
    );
  }
}

function printProduct(product: any) {
  console.log(`${product.id}\t${product.status}\t${product.title}`);
  console.log(`subject=${product.subject || "-"}`);
  console.log(`category=${product.category || "-"}`);
  console.log(`sellingPoints=${(product.product?.sellingPoints ?? []).join(", ") || "-"}`);
}

function printProductFolderIngest(data: any) {
  const importedCount = Array.isArray(data.imported) ? data.imported.length : 0;
  const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
  const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
  console.log(
    `[assets] product folder ${data.dryRun ? "dry-run" : "imported"} images=${data.scanned?.imageCount ?? 0} imported=${importedCount} failed=${failedCount} skipped=${skippedCount} mode=${data.mode ?? "-"} concurrency=${data.concurrency ?? "-"}`
  );
  for (const cluster of data.clusters ?? []) {
    console.log(`cluster ${cluster.id}\t${cluster.category}\t${cluster.images?.length ?? 0}`);
    for (const image of cluster.images ?? []) {
      const id = image.productId ? `\t${image.productId}` : "";
      const error = image.error ? `\terror=${image.error}` : "";
      console.log(`  ${image.relativePath}${id}${error}`);
    }
  }
  if (skippedCount > 0) {
    console.log("skipped:");
    for (const item of (data.skipped ?? []).slice(0, 50)) {
      console.log(`  ${item.relativePath}\t${item.reason}`);
    }
    if (skippedCount > 50) console.log(`  ... ${skippedCount - 50} more`);
  }
}

function printCommerceVideo(video: any, slices: any[]) {
  console.log(`${video.id}\t${video.status}\t${video.title}`);
  console.log(`source=${video.sourceKind}${video.sourceConnectorId ? `/${video.sourceConnectorId}` : ""}`);
  console.log(`summary=${video.video?.summary ?? "-"}`);
  console.log(`slices=${slices?.length ?? 0}`);
}

function printJob(job: any) {
  console.log(`${job.id}\t${job.status}\t${job.assetKind}/${job.assetId}\t${job.kind}`);
  if (Array.isArray(job.progress)) {
    for (const line of job.progress.slice(-10)) console.log(`progress=${line}`);
  }
  if (job.error?.message) console.log(`error=${job.error.code ? `${job.error.code}: ` : ""}${job.error.message}`);
}

function parseFlags(argv: string[], opts: { string?: Set<string>; boolean?: Set<string> } = {}) {
  const stringFlags = opts.string instanceof Set ? opts.string : new Set<string>();
  const booleanFlags = opts.boolean instanceof Set ? opts.boolean : new Set<string>();
  const knownFlags = new Set([...stringFlags, ...booleanFlags]);
  const out: Record<string, any> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (knownFlags.size > 0 && !knownFlags.has(key)) {
      throw new Error(`unknown flag: --${key}. Run with --help for accepted flags.`);
    }
    if (eq >= 0) {
      out[key] = a.slice(eq + 1);
    } else if (booleanFlags.has(key)) {
      out[key] = true;
    } else {
      const next = argv[i + 1];
      if (next == null) throw new Error(`flag --${key} requires a value`);
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function positionalArgs(argv: string[], stringFlags = new Set<string>()) {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith("--")) {
      out.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (eq < 0 && stringFlags.has(key)) i += 1;
  }
  return out;
}

function splitList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function countByStatus(items: any[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const status = typeof item?.status === "string" && item.status ? item.status : "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function productSummary(product: any) {
  return {
    id: product?.id ?? "",
    title: product?.title ?? "",
    status: product?.status ?? "",
    subject: product?.subject ?? "",
    category: product?.category ?? "",
    imageCount: Array.isArray(product?.files) ? product.files.length : 0
  };
}

function commerceVideoSummary(video: any) {
  return {
    id: video?.id ?? "",
    title: video?.title ?? "",
    status: video?.status ?? "",
    sourceKind: video?.sourceKind ?? "",
    sourceConnectorId: video?.sourceConnectorId ?? "",
    subject: video?.product?.subject ?? "",
    category: video?.product?.category ?? "",
    sliceCount: Array.isArray(video?.video?.slices) ? video.video.slices.length : undefined
  };
}

function jsonFlag(value: unknown, fallback: any) {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return value === "-" ? JSON.parse(readFileSync(0, "utf8")) : JSON.parse(value);
  } catch (error: any) {
    throw new Error(`invalid JSON flag: ${error.message}`);
  }
}

async function readPromptFromFlags(flags: Record<string, any>) {
  if (typeof flags.prompt === "string" && flags.prompt.length > 0) return flags.prompt;
  if (typeof flags["prompt-file"] !== "string" || flags["prompt-file"].length === 0) return null;
  if (flags["prompt-file"] === "-") {
    const fs = await import("node:fs");
    return fs.readFileSync(0, "utf8");
  }
  const fs = await import("node:fs/promises");
  return fs.readFile(flags["prompt-file"], "utf8");
}

function writeJson(data: any) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function printAssetsHelp() {
  console.log(`Usage:
  od assets status [--json]

  od assets tools get [--json]
  od assets tools set [--ffmpeg-path <path>] [--ffprobe-path <path>] [--auto-detect|--no-auto-detect] [--json]
  od assets tools test [--json]

  od assets embedding get [--json]
  od assets embedding set [--provider volcengine-ark|custom] [--api-key <key>] [--base-url <url>]
                          [--endpoint-path <path>] [--model <id>] [--headers-json <json>]
                          [--input-mapping-json <json>] [--preserve-api-key] [--json]
  od assets embedding test [--api-key <key>] [--json]
      Volcengine Ark vectorization is limited to doubao-embedding-vision-251215.
      Use --provider custom for non-Ark gateways or other embedding models.

  od assets search [--query <text>|--prompt-file <path|->] [--tags a,b]
                   [--kind products|commerce-videos|quality-videos|all]
                   [--granularity asset|slice|all] [--limit <n>] [--include-vectors] [--json]

  od assets products list [--query <text>] [--limit <n>] [--json]
  od assets products get <id> [--json]
  od assets products import --title <title> [--subject <text>] [--category <text>]
                            [--selling-points a,b] [--prompt-file <path|->] [--json]
  od assets products import-image <localpath> [--title <title>] [--subject <text>]
                            [--category <text>] [--selling-points a,b] [--wait] [--json]
  od assets products import-folder <folder> [--mode serial|parallel] [--concurrency <n>]
                            [--provider <id>] [--model <id>] [--prompt-file <path|->]
                            [--dry-run] [--no-recursive] [--no-process] [--wait] [--json]
  od assets products update <id> --yes [--title <title>] [--subject <text>] [--category <text>]
                            [--selling-points a,b] [--summary <text>] [--patch-json <json>] [--json]
  od assets products delete <id> --yes [--json]
  od assets products process <id> [--wait] [--json]
  od assets products embed <id> [--text <text>|--prompt-file <path|->] [--wait] [--json]
  od assets products context <projectId> <assetId> [--purpose <text>] [--note <text>] [--json]

  od assets commerce-videos list [--query <text>] [--limit <n>] [--json]
  od assets commerce-videos get <id> [--json]
  od assets commerce-videos search --connector bilibili --query <text>
                                  [--limit <n>] [--sort hot|newest|comments|favorites] [--json]
  od assets commerce-videos import --title <title> [--connector bilibili] [--source-url <url>]
                                  [--source-video-id <id>] [--subject <text>]
                                  [--category <text>] [--summary <text>] [--json]
  od assets commerce-videos import-crawler --connector <youtube|tiktok|douyin|bilibili>
                                           [--url <url>] [--video-id <id>] [--resolution <label>]
                                           [--input-json <json>] [--public-test]
                                           [--prompt-file <path|->] [--wait] [--json]
  od assets commerce-videos import-search --connector bilibili --query <text>
                                          [--limit <n>] [--sort hot|newest|comments|favorites] [--json]
  od assets commerce-videos import-upload <localpath> [--title <title>] [--wait] [--json]
  od assets commerce-videos update <id> --yes [--title <title>] [--summary <text>] [--product-json <json>]
                                  [--video-json <json>] [--methodology-json <json>] [--patch-json <json>] [--json]
  od assets commerce-videos delete <id> --yes [--json]
  od assets commerce-videos process <id> [--wait] [--json]
  od assets commerce-videos slice <id> [--wait] [--json]
  od assets commerce-videos batch-process [--ids <id,id>] [--query <text>] [--limit <n>]
                                      [--only-unprocessed] [--no-include-embeddings] [--wait] [--json]
  od assets commerce-videos embed <id> [--text <text>|--prompt-file <path|->]
                                   [--include-slices|--no-include-slices] [--wait] [--json]
  od assets commerce-videos slices <id> [--json]
  od assets commerce-videos methodology <id> [--json]
  od assets commerce-videos methodology-summary [--ids <id,id>] [--query <text>] [--limit <n>] [--json]

  od assets quality-videos list [--query <text>] [--category <text>] [--keyword <text>] [--limit <n>] [--json]
  od assets quality-videos get <id> [--json]
  od assets quality-videos search --query <text> [--source-name facebook|instagram|bilibili|...]
                                [--connector <id>] [--tool <name>] [--category <text>] [--keyword <text>] [--json]
  od assets quality-videos import --title <title> --source-name <name>
                                [--source-url <url>|--source-video-id <id>] [--report-json <json>]
                                [--hooks a,b] [--selling-points a,b] [--structure a,b] [--style-tags a,b] [--json]
  od assets quality-videos import-search --query <text> [--source-name <name>] [--connector <id>]
                                       [--category <text>] [--keyword <text>] [--limit <n>] [--json]
  od assets quality-videos import-upload <localpath> [--title <title>] [--source-name owned-upload] [--wait] [--json]
  od assets quality-videos update <id> --yes [--title <title>] [--summary <text>] [--patch-json <json>] [--json]
  od assets quality-videos delete <id> --yes [--json]
  od assets quality-videos process <id> [--wait] [--json]
  od assets quality-videos embed <id> [--text <text>|--prompt-file <path|->] [--wait] [--json]
  od assets quality-videos report <id> [--json]
  od assets quality-videos methodology-summary [--ids <id,id>] [--query <text>] [--limit <n>] [--json]

  od assets jobs get <jobId> [--json]
  od assets jobs wait <jobId> [--json]

Common options:
  --daemon-url <url>   Open Design daemon HTTP base.
  --json               Emit raw JSON for scripted callers.
  --prompt-file <path|-> stores long import notes or search prompts without shell quoting.`);
}
