"""
Export all Mermaid diagrams from documentation/uml_diagrams/*.md to PNG/SVG.

Requires: @mermaid-js/mermaid-cli installed globally
    npm install -g @mermaid-js/mermaid-cli

Usage:
    python scripts/export_mermaid.py             # export all diagrams
    python scripts/export_mermaid.py --fmt svg   # export as SVG instead of PNG

Output:
    figures/uml/<stem>_<N>.png   (or .svg)

Each .md file may contain multiple ```mermaid``` blocks; each block is
exported as a separate image, numbered _1, _2, _3 ...

After running, the figures/ folder contains ready-to-use images for
\includegraphics in Overleaf.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT    = pathlib.Path(__file__).parent.parent
SRC_DIR = ROOT / "documentation" / "uml_diagrams"
OUT_DIR = ROOT / "figures" / "uml"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Which files to export and in which order (matches PDF figure assignments)
# Files not listed here are still exported but sorted alphabetically at the end.
PRIORITY = [
    "env_02_agent_user_topology.md",       # Fig 5  — care circle topology
    "env_06_training_environment.md",      # Fig 6  — 8-arm capability ladder
    "env_03_rl_environment_pomdph.md",     # Fig 7  — POMDP-H state diagram
    "env_04_information_flow.md",          # Fig 14 — production data flow
    "env_01_physical_deployment.md",       # Appendix — physical deployment
    "env_05_care_circle_social_graph.md",  # Appendix — social graph
    "escalation_flow_v2_real_modules.md",  # Appendix — escalation flow
    "basic_message_flow_v2_real_modules.md",
    "consent_management_v2_real_modules.md",
    "context_switching_v2_real_modules.md",
]

MERMAID_RE = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)


def find_mmdc() -> str:
    """Return path to mmdc executable, or raise if not found."""
    candidate = shutil.which("mmdc")
    if candidate:
        return candidate
    # On Windows, global npm installs land in %APPDATA%\npm
    import os
    appdata = os.environ.get("APPDATA", "")
    win_path = pathlib.Path(appdata) / "npm" / "mmdc.cmd"
    if win_path.exists():
        return str(win_path)
    raise FileNotFoundError(
        "mmdc not found.  Install with:  npm install -g @mermaid-js/mermaid-cli"
    )


def extract_blocks(md_path: pathlib.Path) -> list[str]:
    text = md_path.read_text(encoding="utf-8", errors="ignore")
    return [m.group(1).strip() for m in MERMAID_RE.finditer(text)]


def export_block(
    mmdc: str,
    mermaid_src: str,
    out_path: pathlib.Path,
    fmt: str = "png",
    width: int = 1600,
) -> bool:
    """Write mermaid_src to a temp file and call mmdc. Returns True on success."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".mmd", encoding="utf-8", delete=False
    ) as tmp:
        tmp.write(mermaid_src)
        tmp_path = pathlib.Path(tmp.name)

    # mmdc config: white background, reasonable scale
    cfg = {"theme": "default", "background": "white"}
    cfg_path = tmp_path.with_suffix(".json")
    cfg_path.write_text(json.dumps(cfg), encoding="utf-8")

    cmd = [
        mmdc,
        "-i", str(tmp_path),
        "-o", str(out_path.with_suffix(f".{fmt}")),
        "-c", str(cfg_path),
        "-w", str(width),
        "--quiet",
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"  [warn] mmdc returned {result.returncode}: {result.stderr.strip()[:120]}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print("  [warn] mmdc timed out")
        return False
    finally:
        tmp_path.unlink(missing_ok=True)
        cfg_path.unlink(missing_ok=True)


def ordered_md_files() -> list[pathlib.Path]:
    all_files = list(SRC_DIR.glob("*.md"))
    priority_set = {p.lower() for p in PRIORITY}
    ordered = []
    for name in PRIORITY:
        p = SRC_DIR / name
        if p.exists():
            ordered.append(p)
    for f in sorted(all_files):
        if f.name.lower() not in priority_set:
            ordered.append(f)
    return ordered


def main(fmt: str = "png") -> None:
    try:
        mmdc = find_mmdc()
    except FileNotFoundError as e:
        print(f"[error] {e}")
        sys.exit(1)

    print(f"Using mmdc: {mmdc}")
    print(f"Output dir: {OUT_DIR}")
    print(f"Format:     {fmt}\n")

    total_ok = 0
    total_fail = 0

    for md_path in ordered_md_files():
        blocks = extract_blocks(md_path)
        if not blocks:
            print(f"  skip  {md_path.name}  (no mermaid blocks)")
            continue

        stem = md_path.stem
        print(f"  {md_path.name}  ({len(blocks)} block(s))")

        for idx, block in enumerate(blocks, 1):
            suffix = f"_{idx}" if len(blocks) > 1 else ""
            out_path = OUT_DIR / f"{stem}{suffix}"
            ok = export_block(mmdc, block, out_path, fmt=fmt)
            final = out_path.with_suffix(f".{fmt}")
            if ok and final.exists():
                kb = final.stat().st_size // 1024
                print(f"    [ok] {final.name}  ({kb} KB)")
                total_ok += 1
            else:
                print(f"    [fail] {out_path.name}.{fmt}")
                total_fail += 1

    print(f"\nDone.  {total_ok} exported, {total_fail} failed.")
    print(f"Files in: {OUT_DIR.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export Mermaid diagrams to images")
    parser.add_argument(
        "--fmt", choices=["png", "svg"], default="png",
        help="Output format (default: png)"
    )
    args = parser.parse_args()
    main(fmt=args.fmt)
