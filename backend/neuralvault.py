"""
NeuralVault backend — file scanning + Gemini Embedding 2 (multimodal)
Supports: text, code, images, PDFs, audio, video via gemini-embedding-2-preview
"""

import os
import json
import subprocess
from pathlib import Path
import mimetypes

from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from google import genai
from google.genai import types as genai_types

# ── Gemini client ──────────────────────────────────────────────────────────────
# Vertex AI path: set GOOGLE_CLOUD_PROJECT (uses ADC / GOOGLE_APPLICATION_CREDENTIALS)
# API key path:   set GEMINI_API_KEY (falls back to gemini-embedding-001)

_project = os.environ.get("GOOGLE_CLOUD_PROJECT")
if _project:
    _client = genai.Client(
        vertexai=True,
        project=_project,
        location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )
    EMBED_MODEL = "gemini-embedding-2-preview"
else:
    _api_key = os.environ.get("GEMINI_API_KEY")
    if not _api_key:
        raise RuntimeError("Set GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT in backend/.env")
    _client = genai.Client(api_key=_api_key)
    EMBED_MODEL = "gemini-embedding-001"

EMBED_DIM = 3072

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

CODE_EXTS = {
    "js","ts","jsx","tsx","py","rb","go","rs","java","cpp","c","h","cs",
    "php","swift","sh","bash","zsh","css","html","htm","xml","sql","graphql",
    "proto","r","ipynb",
}

def get_file_type(ext: str) -> str:
    t = FILE_TYPE_MAP.get(ext.lower(), "other")
    if t == "text" and ext.lower() in CODE_EXTS:
        return "code"
    return t

# ── Desktop scanner ────────────────────────────────────────────────────────────
DESKTOP = Path(os.environ.get("DESKTOP_PATH", Path.home() / "Desktop"))
SCAN_DEPTH = int(os.environ.get("SCAN_DEPTH", "3"))
MAX_FILE_MB = 100

# Folders to skip entirely
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", ".cache", "vendor", ".tox", "coverage",
}

# File extensions to skip (code, config, dev files)
SKIP_EXTS = {
    "py", "js", "ts", "jsx", "tsx", "rb", "go", "rs", "java", "cpp", "c",
    "h", "cs", "php", "swift", "sh", "bash", "zsh", "r", "ipynb",
    "json", "yaml", "yml", "toml", "ini", "conf", "config", "lock",
    "env", "gitignore", "gitattributes", "dockerignore", "editorconfig",
    "eslintrc", "prettierrc", "babelrc", "npmrc", "nvmrc",
    "sql", "graphql", "proto", "log",
}

# Exact filenames to skip
SKIP_NAMES = {
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock",
    "Makefile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    ".env", ".env.local", ".env.production", ".gitignore", "tsconfig.json",
    "next.config.js", "next.config.ts", "vite.config.ts", "webpack.config.js",
    "tailwind.config.js", "tailwind.config.ts", "postcss.config.js",
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
            nodes.append({
                "id":       str(entry),
                "name":     entry.name,
                "path":     str(entry),
                "type":     "folder",
                "size":     0,
                "modified": "",
                "ext":      "",
                "color":    FILE_TYPE_COLORS["folder"],
                "val":      4,
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
            size_mb = stat.st_size / 1024 / 1024
            if size_mb > MAX_FILE_MB:
                continue
            ext = entry.suffix.lstrip(".").lower()
            if ext in SKIP_EXTS:
                continue
            ftype = get_file_type(ext)
            nodes.append({
                "id":       str(entry),
                "name":     entry.name,
                "path":     str(entry),
                "type":     ftype,
                "size":     stat.st_size,
                "modified": str(stat.st_mtime),
                "ext":      ext,
                "color":    FILE_TYPE_COLORS.get(ftype, FILE_TYPE_COLORS["other"]),
                "val":      max(2, min(8, int(stat.st_size / 1024).bit_length())),
            })

    return nodes

# ── Embedding via Gemini Embedding 2 ──────────────────────────────────────────
MAX_INLINE_MB = 5  # max file size to send inline (images/PDFs/audio/video)

def embed(content: str | bytes, mime: str | None = None, task: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    """
    Embed any content using gemini-embedding-2-preview.
    - str  → text embedding
    - bytes with mime → inline multimodal part (image, PDF, audio, video)
    """
    if isinstance(content, bytes) and mime:
        part = genai_types.Part.from_bytes(data=content, mime_type=mime)
        contents = [part]
    else:
        contents = str(content)[:8000]

    resp = _client.models.embed_content(
        model=EMBED_MODEL,
        contents=contents,
        config=genai_types.EmbedContentConfig(
            task_type=task,
            output_dimensionality=EMBED_DIM,
        ),
    )
    return resp.embeddings[0].values


def embed_file(path: str, ftype: str) -> tuple[list[float], str]:
    """Return (embedding_vector, preview_text)."""
    p = Path(path)
    if not p.exists():
        return embed(f"File: {p.name}"), ""

    ext = p.suffix.lstrip(".").lower()
    name = p.name

    # ── Folder ────────────────────────────────────────────────────────────────
    if ftype == "folder":
        text = f"Folder: {name}  Path: {path}"
        return embed(text), text

    # ── Text / Code ───────────────────────────────────────────────────────────
    if ext in TEXT_EXTS:
        try:
            raw = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return embed(f"File: {name}"), ""
        preview = raw[:300].replace("\n", " ").strip()
        to_embed = f"{name}\n\n{raw[:8000]}"
        return embed(to_embed), preview

    # ── Images: send inline to gemini-embedding-2-preview ────────────────────
    if ext in IMAGE_EXTS:
        if p.stat().st_size > MAX_INLINE_MB * 1024 * 1024:
            return embed(f"Image: {name}"), f"Image file: {name}"
        mime = mimetypes.guess_type(path)[0] or "image/jpeg"
        data = p.read_bytes()
        preview = f"[Image] {name}"
        return embed(data, mime), preview

    # ── PDFs: send inline ─────────────────────────────────────────────────────
    if ext in PDF_EXTS:
        if p.stat().st_size > MAX_INLINE_MB * 1024 * 1024:
            return embed(f"PDF document: {name}"), f"PDF: {name}"
        data = p.read_bytes()
        return embed(data, "application/pdf"), f"[PDF] {name}"

    # ── Audio: send inline ────────────────────────────────────────────────────
    if ext in AUDIO_EXTS:
        if p.stat().st_size > MAX_INLINE_MB * 1024 * 1024:
            return embed(f"Audio file: {name}"), f"Audio: {name}"
        mime = mimetypes.guess_type(path)[0] or "audio/mpeg"
        data = p.read_bytes()
        return embed(data, mime), f"[Audio] {name}"

    # ── Video: embed metadata (files are usually too large) ───────────────────
    if ext in VIDEO_EXTS:
        size_mb = p.stat().st_size / 1024 / 1024
        meta = f"Video file: {name}  Size: {size_mb:.1f}MB"
        return embed(meta), meta

    # ── Other ─────────────────────────────────────────────────────────────────
    meta = f"File: {name}  Type: {ftype}  Size: {p.stat().st_size} bytes"
    return embed(meta), meta


# ── Persistent index (written by index_desktop.py) ────────────────────────────
INDEX_FILE = Path(__file__).parent / "index.json"

def load_index() -> dict:
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except Exception:
            pass
    return {}

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})


@app.route("/api/files")
def api_files():
    files = scan_dir(DESKTOP, 1)
    # Merge in any pre-computed embeddings from index.json
    index = load_index()
    for f in files:
        if f["id"] in index:
            cached = index[f["id"]]
            f["embedding"] = cached.get("embedding")
            f["preview"]   = cached.get("preview", "")
    return jsonify({"files": files, "total": len(files), "desktop": str(DESKTOP)})


@app.route("/api/embed", methods=["POST"])
def api_embed():
    body = request.get_json(force=True)
    path = body.get("path", "")
    ftype = body.get("type", "other")

    # Query-text embedding for semantic search
    query_text = body.get("queryText")
    if path == "__query__" and query_text:
        try:
            vec = embed(query_text, task="RETRIEVAL_QUERY")
            return jsonify({"embedding": vec})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    try:
        vec, preview = embed_file(path, ftype)
        return jsonify({"embedding": vec, "preview": preview})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/open", methods=["POST"])
def api_open():
    path = request.args.get("path", "")
    if not path:
        return jsonify({"error": "no path"}), 400
    subprocess.Popen(["open", "-R", path])
    return jsonify({"ok": True})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "model": EMBED_MODEL, "dim": EMBED_DIM})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"\n🧠 NeuralVault backend — {EMBED_MODEL} ({EMBED_DIM}d)")
    print(f"   Desktop: {DESKTOP}")
    print(f"   http://localhost:{port}/api/health\n")
    app.run(port=port, debug=False)
