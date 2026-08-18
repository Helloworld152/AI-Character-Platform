from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def find_signed_bundle(root: Path, patterns: tuple[str, ...], prefer_setup: bool = False) -> Path:
    candidates = [
        path
        for pattern in patterns
        for path in root.rglob(pattern)
        if path.is_file() and path.with_name(path.name + ".sig").is_file()
    ]
    if prefer_setup:
        setup_candidates = [path for path in candidates if "setup" in path.name.lower()]
        if setup_candidates:
            candidates = setup_candidates
    if not candidates:
        raise SystemExit(f"找不到带签名的 updater 产物: {root}")
    return sorted(candidates)[0]


def release_entry(bundle: Path, repository: str, tag: str) -> dict[str, str]:
    signature = bundle.with_name(bundle.name + ".sig").read_text(encoding="utf-8").strip()
    base_url = f"https://github.com/{repository}/releases/download/{quote(tag, safe='')}"
    return {
        "url": f"{base_url}/{quote(bundle.name, safe='')}",
        "signature": signature,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 Tauri updater latest.json")
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    macos = find_signed_bundle(args.artifacts / "tauri-macos-release", ("*.app.tar.gz",))
    windows = find_signed_bundle(
        args.artifacts / "tauri-windows-release",
        ("*.exe", "*.msi"),
        prefer_setup=True,
    )
    payload = {
        "version": args.version.removeprefix("v"),
        "notes": "",
        "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "platforms": {
            "darwin-aarch64": release_entry(macos, args.repository, args.tag),
            "windows-x86_64": release_entry(windows, args.repository, args.tag),
        },
    }
    output = args.artifacts / "latest.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已生成 {output}")


if __name__ == "__main__":
    main()
