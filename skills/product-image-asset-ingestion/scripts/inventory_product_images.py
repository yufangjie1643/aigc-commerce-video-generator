#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory product images in a folder tree.")
    parser.add_argument("--root", required=True, help="Folder to scan recursively.")
    parser.add_argument("--output", required=True, help="Output directory for manifest files.")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise SystemExit(f"root folder not found: {root}")
    output.mkdir(parents=True, exist_ok=True)

    images = []
    skipped_videos = []
    skipped_other = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        stat = path.stat()
        item = {
            "path": str(path),
            "relativePath": rel(path, root),
            "parent": rel(path.parent, root) if path.parent != root else "",
            "name": path.name,
            "extension": ext,
            "mime": mimetypes.guess_type(path.name)[0],
            "size": stat.st_size,
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        }
        if ext in IMAGE_EXTS:
            images.append(item)
        elif ext in VIDEO_EXTS:
            skipped_videos.append(item)
        else:
            skipped_other.append(item)

    manifest = {
        "workflow": "product-image-asset-ingestion",
        "root": str(root),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "images": len(images),
            "skippedVideos": len(skipped_videos),
            "skippedOther": len(skipped_other),
        },
        "images": images,
        "skippedVideos": skipped_videos,
        "skippedOther": skipped_other,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "contact-sheet.html").write_text(render_contact_sheet(manifest), encoding="utf-8")
    print(
        json.dumps(
            {
                "manifest": str(output / "manifest.json"),
                "contactSheet": str(output / "contact-sheet.html"),
                "counts": manifest["counts"],
            },
            ensure_ascii=False,
        )
    )
    return 0


def render_contact_sheet(manifest: dict) -> str:
    cards = []
    for index, item in enumerate(manifest["images"], start=1):
        src = Path(item["path"]).as_uri()
        cards.append(
            f'<figure><img src="{src}" alt="{item["relativePath"]}">'
            f'<figcaption>#{index} {item["relativePath"]}<br>{item["size"]} bytes</figcaption></figure>'
        )
    return f"""<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Product image inventory</title>
<style>
body{{font-family:system-ui,sans-serif;margin:24px;background:#f7f7f5;color:#171717}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}}
figure{{margin:0;padding:10px;border:1px solid #ddd;border-radius:8px;background:white}}
img{{display:block;width:100%;height:180px;object-fit:contain;background:#fafafa}}
figcaption{{margin-top:8px;font-size:12px;line-height:1.35;word-break:break-all;color:#555}}
</style>
<h1>Product image inventory</h1>
<p>{manifest["counts"]["images"]} images, {manifest["counts"]["skippedVideos"]} videos skipped.</p>
<div class="grid">{''.join(cards)}</div>
</html>
"""


if __name__ == "__main__":
    raise SystemExit(main())
