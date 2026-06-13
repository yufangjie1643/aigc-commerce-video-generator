from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


SCRIPT_PATH = Path(__file__).resolve()
SKILL_ROOT = SCRIPT_PATH.parents[1]
REPO_ROOT = SCRIPT_PATH.parents[3]
DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODEL = "doubao-seed-2-0-lite-260215"
BASE64_MAX_BYTES = 50 * 1024 * 1024


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        if clean.startswith("export "):
            clean = clean.removeprefix("export ").strip()
        key, value = clean.split("=", 1)
        key = key.strip()
        if key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def is_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def encode_video_input(video: str) -> tuple[str, dict[str, Any]]:
    if is_url(video):
        return video, {"delivery": "url", "source": video}

    path = Path(video)
    if not path.exists():
        raise FileNotFoundError(str(path))
    size = path.stat().st_size
    if size > BASE64_MAX_BYTES:
        raise RuntimeError(
            f"Local video is {size} bytes, above the {BASE64_MAX_BYTES} byte Base64 limit. "
            "Upload it and pass a public URL instead."
        )
    mime_type = mimetypes.guess_type(path.name)[0] or "video/mp4"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}", {
        "delivery": "base64",
        "source": str(path),
        "bytes": size,
        "mime_type": mime_type,
    }


def storyboard_prompt(video_name: str, category: str, language: str) -> str:
    return f"""
你是电商短视频素材分镜解析专家。请分析视频《{video_name}》，类目：{category or "未知"}。

只输出一个合法 JSON 对象，不要 Markdown，不要代码块。请使用 {language}。

JSON 顶层字段必须包含：
- metadata: video_name, category, inferred_platform, duration_observation, confidence
- asset_contract: 用于素材入库和剧本/创作模块消费的结构化资产契约，必须包含：
  - product_dimensions: subject, category, product_role, usage_scene, target_audience, selling_point_candidates, claim_constraints
  - video_dimensions: overall_summary, embedding_text, style_tags, hook_type, cta_type, pacing, bgm_or_sound, platform_fit
  - slice_dimensions: 数组；每项包含 sequence, start_ms, end_ms, slice_type, summary, detected_objects, ocr_text, visual_features, usage_context, script_role, quality_score, embedding_text
  - downstream_contract: asset_granularity, recommended_consumers, retrieval_keywords, copyright_policy, safety_notes
- overall_summary: 一段 80-150 字总结
- selling_points: 字符串数组，提炼可复用商品卖点
- hook_patterns: 字符串数组，提炼开头吸引点
- shot_breakdown: 数组；每项包含 sequence, start_time, end_time, shot_type, camera_framing, visual_description, product_or_subject, action, ocr_text, audio_or_voiceover_cue, selling_point, editing_purpose, reuse_suggestion, quality_notes
- storyboard_script: 数组；每项包含 sequence, time_range, screen_visual, narration_or_caption, transition, production_notes
- editing_notes: pacing, color_style, lighting, composition, music_or_sound, subtitle_style
- reuse_recommendations: 数组，说明如何改编成新的 AIGC 带货视频
- risk_notes: 数组，指出水印、画质、夸大宣传、平台合规或素材可用性风险

要求：
1. 尽量给出明确时间段；如果模型只能近似判断，请在 quality_notes 中说明。
2. 关注服饰鞋包/电商带货语境，包括产品展示、上身/使用场景、质感、价格感、CTA。
3. 不要编造看不见的品牌、价格、功效或人物身份。
4. `embedding_text` 应是可用于向量检索的自然语言摘要，不要包含密钥、URL 或长篇原始文本。
""".strip()


def extract_text(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else {}
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = [item.get("text") for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)]
            return "\n".join(parts).strip()
    return json.dumps(body, ensure_ascii=False)


def extract_json_object(text: str) -> dict[str, Any]:
    clean = text.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?", "", clean, flags=re.IGNORECASE).strip()
        clean = re.sub(r"```$", "", clean).strip()
    try:
        value = json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", clean, flags=re.DOTALL)
        if not match:
            raise RuntimeError("Model output did not contain a JSON object")
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise RuntimeError("Model JSON output must be an object")
    return value


def post_json(endpoint: str, payload: dict[str, Any], api_key: str) -> tuple[int, dict[str, Any]]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            body = response.read().decode("utf-8", errors="replace")
            status = int(response.status)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        status = int(error.code)
    try:
        parsed = json.loads(body)
    except ValueError:
        parsed = {"raw": body[:2000]}
    return status, parsed


def to_markdown(report: dict[str, Any], *, video: str, model: str, fps: float, delivery: dict[str, Any]) -> str:
    def value_text(value: Any) -> str:
        return "" if value is None else str(value)

    def first_text(item: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = item.get(key)
            if value is not None and value != "":
                return str(value)
        return ""

    lines: list[str] = []
    lines.append("# 视频分镜解析剧本")
    lines.append("")
    lines.append(f"- 视频: `{video}`")
    lines.append(f"- 模型: `{model}`")
    lines.append(f"- FPS: `{fps}`")
    lines.append(f"- 输入方式: `{delivery.get('delivery')}`")
    lines.append(f"- 生成时间: `{datetime.now().isoformat(timespec='seconds')}`")
    lines.append("")

    summary = str(report.get("overall_summary") or "").strip()
    if summary:
        lines.extend(["## 总体概述", "", summary, ""])

    contract = report.get("asset_contract")
    if isinstance(contract, dict):
        lines.extend(["## 结构化资产契约", ""])
        product_dimensions = contract.get("product_dimensions")
        if isinstance(product_dimensions, dict):
            lines.extend(["### 商品维度", ""])
            for key, value in product_dimensions.items():
                lines.append(f"- {key}: {value}")
            lines.append("")
        video_dimensions = contract.get("video_dimensions")
        if isinstance(video_dimensions, dict):
            lines.extend(["### 视频维度", ""])
            for key, value in video_dimensions.items():
                lines.append(f"- {key}: {value}")
            lines.append("")
        slice_dimensions = contract.get("slice_dimensions")
        if isinstance(slice_dimensions, list) and slice_dimensions:
            lines.extend(["### 切片维度", ""])
            lines.append("| # | 时间 | 类型 | 摘要 | 对象/OCR | 用途 | 质量 |")
            lines.append("| --- | --- | --- | --- | --- | --- | --- |")
            for index, item in enumerate(slice_dimensions, start=1):
                if not isinstance(item, dict):
                    continue
                seq = item.get("sequence") or index
                time_range = f"{value_text(item.get('start_ms'))}-{value_text(item.get('end_ms'))}".strip("-")
                objects = ", ".join(str(value) for value in item.get("detected_objects") or [])
                ocr = first_text(item, "ocr_text")
                evidence = " / ".join(part for part in (objects, ocr) if part)
                row = [
                    seq,
                    time_range,
                    first_text(item, "slice_type"),
                    first_text(item, "summary"),
                    evidence,
                    first_text(item, "usage_context", "script_role"),
                    first_text(item, "quality_score"),
                ]
                lines.append("| " + " | ".join(str(cell).replace("|", "\\|").replace("\n", "<br>") for cell in row) + " |")
            lines.append("")

    for key, title in (("selling_points", "可复用卖点"), ("hook_patterns", "开头吸引点")):
        values = report.get(key)
        if isinstance(values, list) and values:
            lines.extend([f"## {title}", ""])
            lines.extend(f"- {item}" for item in values)
            lines.append("")

    shots = report.get("shot_breakdown")
    if isinstance(shots, list) and shots:
        lines.extend(["## 分镜拆解", ""])
        lines.append("| # | 时间 | 景别/构图 | 画面与动作 | 文案/声音 | 目的 | 复用建议 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for index, shot in enumerate(shots, start=1):
            if not isinstance(shot, dict):
                continue
            seq = shot.get("sequence") or index
            time_range = f"{value_text(shot.get('start_time'))}-{value_text(shot.get('end_time'))}".strip("-")
            framing = " / ".join(value_text(shot.get(k)) for k in ("shot_type", "camera_framing")).strip(" /")
            visual = "；".join(
                str(shot.get(k) or "")
                for k in ("visual_description", "product_or_subject", "action", "ocr_text")
                if shot.get(k)
            )
            cue = str(shot.get("audio_or_voiceover_cue") or "")
            purpose = str(shot.get("editing_purpose") or shot.get("selling_point") or "")
            reuse = str(shot.get("reuse_suggestion") or "")
            row = [seq, time_range, framing, visual, cue, purpose, reuse]
            lines.append("| " + " | ".join(str(cell).replace("|", "\\|").replace("\n", "<br>") for cell in row) + " |")
        lines.append("")

    script = report.get("storyboard_script")
    if isinstance(script, list) and script:
        lines.extend(["## 成片脚本", ""])
        for item in script:
            if not isinstance(item, dict):
                continue
            lines.append(f"### 镜头 {item.get('sequence')}")
            lines.append(f"- 时间: {item.get('time_range') or ''}")
            lines.append(f"- 画面: {item.get('screen_visual') or ''}")
            lines.append(f"- 口播/字幕: {first_text(item, 'narration_or_caption', 'narration_caption', 'caption', 'voiceover')}")
            lines.append(f"- 转场: {item.get('transition') or ''}")
            lines.append(f"- 制作备注: {item.get('production_notes') or ''}")
            lines.append("")

    notes = report.get("editing_notes")
    if isinstance(notes, dict) and notes:
        lines.extend(["## 风格与剪辑备注", ""])
        for key, value in notes.items():
            lines.append(f"- {key}: {value}")
        lines.append("")

    for key, title in (("reuse_recommendations", "AIGC 复用建议"), ("risk_notes", "风险与限制")):
        values = report.get(key)
        if isinstance(values, list) and values:
            lines.extend([f"## {title}", ""])
            lines.extend(f"- {item}" for item in values)
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze a video into an ecommerce storyboard script with Volcengine Ark.")
    parser.add_argument("--video", required=True, help="Local video path or remote URL.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / ".od" / "asset-library" / "analysis" / "video-storyboard-analysis"))
    parser.add_argument("--model", default=os.environ.get("ARK_VIDEO_STORYBOARD_MODEL") or os.environ.get("ARK_VIDEO_MODEL") or DEFAULT_MODEL)
    parser.add_argument("--base-url", default=os.environ.get("ARK_BASE_URL") or DEFAULT_BASE_URL)
    parser.add_argument("--fps", type=float, default=1.0)
    parser.add_argument("--category", default="服饰鞋包")
    parser.add_argument("--language", default="zh-CN")
    parser.add_argument("--max-tokens", type=int, default=4096)
    return parser.parse_args()


def main() -> int:
    load_dotenv(REPO_ROOT / ".env")
    load_dotenv(Path.cwd() / ".env")
    args = parse_args()

    api_key = os.environ.get("ARK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ARK_API_KEY is required in environment or project .env")
    if not (0.2 <= float(args.fps) <= 5):
        raise RuntimeError("--fps must be in the documented range [0.2, 5]")

    video_url, delivery = encode_video_input(args.video)
    video_name = Path(args.video).name if not is_url(args.video) else args.video.rsplit("/", 1)[-1]
    payload = {
        "model": args.model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "video_url", "video_url": {"url": video_url, "fps": float(args.fps)}},
                    {"type": "text", "text": storyboard_prompt(video_name, args.category, args.language)},
                ],
            }
        ],
        "max_tokens": int(args.max_tokens),
        "temperature": 0.2,
    }

    endpoint = f"{args.base_url.rstrip('/')}/chat/completions"
    status_code, body = post_json(endpoint, payload, api_key)
    if status_code >= 400:
        raise RuntimeError(f"Ark video request failed with HTTP {status_code}: {json.dumps(body, ensure_ascii=False)[:1000]}")

    text = extract_text(body)
    report = extract_json_object(text)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", Path(video_name).stem).strip("_") or "video"
    json_path = output_dir / f"{stem}.storyboard.json"
    md_path = output_dir / f"{stem}.storyboard.md"
    raw_path = output_dir / f"{stem}.raw_response.json"

    envelope = {
        "video": args.video,
        "model": args.model,
        "base_url": args.base_url,
        "fps": float(args.fps),
        "delivery": {k: v for k, v in delivery.items() if k != "source" or not str(v).startswith("data:")},
        "report": report,
    }
    json_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(to_markdown(report, video=args.video, model=args.model, fps=float(args.fps), delivery=delivery), encoding="utf-8")
    raw_path.write_text(json.dumps({"http_status": status_code, "body": body}, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "success": True,
                "video": args.video,
                "model": args.model,
                "fps": float(args.fps),
                "json_path": str(json_path),
                "markdown_path": str(md_path),
                "raw_response_path": str(raw_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
