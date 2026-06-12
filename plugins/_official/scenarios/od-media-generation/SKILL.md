---
name: od-media-generation
description: Default reference pipeline for image, video, and audio projects — routes through media-image / media-video / media-audio atoms based on the project kind, wraps the output in a live artifact, and devloops on critique-theater until the score converges.
od:
  scenario: media-generation
  mode: scenario
---

# od-media-generation (scenario)

This scenario plugin is the bundled default for projects whose
`metadata.kind` is `image`, `video`, or `audio`. The web client and the
daemon both look up `defaultScenarioPluginIdForKind(kind)` from
`@open-design/contracts` and, when no other plugin is applied, bind
this scenario at project / run creation time.

## Default pipeline

```jsonc
{
  "stages": [
    { "id": "discovery", "atoms": ["discovery-question-form"] },
    { "id": "plan", "atoms": ["todo-write"] },
    { "id": "generate", "atoms": ["media-image", "media-video", "media-audio", "live-artifact"] },
    {
      "id": "critique",
      "atoms": ["critique-theater"],
      "repeat": true,
      "until": "critique.score>=4 || iterations>=3"
    }
  ]
}
```

The `generate` stage lists all three media atoms even though a single
run only calls one of them. Picking the right atom is the agent's job:

- `metadata.kind === 'image'` → `media-image`
- `metadata.kind === 'video'` → `media-video`
- `metadata.kind === 'audio'` → `media-audio`

If the user picks this plugin manually without a media-typed project,
prefer `media-image` and explain the assumption in the first reply.

## Ecommerce selling-video staged workflow

For video projects whose brief is ecommerce, product selling, 带货,
product demo, product ad, offer/CTA, livestream clip, marketplace short
video, or any product image/link to finished-video request, route into the
strict staged production chain:

`商品素材上传 -> 剧本生成 -> 基础分镜 -> 一键成片 -> 任务进度 -> 预览导出`

Complete only the current stage, stop, and ask whether to enter the next stage.
Do not treat the stage name 一键成片 as permission for full automation; it only
creates the generation task. Waiting and export belong to later stages unless
the user explicitly says 一键生成视频, 使用一键生成视频的模式, 全自动一键成片,
无需确认, 一次性跑完整流程到导出, or similar. In that full-auto case, run
`commerce-video generate --follow --full-auto`, then continue to preview/export
before reporting success.

1. **商品素材上传.** Identify product source (image, link, brief, library
   asset), audience, platform, promise, proof, offer/CTA, and constraints.
   Read `references/ecommerce-selling-video.md` when useful, then build an
   `asset_manifest` with `provided`, `retrieved`, `missing`, and `not needed`
   entries.
2. **剧本生成.** Produce one concise selling angle with hook, proof, offer, CTA,
   safety notes, and final TTS/voiceover copy.
3. **基础分镜.** Produce 3-6 shots, each with duration, visual goal,
   camera/motion, caption, voiceover line, required asset, generation mode,
   prompt, match reason, and QA check.
4. **一键成片.** Create the generation task through the commerce-video workflow
   entrypoint only; do not wait or export in this stage.
5. **任务进度.** Observe/wait for the task, report progress or failure, and
   identify the retry path if needed.
6. **预览导出.** Fetch preview/export paths and report the final QA/export state.

Keep ecommerce first cuts at 15 seconds or less. If project metadata requests a
longer duration, render a 15s first cut and mention the clamp. Use `9:16` unless
the user or project metadata chose another aspect. The commerce-video CLI does
not accept a raw `--image` flag; when the user explicitly asks for
image-to-video / first-frame / reference-image video, bind the image through the
storyboard shot `requiredAssets` and prompt.

## Atom call shape

Every media atom takes the same kernel of inputs and returns a media
artifact reference that `live-artifact` can wrap:

- `prompt` — the rendered `useCase.query` after input substitution.
- `aspect` — one of `1:1` / `16:9` / `9:16` / `4:3` / `3:4`. Default
  `16:9`. The contracts `MediaAspect` union enumerates the legal
  values.
- `provider` — left blank by default so the daemon picks the user's
  configured provider for this media kind (see Settings → Media). Only
  set this when the user names a provider explicitly.

After the media atom returns:

1. Save the binary into `<cwd>/media/<timestamp>.<ext>`.
2. Call `live-artifact` to register a preview surface pointing at the
   saved file. The preview is what the user sees in the right pane.

## Critique loop

`critique-theater` reads the artifact, scores it across the standard
five dimensions, and emits a `critique.score` signal. The `until`
clause stops the loop at score ≥ 4 or three iterations, whichever
comes first. Use the critique notes to drive the next media call's
prompt, not to re-pick the media atom.

## Replace, do not extend

Enterprise editions that need a different default for media work
should ship a sibling scenario plugin and add the right mapping in
`@open-design/contracts/scenario-defaults`, not patch this manifest.
