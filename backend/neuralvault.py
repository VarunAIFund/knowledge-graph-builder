"""
NeuralVault backend — file scanning + Gemini Embedding 2 + Neo4j knowledge graph
"""

import os
import json
import math
import threading
import subprocess
from pathlib import Path
import mimetypes
from collections import defaultdict

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from google import genai
from google.genai import types as genai_types
from neo4j import GraphDatabase

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

# ── Cosine similarity (Python) ─────────────────────────────────────────────────
def cosine_similarity_py(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(y * y for y in b))
    denom = mag_a * mag_b
    return dot / denom if denom else 0.0

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


# ── Neo4j client ───────────────────────────────────────────────────────────────
_neo4j_driver = None
_neo4j_lock   = threading.Lock()
NEO4J_DB      = os.environ.get("NEO4J_DATABASE", "neo4j")

def get_neo4j_driver():
    global _neo4j_driver
    if _neo4j_driver is not None:
        return _neo4j_driver
    with _neo4j_lock:
        if _neo4j_driver is not None:
            return _neo4j_driver
        uri      = os.environ.get("NEO4J_URI")
        user     = os.environ.get("NEO4J_USERNAME", "neo4j")
        password = os.environ.get("NEO4J_PASSWORD")
        if not (uri and password):
            return None
        try:
            drv = GraphDatabase.driver(uri, auth=(user, password))
            drv.verify_connectivity()
            _neo4j_driver = drv
            print(f"✓ Neo4j connected: {uri}")
            _ensure_constraints()
        except Exception as e:
            print(f"✗ Neo4j connection failed: {e}")
    return _neo4j_driver


def _ensure_constraints():
    driver = _neo4j_driver
    if not driver:
        return
    try:
        with driver.session(database=NEO4J_DB) as session:
            session.run(
                "CREATE CONSTRAINT file_id IF NOT EXISTS "
                "FOR (f:File) REQUIRE f.id IS UNIQUE"
            )
    except Exception:
        pass


def neo4j_upsert_files(nodes: list[dict]):
    driver = get_neo4j_driver()
    if not driver:
        return
    slim = [{k: v for k, v in n.items() if k != "embedding"} for n in nodes]
    try:
        with driver.session(database=NEO4J_DB) as session:
            session.run("""
                UNWIND $nodes AS n
                MERGE (f:File {id: n.id})
                SET f.name = n.name, f.path = n.path, f.type = n.type,
                    f.size = n.size, f.modified = n.modified, f.ext = n.ext,
                    f.color = n.color, f.val = n.val
            """, nodes=slim)
    except Exception as e:
        print(f"Neo4j upsert error: {e}")


def neo4j_load_embeddings(file_ids: list[str]) -> dict[str, dict]:
    driver = get_neo4j_driver()
    if not driver:
        return {}
    try:
        with driver.session(database=NEO4J_DB) as session:
            result = session.run("""
                MATCH (f:File) WHERE f.id IN $ids AND f.embedding IS NOT NULL
                RETURN f.id AS id, f.embedding AS embedding,
                       f.preview AS preview, f.community AS community
            """, ids=file_ids)
            return {
                r["id"]: {
                    "embedding": r["embedding"],
                    "preview":   r["preview"] or "",
                    "community": r["community"],
                }
                for r in result
            }
    except Exception as e:
        print(f"Neo4j load embeddings error: {e}")
        return {}


def neo4j_save_embedding(node_id: str, embedding: list[float], preview: str):
    driver = get_neo4j_driver()
    if not driver:
        return
    try:
        with driver.session(database=NEO4J_DB) as session:
            session.run("""
                MERGE (f:File {id: $id})
                SET f.embedding = $embedding, f.preview = $preview
            """, id=node_id, embedding=embedding, preview=preview)
    except Exception as e:
        print(f"Neo4j save embedding error: {e}")


def neo4j_build_links_for_node(node_id: str, new_embedding: list[float], threshold: float = 0.72):
    """
    Compute SIMILAR_TO relationships for a freshly embedded node.
    Called in a background thread — never blocks the API response.
    """
    driver = get_neo4j_driver()
    if not driver:
        return
    try:
        with driver.session(database=NEO4J_DB) as session:
            result = session.run("""
                MATCH (f:File) WHERE f.id <> $id AND f.embedding IS NOT NULL
                RETURN f.id AS id, f.embedding AS embedding
            """, id=node_id)
            others = result.data()

        to_create = []
        for rec in others:
            score = cosine_similarity_py(new_embedding, rec["embedding"])
            if score >= threshold:
                a, b = (node_id, rec["id"]) if node_id < rec["id"] else (rec["id"], node_id)
                to_create.append({"a": a, "b": b, "score": round(score, 4)})

        if to_create:
            with driver.session(database=NEO4J_DB) as session:
                session.run("""
                    UNWIND $rels AS r
                    MATCH (a:File {id: r.a}), (b:File {id: r.b})
                    MERGE (a)-[rel:SIMILAR_TO]->(b)
                    SET rel.score = r.score
                """, rels=to_create)

        # Recompute communities after link update
        _recompute_communities()

    except Exception as e:
        print(f"Neo4j build links error: {e}")


def _recompute_communities():
    """Label propagation community detection — writes community IDs back to nodes."""
    driver = get_neo4j_driver()
    if not driver:
        return
    try:
        with driver.session(database=NEO4J_DB) as session:
            edges_result = session.run("""
                MATCH (a:File)-[r:SIMILAR_TO]->(b:File)
                RETURN a.id AS src, b.id AS tgt, r.score AS score
            """)
            edges = [(r["src"], r["tgt"], r["score"]) for r in edges_result]

            nodes_result = session.run("""
                MATCH (f:File) WHERE f.embedding IS NOT NULL
                RETURN f.id AS id
            """)
            node_ids = [r["id"] for r in nodes_result]

        if not node_ids:
            return

        communities = label_propagation(node_ids, edges)
        updates = [{"id": nid, "community": cid} for nid, cid in communities.items()]

        with driver.session(database=NEO4J_DB) as session:
            session.run("""
                UNWIND $updates AS u
                MATCH (f:File {id: u.id})
                SET f.community = u.community
            """, updates=updates)

        num_communities = len(set(communities.values()))
        print(f"  Communities recomputed: {num_communities} clusters across {len(node_ids)} nodes")

    except Exception as e:
        print(f"Community recompute error: {e}")


def neo4j_get_graph() -> tuple[list[dict], list[dict]]:
    """Return (nodes, links) enriched with community + degree data."""
    driver = get_neo4j_driver()
    if not driver:
        return [], []
    try:
        with driver.session(database=NEO4J_DB) as session:
            nodes_result = session.run("""
                MATCH (f:File)
                OPTIONAL MATCH (f)-[r:SIMILAR_TO]-()
                RETURN f.id AS id, f.name AS name, f.path AS path,
                       f.type AS type, f.size AS size, f.modified AS modified,
                       f.ext AS ext, f.preview AS preview, f.color AS color,
                       f.val AS baseVal, f.community AS community,
                       f.embedding IS NOT NULL AS indexed,
                       count(r) AS degree
                ORDER BY f.type, f.name
            """)
            links_result = session.run("""
                MATCH (a:File)-[r:SIMILAR_TO]->(b:File)
                RETURN a.id AS source, b.id AS target, r.score AS value
                ORDER BY r.score DESC
            """)
            nodes = [dict(r) for r in nodes_result]
            links = [dict(r) for r in links_result]
            return nodes, links
    except Exception as e:
        print(f"Neo4j get graph error: {e}")
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
        return embed(p.read_bytes(), mime), f"[Image] {name}"
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


# ── Persistent local index (fallback) ─────────────────────────────────────────
INDEX_FILE = Path(__file__).parent / "index.json"

def load_index() -> dict:
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except Exception:
            pass
    return {}

# ── Flask app ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})


@app.route("/api/files")
def api_files():
    files    = scan_dir(DESKTOP, 1)
    file_ids = [f["id"] for f in files]

    driver = get_neo4j_driver()
    if driver:
        try:
            neo4j_upsert_files(files)
            cached = neo4j_load_embeddings(file_ids)
            for f in files:
                if f["id"] in cached:
                    c = cached[f["id"]]
                    f["embedding"] = c["embedding"]
                    f["preview"]   = c["preview"]
                    if c["community"] is not None:
                        f["community"] = c["community"]
        except Exception as e:
            print(f"Neo4j files error: {e}")
            _merge_local_index(files)
    else:
        _merge_local_index(files)

    return jsonify({"files": files, "total": len(files), "desktop": str(DESKTOP)})


def _merge_local_index(files: list[dict]):
    index = load_index()
    for f in files:
        if f["id"] in index:
            f["embedding"] = index[f["id"]].get("embedding")
            f["preview"]   = index[f["id"]].get("preview", "")


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
            neo4j_save_embedding(path, vec, preview)
            neo4j_build_links_for_node(path, vec)

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
    """Embed query, compute cosine similarity against all stored embeddings, return ranked results."""
    body  = request.get_json(force=True)
    query = body.get("query", "").strip()
    limit = min(int(body.get("limit", 20)), 50)

    if not query:
        return jsonify({"results": [], "method": "none"})

    # Use Gemini to understand query intent
    parsed      = parse_query(query)
    sem_query   = parsed.get("semantic_query") or query
    type_filter = parsed.get("type_filter")  # e.g. ["image"] or None
    print(f"Search: '{query}' → semantic='{sem_query}' types={type_filter}")

    try:
        query_vec = embed(sem_query, task="RETRIEVAL_QUERY")
    except Exception as e:
        return jsonify({"error": f"embed failed: {e}"}), 500

    def _score_rows(rows):
        scored = []
        for row in rows:
            if type_filter and row.get("type") not in type_filter:
                continue
            emb = row.pop("embedding", None)
            if emb:
                row["score"] = round(cosine_similarity_py(query_vec, list(emb)), 4)
                scored.append(row)
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]

    driver = get_neo4j_driver()
    if driver:
        try:
            with driver.session(database=NEO4J_DB) as session:
                rows = session.run("""
                    MATCH (f:File) WHERE f.embedding IS NOT NULL
                    RETURN f.id AS id, f.name AS name, f.path AS path,
                           f.type AS type, f.ext AS ext, f.size AS size,
                           f.preview AS preview, f.embedding AS embedding
                """).data()
            return jsonify({"results": _score_rows(rows), "method": "embedding",
                            "semantic_query": sem_query, "type_filter": type_filter})
        except Exception as e:
            print(f"Search error: {e}")

    # Fallback: local index
    index = load_index()
    rows = [
        {"id": fid, "name": d.get("name",""), "path": fid,
         "type": d.get("type","other"), "ext": d.get("ext",""),
         "size": d.get("size",0), "preview": d.get("preview",""),
         "embedding": d.get("embedding")}
        for fid, d in index.items() if d.get("embedding")
    ]
    return jsonify({"results": _score_rows(rows), "method": "embedding"})


@app.route("/api/graph")
def api_graph():
    """Full graph from Neo4j: nodes enriched with community + degree."""
    nodes, links = neo4j_get_graph()
    community_counts: dict[int, int] = defaultdict(int)
    for n in nodes:
        c = n.get("community")
        if c is not None:
            community_counts[int(c)] += 1

    return jsonify({
        "nodes":       nodes,
        "links":       links,
        "neo4j":       bool(nodes or links),
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
    return jsonify({
        "status": "ok",
        "model":  EMBED_MODEL,
        "dim":    EMBED_DIM,
        "neo4j":  get_neo4j_driver() is not None,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"\n🧠 NeuralVault")
    print(f"   Model:   {EMBED_MODEL} ({EMBED_DIM}d)")
    print(f"   Desktop: {DESKTOP}")
    get_neo4j_driver()
    print(f"   Listening on http://localhost:{port}\n")
    app.run(port=port, debug=False)
