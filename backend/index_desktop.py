"""
index_desktop.py — embed every file on your Desktop and save to LanceDB

Usage:
    python index_desktop.py               # embed everything not yet indexed
    python index_desktop.py --reindex     # re-embed all files (ignore cache)
    python index_desktop.py --dry-run     # just list files, don't call Gemini
    python index_desktop.py --depth 3     # scan deeper (default: 3)
"""

import argparse
import sys
import time
from pathlib import Path

import neuralvault
from neuralvault import (
    scan_dir, embed_file,
    lancedb_upsert_files, lancedb_save_embedding, lancedb_rebuild_all_links,
    get_tables,
    DESKTOP, EMBED_MODEL, EMBED_DIM,
)


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def already_indexed_ids() -> set[str]:
    """Return IDs of files that already have a vector in LanceDB."""
    files_tbl, _ = get_tables()
    try:
        df = files_tbl.to_pandas()[["id", "vector"]]
        from neuralvault import _vec_or_none
        return {row["id"] for _, row in df.iterrows() if _vec_or_none(row["vector"]) is not None}
    except Exception:
        return set()


def main():
    parser = argparse.ArgumentParser(description="Index Desktop files with Gemini embeddings → LanceDB")
    parser.add_argument("--reindex",  action="store_true", help="Re-embed already-indexed files")
    parser.add_argument("--dry-run",  action="store_true", help="List files without embedding")
    parser.add_argument("--depth",    type=int, default=10, help="Scan depth (default: 10)")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  NeuralVault Desktop Indexer")
    print(f"  Model : {EMBED_MODEL} ({EMBED_DIM}d)")
    print(f"  Folder: {DESKTOP}")
    print(f"  Depth : {args.depth} levels")
    print(f"  Store : LanceDB (~/.neuralvault/lancedb/)")
    print(f"{'='*60}\n")

    # Override the module-level scan depth before scanning
    neuralvault.SCAN_DEPTH = args.depth
    # Suppress per-folder dataset skip messages during dry-run
    import builtins, io
    if args.dry_run:
        _real_print = builtins.print
        builtins.print = lambda *a, **k: None
    files = scan_dir(DESKTOP, 1)
    if args.dry_run:
        builtins.print = _real_print
    print(f"Found {len(files)} items\n")

    if args.dry_run:
        embeddable = [f for f in files if f["type"] != "folder"]

        # Summary by type
        by_type: dict[str, int] = {}
        for f in embeddable:
            by_type[f["type"]] = by_type.get(f["type"], 0) + 1

        print(f"  Depth {args.depth} → {len(embeddable)} files to embed ({len(files) - len(embeddable)} folders)\n")
        for ftype, count in sorted(by_type.items(), key=lambda x: -x[1]):
            print(f"    {ftype:8}  {count}")

        # Find directories that contain only one file extension (potential datasets)
        from collections import defaultdict
        dir_exts: dict[str, set] = defaultdict(set)
        dir_counts: dict[str, int] = defaultdict(int)
        for f in embeddable:
            parent = str(Path(f["path"]).parent)
            dir_exts[parent].add(f["ext"] or f["type"])
            dir_counts[parent] += 1

        single_type_dirs = [
            (parent, exts.pop(), dir_counts[parent])
            for parent, exts in dir_exts.items()
            if len(exts) == 1 and dir_counts[parent] >= 5
        ]
        single_type_dirs.sort(key=lambda x: -x[2])

        if single_type_dirs:
            print(f"\n  Directories with only one file type (possible datasets — {len(single_type_dirs)} found):\n")
            for parent, ext, count in single_type_dirs[:30]:
                rel = Path(parent).relative_to(DESKTOP) if Path(parent).is_relative_to(DESKTOP) else Path(parent)
                print(f"    {count:5}x .{ext:10}  {rel}")
            if len(single_type_dirs) > 30:
                print(f"    ... and {len(single_type_dirs) - 30} more")

        print(f"\nDry run complete — no embeddings generated.")
        return

    # Upsert file metadata so every file has a row in LanceDB
    print("Upserting file metadata into LanceDB...")
    lancedb_upsert_files(files)

    # Decide what to embed
    done_ids  = set() if args.reindex else already_indexed_ids()
    to_embed  = [f for f in files if f["type"] != "folder" and f["id"] not in done_ids]
    skipped   = len(files) - len(to_embed)

    if skipped:
        print(f"  Skipping {skipped} already-indexed files (use --reindex to force)\n")

    if not to_embed:
        print("  Everything is already indexed.\n")
        return

    print(f"  Embedding {len(to_embed)} files...\n")

    errors = 0
    for i, f in enumerate(to_embed, 1):
        size_str = human_bytes(f["size"]) if f["size"] else "—"
        print(f"  [{i:4}/{len(to_embed)}]  {f['type']:7}  {f['name'][:48]:48}  {size_str}", end="  ", flush=True)

        try:
            embedding, preview = embed_file(f["path"], f["type"])
            lancedb_save_embedding(f["id"], embedding, preview)
            preview_str = preview[:80].replace("\n", " ") if preview else ""
            print(f"✓  {preview_str}")
        except Exception as e:
            print(f"✗  {e}")
            errors += 1

        # Small delay to avoid Gemini rate limiting
        time.sleep(0.05)

    # Build similarity graph once at the end (much faster than per-file)
    print(f"\nBuilding similarity graph...")
    lancedb_rebuild_all_links()

    total = len(to_embed)
    ok    = total - errors
    print(f"\n{'='*60}")
    print(f"  Done!  {ok}/{total} files embedded  ({errors} errors)")
    print(f"  Data  → ~/.neuralvault/lancedb/")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
