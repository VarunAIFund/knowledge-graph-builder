"""
index_desktop.py — pre-embed every file on your Desktop and save to index.json

Usage:
    python index_desktop.py               # embed everything not yet indexed
    python index_desktop.py --reindex     # re-embed all files (ignore cache)
    python index_desktop.py --dry-run     # just list files, don't call Gemini

The output (index.json) is loaded by the frontend on startup so you don't have
to click "Generate Embeddings" every time.
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Reuse all the helpers from neuralvault.py
from neuralvault import scan_dir, embed_file, DESKTOP, EMBED_MODEL, EMBED_DIM

INDEX_FILE = Path(__file__).parent / "index.json"


def load_index() -> dict:
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except Exception:
            pass
    return {}


def save_index(index: dict) -> None:
    INDEX_FILE.write_text(json.dumps(index, indent=2))


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def main():
    parser = argparse.ArgumentParser(description="Index Desktop files with Gemini embeddings")
    parser.add_argument("--reindex", action="store_true", help="Re-embed already-indexed files")
    parser.add_argument("--dry-run", action="store_true", help="List files without embedding")
    parser.add_argument("--depth", type=int, default=1, help="Scan depth (default: 1)")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  NeuralVault Desktop Indexer")
    print(f"  Model : {EMBED_MODEL} ({EMBED_DIM}d)")
    print(f"  Folder: {DESKTOP}")
    print(f"{'='*60}\n")

    # Scan files
    files = scan_dir(DESKTOP, args.depth)
    print(f"Found {len(files)} items\n")

    if args.dry_run:
        for f in files:
            size = human_bytes(f["size"]) if f["size"] else "—"
            print(f"  [{f['type']:7}]  {f['name']}  ({size})")
        print(f"\nDry run complete — no embeddings generated.")
        return

    # Load existing index
    index = {} if args.reindex else load_index()
    skipped = sum(1 for f in files if f["id"] in index)
    to_embed = [f for f in files if f["id"] not in index and f["type"] != "folder"]

    if skipped:
        print(f"  Skipping {skipped} already-indexed files (use --reindex to force)\n")

    if not to_embed:
        print("  Everything is already indexed. Run with --reindex to refresh.\n")
        return

    print(f"  Embedding {len(to_embed)} files...\n")

    errors = 0
    for i, f in enumerate(to_embed, 1):
        prefix = f"  [{i:3}/{len(to_embed)}]"
        size_str = human_bytes(f["size"]) if f["size"] else "—"
        print(f"{prefix}  {f['type']:7}  {f['name'][:50]:50}  {size_str}", end="  ", flush=True)

        try:
            embedding, preview = embed_file(f["path"], f["type"])
            index[f["id"]] = {
                **f,
                "embedding": embedding,
                "preview":   preview,
            }
            print("✓")
        except Exception as e:
            print(f"✗  {e}")
            errors += 1

        # Save incrementally every 10 files so progress isn't lost on interrupt
        if i % 10 == 0:
            save_index(index)

        # Small delay to avoid rate limiting
        time.sleep(0.1)

    save_index(index)

    total = len(to_embed)
    ok    = total - errors
    print(f"\n{'='*60}")
    print(f"  Done!  {ok}/{total} files embedded  ({errors} errors)")
    print(f"  Saved → {INDEX_FILE}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
