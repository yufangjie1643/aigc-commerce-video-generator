from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]


def storyboard_files(inputs: list[str]) -> list[Path]:
    files: list[Path] = []
    for item in inputs:
        path = Path(item)
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(path.rglob("*.storyboard.json"))
        else:
            files.extend(Path().glob(item))
    return sorted({file.resolve() for file in files})


def report_from(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("report"), dict):
        return data["report"]
    if isinstance(data, dict):
        return data
    raise RuntimeError(f"Storyboard JSON must be an object: {path}")


def list_values(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def add_counter(counter: Counter[str], values: list[Any]) -> None:
    for value in values:
        if isinstance(value, dict):
            candidate = text(value.get("summary") or value.get("visual_description") or value.get("screen_visual"))
        else:
            candidate = text(value)
        if candidate:
            counter[candidate] += 1


def collect(files: list[Path]) -> dict[str, Any]:
    hooks: Counter[str] = Counter()
    selling_points: Counter[str] = Counter()
    framing: Counter[str] = Counter()
    motions: Counter[str] = Counter()
    purposes: Counter[str] = Counter()
    reuse: Counter[str] = Counter()
    risks: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    editing_notes: dict[str, Counter[str]] = {}
    source_summaries: list[dict[str, str]] = []
    product_dimensions: list[dict[str, Any]] = []
    video_dimensions: list[dict[str, Any]] = []
    slice_dimensions: list[dict[str, Any]] = []
    downstream_contracts: list[dict[str, Any]] = []

    for path in files:
        report = report_from(path)
        metadata = report.get("metadata") if isinstance(report.get("metadata"), dict) else {}
        asset_contract = report.get("asset_contract") if isinstance(report.get("asset_contract"), dict) else {}
        category = text(metadata.get("category")) or "unknown"
        categories[category] += 1
        source_summaries.append(
            {
                "file": str(path),
                "video_name": text(metadata.get("video_name")) or path.stem,
                "category": category,
                "summary": text(report.get("overall_summary")),
            }
        )
        if isinstance(asset_contract.get("product_dimensions"), dict):
            product_dimensions.append({"source": str(path), **asset_contract["product_dimensions"]})
        if isinstance(asset_contract.get("video_dimensions"), dict):
            video_dimensions.append({"source": str(path), **asset_contract["video_dimensions"]})
        if isinstance(asset_contract.get("downstream_contract"), dict):
            downstream_contracts.append({"source": str(path), **asset_contract["downstream_contract"]})
        if isinstance(asset_contract.get("slice_dimensions"), list):
            for item in asset_contract["slice_dimensions"]:
                if isinstance(item, dict):
                    slice_dimensions.append({"source": str(path), **item})
        add_counter(hooks, list_values(report.get("hook_patterns")))
        add_counter(selling_points, list_values(report.get("selling_points")))
        add_counter(reuse, list_values(report.get("reuse_recommendations")))
        add_counter(risks, list_values(report.get("risk_notes")))

        for shot in list_values(report.get("shot_breakdown")):
            if not isinstance(shot, dict):
                continue
            for key, counter in (
                ("camera_framing", framing),
                ("shot_type", framing),
                ("action", motions),
                ("editing_purpose", purposes),
                ("reuse_suggestion", reuse),
            ):
                value = text(shot.get(key))
                if value:
                    counter[value] += 1

        notes = report.get("editing_notes")
        if isinstance(notes, dict):
            for key, value in notes.items():
                editing_notes.setdefault(str(key), Counter())[text(value)] += 1

    return {
        "source_count": len(files),
        "categories": categories,
        "sources": source_summaries,
        "hooks": hooks,
        "selling_points": selling_points,
        "framing": framing,
        "motions": motions,
        "purposes": purposes,
        "reuse": reuse,
        "risks": risks,
        "editing_notes": editing_notes,
        "product_dimensions": product_dimensions,
        "video_dimensions": video_dimensions,
        "slice_dimensions": slice_dimensions,
        "downstream_contracts": downstream_contracts,
    }


def top(counter: Counter[str], limit: int = 8) -> list[dict[str, Any]]:
    return [{"text": key, "count": value} for key, value in counter.most_common(limit)]


def confidence(count: int, source_count: int) -> str:
    if source_count >= 3 and count >= 3:
        return "high"
    if count >= 2:
        return "medium"
    return "low"


def build_pipeline(collected: dict[str, Any]) -> dict[str, Any]:
    source_count = int(collected["source_count"])
    categories = top(collected["categories"])
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_count": source_count,
        "categories": categories,
        "sources": collected["sources"],
        "structured_asset_contract": {
            "granularity": ["asset", "asset_file", "asset_slice"],
            "product_dimensions": collected["product_dimensions"],
            "video_dimensions": collected["video_dimensions"],
            "slice_dimensions": collected["slice_dimensions"],
            "downstream_contracts": collected["downstream_contracts"],
            "fallback_product_dimensions": {
                "category_candidates": categories,
                "subject": "derive from asset title, category, detected_objects, and slice summaries",
                "claim_constraints": ["Do not invent unseen brand, price, efficacy, or body-effect claims."],
            },
            "embedding_scopes": [
                "video: overall summary + category + selling points + hook/style/CTA",
                "slice: timestamp + summary + detected objects + OCR + visual features + usage context",
            ],
            "recommended_consumers": ["script_generation", "creation_edit_plan", "asset_retrieval", "video_generation"],
        },
        "technique_library": {
            "hooks": [{**item, "confidence": confidence(item["count"], source_count)} for item in top(collected["hooks"])],
            "selling_points": [{**item, "confidence": confidence(item["count"], source_count)} for item in top(collected["selling_points"])],
            "camera_framing": [{**item, "confidence": confidence(item["count"], source_count)} for item in top(collected["framing"])],
            "motion": [{**item, "confidence": confidence(item["count"], source_count)} for item in top(collected["motions"])],
            "editing_purpose": [{**item, "confidence": confidence(item["count"], source_count)} for item in top(collected["purposes"])],
            "reuse": [{**item, "confidence": confidence(item["count"], source_count)} for item in top(collected["reuse"])],
            "risks": [{**item, "confidence": confidence(item["count"], source_count)} for item in top(collected["risks"])],
        },
        "generation_pipeline": [
            {
                "stage": "intake",
                "instruction": "Collect product facts, target audience, platform, references, duration, aspect ratio, and hard claims.",
            },
            {
                "stage": "hook",
                "instruction": "Make the product visible in the first 2 seconds and use a reference-supported hook.",
            },
            {
                "stage": "proof",
                "instruction": "Show concrete product evidence: try-on, label, texture, packaging, hands-on use, or result.",
            },
            {
                "stage": "motion",
                "instruction": "Use simple motion that proves the product: turn, walk, open, pour, wipe, apply, compare, or place.",
            },
            {
                "stage": "style",
                "instruction": "Match category scene language while keeping background secondary to the product.",
            },
            {
                "stage": "copy-audio",
                "instruction": "Use short captions or TTS lines tied to visible evidence. Do not add unsupported claims.",
            },
            {
                "stage": "cta",
                "instruction": "End on product/result recap with a save, click, buy, or collection CTA.",
            },
            {
                "stage": "qa",
                "instruction": "Check product identity, claim evidence, readable text, watermark/logo risk, and motion coherence.",
            },
        ],
    }


def markdown(pipeline: dict[str, Any]) -> str:
    lines: list[str] = ["# 视频生成流水线", ""]
    lines.append(f"- 来源分镜数: `{pipeline['source_count']}`")
    if pipeline["source_count"] < 3:
        lines.append("- 置信度提示: 当前来源少于 3 个，先作为候选流水线使用。")
    lines.append("")

    contract = pipeline.get("structured_asset_contract") if isinstance(pipeline.get("structured_asset_contract"), dict) else {}
    if contract:
        lines.extend(["## 结构化资产契约", ""])
        lines.append(f"- 粒度: `{', '.join(contract.get('granularity') or [])}`")
        lines.append(f"- 商品维度记录数: `{len(contract.get('product_dimensions') or [])}`")
        lines.append(f"- 视频维度记录数: `{len(contract.get('video_dimensions') or [])}`")
        lines.append(f"- 切片维度记录数: `{len(contract.get('slice_dimensions') or [])}`")
        lines.append(f"- 推荐消费者: `{', '.join(contract.get('recommended_consumers') or [])}`")
        lines.append("")
        fallback = contract.get("fallback_product_dimensions")
        if isinstance(fallback, dict):
            lines.extend(["### 缺省商品维度补全", ""])
            for key, value in fallback.items():
                lines.append(f"- {key}: {value}")
            lines.append("")

    lines.extend(["## 来源", ""])
    for source in pipeline["sources"]:
        lines.append(f"- `{source['video_name']}` ({source['category']}): {source['summary']}")
    lines.append("")

    lines.extend(["## 核心技法库", ""])
    for key, title in (
        ("hooks", "Hook"),
        ("selling_points", "卖点"),
        ("camera_framing", "镜头/构图"),
        ("motion", "动作"),
        ("editing_purpose", "剪辑目的"),
        ("reuse", "复用方式"),
        ("risks", "风险"),
    ):
        values = pipeline["technique_library"][key]
        if not values:
            continue
        lines.extend([f"### {title}", ""])
        for item in values:
            lines.append(f"- [{item['confidence']}] {item['text']} (x{item['count']})")
        lines.append("")

    lines.extend(["## 生成流水线", ""])
    for index, stage in enumerate(pipeline["generation_pipeline"], start=1):
        lines.append(f"{index}. **{stage['stage']}**: {stage['instruction']}")
    lines.append("")

    lines.extend(
        [
            "## 9:16 默认镜头配方",
            "",
            "| 镜头 | 时长 | 目标 | 画面 | 文案/声音 |",
            "| --- | --- | --- | --- | --- |",
            "| 1 | 0-2s | 抓住注意 | 产品直接出现，强首帧 | 一句利益承诺 |",
            "| 2 | 2-4s | 建立场景 | 用户/手/场景带出使用语境 | 痛点或使用场景 |",
            "| 3 | 4-7s | 证明卖点 | 近景展示材质、标签、结构、功能 | 卖点 1 |",
            "| 4 | 7-10s | 展示动作 | 试穿、打开、擦拭、倒出、操作、对比 | 卖点 2 |",
            "| 5 | 10-13s | 结果与 CTA | 产品+结果回看，干净收尾 | 点击/收藏/购买 |",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a reusable video generation pipeline from storyboard JSON files.")
    parser.add_argument("--input", action="append", required=True, help="Storyboard JSON file, directory, or glob. Can be passed multiple times.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / ".od" / "asset-library" / "analysis" / "video-generation-pipeline"))
    parser.add_argument("--name", default="multi-video-generation-pipeline")
    args = parser.parse_args()

    files = storyboard_files(args.input)
    if not files:
        raise RuntimeError("No storyboard JSON files found")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pipeline = build_pipeline(collect(files))

    json_path = output_dir / f"{args.name}.json"
    md_path = output_dir / f"{args.name}.md"
    json_path.write_text(json.dumps(pipeline, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(markdown(pipeline), encoding="utf-8")
    print(json.dumps({"success": True, "json_path": str(json_path), "markdown_path": str(md_path), "source_count": len(files)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
