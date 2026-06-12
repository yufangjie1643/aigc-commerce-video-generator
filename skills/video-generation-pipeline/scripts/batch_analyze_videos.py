from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve()
SKILL_ROOT = SCRIPT_PATH.parents[1]
REPO_ROOT = SCRIPT_PATH.parents[3]
STORYBOARD_SCRIPT = SKILL_ROOT.parent / "video-storyboard-analysis" / "scripts" / "analyze_video_storyboard.py"
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi"}


def iter_videos(inputs: list[str], recursive: bool) -> list[Path]:
    videos: list[Path] = []
    for item in inputs:
        path = Path(item)
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            videos.append(path)
        elif path.is_dir():
            pattern = "**/*" if recursive else "*"
            videos.extend(child for child in path.glob(pattern) if child.is_file() and child.suffix.lower() in VIDEO_EXTENSIONS)
        else:
            videos.extend(Path().glob(item))
    return sorted({video.resolve() for video in videos})


def output_json_path(output_dir: Path, video: Path) -> Path:
    return output_dir / f"{video.stem}.storyboard.json"


def category_for(video: Path, mode: str, fallback: str) -> str:
    if mode == "parent":
        return video.parent.name
    if mode == "grandparent":
        return video.parent.parent.name if video.parent.parent else video.parent.name
    return fallback


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch analyze videos using the video-storyboard-analysis skill.")
    parser.add_argument("--input", action="append", required=True, help="Video file, directory, or glob. Can be passed multiple times.")
    parser.add_argument("--output-dir", default=str(REPO_ROOT / ".od" / "asset-library" / "analysis" / "video-storyboard-analysis"))
    parser.add_argument("--fps", type=float, default=1.0)
    parser.add_argument("--category", default="电商短视频")
    parser.add_argument("--category-mode", choices=["fixed", "parent", "grandparent"], default="parent")
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    if not STORYBOARD_SCRIPT.exists():
        raise RuntimeError(f"Missing required script: {STORYBOARD_SCRIPT}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    videos = iter_videos(args.input, args.recursive)
    if args.limit > 0:
        videos = videos[: args.limit]

    failures: list[tuple[Path, int]] = []
    for index, video in enumerate(videos, start=1):
        target = output_json_path(output_dir, video)
        if target.exists() and not args.force:
            print(f"[skip] {index}/{len(videos)} {video}")
            continue
        print(f"[analyze] {index}/{len(videos)} {video}")
        command = [
            sys.executable,
            str(STORYBOARD_SCRIPT),
            "--video",
            str(video),
            "--output-dir",
            str(output_dir),
            "--fps",
            str(args.fps),
            "--category",
            category_for(video, args.category_mode, args.category),
        ]
        result = subprocess.run(command, cwd=str(REPO_ROOT), text=True)
        if result.returncode != 0:
            failures.append((video, result.returncode))

    if failures:
        for video, code in failures:
            print(f"[failed] code={code} {video}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
