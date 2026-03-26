"""
NeuralVault backend — file scanning + Gemini Embedding 2 + LanceDB local vector store
"""

import os
import json
import threading
import subprocess
from pathlib import Path
import mimetypes
from collections import defaultdict

import lancedb
import numpy as np
import pyarrow as pa
import pandas as pd

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from google import genai
from google.genai import types as genai_types

# ── Gemini client ──────────────────────────────────────────────────────────────
_project = os.environ.get("GOOGLE_CLOUD_PROJECT")
_api_key  = os.environ.get("GEMINI_API_KEY")

if _project:
    _client = genai.Client(
        vertexai=True,
        project=_project,
        location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )
    EMBED_MODEL = "gemini-embedding-2-preview"
else:
    if not _api_key:
        raise RuntimeError("Set GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT in backend/.env")
    _client = genai.Client(api_key=_api_key)
    EMBED_MODEL = "gemini-embedding-001"

# Text generation always uses the API key client (Vertex AI project may lack generative model access)
if _api_key:
    _gen_client = genai.Client(api_key=_api_key)
else:
    _gen_client = _client  # fallback to same client

EMBED_DIM = 3072
GEN_MODEL = "gemini-2.0-flash"

# ── File type mapping ──────────────────────────────────────────────────────────
TEXT_EXTS = {
    "txt","md","markdown","rst","csv","tsv","json","yaml","yml","toml",
    "js","ts","jsx","tsx","py","rb","go","rs","java","cpp","c","h","cs",
    "php","swift","sh","bash","zsh","css","html","htm","xml","sql","graphql",
    "proto","gitignore","env","conf","config","ini","log","ipynb","r",
}
IMAGE_EXTS  = {"png","jpg","jpeg","gif","webp","bmp","tiff","tif","heic","heif"}
PDF_EXTS    = {"pdf"}
AUDIO_EXTS  = {"mp3","wav","m4a","aac","ogg","flac","opus"}
VIDEO_EXTS  = {"mp4","mov","avi","mkv","webm","m4v","mpeg","mpg"}
CODE_EXTS   = {
    "js","ts","jsx","tsx","py","rb","go","rs","java","cpp","c","h","cs",
    "php","swift","sh","bash","zsh","css","html","htm","xml","sql","graphql",
    "proto","r","ipynb",
}

FILE_TYPE_MAP: dict[str, str] = (
    {e: "image"  for e in IMAGE_EXTS} |
    {e: "text"   for e in TEXT_EXTS}  |
    {e: "pdf"    for e in PDF_EXTS}   |
    {e: "audio"  for e in AUDIO_EXTS} |
    {e: "video"  for e in VIDEO_EXTS}
)

FILE_TYPE_COLORS = {
    "image":  "#FF0080",
    "text":   "#00D4FF",
    "code":   "#00FF88",
    "pdf":    "#FF6B00",
    "video":  "#8B5CF6",
    "audio":  "#FFB800",
    "folder": "#38BDF8",
    "other":  "#64748B",
}

def get_file_type(ext: str) -> str:
    t = FILE_TYPE_MAP.get(ext.lower(), "other")
    if t == "text" and ext.lower() in CODE_EXTS:
        return "code"
    return t

# ── Desktop scanner ────────────────────────────────────────────────────────────
DESKTOP    = Path(os.environ.get("DESKTOP_PATH", Path.home() / "Desktop"))
SCAN_DEPTH = int(os.environ.get("SCAN_DEPTH", "3"))
MAX_FILE_MB = 100

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", ".cache", "vendor", ".tox", "coverage",
}

# Folders with more than this many files of the same bulk type are skipped
DATASET_THRESHOLD = 50
DATASET_EXTS = {
    ".png",".jpg",".jpeg",".gif",".webp",".bmp",".tiff",".tif",".heic",".heif",
    ".json",".jsonl",".csv",".tsv",".npy",".npz",".pkl",".parquet",
    ".tfrecord",".bin",".dat",".h5",".hdf5",".arrow",
}

def _is_dataset_dir(path: Path) -> bool:
    """True if this folder looks like a bulk dataset (>50 files of one data type)."""
    try:
        children = list(path.iterdir())
    except PermissionError:
        return False
    by_ext: dict[str, int] = {}
    for p in children:
        if p.is_file():
            by_ext[p.suffix.lower()] = by_ext.get(p.suffix.lower(), 0) + 1
    return any(count > DATASET_THRESHOLD and ext in DATASET_EXTS for ext, count in by_ext.items())
SKIP_EXTS = {
    "py","js","ts","jsx","tsx","rb","go","rs","java","cpp","c","h","cs",
    "php","swift","sh","bash","zsh","r","ipynb","json","yaml","yml","toml",
    "ini","conf","config","lock","env","gitignore","gitattributes",
    "dockerignore","editorconfig","eslintrc","prettierrc","babelrc",
    "npmrc","nvmrc","sql","graphql","proto","log",
}
SKIP_NAMES = {
    "package.json","package-lock.json","yarn.lock","pnpm-lock.yaml",
    "requirements.txt","Pipfile","Pipfile.lock","poetry.lock",
    "Makefile","Dockerfile","docker-compose.yml","docker-compose.yaml",
    ".env",".env.local",".env.production",".gitignore","tsconfig.json",
    "next.config.js","next.config.ts","vite.config.ts","webpack.config.js",
    "tailwind.config.js","tailwind.config.ts","postcss.config.js",
}

def scan_dir(directory: Path, depth: int) -> list[dict]:
    nodes = []
    try:
        entries = list(directory.iterdir())
    except PermissionError:
        return nodes

    for entry in sorted(entries, key=lambda e: e.name.lower()):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            if entry.name in SKIP_DIRS:
                continue
            if _is_dataset_dir(entry):
                print(f"  [skip dataset]  {entry.name}")
                continue
            nodes.append({
                "id": str(entry), "name": entry.name, "path": str(entry),
                "type": "folder", "size": 0, "modified": "", "ext": "",
                "color": FILE_TYPE_COLORS["folder"], "val": 4,
            })
            if depth < SCAN_DEPTH:
                nodes.extend(scan_dir(entry, depth + 1))
        elif entry.is_file():
            if entry.name in SKIP_NAMES:
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            if stat.st_size / 1024 / 1024 > MAX_FILE_MB:
                continue
            ext = entry.suffix.lstrip(".").lower()
            if ext in SKIP_EXTS:
                continue
            ftype = get_file_type(ext)
            nodes.append({
                "id": str(entry), "name": entry.name, "path": str(entry),
                "type": ftype, "size": stat.st_size, "modified": str(stat.st_mtime),
                "ext": ext, "color": FILE_TYPE_COLORS.get(ftype, FILE_TYPE_COLORS["other"]),
                "val": max(2, min(8, int(stat.st_size / 1024).bit_length())),
            })
    return nodes

# ── Cosine similarity (numpy) ──────────────────────────────────────────────────
def cosine_similarity(a, b) -> float:
    a = np.array(a, dtype=np.float32)
    b = np.array(b, dtype=np.float32)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom else 0.0

# ── Community detection — label propagation ────────────────────────────────────
def label_propagation(
    node_ids: list[str],
    edges: list[tuple[str, str, float]],
    iterations: int = 30,
) -> dict[str, int]:
    """
    Weighted label propagation community detection.
    Returns {node_id: community_id} with sequential IDs starting at 0.
    """
    if not node_ids:
        return {}

    adj: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for src, tgt, w in edges:
        adj[src].append((tgt, w))
        adj[tgt].append((src, w))

    # Initialize: each node is its own community
    labels: dict[str, int] = {nid: i for i, nid in enumerate(node_ids)}

    import random
    shuffled = list(node_ids)

    for _ in range(iterations):
        random.shuffle(shuffled)
        changed = False
        for nid in shuffled:
            neighbors = adj.get(nid, [])
            if not neighbors:
                continue
            vote: dict[int, float] = defaultdict(float)
            for nb, w in neighbors:
                vote[labels[nb]] += w
            best = max(vote, key=lambda k: (vote[k], -k))
            if best != labels[nid]:
                labels[nid] = best
                changed = True
        if not changed:
            break

    # Remap to sequential IDs
    unique = sorted(set(labels.values()))
    remap = {old: new for new, old in enumerate(unique)}
    return {nid: remap[labels[nid]] for nid in node_ids}


# ── LanceDB (local vector store) ───────────────────────────────────────────────
LANCEDB_PATH = Path.home() / ".neuralvault" / "lancedb"

_lancedb_lock = threading.Lock()
_db           = None
_files_tbl    = None
_links_tbl    = None

FILE_SCHEMA = pa.schema([
    pa.field("id",        pa.utf8()),
    pa.field("name",      pa.utf8()),
    pa.field("path",      pa.utf8()),
    pa.field("type",      pa.utf8()),
    pa.field("ext",       pa.utf8()),
    pa.field("size",      pa.int64()),
    pa.field("modified",  pa.utf8()),
    pa.field("color",     pa.utf8()),
    pa.field("val",       pa.int64()),
    pa.field("preview",   pa.utf8()),
    pa.field("community", pa.int64()),
    pa.field("vector",    pa.list_(pa.float32(), EMBED_DIM)),
])

LINK_SCHEMA = pa.schema([
    pa.field("source", pa.utf8()),
    pa.field("target", pa.utf8()),
    pa.field("score",  pa.float32()),
])


def get_tables():
    global _db, _files_tbl, _links_tbl
    if _db is not None:
        return _files_tbl, _links_tbl
    with _lancedb_lock:
        if _db is not None:
            return _files_tbl, _links_tbl
        LANCEDB_PATH.mkdir(parents=True, exist_ok=True)
        _db = lancedb.connect(str(LANCEDB_PATH))
        _files_tbl = (
            _db.open_table("files") if "files" in _db.table_names()
            else _db.create_table("files", schema=FILE_SCHEMA)
        )
        _links_tbl = (
            _db.open_table("links") if "links" in _db.table_names()
            else _db.create_table("links", schema=LINK_SCHEMA)
        )
        print(f"✓ LanceDB: {LANCEDB_PATH}")
    return _files_tbl, _links_tbl


def _vec_or_none(v):
    """Safely extract a vector from a pandas cell (handles None/NaN)."""
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    return v.tolist() if hasattr(v, "tolist") else list(v)


def lancedb_upsert_files(nodes: list[dict]):
    """Upsert file metadata. Preserves existing vectors and community assignments."""
    files_tbl, _ = get_tables()
    try:
        try:
            existing = files_tbl.to_pandas()
        except Exception:
            existing = pd.DataFrame()

        ex_map: dict[str, pd.Series] = {}
        if len(existing) > 0:
            for _, row in existing.iterrows():
                ex_map[str(row["id"])] = row

        rows = []
        for n in nodes:
            ex = ex_map.get(n["id"])
            vec       = _vec_or_none(ex["vector"])   if ex is not None else None
            community = int(ex["community"])          if ex is not None and ex["community"] is not None and not (isinstance(ex["community"], float) and pd.isna(ex["community"])) else -1
            preview   = str(ex["preview"])            if ex is not None and ex["preview"] is not None else ""
            rows.append({
                "id":        n["id"],
                "name":      n["name"],
                "path":      n["path"],
                "type":      n["type"],
                "ext":       n.get("ext", ""),
                "size":      int(n.get("size", 0)),
                "modified":  str(n.get("modified", "")),
                "color":     n.get("color", ""),
                "val":       int(n.get("val", 2)),
                "preview":   preview,
                "community": community,
                "vector":    vec,
            })

        (files_tbl
            .merge_insert("id")
            .when_matched_update_all()
            .when_not_matched_insert_all()
            .execute(rows))

    except Exception as e:
        print(f"LanceDB upsert error: {e}")


def lancedb_load_embeddings(file_ids: list[str]) -> dict[str, dict]:
    """Return {id: {embedding, preview, community}} for files that have a vector."""
    files_tbl, _ = get_tables()
    try:
        df = files_tbl.to_pandas()
        id_set = set(file_ids)
        result = {}
        for _, row in df.iterrows():
            if row["id"] not in id_set:
                continue
            vec = _vec_or_none(row["vector"])
            if vec is None:
                continue
            community = row["community"]
            result[row["id"]] = {
                "embedding": vec,
                "preview":   row["preview"] or "",
                "community": int(community) if community is not None and not (isinstance(community, float) and pd.isna(community)) and community != -1 else None,
            }
        return result
    except Exception as e:
        print(f"LanceDB load embeddings error: {e}")
        return {}


def lancedb_save_embedding(node_id: str, embedding: list[float], preview: str):
    """Upsert a vector + preview for a file node. Inserts the row if it doesn't exist yet."""
    files_tbl, _ = get_tables()
    try:
        df   = files_tbl.to_pandas()
        mask = df["id"] == node_id
        if mask.any():
            row = df[mask].iloc[0].to_dict()
            row["vector"]  = embedding
            row["preview"] = preview
        else:
            # File wasn't picked up by scan (e.g. outside scan depth) — create row now
            p   = Path(node_id)
            ext = p.suffix.lstrip(".").lower()
            ftype = get_file_type(ext)
            try:
                stat = p.stat()
                size, modified = int(stat.st_size), str(stat.st_mtime)
            except Exception:
                size, modified = 0, ""
            row = {
                "id": node_id, "name": p.name, "path": node_id,
                "type": ftype, "ext": ext, "size": size, "modified": modified,
                "color": FILE_TYPE_COLORS.get(ftype, FILE_TYPE_COLORS["other"]),
                "val": max(2, min(8, int(size / 1024).bit_length())) if size else 2,
                "preview": preview, "community": -1, "vector": embedding,
            }
        (files_tbl
            .merge_insert("id")
            .when_matched_update_all()
            .when_not_matched_insert_all()
            .execute([row]))
    except Exception as e:
        print(f"LanceDB save embedding error: {e}")


def lancedb_build_links_for_node(node_id: str, new_embedding: list[float], threshold: float = 0.72):
    """
    Compute similarity edges for a freshly embedded node using numpy batch ops.
    Called in a background thread — never blocks the API response.
    """
    files_tbl, links_tbl = get_tables()
    try:
        df = files_tbl.to_pandas()[["id", "vector"]]
        df = df[df["id"] != node_id]
        df = df[df["vector"].apply(lambda v: _vec_or_none(v) is not None)]
        if df.empty:
            return

        new_vec  = np.array(new_embedding, dtype=np.float32)
        new_norm = np.linalg.norm(new_vec)
        if new_norm == 0:
            return

        vecs   = np.stack([_vec_or_none(v) for v in df["vector"]]).astype(np.float32)
        norms  = np.linalg.norm(vecs, axis=1)
        scores = np.zeros(len(vecs))
        valid  = norms > 0
        scores[valid] = (vecs[valid] @ new_vec) / (norms[valid] * new_norm)

        new_links = []
        for i, other_id in enumerate(df["id"].tolist()):
            if scores[i] >= threshold:
                a, b = (node_id, other_id) if node_id < other_id else (other_id, node_id)
                new_links.append({"source": a, "target": b, "score": float(round(float(scores[i]), 4))})

        try:
            links_tbl.delete(f"source = {repr(node_id)} OR target = {repr(node_id)}")
        except Exception:
            pass

        if new_links:
            links_tbl.add(new_links)

        _recompute_communities()

    except Exception as e:
        print(f"LanceDB build links error: {e}")


def _recompute_communities():
    """Label propagation community detection — writes community IDs back to file nodes."""
    files_tbl, links_tbl = get_tables()
    try:
        df = files_tbl.to_pandas()[["id", "vector"]]
        df = df[df["vector"].apply(lambda v: _vec_or_none(v) is not None)]
        node_ids = df["id"].tolist()
        if not node_ids:
            return

        links_df = links_tbl.to_pandas()
        edges = [
            (r["source"], r["target"], float(r["score"]))
            for _, r in links_df.iterrows()
        ] if len(links_df) > 0 else []

        communities = label_propagation(node_ids, edges)

        # Batch update: group by community to minimize update calls
        by_community: dict[int, list[str]] = defaultdict(list)
        for nid, cid in communities.items():
            by_community[cid].append(nid)

        for cid, nids in by_community.items():
            id_list = ", ".join("'" + nid.replace("'", "''") + "'" for nid in nids)
            files_tbl.update(where=f"id IN ({id_list})", values={"community": int(cid)})

        print(f"  Communities: {len(by_community)} clusters, {len(node_ids)} nodes")

    except Exception as e:
        print(f"Community recompute error: {e}")


def lancedb_rebuild_all_links(threshold: float = 0.72):
    """
    Rebuild ALL similarity edges from scratch using a single vectorised numpy pass.
    Use this after bulk indexing — much faster than building links per-file.
    """
    global _links_tbl
    files_tbl, links_tbl = get_tables()
    try:
        df = files_tbl.to_pandas()[["id", "vector"]]
        df = df[df["vector"].apply(lambda v: _vec_or_none(v) is not None)].reset_index(drop=True)
        n = len(df)
        if n < 2:
            print("  Not enough indexed files to build links.")
            return

        ids  = df["id"].tolist()
        vecs = np.stack([_vec_or_none(v) for v in df["vector"]]).astype(np.float32)

        # Normalise rows so dot product == cosine similarity
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms[norms == 0] = 1
        vecs_norm = vecs / norms

        # Full pairwise similarity — upper triangle only
        sim = vecs_norm @ vecs_norm.T
        rows_idx, cols_idx = np.where(np.triu(sim, k=1) >= threshold)

        new_links = []
        for i, j in zip(rows_idx.tolist(), cols_idx.tolist()):
            score = float(round(float(sim[i, j]), 4))
            a, b  = (ids[i], ids[j]) if ids[i] < ids[j] else (ids[j], ids[i])
            new_links.append({"source": a, "target": b, "score": score})

        # Drop and recreate links table for a clean rebuild
        _db.drop_table("links")
        _links_tbl = _db.create_table("links", schema=LINK_SCHEMA)
        if new_links:
            _links_tbl.add(new_links)

        print(f"  Built {len(new_links)} similarity edges across {n} files")
        _recompute_communities()

    except Exception as e:
        print(f"LanceDB rebuild all links error: {e}")


def lancedb_get_graph() -> tuple[list[dict], list[dict]]:
    """Return (nodes, links) for the frontend graph visualization."""
    files_tbl, links_tbl = get_tables()
    try:
        files_df = files_tbl.to_pandas()
        links_df = links_tbl.to_pandas()

        degree: dict[str, int] = defaultdict(int)
        for _, row in links_df.iterrows():
            degree[row["source"]] += 1
            degree[row["target"]] += 1

        nodes = []
        for _, row in files_df.iterrows():
            community = row["community"]
            nodes.append({
                "id":        row["id"],
                "name":      row["name"],
                "path":      row["path"],
                "type":      row["type"],
                "size":      int(row["size"]),
                "modified":  row["modified"],
                "ext":       row["ext"],
                "preview":   row["preview"] or "",
                "color":     row["color"],
                "baseVal":   int(row["val"]),
                "community": int(community) if community is not None and not (isinstance(community, float) and pd.isna(community)) and community != -1 else None,
                "indexed":   _vec_or_none(row["vector"]) is not None,
                "degree":    degree.get(row["id"], 0),
            })

        links = [
            {"source": r["source"], "target": r["target"], "value": float(r["score"])}
            for _, r in links_df.iterrows()
        ]
        return nodes, links

    except Exception as e:
        print(f"LanceDB get graph error: {e}")
        return [], []


# ── Embedding via Gemini ───────────────────────────────────────────────────────
MAX_INLINE_MB = 5

def embed(content, mime: str | None = None, task: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    if isinstance(content, bytes) and mime:
        part = genai_types.Part.from_bytes(data=content, mime_type=mime)
        contents = [part]
    else:
        contents = str(content)[:8000]
    resp = _client.models.embed_content(
        model=EMBED_MODEL,
        contents=contents,
        config=genai_types.EmbedContentConfig(task_type=task, output_dimensionality=EMBED_DIM),
    )
    return resp.embeddings[0].values


def caption_image(data: bytes, mime: str, name: str) -> str:
    """Use Gemini Flash to describe an image so it can be embedded as text."""
    try:
        part = genai_types.Part.from_bytes(data=data, mime_type=mime)
        resp = _gen_client.models.generate_content(
            model=GEN_MODEL,
            contents=[part, "Describe this image in 1-2 sentences for search indexing. "
                      "Focus on visible content: any text shown, people, objects, activities, setting."]
        )
        return f"{name}: {resp.text.strip()}"
    except Exception as e:
        print(f"caption_image error for {name}: {e}")
        return f"Image: {name}"


def embed_file(path: str, ftype: str) -> tuple[list[float], str]:
    p = Path(path)
    if not p.exists():
        return embed(f"File: {p.name}"), ""
    ext  = p.suffix.lstrip(".").lower()
    name = p.name

    if ftype == "folder":
        text = f"Folder: {name}  Path: {path}"
        return embed(text), text
    if ext in TEXT_EXTS:
        try:
            raw = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return embed(f"File: {name}"), ""
        preview = raw[:300].replace("\n", " ").strip()
        return embed(f"{name}\n\n{raw[:8000]}"), preview
    if ext in IMAGE_EXTS:
        if p.stat().st_size > MAX_INLINE_MB * 1024 * 1024:
            return embed(f"Image: {name}"), f"Image file: {name}"
        mime = mimetypes.guess_type(path)[0] or "image/jpeg"
        data = p.read_bytes()
        caption = caption_image(data, mime, name)
        return embed(caption), caption
    if ext in PDF_EXTS:
        if p.stat().st_size > MAX_INLINE_MB * 1024 * 1024:
            return embed(f"PDF document: {name}"), f"PDF: {name}"
        return embed(p.read_bytes(), "application/pdf"), f"[PDF] {name}"
    if ext in AUDIO_EXTS:
        if p.stat().st_size > MAX_INLINE_MB * 1024 * 1024:
            return embed(f"Audio file: {name}"), f"Audio: {name}"
        mime = mimetypes.guess_type(path)[0] or "audio/mpeg"
        return embed(p.read_bytes(), mime), f"[Audio] {name}"
    if ext in VIDEO_EXTS:
        size_mb = p.stat().st_size / 1024 / 1024
        meta = f"Video file: {name}  Size: {size_mb:.1f}MB"
        return embed(meta), meta

    meta = f"File: {name}  Type: {ftype}  Size: {p.stat().st_size} bytes"
    return embed(meta), meta


# ── Flask app ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})


@app.route("/api/files")
def api_files():
    files    = scan_dir(DESKTOP, 1)
    file_ids = [f["id"] for f in files]

    lancedb_upsert_files(files)
    cached = lancedb_load_embeddings(file_ids)
    for f in files:
        if f["id"] in cached:
            c = cached[f["id"]]
            f["embedding"] = c["embedding"]
            f["preview"]   = c["preview"]
            if c["community"] is not None:
                f["community"] = c["community"]

    return jsonify({"files": files, "total": len(files), "desktop": str(DESKTOP)})


@app.route("/api/embed", methods=["POST"])
def api_embed():
    body       = request.get_json(force=True)
    path       = body.get("path", "")
    ftype      = body.get("type", "other")
    query_text = body.get("queryText")

    if path == "__query__" and query_text:
        try:
            vec = embed(query_text, task="RETRIEVAL_QUERY")
            return jsonify({"embedding": vec})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    if ftype == "folder":
        return jsonify({"embedding": None, "preview": ""}), 200

    try:
        vec, preview = embed_file(path, ftype)

        # Persist + build graph links asynchronously
        def _bg():
            lancedb_save_embedding(path, vec, preview)
            lancedb_build_links_for_node(path, vec)

        threading.Thread(target=_bg, daemon=True).start()

        return jsonify({"embedding": vec, "preview": preview})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def parse_query(query: str) -> dict:
    """Use Gemini to extract semantic core + optional file type filter from a natural language query."""
    prompt = (
        'Extract from this file search query:\n'
        '1. semantic_query: the core search intent (strip any file-type words)\n'
        '2. type_filter: list of file types if the user hinted at a type, else null\n\n'
        f'Query: "{query}"\n\n'
        'Valid types: image, video, audio, pdf, text, code, other\n'
        'Type hints: "image/photo/screenshot/picture" → ["image"], '
        '"video/movie/clip/recording" → ["video"], '
        '"audio/music/song" → ["audio"], '
        '"pdf/document/doc/resume/report" → ["pdf","other"], '
        '"code/script" → ["code"]\n\n'
        'Respond with JSON only, no markdown:\n'
        '{"semantic_query": "...", "type_filter": ["image"] or null}\n\n'
        'Examples:\n'
        '"schedule image" → {"semantic_query": "schedule", "type_filter": ["image"]}\n'
        '"vacation photos" → {"semantic_query": "vacation", "type_filter": ["image"]}\n'
        '"my resume" → {"semantic_query": "resume", "type_filter": null}\n'
        '"sorting algorithm code" → {"semantic_query": "sorting algorithm", "type_filter": ["code"]}\n'
        '"schedule" → {"semantic_query": "schedule", "type_filter": null}\n'
    )
    try:
        resp = _gen_client.models.generate_content(model=GEN_MODEL, contents=prompt)
        text = resp.text.strip()
        import re as _re
        m = _re.search(r'\{.*\}', text, _re.DOTALL)
        if m:
            return json.loads(m.group())
    except Exception as e:
        print(f"parse_query error: {e}")
    return {"semantic_query": query, "type_filter": None}


@app.route("/api/search", methods=["POST"])
def api_search():
    """Embed query and use LanceDB native vector search to return ranked results."""
    body  = request.get_json(force=True)
    query = body.get("query", "").strip()
    limit = min(int(body.get("limit", 20)), 50)

    if not query:
        return jsonify({"results": [], "method": "none"})

    parsed      = parse_query(query)
    sem_query   = parsed.get("semantic_query") or query
    type_filter = parsed.get("type_filter")
    print(f"Search: '{query}' → semantic='{sem_query}' types={type_filter}")

    try:
        query_vec = embed(sem_query, task="RETRIEVAL_QUERY")
    except Exception as e:
        return jsonify({"error": f"embed failed: {e}"}), 500

    files_tbl, _ = get_tables()
    try:
        where_clause = "vector IS NOT NULL"
        if type_filter:
            type_sql = ", ".join(f"'{t}'" for t in type_filter)
            where_clause += f" AND type IN ({type_sql})"

        df = (
            files_tbl
            .search(query_vec)
            .metric("cosine")
            .where(where_clause, prefilter=True)
            .limit(limit)
            .to_pandas()
        )

        results = []
        for _, row in df.iterrows():
            dist  = float(row.get("_distance", 1.0))
            score = round(max(0.0, 1.0 - dist), 4)
            results.append({
                "id":      row["id"],
                "name":    row["name"],
                "path":    row["path"],
                "type":    row["type"],
                "ext":     row["ext"],
                "size":    int(row["size"]),
                "preview": row["preview"] or "",
                "score":   score,
            })

        return jsonify({
            "results":        results,
            "method":         "embedding",
            "semantic_query": sem_query,
            "type_filter":    type_filter,
        })
    except Exception as e:
        print(f"Search error: {e}")
        return jsonify({"results": [], "method": "error", "error": str(e)})


@app.route("/api/graph")
def api_graph():
    """Full graph from LanceDB: nodes enriched with community + degree."""
    nodes, links = lancedb_get_graph()
    community_counts: dict[int, int] = defaultdict(int)
    for n in nodes:
        c = n.get("community")
        if c is not None:
            community_counts[int(c)] += 1

    return jsonify({
        "nodes":       nodes,
        "links":       links,
        "neo4j":       True,  # kept for frontend compatibility
        "communities": len(community_counts),
        "total_links": len(links),
    })


@app.route("/api/preview")
def api_preview():
    """Serve raw file bytes for image/PDF inline preview in the browser."""
    path = request.args.get("path", "")
    if not path:
        return jsonify({"error": "no path"}), 400
    p = Path(path)
    if not p.exists() or not p.is_file():
        return jsonify({"error": "not found"}), 404
    # Security: only serve files under DESKTOP
    try:
        p.resolve().relative_to(DESKTOP.resolve())
    except ValueError:
        return jsonify({"error": "forbidden"}), 403
    mime = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    resp = send_file(str(p.resolve()), mimetype=mime, as_attachment=False)
    resp.headers["Content-Disposition"] = f"inline; filename=\"{p.name}\""
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@app.route("/api/open", methods=["POST"])
def api_open():
    path = request.args.get("path", "")
    action = request.args.get("action", "reveal")  # "open" or "reveal"
    if not path:
        return jsonify({"error": "no path"}), 400
    if action == "open":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["open", "-R", path])
    return jsonify({"ok": True})


@app.route("/api/health")
def health():
    get_tables()  # ensure LanceDB is initialized
    return jsonify({
        "status":   "ok",
        "model":    EMBED_MODEL,
        "dim":      EMBED_DIM,
        "lancedb":  str(LANCEDB_PATH),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"\n🧠 NeuralVault")
    print(f"   Model:   {EMBED_MODEL} ({EMBED_DIM}d)")
    print(f"   Desktop: {DESKTOP}")
    get_tables()
    print(f"   Listening on http://localhost:{port}\n")
    app.run(port=port, debug=False)
