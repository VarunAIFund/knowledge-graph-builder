"""
Reindex all images on Desktop through the running Flask server.
Skips dataset directories (folders with many homogeneous data files).

Usage: python3 reindex_images.py
"""
import json, urllib.request, urllib.error, sys, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

BASE    = "http://localhost:5001"
IMG_EXTS    = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".heic", ".heif"}
DATA_EXTS   = {".json", ".jsonl", ".csv", ".tsv", ".npy", ".npz", ".pkl", ".parquet", ".tfrecord"}
DATASET_THRESHOLD = 50   # if a folder has >50 files of the same data type, skip it
DESKTOP = Path.home() / "Desktop"

def post(path, body):
    data = json.dumps(body).encode()
    req  = urllib.request.Request(f"{BASE}{path}", data=data,
                                   headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def is_dataset_dir(d: Path) -> bool:
    """True if this directory looks like a bulk dataset."""
    try:
        children = list(d.iterdir())
    except PermissionError:
        return False
    img_count  = sum(1 for p in children if p.is_file() and p.suffix.lower() in IMG_EXTS)
    data_count = sum(1 for p in children if p.is_file() and p.suffix.lower() in DATA_EXTS)
    return img_count > DATASET_THRESHOLD or data_count > DATASET_THRESHOLD

def find_images(root: Path):
    try:
        children = list(root.iterdir())
    except PermissionError:
        return
    for p in children:
        if p.is_file() and p.suffix.lower() in IMG_EXTS:
            yield p
        elif p.is_dir() and not p.name.startswith(".") and p.name not in ("node_modules", ".git", "venv", "__pycache__"):
            if is_dataset_dir(p):
                print(f"  [skip dataset]  {p.relative_to(DESKTOP)}")
            else:
                yield from find_images(p)

# Check server
try:
    urllib.request.urlopen(f"{BASE}/api/files", timeout=5)
except Exception as e:
    print(f"✗ Server not reachable: {e}"); sys.exit(1)

print("Scanning Desktop for images (skipping dataset folders)...\n")
images = list(find_images(DESKTOP))
print(f"\nFound {len(images)} images to index\n")

ok = errors = 0
for i, img in enumerate(images, 1):
    print(f"  [{i:4}/{len(images)}]  {img.name[:55]:55}", end="  ", flush=True)
    try:
        resp = post("/api/embed", {"path": str(img), "type": "image"})
        if resp.get("embedding"):
            preview = (resp.get("preview") or "")[:80]
            print(f"✓  {preview}")
            ok += 1
        else:
            print(f"✗  {resp.get('error','no embedding')}")
            errors += 1
    except Exception as e:
        print(f"✗  {e}")
        errors += 1

print(f"\nDone: {ok} captioned, {errors} errors")
