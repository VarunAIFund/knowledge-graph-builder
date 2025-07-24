# Knowledge Graph Builder

Convert documents and web pages into an interactive knowledge graph using Neo4j AuraDB and OpenAI GPT. Extract entities, relationships, and answer natural language questions about your content.

## Features

- **Document Processing**: Handle TXT files and web URLs (up to 100MB total)
- **AI-Powered Extraction**: Use GPT-3.5 to extract entities and relationships
- **Graph Storage**: Store knowledge in Neo4j AuraDB with full-text search
- **Natural Language Queries**: Ask questions and get comprehensive answers
- **Web Interface**: Simple Flask app for easy interaction
- **Graph Visualization**: Access to Neo4j Browser for exploration

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

The system uses environment variables stored in `.env`. These are already configured:

- OpenAI API Key
- Neo4j AuraDB connection details

### 3. Run the Application

#### Web Interface (Recommended)
```bash
python app.py
```
Visit `http://localhost:5000` in your browser.

#### Command Line Interface
```bash
python main.py
```

## Usage

### Web Interface

1. **Upload Documents**: Go to "Upload Documents" and add TXT files or web URLs
2. **Query Knowledge**: Go to "Query Knowledge" and ask natural language questions
3. **View Statistics**: See graph statistics and entity/relationship counts
4. **Explore Graph**: Access Neo4j Browser for advanced visualization

### Command Line

```bash
# Process a document
> process https://example.com/article.html
> process /path/to/document.txt

# Ask questions
> query Who are the key people mentioned?
> query What organizations are discussed?

# View statistics
> stats

# Clear all data
> clear

# Exit
> quit
```

## Architecture

### Core Components

1. **DocumentProcessor** (`document_processor.py`)
   - Extracts text from files and URLs
   - Chunks content into manageable segments
   - Tracks source attribution

2. **KnowledgeExtractor** (`knowledge_extractor.py`)
   - Uses GPT-3.5 to extract entities and relationships
   - Validates extraction quality
   - Merges and deduplicates results

3. **GraphManager** (`graph_manager.py`)
   - Manages Neo4j database operations
   - Creates and queries graph structures
   - Provides search and path-finding capabilities

4. **QueryEngine** (`query_engine.py`)
   - Processes natural language questions
   - Retrieves relevant graph context
   - Generates comprehensive answers using GPT

### Entity Types

- **Person**: People mentioned in content
- **Organization**: Companies, institutions, organizations
- **Location**: Cities, countries, addresses, places  
- **Product**: Products, services, technologies
- **Concept**: Ideas, concepts, topics, fields of study

### Data Flow

1. User uploads document/URL → Text extraction → Chunking
2. Each chunk → GPT extraction → Structured entities/relationships
3. Store in Neo4j with source tracking
4. User asks question → GPT query translation → Neo4j retrieval → GPT answer generation

## Configuration

### Environment Variables

- `OPENAI_API_KEY`: OpenAI API key for GPT access
- `NEO4J_URI`: Neo4j database URI
- `NEO4J_USERNAME`: Neo4j username
- `NEO4J_PASSWORD`: Neo4j password
- `NEO4J_DATABASE`: Neo4j database name

### Settings

- `CHUNK_SIZE`: Token size for document chunks (default: 1500)
- `CHUNK_OVERLAP`: Overlap between chunks (default: 200)
- `MAX_FILE_SIZE`: Maximum file size in bytes (default: 100MB)

## Neo4j Browser Access

Access advanced graph visualization at: https://console.neo4j.io

**Connection Details:**
- URI: Use `NEO4J_URI` from your `.env` file
- Username: Use `NEO4J_USERNAME` from your `.env` file  
- Database: Use `NEO4J_DATABASE` from your `.env` file
- Password: Use `NEO4J_PASSWORD` from your `.env` file

**Note:** All connection details are stored securely in environment variables.

**Sample Queries:**
```cypher
// Show all entities
MATCH (n) RETURN n LIMIT 25

// Show all people
MATCH (p:Person) RETURN p

// Show relationships
MATCH (n)-[r]-(m) RETURN n,r,m LIMIT 50

// Search entities by name
CALL db.index.fulltext.queryNodes('entity_search', 'search_term')
YIELD node, score RETURN node, score
```

## Error Handling

The system includes comprehensive error handling:

- **Rate Limiting**: Automatic delays between API calls
- **Logging**: Detailed logs in the `logs/` directory
- **Validation**: Input validation and extraction quality checks
- **Recovery**: Graceful degradation when services are unavailable

## Logging

Logs are stored in the `logs/` directory:

- `knowledge_graph.log`: All system events
- `errors.log`: Error-specific logs
- `api_calls.log`: API usage monitoring

## Limitations

- Currently supports only TXT files and web pages
- Uses GPT-3.5-turbo (upgrade to GPT-4 for better extraction)
- Neo4j AuraDB free tier limits: 200K nodes, 400K relationships
- Rate limited by OpenAI API quotas

## Troubleshooting

### Common Issues

1. **Connection Errors**: Check your internet connection and API keys
2. **Large Files**: Ensure files are under 100MB
3. **Processing Errors**: Check logs for detailed error messages
4. **Graph Visualization**: Ensure Neo4j AuraDB instance is running

### Debug Mode

Enable debug logging by setting `FLASK_DEBUG=True` in your environment.

## Development

### Project Structure

```
knowledge-graph-builder/
├── app.py                 # Flask web application
├── main.py               # CLI interface
├── config.py             # Configuration settings
├── document_processor.py # Document processing
├── knowledge_extractor.py # AI extraction
├── graph_manager.py      # Neo4j operations
├── query_engine.py       # Query processing
├── logging_config.py     # Logging setup
├── templates/            # HTML templates
├── requirements.txt      # Dependencies
├── .env                  # Environment variables
└── logs/                 # Log files
```

### Adding New Features

1. **New Entity Types**: Update the extraction prompt and validation
2. **File Formats**: Extend DocumentProcessor for new formats
3. **Query Types**: Enhance QueryEngine with specialized query handlers
4. **Visualizations**: Add new chart types to the web interface

## License

This project is for educational and demonstration purposes.