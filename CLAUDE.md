# CLAUDE.md — NeuralVault

This file is the authoritative context for Claude Code working in this repository. Read it before making any changes.

---

## What this project is

**NeuralVault** turns `~/Desktop` into a queryable, 3D semantic knowledge graph. It has two parts:

| Part | Location | Purpose |
|---|---|---|
| Flask backend | `backend/neuralvault.py` | Scan Desktop, embed files with Gemini, store vectors in LanceDB, serve REST API |
| Next.js frontend | `frontend/` | 3D force-graph visualization, ⌘K search, file detail panel |

There is also a **legacy** knowledge-graph-builder app in `backend/` (app.py, main.py, graph_manager.py, etc.) that uses GPT-3.5 + Neo4j AuraDB. It is largely superseded by NeuralVault but still runnable. Do not break it when touching shared files like `requirements.txt`.

---

## Running the project

**Backend** (port 5001):
```bash
cd backend
source venv/bin/activate
python neuralvault.py
```

**Frontend** (port 3000):
```bash
cd frontend
npm run dev      # uses Turbopack
```

The frontend fetches from `http://localhost:5001` (hardcoded in `frontend/app/page.tsx` and components). No proxy is configured.

---

## Environment variables

| File | Variable | Purpose |
|---|---|---|
| `backend/.env` | `GEMINI_API_KEY` | Gemini API key (required unless using Vertex AI) |
| `backend/.env` | `GOOGLE_CLOUD_PROJECT` | Vertex AI project ID (optional; activates `gemini-embedding-2-preview`) |
| `backend/.env` | `GOOGLE_CLOUD_LOCATION` | Vertex AI region (default: `us-central1`) |

No secrets go in the frontend. The Next.js API route at `frontend/app/api/preview/` runs server-side and needs no keys.

---

## Backend — `backend/neuralvault.py`

Single-file Flask app (~933 lines). Key sections:

### File type system

```python
TEXT_EXTS, IMAGE_EXTS, PDF_EXTS, AUDIO_EXTS, VIDEO_EXTS, CODE_EXTS
FILE_TYPE_MAP   # ext → "image" | "text" | "pdf" | "audio" | "video"
FILE_TYPE_COLORS  # type → hex color (must match frontend FILE_TYPE_COLORS)
```

Colors must stay in sync with `frontend/app/page.tsx` — both define the same `FILE_TYPE_COLORS` map.

### LanceDB schema

Two tables:

1. **`files`** — one row per file. Columns: `id` (path), `name`, `path`, `type`, `size`, `modified`, `ext`, `embedding` (float[3072]), `preview` (text caption), `community` (int), `degree` (int).
2. **`links`** — one row per similarity edge. Columns: `source`, `target`, `value` (cosine similarity float).

Tables are created lazily in `get_tables()`. The LanceDB database lives at `backend/lancedb/` (not committed).

### Embedding logic (`embed_file`)

```
text/code  →  read file content  →  gemini-embedding-001  →  float[3072]
image/pdf  →  caption with gemini-2.0-flash  →  embed caption
audio/vid  →  embed "{name} {ext} file"
other      →  embed filename only
```

`EMBED_DIM = 3072` — must match any vector search operations.

### Similarity and community detection

- `cosine_similarity(a, b)` — pure NumPy dot product over L2 norms.
- `lancedb_build_links_for_node(node_id, embedding, threshold=0.72)` — after embedding a file, loads all other vectors from LanceDB and creates edges above threshold.
- `label_propagation(nodes, edges, iterations=10)` — assigns community IDs by iteratively assigning each node the most common community among its neighbors.
- `_recompute_communities()` — called after any link change; updates the `community` and `degree` columns in the `files` table.

### Query parsing (`parse_query`)

Takes a free-text search string, calls `gemini-2.0-flash` with a structured prompt, and returns a dict:
```python
{
  "semantic_query": str,   # cleaned query for vector search
  "type_filter": str|None, # e.g. "image", "text"
  "name_filter": str|None,
  "date_filter": str|None,
  "limit": int
}
```

### API endpoints

| Endpoint | Notes |
|---|---|
| `GET /api/files` | Calls `scan_dir(~/Desktop, depth=5)`, merges with LanceDB to attach `embedding`, `community`, `degree` to each node |
| `POST /api/embed` | Body: `{"id": "<abs-path>"}`. Embeds one file, upserts to LanceDB, rebuilds links and communities |
| `GET /api/graph` | Returns `{nodes, links}` from LanceDB — used on refresh |
| `POST /api/search` | Parses query, does vector search + filters, returns ranked FileNode list |
| `POST /api/cluster-labels` | Body: `{"communities": {id: [filenames]}}`. Calls Gemini to name each cluster |
| `GET /api/preview?path=` | Streams file bytes; restricted to `~/Desktop` paths |
| `POST /api/open` | Calls `subprocess.run(["open", path])` |

### Directory skipping (`_is_dataset_dir`, `scan_dir`)

`scan_dir` skips: `.git`, `node_modules`, `__pycache__`, `.next`, `venv`, `dist`, `build`, `target`, `.DS_Store`, hidden dirs.

`_is_dataset_dir` returns `True` if a directory has >50 files that are all the same extension (e.g. a folder of 200 PNGs). These are treated as a single "folder" node instead of 200 individual nodes.

---

## Frontend — `frontend/`

Next.js 15 App Router, TypeScript, Tailwind CSS 3, shadcn/ui.

### Key files

| File | Purpose |
|---|---|
| `app/page.tsx` | Root page — fetches `/api/files` and `/api/graph`, owns all state, renders Graph3D + FileDetails + SearchBar |
| `components/Graph3D.tsx` | Wraps `react-force-graph-3d`. Handles node coloring (type vs. community), link rendering, node click, type filters |
| `components/FileDetails.tsx` | Right-side slide-in panel. Shows metadata, AI preview caption, image preview, Open button |
| `components/SearchBar.tsx` | ⌘K command palette. Calls `/api/search`, keyboard nav, staggered Framer Motion results |
| `components/ui/liquid-glass-button.tsx` | Custom animated CTA button (used for Generate Embeddings) |
| `types/index.ts` | `FileNode`, `GraphLink`, `GraphData`, `SearchResult`, `EmbedResponse` |
| `lib/utils.ts` | `buildLinks()` — converts raw link objects to force-graph format; `cn()` Tailwind merge |

### State (in `page.tsx`)

```typescript
files: FileNode[]          // raw file list from /api/files
graphData: GraphData       // { nodes: FileNode[], links: GraphLink[] }
selectedFile: FileNode | null
isEmbedding: boolean
embedProgress: { done, total }
activeTypes: Set<FileType> // type filter
showCommunities: boolean
communityLabels: Record<number, string>
```

### Graph3D props

```typescript
graphData       // filtered graphData based on activeTypes
onNodeClick     // sets selectedFile
activeTypes
showCommunities
communityLabels
```

### Design system

- Background: `#eef0f5` (Neo4j Bloom light grey)
- Glass panels: white with `backdrop-blur`, `border border-white/60`
- Accent: indigo (`indigo-500` / `indigo-600`)
- Text: `slate-800` (primary), `slate-500` (secondary)
- File type colors (from `FILE_TYPE_COLORS` in both backend and frontend):
  - image: `#FF0080` (hot pink)
  - text: `#00D4FF` (cyan)
  - code: `#00FF88` (green)
  - pdf: `#FF6B35` (orange)
  - audio: `#A855F7` (purple)
  - video: `#F59E0B` (amber)
  - folder: `#6B7280` (grey)
  - other: `#94A3B8` (slate)

### Next.js API route

`app/api/preview/route.ts` — serves images and PDFs from Desktop. Security: resolves the path and checks it starts with `~/Desktop` before reading. Only serves `image/*` and `application/pdf` MIME types.

---

## Data flow: full embed cycle

```
User clicks ⚡ Generate Embeddings
  → page.tsx: POST /api/embed for each file sequentially
  → neuralvault.py: embed_file(path, type)
      → Gemini API call → float[3072]
  → lancedb_upsert_files([node])  — writes/updates files table
  → lancedb_save_embedding(id, vec, preview)  — updates embedding col
  → lancedb_build_links_for_node(id, vec)  — loads all vecs, computes sims, upserts links table
  → _recompute_communities()  — label propagation, updates community + degree cols
  → returns { embedding, preview }
  → page.tsx: updates graphData with new node + links
```

---

## Common tasks

### Add a new file type

1. Add extension to the appropriate set in `backend/neuralvault.py` (`TEXT_EXTS`, `IMAGE_EXTS`, etc.)
2. Add a color to `FILE_TYPE_COLORS` in `neuralvault.py`
3. Add the same color to the `FILE_TYPE_COLORS` constant in `frontend/app/page.tsx`
4. Add the type to `FileType` union in `frontend/types/index.ts`
5. Handle the type in `embed_file()` if it needs special treatment

### Change the similarity threshold

In `neuralvault.py`, the default threshold is `0.72`. It appears in:
- `lancedb_build_links_for_node(node_id, new_embedding, threshold=0.72)`
- `lancedb_rebuild_all_links(threshold=0.72)`

Expose via env var or API param if you want it configurable at runtime.

### Add a new API endpoint

Add a `@app.route(...)` function to `neuralvault.py`. CORS is enabled globally via `CORS(app)`. Call it from `frontend/app/page.tsx` or the relevant component using `fetch('http://localhost:5001/api/...')`.

### Modify the 3D graph appearance

All visual logic is in `frontend/components/Graph3D.tsx`. Key methods passed to `ForceGraph3D`:
- `nodeColor` — returns hex string based on type or community
- `nodeVal` — returns sphere size (based on `degree`)
- `linkColor` — returns rgba based on `value` (similarity)
- `nodeThreeObject` — can return a custom Three.js object per node

### Add search filters

1. Update `parse_query()` in `neuralvault.py` to extract the new field from the Gemini response
2. Apply the filter in `api_search()` before or after vector search
3. Optionally expose filter controls in `frontend/components/SearchBar.tsx`

---

## Dependencies

### Backend (`backend/requirements.txt`)

```
flask==3.0.0
flask-cors>=4.0.0
google-genai>=1.10.0
lancedb>=0.8.0
numpy>=1.26.0
python-dotenv==1.0.0
# Legacy (knowledge-graph-builder):
openai==1.12.0
beautifulsoup4==4.12.2
requests==2.31.0
tiktoken==0.5.2
werkzeug==3.0.1
```

### Frontend (`frontend/package.json`)

Key dependencies:
- `next` ^15
- `react-force-graph-3d` ^1.24 — Three.js force-directed graph
- `react-force-graph-2d` ^1.29 — 2D fallback (imported but not default)
- `three` ^0.168 — required peer dep for 3D graph
- `framer-motion` ^11 — animations
- `@google/generative-ai` ^0.21 — client-side Gemini (not currently used in main flow)
- `lucide-react` ^0.446 — icons
- `tailwind-merge`, `clsx` — class utilities

---

## What NOT to do

- Do not move LanceDB data files (`backend/lancedb/`) — they are gitignored and local.
- Do not add API keys to `frontend/.env.local` unless explicitly building a client-side Gemini feature.
- Do not change `EMBED_DIM = 3072` without migrating the LanceDB table schema (it is a fixed-size vector column).
- Do not import `react-force-graph-3d` with SSR — Graph3D is always loaded via `next/dynamic` with `ssr: false`.
- Do not break the legacy `backend/app.py` routes — they share `requirements.txt` and could be needed.
