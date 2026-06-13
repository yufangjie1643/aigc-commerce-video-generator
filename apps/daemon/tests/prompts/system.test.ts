import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { composeSystemPrompt, resolveExclusiveSurface } from "../../src/prompts/system.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");
// `live-artifact` moved from skills/ to design-templates/ in PR #955 as
// part of the skills/design-templates split (see specs/current/
// skills-and-design-templates.md). The root path now points there.
const liveArtifactRoot = path.join(repoRoot, "design-templates/live-artifact");
const liveArtifactSkillPath = path.join(repoRoot, "design-templates/live-artifact/SKILL.md");
const liveArtifactSkillMarkdown = readFileSync(liveArtifactSkillPath, "utf8");
const liveArtifactSkillBody = [
  `> **Skill root (absolute):** \`${liveArtifactRoot}\``,
  ">",
  "> This skill ships side files alongside `SKILL.md`. When the workflow",
  "> below references side files such as `references/artifact-schema.md`, resolve",
  "> them against the skill root above and open them via their full absolute path.",
  ">",
  "> Known side files in this skill: `references/artifact-schema.md`, `references/connector-policy.md`, `references/refresh-contract.md`.",
  "",
  "",
  liveArtifactSkillMarkdown.replace(/^---[\s\S]*?---\n\n/, "").trim()
].join("\n");

// `hyperframes` also moved to design-templates/ in PR #955 — same split
// as `live-artifact` above.
const hyperframesRoot = path.join(repoRoot, "design-templates/hyperframes");
const hyperframesSkillPath = path.join(repoRoot, "design-templates/hyperframes/SKILL.md");
const hyperframesSkillMarkdown = readFileSync(hyperframesSkillPath, "utf8");
const hyperframesSkillBody = [
  `> **Skill root (absolute):** \`${hyperframesRoot}\``,
  ">",
  "> This skill ships side files alongside `SKILL.md`. Resolve references",
  "> like `references/html-in-canvas.md` against the skill root above.",
  "",
  "",
  hyperframesSkillMarkdown.replace(/^---[\s\S]*?---\n\n/, "").trim()
].join("\n");

describe("composeSystemPrompt — activeStageBlocks splice (spec §23.4)", () => {
  it("inserts every active stage block after the plugin block when supplied", () => {
    const stage1 = "\n\n## Active stage: discovery\n\n### discovery-question-form\n\nAsk audience.";
    const stage2 = "\n\n## Active stage: plan\n\n### todo-write\n\nCommit a plan.";
    const prompt = composeSystemPrompt({
      pluginBlock: "\n\n## Active plugin\n\nThe user applied test-plugin.",
      activeStageBlocks: [stage1, stage2]
    });
    expect(prompt).toContain("## Active plugin");
    expect(prompt.indexOf("## Active stage: discovery")).toBeGreaterThan(prompt.indexOf("## Active plugin"));
    expect(prompt.indexOf("## Active stage: plan")).toBeGreaterThan(prompt.indexOf("## Active stage: discovery"));
  });

  it("skips empty / whitespace-only blocks", () => {
    const prompt = composeSystemPrompt({
      activeStageBlocks: ["", "   ", "\n\n## Active stage: critique\n\n### critique-theater\n\nScore."]
    });
    expect(prompt).toContain("## Active stage: critique");
    // Only one stage block means just one heading.
    expect((prompt.match(/## Active stage:/g) ?? []).length).toBe(1);
  });

  it("is a no-op when activeStageBlocks is undefined or empty", () => {
    const baseline = composeSystemPrompt({});
    const withUndefined = composeSystemPrompt({ activeStageBlocks: undefined });
    const withEmpty = composeSystemPrompt({ activeStageBlocks: [] });
    expect(withUndefined).toBe(baseline);
    expect(withEmpty).toBe(baseline);
  });
});

describe("composeSystemPrompt", () => {
  it("injects the Comprehensive mode orchestration override before discovery", () => {
    const prompt = composeSystemPrompt({ sessionMode: "comprehensive" });

    expect(prompt).toContain("# Comprehensive mode — business workbench orchestration");
    expect(prompt).toContain("do not emit the default Design discovery `<question-form>`");
    expect(prompt).toContain("od assets status --json");
    expect(prompt).toContain("od assets search --query");
    expect(prompt).toContain("od assets commerce-videos search");
    expect(prompt).toContain("douyin_keyword_unavailable");
    expect(prompt).toContain("Douyin/抖音 keyword candidate preview is available");
    expect(prompt).toContain("assets commerce-videos search --connector douyin");
    expect(prompt).not.toContain("does not currently expose a keyword-search interface");
    expect(prompt).toContain("reuse it instead of rerunning `assets status` just to prove daemon liveness");
    expect(prompt).toContain("missing `OD_NODE_BIN` or `OD_PROJECT_ID` as a runtime shell wiring gap");
    expect(prompt).toContain("od media understand --image");
    expect(prompt).toContain("--provider mimo");
    expect(prompt).toContain('od commerce-video materials --project "$OD_PROJECT_ID" --materials-file');
    expect(prompt).toContain("commerce-video/materials.sqlite");
    expect(prompt).toContain("must not block 商品素材上传");
    expect(prompt).toContain("do not ask the user to choose project routing or create a replacement project");
    expect(prompt).toContain("video-generation-pipeline");
    expect(prompt).toContain(
      "Generated commerce-video outputs are project artifacts, not source material-library assets"
    );
    expect(prompt.indexOf("# Comprehensive mode — business workbench orchestration")).toBeLessThan(
      prompt.indexOf("RULE 1")
    );
  });

  it("uses question-form follow-up choices for non-Claude adapters", () => {
    const prompt = composeSystemPrompt({ agentId: "opencode", sessionMode: "comprehensive" });

    expect(prompt).toContain("## Clarifying questions");
    expect(prompt).toContain("use Open Design's interactive choice UI instead of a markdown A/B/C table");
    expect(prompt).toContain("For this adapter, use a single renderable `<question-form>` block");
    expect(prompt).toContain('<question-form id="follow-up" title="选择下一步">');
    expect(prompt).not.toContain("call the `AskUserQuestion` tool instead of writing a bulleted list in markdown");
  });

  it("keeps AskUserQuestion as the follow-up choice UI for Claude", () => {
    const prompt = composeSystemPrompt({ agentId: "claude", sessionMode: "comprehensive" });

    expect(prompt).toContain("## Clarifying questions");
    expect(prompt).toContain("call the `AskUserQuestion` tool instead of writing a bulleted list in markdown");
    expect(prompt).toContain("that tool call is the entire response");
  });

  it("injects Chinese quick brief guidance when the UI locale is zh-CN", () => {
    const prompt = composeSystemPrompt({ locale: "zh-CN" });

    expect(prompt).toContain("# UI locale override");
    expect(prompt).toContain("`zh-CN` (Simplified Chinese)");
    expect(prompt).toContain("This locale is the user's Settings → Language choice");
    expect(prompt).toContain("Use Simplified Chinese as the default conversation language");
    expect(prompt).toContain("中文沟通要求：默认用简体中文和用户交流");
    expect(prompt).toContain("快速简报 — 30 秒");
    expect(prompt).toContain("目标用户");
    expect(prompt).toContain("视觉调性");
    expect(prompt).toContain("Keep machine-readable ids and object option `value` fields exact and unlocalized");
  });

  it("preserves canonical default task-type options under locale overrides", () => {
    const prompt = composeSystemPrompt({ locale: "zh-CN" });

    expect(prompt).toContain("keep the `taskType` option labels as the canonical routing choices");
    for (const option of [
      "Prototype",
      "Live artifact",
      "Slide deck",
      "Image",
      "Video",
      "HyperFrames",
      "Audio",
      "Other"
    ]) {
      expect(prompt).toContain(`"${option}"`);
    }
    expect(prompt).not.toContain("option labels as `原型`");
    expect(prompt).not.toContain("`实时作品`");
  });

  it("preserves canonical default task-type options for zh-TW locale overrides", () => {
    const prompt = composeSystemPrompt({ locale: "zh-TW" });

    expect(prompt).toContain("# UI locale override");
    expect(prompt).toContain("`zh-TW` (Traditional Chinese)");
    expect(prompt).toContain("keep the `taskType` option labels as the canonical routing choices");
    for (const option of [
      "Prototype",
      "Live artifact",
      "Slide deck",
      "Image",
      "Video",
      "HyperFrames",
      "Audio",
      "Other"
    ]) {
      expect(prompt).toContain(`"${option}"`);
    }
    expect(prompt).not.toContain("快速简报 — 30 秒");
    expect(prompt).not.toContain("option labels as `原型`");
    expect(prompt).not.toContain("`实时作品`");
  });

  it("treats an active design system as the visual direction", () => {
    const prompt = composeSystemPrompt({
      designSystemTitle: "ComfyUI",
      designSystemBody: "# ComfyUI\n\n--accent: #ffd500",
      metadata: { kind: "prototype" } as any,
      activeStageBlocks: ["\n\n## Active stage: plan\n\n### direction-picker\n\nAsk for 3-5 directions."]
    });

    expect(prompt).toContain("## Active design system — ComfyUI");
    expect(prompt).toContain("Active design system exception");
    expect(prompt).toContain("the active design system is the visual direction for this project");
    expect(prompt).toContain("Do not ask the user to pick a separate theme color");
    expect(prompt).toContain("Do not emit a direction question-form");
    expect(prompt).not.toContain('<question-form id="direction"');
    expect(prompt).not.toContain("Pick a visual direction");
    expect(prompt.indexOf("## Active design system visual direction")).toBeGreaterThan(
      prompt.indexOf("### direction-picker")
    );
  });

  it("uses stable brand option values for discovery-form branching", () => {
    const prompt = composeSystemPrompt({});
    expect(prompt).toContain('{ "label": "Pick a direction for me", "value": "pick_direction" }');
    expect(prompt).toContain('{ "label": "I have a brand spec — I\'ll share it", "value": "brand_spec" }');
    expect(prompt).toContain(
      '{ "label": "Match a reference site / screenshot — I\'ll attach it", "value": "reference_match" }'
    );
    expect(prompt).toContain(
      "When the answer line includes `[value: ...]`, use that stable value instead of the visible label."
    );
    expect(prompt).toContain('If you keep the `brand` question, its `id` must stay `"brand"`.');
    expect(prompt).toContain(
      "you may drop the `brand` question as already answered, but you must still treat that provided source as Branch A below"
    );
    expect(prompt).toContain("When skipping the form, do not skip brand-source handling");
    expect(prompt).toContain(
      "If the current message, attachments, prior brief, or URL already contains an actual brand spec / brand guide / reference site / screenshot source, use Branch A."
    );
    expect(prompt).toContain(
      '### Branch A — user provided a brand/reference source, or `brand` value is `"brand_spec"` / `"reference_match"`'
    );
    expect(prompt).toContain("ask them to paste/upload the brand spec or reference and stop");
    expect(prompt).toContain("Do not guess a brand domain or invent tokens");
    expect(prompt).toContain(
      "An active design system does not suppress Branch A when the user provides a brand/reference source"
    );
    expect(prompt).toContain("### Branch B — no user-provided brand/reference source and no Branch A brand value");
    expect(prompt).toContain("active-design-system cases where the user did not provide a new brand/reference source");
    expect(prompt).toContain("Provided brand/reference source → run brand-spec extraction");
    expect(prompt).toContain(
      "`brand_spec` / `reference_match` without a provided source → ask for the source and stop; do not guess brand tokens."
    );
  });

  it("injects live-artifact skill guidance and metadata intent", () => {
    const prompt = composeSystemPrompt({
      skillName: "live-artifact",
      skillMode: "prototype",
      skillBody: liveArtifactSkillBody,
      metadata: {
        kind: "prototype",
        intent: "live-artifact"
      } as any
    });

    expect(prompt).toContain("## Active skill — live-artifact");
    expect(prompt).toContain(`> **Skill root (absolute):** \`${liveArtifactRoot}\``);
    expect(prompt).not.toContain("**Pre-flight (do this before any other tool):** Read `assets/template.html`");
    expect(prompt).not.toContain("live-artifact/references/layouts.md");
    expect(prompt).not.toContain("live-artifact/assets/template.html");
    expect(prompt).toContain("`references/artifact-schema.md`");
    expect(prompt).toContain("`references/connector-policy.md`");
    expect(prompt).toContain("`references/refresh-contract.md`");
    expect(prompt).toContain(
      "The wrapper reads injected `OD_NODE_BIN`, `OD_BIN`, `OD_DAEMON_URL`, and `OD_TOOL_TOKEN`"
    );
    expect(prompt).toContain(
      "Do not include or invent `projectId`; the daemon derives project/run scope from the token."
    );
    expect(prompt).toContain('"$OD_NODE_BIN" "$OD_BIN" tools live-artifacts create --input artifact.json');
    expect(prompt).toContain("if the user names a connector/source (for example Notion)");
    expect(prompt).toContain("list connectors before asking where the data comes from");
    expect(prompt).toContain(
      "a connected `notion` connector plus a user brief that names Notion is enough to start with `notion.notion_search`"
    );
    expect(prompt).toContain("Prefer the `live-artifact` skill workflow when available");
    expect(prompt).toContain("The first output should be a live artifact/dashboard/report");
  });

  // The daemon composer (this file) is what apps/daemon/src/server.ts wires
  // into live chat runs. The contracts copy at packages/contracts/src/prompts
  // /system.ts exists for non-daemon contexts and was updated in the
  // hyperframes PR; without this test the two copies drift silently and the
  // main HyperFrames flow misses its preflight directive in production.
  it("injects the html-in-canvas preflight for the hyperframes skill", () => {
    const prompt = composeSystemPrompt({
      skillName: "hyperframes",
      skillMode: "video",
      skillBody: hyperframesSkillBody,
      metadata: {
        kind: "video",
        videoModel: "hyperframes-html"
      } as any
    });

    expect(prompt).toContain("## Active skill — hyperframes");
    expect(prompt).toContain("**Pre-flight (do this before any other tool):**");
    expect(prompt).toContain("`references/html-in-canvas.md`");
    expect(prompt).toContain("media generate --surface video --model hyperframes-html --composition-dir");
    expect(prompt).not.toContain("that path is\n   intentionally rejected for this model");
    expect(prompt).toContain(
      "For ecommerce/product selling video briefs, follow the Ecommerce selling-video staged workflow"
    );
  });

  it("turns media generation into brief question behavior in question mode", () => {
    const prompt = composeSystemPrompt({
      metadata: {
        kind: "video",
        videoModel: "hyperframes-html"
      } as any,
      mediaExecution: {
        mode: "question",
        allowedSurfaces: ["video"],
        allowedModels: ["hyperframes-html"]
      }
    });

    expect(prompt).toContain("## Media question mode");
    expect(prompt).toContain('Do not call\n`"$OD_NODE_BIN" "$OD_BIN" media generate`');
    expect(prompt).toContain("this conversation is in Question / chat mode");
    expect(prompt).not.toContain("Dispatch immediately when the brief is complete");
  });

  it("adds the ecommerce selling-video staged workflow for video projects", () => {
    const prompt = composeSystemPrompt({
      metadata: {
        kind: "video",
        videoModel: "doubao-seedance-2-0-260128",
        videoLength: 20,
        videoAspect: "9:16"
      } as any
    });

    expect(prompt).toContain("### Ecommerce selling-video staged workflow");
    expect(prompt).toContain("### Commerce-video task-type classifier");
    expect(prompt).toContain("Default injected prompt for strict staged mode");
    expect(prompt).toContain(
      "请用我刚上传的商品素材生成一条 9:16 竖版带货短视频。严格按 commerce-video 六阶段流程执行：商品素材上传、剧本生成、基础分镜、一键成片、任务进度、预览导出。现在只执行第 1 阶段「商品素材上传」，完成后标记当前阶段并询问我是否进入「剧本生成」。不要生成剧本、不要生成分镜、不要创建成片任务。"
    );
    expect(prompt).toContain("Full-auto injected prompt for explicit one-click mode");
    expect(prompt).toContain("用户已明确要求一键成片");
    expect(prompt).toContain("使用一键生成视频的模式");
    expect(prompt).toContain("一键生成视频");
    expect(prompt).toContain("等待任务完成后必须继续调用 preview 和 export");
    expect(prompt).toContain("不要在完成后询问是否导出");
    expect(prompt).toContain("不要在阶段之间停下来询问");
    expect(prompt).toContain("Do not classify a stage-list mention of 一键成片 as full-auto");
    expect(prompt).toContain("Default chain: 商品素材上传 -> 剧本生成 -> 基础分镜 -> 一键成片 -> 任务进度 -> 预览导出");
    expect(prompt).toContain(
      "Complete only the current stage, then stop and ask the user whether to enter the next stage"
    );
    expect(prompt).toContain("Stage name 一键成片 alone is not permission for full automation");
    expect(prompt).toContain("Full automation requires explicit wording such as 一键生成视频");
    expect(prompt).toContain("Do not treat 完整 commerce-video 工作流");
    expect(prompt).toContain("do not create a replacement project");
    expect(prompt).toContain("The 剧本生成 and 基础分镜 workbenches are separate");
    expect(prompt).toContain("Do not prefill the UI with example scripts or example shots");
    expect(prompt).toContain("do not call `commerce-video storyboard` during 剧本生成");
    expect(prompt).toContain("quality-video library to find similar public references");
    expect(prompt).toContain("clothing-product mock reference set");
    expect(prompt).toContain("strategy + factors");
    expect(prompt).toContain("Do not generate or save storyboard shots in this stage");
    expect(prompt).toContain("Do not rewrite the script or create a generation task");
    expect(prompt).toContain(
      'Do not call direct `"$OD_NODE_BIN" "$OD_BIN" media generate` for ecommerce/product selling videos'
    );
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video materials');
    expect(prompt).toContain("--materials-file <path|->");
    expect(prompt).toContain("project's `commerce-video/materials.sqlite`");
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video script');
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video storyboard');
    expect(prompt).toContain("--storyboard-file <path|->");
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video generate');
    expect(prompt).toContain("--follow --full-auto");
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video jobs');
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video wait');
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video preview');
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" commerce-video export');
    expect(prompt).toContain("`product_source`");
    expect(prompt).toContain("`asset_manifest`");
    expect(prompt).toContain("`storyboard` (top-level `shots[]` payload for the storyboard API)");
    expect(prompt).toContain("`preview_export`");
    expect(prompt).toContain("`retry_or_diagnostics`");
    expect(prompt).toContain("duration `min(lengthSeconds, 15)` or 15s when length is unknown");
    expect(prompt).toContain(
      "Generated commerce-video outputs are project artifacts, not source material-library assets"
    );
    expect(prompt).toContain("never call `assets commerce-videos import");
    expect(prompt).toContain("`minimax-video-01`");
    expect(prompt).toContain("`doubao-seedance-2-0-260128`");
    expect(prompt).not.toContain(
      "product input -> script -> storyboard -> TTS/BGM/subtitles -> <=15s finished video -> preview/export"
    );
    expect(prompt).not.toContain('do not call `"$OD_NODE_BIN" "$OD_BIN" media generate --surface video ...`');
    expect(prompt).not.toContain("Requirement Q&A");
    expect(prompt.indexOf("### Ecommerce selling-video staged workflow")).toBeGreaterThan(
      prompt.indexOf("This is a **video** project")
    );
  });

  it("ships the local ecommerce selling-video reference library for the default media scenario", () => {
    const mediaScenarioRoot = path.join(repoRoot, "plugins/_official/scenarios/od-media-generation");
    const scenarioSkill = readFileSync(path.join(mediaScenarioRoot, "SKILL.md"), "utf8");
    const reference = readFileSync(path.join(mediaScenarioRoot, "references/ecommerce-selling-video.md"), "utf8");

    expect(scenarioSkill).toContain("references/ecommerce-selling-video.md");
    expect(scenarioSkill).toContain("商品素材上传 -> 剧本生成 -> 基础分镜 -> 一键成片 -> 任务进度 -> 预览导出");
    expect(scenarioSkill).toContain("Do not treat the stage name 一键成片 as permission for full automation");
    expect(scenarioSkill).toContain("一键生成视频");
    expect(scenarioSkill).toContain("commerce-video generate --follow --full-auto");
    expect(reference).toContain("## Staged Chain");
    expect(reference).toContain("Finish exactly one stage, ask whether to enter the next stage");
    expect(reference).toContain("top-level `shots[]`");
    expect(reference).toContain("commerce-video generate --follow --full-auto");
    expect(reference).toContain("## Image-to-Video Rule");
    expect(reference).toContain("does not accept a raw `--image` flag");
    expect(reference).toContain("## Pattern A");
    expect(reference).toContain("## Pattern E");
  });

  it("does not add the responsive web contract to deck metadata without platform fields", () => {
    const prompt = composeSystemPrompt({
      metadata: {
        kind: "deck",
        speakerNotes: true,
        slideCount: "10-15 pages"
      } as any
    });

    expect(prompt).toContain("- **kind**: deck");
    expect(prompt).toContain("- **slideCount**: 10-15 pages");
    expect(prompt).not.toContain("**responsive web contract**");
    expect(prompt).not.toContain("**platformTargets**");
  });

  it("tells artifact generation to summarize instead of dumping raw HTML source into chat", () => {
    const prompt = composeSystemPrompt({
      metadata: { kind: "prototype", fidelity: "production" } as any
    });

    expect(prompt).toContain("Do not dump the full raw HTML source back into chat");
    expect(prompt).toContain("the assistant message should only summarize the result");
  });

  it("uses the primary skill surface when composed skill modes conflict", () => {
    const prompt = composeSystemPrompt({
      skillMode: "image",
      skillModes: ["deck", "image"]
    });

    expect(prompt).toContain("## Media generation contract");
    expect(prompt).not.toContain("# Slide deck — fixed framework");
  });

  it("lets metadata.kind win over conflicting composed skill modes", () => {
    const prompt = composeSystemPrompt({
      skillMode: "image",
      skillModes: ["deck", "image"],
      metadata: { kind: "deck" } as any
    });

    expect(prompt).toContain("# Slide deck — fixed framework");
    expect(prompt).not.toContain("## Media generation contract");
  });

  it("resolves a non-media primary surface ahead of composed media mentions", () => {
    expect(
      resolveExclusiveSurface({
        skillMode: "deck",
        skillModes: ["deck", "image"]
      })
    ).toBe("deck");
  });

  describe("artifact handoff no-emit clauses (#1143)", () => {
    it('drops the absolute "non-negotiable" framing in favor of conditional language', () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).not.toContain("non-negotiable output rule");
    });

    it('includes the "When NOT to emit <artifact>" sub-section', () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).toContain("When NOT to emit `<artifact>`");
    });

    it("forbids wrapping in-place-edit-only turns in an artifact block", () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).toMatch(/in-place|Edit-only|already-existing/i);
      expect(prompt).toMatch(/do not (emit|wrap|send) (a |an )?`?<artifact/i);
    });

    it("forbids putting prose / summaries / paths inside an artifact block", () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).toMatch(/complete `?<!doctype html>`?/i);
      expect(prompt).toMatch(/summar(y|ies)|prose|file path/i);
    });

    it('does not carry unconditional "Emit single <artifact>" / "emit a single <artifact>" lines anywhere in the composed prompt', () => {
      const prompt = composeSystemPrompt({});
      // Discovery layer used to carry hard-rule unconditional emit instructions
      // (plan template step 9, default arc Turn 3+ recap, deck workflow step 7).
      // Those must be conditional now — otherwise the no-emit exception in the
      // base prompt is overridden by the higher-priority discovery layer.
      expect(prompt).not.toMatch(/^- 9\.\s+Emit single <artifact>\s*$/m);
      expect(prompt).not.toMatch(/emit a single `?<artifact>`?\.\s*$/m);
      expect(prompt).not.toMatch(/^7\.\s+Emit single <artifact>\s*$/m);
    });

    it("declares artifact-emission conditionality at the dominant discovery layer", () => {
      const prompt = composeSystemPrompt({});
      // The base prompt's "When NOT to emit" section is at lower precedence than
      // DISCOVERY_AND_PHILOSOPHY, so the exception itself must be stated once at
      // the dominant layer (near RULE 3) — not only back-pointed.
      expect(prompt).toMatch(/only when this turn wrote a new canonical HTML/i);
      expect(prompt).toMatch(/only edited an existing HTML file/i);
    });

    it("also keeps deck-mode prompts free of the unconditional emit line (DECK_FRAMEWORK_DIRECTIVE only stacks for deck projects)", () => {
      // The plain composeSystemPrompt({}) call does NOT include
      // DECK_FRAMEWORK_DIRECTIVE; that directive only stacks when
      // `skillMode === 'deck'` or `metadata.kind === 'deck'`. So if
      // deck-framework.ts:327 ever regresses back to "Emit single <artifact>",
      // a no-args negative assertion is a false negative — exercise the deck
      // path explicitly here.
      const deckPrompt = composeSystemPrompt({ skillMode: "deck" });
      expect(deckPrompt).not.toMatch(/^7\.\s+Emit single <artifact>\s*$/m);
      expect(deckPrompt).toMatch(/Emit single <artifact> if a new canonical deck HTML/i);
    });
  });

  describe("connectedExternalMcp directive", () => {
    it("omits the directive when no servers are passed", () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).not.toContain("External MCP servers — already authenticated");
      expect(prompt).not.toContain("mcp__<server>__authenticate");
    });

    it("omits the directive when an empty array is passed", () => {
      const prompt = composeSystemPrompt({ connectedExternalMcp: [] });
      expect(prompt).not.toContain("External MCP servers — already authenticated");
    });

    it("lists each connected server and forbids the synthetic auth tools", () => {
      const prompt = composeSystemPrompt({
        connectedExternalMcp: [{ id: "higgsfield-openclaw", label: "Higgsfield (OpenClaw)" }, { id: "github" }]
      });

      expect(prompt).toContain("## External MCP servers — already authenticated");
      expect(prompt).toContain("`higgsfield-openclaw`");
      expect(prompt).toContain("Higgsfield (OpenClaw)");
      expect(prompt).toContain("`github`");
      expect(prompt).toContain(
        "**Do NOT call any tool whose name matches `mcp__<server>__authenticate` or `mcp__<server>__complete_authentication`"
      );
      expect(prompt).toContain("localhost:<random>/callback");
      expect(prompt).toContain("Settings → External MCP");
    });

    it("skips entries with blank ids and emits no directive when nothing usable remains", () => {
      const prompt = composeSystemPrompt({
        connectedExternalMcp: [
          { id: "   ", label: "blank" },
          { id: "", label: "empty" }
        ] as any
      });
      expect(prompt).not.toContain("External MCP servers — already authenticated");
    });

    it("does not duplicate the label when it equals the id", () => {
      const prompt = composeSystemPrompt({
        connectedExternalMcp: [{ id: "github", label: "github" }]
      });
      expect(prompt).toContain("- `github`\n");
      expect(prompt).not.toContain("- `github` (github)");
    });

    it("keeps external MCP tools visible when OD-owned media execution is disabled", () => {
      const prompt = composeSystemPrompt({
        connectedExternalMcp: [{ id: "external-media", label: "External media" }],
        metadata: { kind: "image" },
        mediaExecution: { mode: "disabled" }
      });

      expect(prompt).toContain("## External MCP servers — already authenticated");
      expect(prompt).toContain("`external-media`");
      expect(prompt).toContain("Open Design-owned media execution is **disabled for this run**");
      expect(prompt).not.toContain("## Media generation contract");
    });
  });

  // The daemon experiment for compiling a brand's design system from prose
  // (DESIGN.md) into a machine-readable contract (tokens.css) plus a worked
  // fixture (components.html) lives in PR-C. The composer exposes two new
  // optional inputs (`designSystemTokensCss`, `designSystemFixtureHtml`)
  // that the daemon populates by default for every brand that ships
  // those files (PR-D flipped the env gate to default-on, with
  // `OD_DESIGN_TOKEN_CHANNEL=0` as the kill switch). These tests pin
  // the injection shape so the prompt structure cannot drift silently.
  describe("design-system token + fixture injection (#PR-C)", () => {
    const sampleTokensCss = ":root {\n  --bg: #ffffff;\n  --fg: #111111;\n  --accent: #0050d8;\n}";
    const sampleFixtureHtml =
      '<!doctype html>\n<html lang="en">\n  <body><button class="btn btn-primary">Subscribe</button></body>\n</html>';
    const sampleComponentsManifest =
      "components.manifest schema v1 for default\nAvailable component groups:\n- Buttons and calls to action: selectors .btn, .btn-primary; tokens --accent";

    it("appends BOTH a tokens block and a fixture block when both inputs are present", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# Neutral Modern\n\n> Category: Utility\n\nProse description.",
        designSystemTokensCss: sampleTokensCss,
        designSystemFixtureHtml: sampleFixtureHtml
      });

      expect(prompt).toContain("## Active design system tokens — default");
      expect(prompt).toContain("Paste the unscoped `:root { ... }` block verbatim");
      expect(prompt).toContain("--accent: #0050d8;");

      expect(prompt).toContain("## Reference fixture — default");
      expect(prompt).toContain("Match its component shapes");
      expect(prompt).toContain('class="btn btn-primary"');
    });

    it("places USAGE.md before DESIGN.md so it acts as the package router", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "PROSE_BODY_MARKER",
        designSystemUsageMd: "Read Order: inspect the manifest cache before source evidence."
      });

      const usageAt = prompt.indexOf("## How to use this design system — default");
      const proseAt = prompt.indexOf("## Active design system — default");
      expect(usageAt).toBeGreaterThan(0);
      expect(proseAt).toBeGreaterThan(usageAt);
      expect(prompt).toContain("Read Order: inspect the manifest cache before source evidence.");
    });

    it("injects a small default usage router for legacy brands with no USAGE.md", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "legacy",
        designSystemBody: "# Legacy\n\nProse description."
      });

      expect(prompt).toContain("## How to use this design system — legacy");
      expect(prompt).toContain("Read DESIGN.md for visual principles");
      expect(prompt).toContain("do not assume those files have already been loaded");
    });

    it("prefers the component manifest over the full fixture when both are present", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# Neutral Modern\n\n> Category: Utility\n\nProse description.",
        designSystemTokensCss: sampleTokensCss,
        designSystemComponentsManifest: sampleComponentsManifest,
        designSystemFixtureHtml: sampleFixtureHtml
      });

      expect(prompt).toContain("## Reference component manifest — default");
      expect(prompt).toContain("components.manifest schema v1 for default");
      expect(prompt).toContain("Buttons and calls to action");
      expect(prompt).not.toContain("## Reference fixture — default");
      expect(prompt).not.toContain('class="btn btn-primary"');
    });

    it("keeps the prompt byte-equivalent to the legacy path when both inputs are omitted", () => {
      const baseline = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# Neutral Modern\n\nProse only."
      });
      const withFlagOffEquivalent = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# Neutral Modern\n\nProse only.",
        designSystemTokensCss: undefined,
        designSystemComponentsManifest: undefined,
        designSystemFixtureHtml: undefined
      });

      expect(withFlagOffEquivalent).toBe(baseline);
      expect(withFlagOffEquivalent).not.toContain("## Active design system tokens");
      expect(withFlagOffEquivalent).not.toContain("## Reference component manifest");
      expect(withFlagOffEquivalent).not.toContain("## Reference fixture");
    });

    it("gates the tokens and fixture blocks independently — either may be absent", () => {
      const tokensOnly = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# x\n\nbody",
        designSystemTokensCss: sampleTokensCss
      });
      expect(tokensOnly).toContain("## Active design system tokens — default");
      expect(tokensOnly).not.toContain("## Reference fixture");

      const fixtureOnly = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# x\n\nbody",
        designSystemFixtureHtml: sampleFixtureHtml
      });
      expect(fixtureOnly).not.toContain("## Active design system tokens");
      expect(fixtureOnly).toContain("## Reference fixture — default");

      const manifestOnly = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# x\n\nbody",
        designSystemComponentsManifest: sampleComponentsManifest
      });
      expect(manifestOnly).not.toContain("## Active design system tokens");
      expect(manifestOnly).toContain("## Reference component manifest — default");
    });

    it("adds the pull-layer index without loading pull-layer file contents", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# x\n\nbody",
        designSystemPullIndex:
          "Additional design-system files declared by manifest.json:\n- preview/colors.html: Colors; colors\n- source/evidence.md: import evidence notes"
      });

      expect(prompt).toContain("## Pull-layer files available on demand — default");
      expect(prompt).toContain("preview/colors.html: Colors; colors");
      expect(prompt).toContain("source/evidence.md: import evidence notes");
      expect(prompt).toContain("Keep the push prompt light");
    });

    it("adds importMode guidance when the manifest declares consumption semantics", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "source-heavy",
        designSystemBody: "# x\n\nbody",
        designSystemImportMode: "verbatim"
      });

      expect(prompt).toContain("## Design system import mode — source-heavy");
      expect(prompt).toContain("Preserve source semantics and source naming");
      expect(prompt).toContain("pull-layer source evidence or snippets");
    });

    it("places the tokens + component manifest blocks AFTER the DESIGN.md prose block (prose sets voice, structured form binds names)", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "PROSE_BODY_MARKER",
        designSystemTokensCss: sampleTokensCss,
        designSystemComponentsManifest: sampleComponentsManifest,
        designSystemFixtureHtml: sampleFixtureHtml
      });
      const proseAt = prompt.indexOf("PROSE_BODY_MARKER");
      const tokensAt = prompt.indexOf("## Active design system tokens");
      const fixtureAt = prompt.indexOf("## Reference component manifest");
      expect(proseAt).toBeGreaterThan(0);
      expect(tokensAt).toBeGreaterThan(proseAt);
      expect(fixtureAt).toBeGreaterThan(tokensAt);
    });

    it("treats whitespace-only inputs as absent (defensive, matches DESIGN.md block behavior)", () => {
      const prompt = composeSystemPrompt({
        designSystemTitle: "default",
        designSystemBody: "# x\n\nbody",
        designSystemTokensCss: "   \n  \t  ",
        designSystemComponentsManifest: "\n\t",
        designSystemFixtureHtml: "\n\n"
      });
      expect(prompt).not.toContain("## Active design system tokens");
      expect(prompt).not.toContain("## Reference component manifest");
      expect(prompt).not.toContain("## Reference fixture");
    });
  });
});
