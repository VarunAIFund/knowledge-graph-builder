# Knowledge Graph Builder

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--3.5-412991?style=flat-square&logo=openai&logoColor=white)](https://openai.com/)
[![Neo4j](https://img.shields.io/badge/Neo4j-AuraDB-008CC1?style=flat-square&logo=neo4j&logoColor=white)](https://neo4j.com/cloud/aura/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**Turn any document or web page into a queryable knowledge graph — in seconds.**

Feed the app a plain-text file or a URL and it uses GPT to extract every entity and relationship it can find, stores them in Neo4j AuraDB, and lets you explore or query the graph through a clean browser UI or a command-line interface.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Setup](#setup)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Limitations](#limitations)

---

## What It Does

Most information is locked inside unstructured text. This project extracts that structure automatically:

1. **Ingest** — paste in a URL or upload a `.txt` file.
2. **Extract** — GPT-3.5 reads each chunk and identifies entities (people, organizations, locations, products, concepts) and the relationships between them.
3. **Store** — entities and relationships are merged, deduplicated, and written to Neo4j as a property graph.
4. **Query** — ask a natural-language question; the app retrieves relevant graph context and uses GPT to synthesize a grounded answer.
5. **Explore** — view the live graph in an interactive D3 force-directed visualization or run raw Cypher queries in Neo4j Browser.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Flask Web App                         │
│   /upload    /query    /graph    /stats    REST API (/api/)  │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
  ┌───────────────┐ ┌──────────────┐ ┌──────────────────┐
  │  Document     │ │  Knowledge   │ │  Query Engine    │
  │  Processor    │ │  Extractor   │ │                  │
  │               │ │              │ │  NL question     │
  │  URL / file   │ │  GPT-3.5     │ │  → entity        │
  │  → clean text │ │  extraction  │ │    extraction    │
  │  → token      │ │  + merge /   │ │  → graph context │
  │    chunks     │ │  dedup       │ │  → GPT answer    │
  └───────┬───────┘ └──────┬───────┘ └────────┬─────────┘
          │                │                  │
          └────────────────▼──────────────────┘
                           │
                  ┌────────▼────────┐
                  │  Graph Manager  │
                  │                 │
                  │  Neo4j AuraDB   │
                  │  MERGE / MATCH  │
                  │  Full-text idx  │
                  │  Path finding   │
                  └─────────────────┘
```

### Data Flow

```
User input (file / URL)
        │
        ▼
DocumentProcessor.ingest_document()
  ├─ fetch & clean HTML  (BeautifulSoup)
  ├─ read plain text
  └─ chunk by token count (tiktoken, 800 tok / 100 overlap)
        │
        ▼  (one API call per chunk)
KnowledgeExtractor.extract_knowledge()
  ├─ GPT-3.5 → structured JSON {entities, relationships}
  ├─ validate schema
  └─ merge_extractions() — case-insensitive dedup
        │
        ▼
GraphManager.store_in_graph()
  ├─ MERGE nodes by (type, name)
  └─ MERGE relationships
        │
        ▼
Neo4j AuraDB  ←─── QueryEngine  ←─── User question (NL)
                    ├─ GPT extracts key terms
                    ├─ full-text search + relationship traversal
                    ├─ shortestPath between entities
                    └─ GPT synthesizes final answer
```

---

## Features

**Document ingestion**
- Plain-text file upload (up to 100 MB)
- Arbitrary web URLs — cleans boilerplate (nav, footer, scripts) with BeautifulSoup
- Token-aware chunking via tiktoken (no context-window overflows)

**Knowledge extraction**
- Five entity types: Person, Organization, Location, Product, Concept
- Named relationship types (founded, works_for, located_in, collaborated_with, and more)
- JSON schema validation on every GPT response
- Automatic merge and deduplication across chunks

**Graph storage**
- Neo4j AuraDB — managed, cloud-hosted property graph
- Per-type indexes for fast lookup
- Full-text search index across name and description fields
- Shortest-path queries between any two entities

**Query interface**
- Natural-language questions resolved against live graph context
- Context window built from entity search + relationship traversal + path results
- Suggested questions auto-generated from available entity types

**Web UI**
- Bootstrap 5 responsive layout
- D3.js force-directed graph visualization (nodes colored by entity type, click for details)
- Upload, query, stats, and graph pages

**CLI**
- `process <file|url>` — ingest a document
- `query <question>` — ask a question
- `stats` — print entity and relationship counts
- `clear` — wipe the graph

**Operations**
- Structured logging with rotating file handlers (all events, errors, API audit)
- Rate-limit delay between OpenAI calls
- Graceful degradation when services are unavailable

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | Flask 3.0 |
| LLM | OpenAI GPT-3.5-turbo |
| Graph database | Neo4j AuraDB (Bolt protocol) |
| HTML parsing | BeautifulSoup 4 |
| Token counting | tiktoken (cl100k_base) |
| Graph visualization | D3.js (force simulation) |
| Frontend | Bootstrap 5, Font Awesome 6 |
| Config / secrets | python-dotenv |

---

## Setup

### Prerequisites

- Python 3.10 or higher
- A free [Neo4j AuraDB](https://neo4j.com/cloud/aura/) instance
- An [OpenAI API key](https://platform.openai.com/api-keys)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/knowledge-graph-builder.git
cd knowledge-graph-builder
```

### 2. Create a virtual environment

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy the template and fill in your credentials:

```bash
cp .env.example .env
```

Open `.env` and set the following values:

```env
# OpenAI
OPENAI_API_KEY=sk-...

# Neo4j AuraDB
NEO4J_URI=neo4j+s://<your-instance-id>.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<your-password>
NEO4J_DATABASE=neo4j

# Flask
FLASK_SECRET_KEY=<generate-a-random-secret-key>
FLASK_DEBUG=False
```

To generate a secure Flask secret key:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

> **Note:** `.env` is listed in `.gitignore` and will never be committed. Never hard-code credentials in source files.

### 5. Run the application

**Web interface (recommended):**

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

**Command-line interface:**

```bash
python main.py
```

---

## Usage

### Web Interface

1. **Upload** — go to "Upload Documents", paste a URL or upload a `.txt` file, and click Process.
2. **Query** — go to "Query Knowledge", type a natural-language question, and press Ask.
3. **Explore** — go to "Graph View" to see an interactive force-directed visualization of every node and edge.
4. **Stats** — go to "Statistics" for entity and relationship counts broken down by type.

### Command-Line Interface

```
Knowledge Graph Builder - Command Line Interface
Commands: process <file/url>, query <question>, stats, clear, quit

> process https://en.wikipedia.org/wiki/SpaceX
  Success! Processed 12 chunks, extracted 47 entities, 63 relationships

> process /path/to/report.txt
  Success! Processed 4 chunks, extracted 18 entities, 22 relationships

> query Who founded SpaceX and what is their background?
  Q: Who founded SpaceX and what is their background?
  A: SpaceX was founded by Elon Musk in 2002. Musk previously co-founded
     PayPal and is also the CEO of Tesla. SpaceX is headquartered in
     Hawthorne, California...

> stats
  Entities: 65
  Relationships: 85
  Entity types:
    Person: 14
    Organization: 22
    Location: 11
    Product: 9
    Concept: 9

> clear
  Clear all graph data? (y/N): y
  Graph cleared successfully
```

### Cypher Queries (Neo4j Browser)

Access the Neo4j Browser at [https://console.neo4j.io](https://console.neo4j.io) and connect with your AuraDB credentials for advanced exploration.

```cypher
-- All nodes
MATCH (n) RETURN n LIMIT 50

-- All people and their relationships
MATCH (p:Person)-[r]-(x)
RETURN p, r, x

-- Shortest path between two entities
MATCH (a {name: "Elon Musk"}), (b {name: "NASA"})
MATCH path = shortestPath((a)-[*1..5]-(b))
RETURN path

-- Full-text search
CALL db.index.fulltext.queryNodes('entity_search', 'machine learning')
YIELD node, score
RETURN node.name, node.description, score
ORDER BY score DESC
```

---

## API Reference

All endpoints return JSON with a top-level `success` boolean.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Ingest a document. Form fields: `file` (multipart) or `url` (string). |
| `POST` | `/api/query` | Answer a question. JSON body: `{"question": "..."}` |
| `POST` | `/api/search` | Entity full-text search. JSON body: `{"query": "..."}` |
| `GET`  | `/api/stats` | Graph statistics (node counts by type, relationship counts). |
| `GET`  | `/api/graph-data` | All nodes and links for visualization. |
| `POST` | `/api/clear` | Delete all nodes and relationships. |

**Upload example:**

```bash
# File upload
curl -X POST http://localhost:5000/api/upload \
  -F "file=@report.txt"

# URL
curl -X POST http://localhost:5000/api/upload \
  -F "url=https://example.com/article"
```

**Query example:**

```bash
curl -X POST http://localhost:5000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What organizations are involved in space exploration?"}'
```

---

## Configuration

All settings are loaded from environment variables via `.env`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `NEO4J_URI` | Yes | — | Bolt URI for Neo4j AuraDB |
| `NEO4J_USERNAME` | Yes | — | Database username |
| `NEO4J_PASSWORD` | Yes | — | Database password |
| `NEO4J_DATABASE` | Yes | — | Database name (usually `neo4j`) |
| `FLASK_SECRET_KEY` | Yes | (weak dev default) | Flask session signing key — **set this in production** |
| `FLASK_DEBUG` | No | `False` | Enable Flask debug mode |

Chunking parameters are set in `config.py`:

| Setting | Default | Description |
|---|---|---|
| `CHUNK_SIZE` | 800 tokens | Maximum tokens per document chunk |
| `CHUNK_OVERLAP` | 100 tokens | Token overlap between consecutive chunks |
| `MAX_FILE_SIZE` | 100 MB | Maximum accepted file or page size |

---

## Project Structure

```
knowledge-graph-builder/
├── app.py                  # Flask application — routes and API endpoints
├── main.py                 # KnowledgeGraphBuilder class + CLI entry point
├── config.py               # Centralised configuration (reads from .env)
├── document_processor.py   # Text extraction (URL / file) and token chunking
├── knowledge_extractor.py  # GPT-3.5 entity/relationship extraction + dedup
├── graph_manager.py        # Neo4j CRUD, indexes, search, path finding
├── query_engine.py         # NL query → graph context → GPT answer pipeline
├── logging_config.py       # Rotating file handlers, rate limiter, env validator
├── templates/
│   ├── base.html           # Shared layout (sidebar, Bootstrap, D3 CDN)
│   ├── index.html          # Home / dashboard
│   ├── upload.html         # Document ingestion page
│   ├── query.html          # Natural-language query page
│   ├── graph.html          # D3 force-directed visualization
│   └── stats.html          # Entity and relationship statistics
├── requirements.txt        # Pinned Python dependencies
├── .gitignore              # Excludes .env, logs/, venv/, __pycache__, etc.
└── logs/                   # Created at runtime — not committed
    ├── knowledge_graph.log
    ├── errors.log
    └── api_calls.log
```

---

## Limitations

- **File formats:** only plain text (`.txt`) and web pages are supported. PDF, DOCX, and other binary formats are not yet handled.
- **Model:** uses GPT-3.5-turbo by default. Upgrading to GPT-4 in `knowledge_extractor.py` and `query_engine.py` improves extraction quality on complex or technical text.
- **Neo4j AuraDB free tier:** capped at 200,000 nodes and 400,000 relationships.
- **Rate limiting:** a fixed 1-second delay is applied between OpenAI API calls. High-volume ingestion will be slow; consider batching or async processing for production use.
- **Concurrency:** global component references in `app.py` are not thread-safe. Use a single worker (`--workers 1`) when deploying behind gunicorn, or refactor to use `g` / application context.
