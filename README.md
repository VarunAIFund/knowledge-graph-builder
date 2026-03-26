# NeuralVault

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Gemini](https://img.shields.io/badge/Gemini-2.0-4285F4?style=flat-square&logo=google&logoColor=white)](https://deepmind.google/technologies/gemini/)
[![LanceDB](https://img.shields.io/badge/LanceDB-local-FF6B35?style=flat-square)](https://lancedb.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**Your Desktop as a knowledge graph — semantic search and 3D visualization powered by Gemini embeddings.**

NeuralVault scans your `~/Desktop`, generates Gemini embeddings for every file (text, code, images, PDFs, audio, video), computes cosine similarity links, detects semantic communities via label propagation, and renders everything as an interactive 3D force-graph you can search and explore.

![NeuralVault loaded](neuralvault-loaded.png)

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Setup](#setup)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Original Knowledge Graph Builder](#original-knowledge-graph-builder)

---

## What It Does

1. **Scan** — the Flask backend recursively scans `~/Desktop` and returns a list of every file with metadata (type, size, modified date).
2. **Embed** — clicking "Generate Embeddings" sends each file to Gemini: text/code files use `gemini-embedding-001` (or `gemini-embedding-2-preview` on Vertex AI); images and PDFs are first captioned by `gemini-2.0-flash`, then embedded.
3. **Link** — after embedding, cosine similarity is computed between every pair of file vectors. Pairs above a configurable threshold (default 0.72) get a `SIMILAR_TO` edge stored in LanceDB.
4. **Cluster** — label propagation over the similarity graph produces semantic community IDs, exposed as colored cluster rings in the visualization.
5. **Explore** — a Next.js 3D force-graph (Three.js) renders every file as a sphere. Click any node to open a details panel. Drag, zoom, and rotate freely.
6. **Search** — the `⌘K` command palette (or the search bar) sends your query to Gemini, which parses intent and filters files semantically using vector search over LanceDB.

![NeuralVault search results](neuralvault-search-results.png)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Next.js 15 Frontend (port 3000)             │
│  Graph3D · FileDetails · SearchBar · ⌘K palette          │
└───────────────────────┬─────────────────────────────────┘
                        │  REST (fetch)
┌───────────────────────▼─────────────────────────────────┐
│           Flask Backend — backend/neuralvault.py         │
│  /api/files  /api/embed  /api/search  /api/graph         │
│  /api/cluster-labels  /api/preview  /api/open            │
└──────┬────────────────┬────────────────┬────────────────┘
       │                │                │
       ▼                ▼                ▼
  File system      Gemini API        LanceDB
  ~/Desktop     (embed + caption)   (vectors +
  recursive scan   google-genai      similarity links
                                     community IDs)
```

### Embedding pipeline

```
File on disk
     │
     ▼
get file type (text / image / pdf / audio / video / other)
     │
     ├─ text / code  →  read content  →  gemini-embedding-001
     │
     ├─ image / pdf  →  caption with gemini-2.0-flash
     │                   →  embed caption text
     │
     └─ audio / video →  embed filename + metadata
          │
          ▼
   float[3072] vector  →  LanceDB upsert
          │
          ▼
   cosine similarity against all existing vectors
          │
   pairs ≥ 0.72  →  SIMILAR_TO edges in LanceDB
          │
          ▼
   label propagation  →  community IDs  →  cluster colors
```

---

## Features

**File scanning**
- Recursive scan of `~/Desktop` (configurable depth)
- Skips hidden files, system dirs (`node_modules`, `.git`, `__pycache__`, etc.)
- Detects dataset directories (large dirs of uniform-type files) and treats them as single nodes
- File types: image, text, code, pdf, audio, video, folder, other

**Embedding**
- Gemini Embedding 2 (3072-dim) for text/code content
- Gemini Flash vision for image/PDF captioning before embedding
- Works with both Gemini API key and Vertex AI (auto-detected via env vars)
- Incremental: already-embedded files are skipped on re-run

**Graph & communities**
- Cosine similarity threshold (default 0.72) drives edge creation
- Label propagation community detection over the similarity graph
- Community cluster legend with AI-generated cluster labels (via Gemini Flash)
- Node size proportional to degree (more connections = larger sphere)

**3D visualization**
- Three.js + react-force-graph-3d
- Nodes colored by file type (Neo4j Bloom-style palette)
- Community ring glow for clustered nodes
- Click node → FileDetails panel with file metadata, AI-generated preview, and quick-open button
- File type legend (right side) — click to filter by type

**Semantic search**
- `⌘K` command palette (Raycast-style) or persistent search bar
- Gemini parses free-text queries into structured filters (type, name, date, semantic query)
- Vector search over LanceDB returns ranked results
- Keyboard navigation in results (↑↓ arrows, Enter to select)

**Operations**
- `/api/open` shells out `open <path>` to open files in their default macOS app
- `/api/preview` serves images and PDFs from Desktop to the frontend (path-restricted to `~/Desktop`)
- Health endpoint at `/api/health`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript |
| 3D graph | react-force-graph-3d + Three.js |
| UI / styling | Tailwind CSS, shadcn/ui, Framer Motion |
| Icons | Lucide React |
| Backend framework | Flask 3.0 + flask-cors |
| Embeddings | Google Gemini (`gemini-embedding-001` / `gemini-embedding-2-preview`) |
| Vision / text gen | Google Gemini Flash (`gemini-2.0-flash`) |
| Vector store | LanceDB (local, file-based) |
| Similarity | NumPy cosine similarity |
| Config / secrets | python-dotenv |

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey) **or** a Google Cloud project with Vertex AI enabled

### 1. Clone the repository

```bash
git clone https://github.com/your-username/knowledge-graph-builder.git
cd knowledge-graph-builder
```

### 2. Set up the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
# Option A — Gemini API key (simplest)
GEMINI_API_KEY=AIza...

# Option B — Vertex AI (uses gemini-embedding-2-preview instead)
# GOOGLE_CLOUD_PROJECT=your-project-id
# GOOGLE_CLOUD_LOCATION=us-central1
```

Start the backend:

```bash
python neuralvault.py
# Listening on http://localhost:5001
```

### 3. Set up the frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
# Not required — the frontend calls the local Flask backend at localhost:5001
# No API keys needed here unless you add client-side Gemini calls
```

Start the frontend:

```bash
npm run dev
# Open http://localhost:3000
```

### 4. Use it

1. Open [http://localhost:3000](http://localhost:3000)
2. The graph loads immediately with all Desktop files as nodes.
3. Click **Generate Embeddings** (⚡) to embed all files and build similarity links.
4. Press **⌘K** or click the search icon to search semantically.
5. Click any node to inspect file details.

---

## Usage

### Generating embeddings

Click the **⚡ Generate Embeddings** button in the top bar. The backend processes files one by one; a progress count updates in the button label. Previously embedded files are skipped.

After embedding completes, similarity edges are drawn and community clusters are computed automatically. The cluster legend appears bottom-left; click **"Label clusters"** to have Gemini name each cluster.

### Searching

Press `⌘K` or click the search bar. Type anything — file names, content descriptions, dates, types:

```
show me all Python files from last week
images of charts or graphs
documents about machine learning
```

Results are ranked by semantic similarity. Use ↑↓ to navigate, Enter to select, Escape to close.

### Filtering by type

Click any file-type pill in the legend (right side) to show/hide that type in the graph.

### Opening files

Click a node, then click **Open** in the FileDetails panel — this calls `/api/open` and opens the file in its default macOS application.

---

## API Reference

All endpoints return JSON. The backend runs on port **5001**.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/files` | Scan `~/Desktop` and return all file nodes with metadata |
| `POST` | `/api/embed` | Embed a single file. Body: `{"id": "<file-id>"}` |
| `GET`  | `/api/graph` | Return all nodes and similarity links from LanceDB |
| `POST` | `/api/search` | Semantic search. Body: `{"query": "..."}` |
| `POST` | `/api/cluster-labels` | Generate AI names for communities. Body: `{"communities": {...}}` |
| `GET`  | `/api/preview?path=<path>` | Serve an image or PDF from Desktop (path-restricted) |
| `POST` | `/api/open` | Open a file with `open`. Body: `{"path": "..."}` |
| `GET`  | `/api/health` | Health check |

**Embed example:**

```bash
curl -X POST http://localhost:5001/api/embed \
  -H "Content-Type: application/json" \
  -d '{"id": "/Users/you/Desktop/report.pdf"}'
```

**Search example:**

```bash
curl -X POST http://localhost:5001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning papers"}'
```

---

## Project Structure

```
knowledge-graph-builder/
│
├── backend/                        # Flask backend (NeuralVault)
│   ├── neuralvault.py              # Main Flask app — all API endpoints
│   ├── requirements.txt            # Python dependencies
│   ├── .env                        # GEMINI_API_KEY / GOOGLE_CLOUD_PROJECT (not committed)
│   ├── index.json                  # Cached file index (auto-generated)
│   │
│   ├── # Legacy knowledge-graph-builder backend (Flask + GPT-3.5 + Neo4j)
│   ├── app.py                      # Original Flask app
│   ├── main.py                     # KnowledgeGraphBuilder CLI
│   ├── config.py                   # Config loader
│   ├── document_processor.py       # URL / file → text chunks
│   ├── knowledge_extractor.py      # GPT-3.5 entity extraction
│   ├── graph_manager.py            # Neo4j CRUD
│   ├── query_engine.py             # NL query → GPT answer
│   ├── logging_config.py           # Rotating log handlers
│   └── templates/                  # Legacy Jinja2 templates
│
├── frontend/                       # Next.js 15 frontend (NeuralVault)
│   ├── app/
│   │   ├── page.tsx                # Main page — graph + controls
│   │   ├── layout.tsx              # Root layout
│   │   ├── globals.css             # Global styles
│   │   ├── api/preview/            # Next.js route: serve file previews
│   │   └── search/                 # Search page (unused / future)
│   ├── components/
│   │   ├── Graph3D.tsx             # react-force-graph-3d wrapper
│   │   ├── FileDetails.tsx         # Right-side file detail panel
│   │   ├── SearchBar.tsx           # ⌘K command palette + search results
│   │   └── ui/                     # shadcn/ui + custom glass button components
│   ├── types/
│   │   └── index.ts                # FileNode, GraphLink, GraphData types
│   ├── lib/
│   │   └── utils.ts                # buildLinks() and Tailwind merge
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── package.json
│
├── neuralvault-*.png               # Screenshots
└── README.md
```

---

## Original Knowledge Graph Builder

The `backend/` directory also contains the original knowledge-graph-builder project — a Flask app that uses GPT-3.5 to extract entities and relationships from any text document or URL and stores them in Neo4j AuraDB.

**To run the original app:**

```bash
cd backend
# Set OPENAI_API_KEY, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD in .env
python app.py       # Web UI at http://localhost:5000
# or
python main.py      # CLI
```

See the legacy architecture and API docs in the git history or the original README for details on the Neo4j/GPT-3.5 pipeline.
