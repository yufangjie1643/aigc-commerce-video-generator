export const MEDIA_GENERATION_CONTRACT = `
---

## Media generation contract (load-bearing - overrides softer wording above)

This project is a **non-web** surface (image / video / audio). The unifying
contract is: skill workflow + project metadata tell you WHAT to make; one
shell command through \`OD_NODE_BIN\` + \`OD_BIN\` is HOW you actually produce bytes,
except ecommerce/product selling-video workflows which must use the stage-aware
\`commerce-video\` CLI/API.
Do not try to embed binary content inside \`<artifact>\` tags, and do not
write image/video/audio bytes by hand. Always call out to the dispatcher.

The daemon injects these environment variables for agent sessions:

- \`OD_NODE_BIN\` - absolute path to the Node-compatible runtime that started the daemon.
- \`OD_BIN\` - absolute path to the OD CLI script. On POSIX shells run with \`"$OD_NODE_BIN" "$OD_BIN" ...\`.
- \`OD_PROJECT_ID\` - active project id. Pass it as \`--project "$OD_PROJECT_ID"\`.
- \`OD_PROJECT_DIR\` - active project files directory.
- \`OD_DAEMON_URL\` - base URL of the local daemon.

Commerce-video carve-out: when the brief is for an ecommerce, product selling,
带货, marketplace, SKU, offer/CTA, product demo, or product-image-to-selling-video
workflow, do not call direct \`"$OD_NODE_BIN" "$OD_BIN" media generate\`. Use
the staged \`commerce-video\` commands so 商品素材上传 -> 剧本生成 -> 基础分镜 ->
一键成片 -> 任务进度 -> 预览导出 remains visible in the right-side UI. The stage
name 一键成片 only creates a generation task; waiting and export belong to later
stages unless the user explicitly asks for no-confirmation full automation.

Generated commerce-video outputs are project artifacts, not source material-library assets. For AI-generated finished videos, keep the MP4 in the project output/export path and media task state; never call \`assets commerce-videos import\`, \`import-crawler\`, \`import-upload\`, or \`import-search\`.

Run media generation through the dispatcher:

\`\`\`bash
"$OD_NODE_BIN" "$OD_BIN" media generate \\
  --project "$OD_PROJECT_ID" \\
  --surface <image|video|audio> \\
  --model <model-id> \\
  --output <filename> \\
  --prompt "<full prompt>" \\
  [--aspect 1:1|16:9|9:16|4:3|3:4] \\
  [--length <seconds>] \\
  [--duration <seconds>] \\
  [--prompt-influence <0-1>] \\
  [--image <project-relative-path>] \\
  [--reference-image-url <https-url>] \\
  [--reference-video-url <https-url>] \\
  [--reference-audio-url <https-url>] \\
  [--loop] \\
  [--audio-kind music|speech|sfx] \\
  [--voice <provider-voice-id>] \\
  [--language <lang>]
\`\`\`

Always quote the prompt value. Never splice unquoted user text into the
command line. The command returns JSON containing either a final
\`file\` object or a \`taskId\` for long-running renders.

Video defaults: use \`doubao-seedance-2-0-260128\` for ordinary
text-to-video. It also accepts \`--image <project-relative-path>\` for
reference-image / first-frame Seedance 2.0 video when the user explicitly
asks for it. For reachable external reference images, clips, or music, pass
\`--reference-image-url <https-url>\`, \`--reference-video-url <https-url>\`,
and/or \`--reference-audio-url <https-url>\`; the daemon sends them as
Seedance 2.0 \`reference_image\`/\`reference_video\`/\`reference_audio\`
content entries. Use \`minimax-video-01\` only when the user explicitly asks for
the MiniMax image-to-video provider/model.

For long-running renders, continue with:

\`\`\`bash
"$OD_NODE_BIN" "$OD_BIN" media wait <taskId> --since <nextSince>
\`\`\`

Native image/audio/video understanding is also exposed through the OD media CLI
when the user asks to inspect, summarize, tag, transcribe, or learn from
existing media:

\`\`\`bash
"$OD_NODE_BIN" "$OD_BIN" media understand \\
  --image|--audio|--video <project-relative-or-absolute-path-or-http-url> \\
  --provider mimo|volcengine-ark \\
  --prompt "<analysis instructions>" \\
  --json
\`\`\`

This calls the configured provider's native multimodal path (\`image_url\`,
\`input_audio\`, or \`video_url\`). Xiaomi MiMo defaults to \`mimo-v2.5\` for
all three media types; Volcengine Ark remains available for native video
understanding with \`--provider volcengine-ark\`. That generic Ark
understanding path only allows \`doubao-seed-2-0-lite-260215\`; ep-* endpoints
belong to the separate Volcengine generation/text-output provider. Prefer this
over manual frame extraction or screenshots when the user asks for video
understanding, and prefer it over hand-written guesses when the user asks to
understand a local image or audio file.

\`media wait\` exits \`0\` when done, \`2\` when still running, and \`5\`
when the provider task failed. Exit code \`2\` is not an error; keep polling
with the returned \`nextSince\`.

Do not emit \`<artifact>\` blocks for media. The artifact is the generated
file written by the dispatcher, and the file viewer will render images,
videos, and audio automatically. If generation fails, surface the actual
stderr / exit status instead of inventing a diagnosis.

For \`elevenlabs-sfx\`, do not pass \`--voice\`; the sound description belongs
in \`--prompt\`. Describe the audible event itself: source/action, materials,
intensity, space, timing, tail/decay, and anything to avoid. Keep ElevenLabs SFX \`--prompt\` under 450 characters; target 180-320 characters so the dispatcher
does not waste a generation attempt on provider validation. For music-like
requests on \`elevenlabs-sfx\`, produce a short sound-effects loop or texture,
not a full song arrangement. Example: "Seamless lo-fi felt-piano cafe loop, slow lazy jazz 7th/9th chords, subtle tape hiss, intimate room, soft decay, no vocals, no drums." Use
\`--prompt-influence 0.7\` for user-specified SFX so ElevenLabs follows the
prompt more closely; lower it only for exploratory/noisier variation. Add
\`--loop\` only for seamless ambience / background / game loop audio, and
mention loop intent in the prompt as well. SFX duration is capped at 30 seconds
by the provider.

Special case: \`hyperframes-html\` video projects may author composition HTML
in \`.hyperframes-cache/\`, then render through the daemon-backed dispatcher
with \`--composition-dir\` so Chrome-bound rendering runs outside the agent
sandbox.
`;
