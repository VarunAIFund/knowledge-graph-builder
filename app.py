"""
Knowledge Graph Builder - Flask Web Application

Exposes a browser-based interface and a JSON REST API for ingesting documents
(plain-text files or web URLs), extracting entities and relationships via
OpenAI GPT, storing the resulting graph in Neo4j AuraDB, and answering
natural-language questions against that graph.

Routes
------
GET  /              Home page
GET  /upload        Document upload page
GET  /query         Query interface page
GET  /graph         Interactive graph visualization page
GET  /stats         Graph statistics page

POST /api/upload    Ingest a document (multipart file or URL form field)
POST /api/query     Answer a natural-language question
POST /api/search    Full-text entity search
GET  /api/stats     Graph statistics (JSON)
GET  /api/graph-data  Nodes and links for D3 visualization
POST /api/clear     Delete all graph data
"""

import os
import logging
from flask import Flask, render_template, request, jsonify, flash, redirect, url_for
from werkzeug.utils import secure_filename
from document_processor import DocumentProcessor
from knowledge_extractor import KnowledgeExtractor
from graph_manager import GraphManager
from query_engine import QueryEngine
from config import Config

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
app.secret_key = Config.FLASK_SECRET_KEY
app.config['MAX_CONTENT_LENGTH'] = Config.MAX_FILE_SIZE

# Global components
graph_manager = None
query_engine = None
document_processor = None
knowledge_extractor = None

def initialize_components():
    """Initialize all system components"""
    global graph_manager, query_engine, document_processor, knowledge_extractor
    
    try:
        graph_manager = GraphManager()
        document_processor = DocumentProcessor()
        knowledge_extractor = KnowledgeExtractor()
        query_engine = QueryEngine(graph_manager)
        logging.info("All components initialized successfully")
        return True
    except Exception as e:
        logging.error(f"Failed to initialize components: {str(e)}")
        return False

@app.route('/')
def index():
    """Home page"""
    return render_template('index.html')

@app.route('/upload')
def upload_page():
    """Document upload page"""
    return render_template('upload.html')

@app.route('/query')
def query_page():
    """Query interface page"""
    suggestions = []
    try:
        if query_engine:
            suggestions = query_engine.get_suggestions("")
    except Exception as e:
        logging.error(f"Error getting suggestions: {str(e)}")
    
    return render_template('query.html', suggestions=suggestions)

@app.route('/stats')
def stats_page():
    """Graph statistics page"""
    try:
        if graph_manager:
            stats = graph_manager.get_graph_stats()
            return render_template('stats.html', stats=stats)
        else:
            return render_template('stats.html', stats={})
    except Exception as e:
        logging.error(f"Error getting stats: {str(e)}")
        return render_template('stats.html', stats={})

@app.route('/api/upload', methods=['POST'])
def upload_document():
    """Handle document upload and processing"""
    try:
        source = None
        
        # Check if URL or file upload
        if 'url' in request.form and request.form['url'].strip():
            source = request.form['url'].strip()
            source_type = "URL"
        elif 'file' in request.files:
            file = request.files['file']
            if file.filename:
                filename = secure_filename(file.filename)
                file_path = os.path.join('/tmp', filename)
                file.save(file_path)
                source = file_path
                source_type = "File"
        
        if not source:
            return jsonify({'success': False, 'error': 'No source provided'})
        
        # Process document
        chunks = document_processor.ingest_document(source)
        
        all_entities = []
        all_relationships = []
        
        # Extract knowledge from each chunk
        for chunk_text, chunk_source, chunk_id in chunks:
            extracted_data = knowledge_extractor.extract_knowledge(chunk_text, chunk_source, chunk_id)
            
            if knowledge_extractor.validate_extraction(extracted_data):
                all_entities.extend(extracted_data.get("entities", []))
                all_relationships.extend(extracted_data.get("relationships", []))
        
        # Merge and deduplicate
        merged_data = knowledge_extractor.merge_extractions([{
            "entities": all_entities,
            "relationships": all_relationships
        }])
        
        # Store in graph
        success = graph_manager.store_in_graph(
            merged_data["entities"],
            merged_data["relationships"]
        )
        
        if success:
            return jsonify({
                'success': True,
                'message': f'{source_type} processed successfully',
                'stats': {
                    'chunks': len(chunks),
                    'entities': len(merged_data["entities"]),
                    'relationships': len(merged_data["relationships"])
                }
            })
        else:
            return jsonify({'success': False, 'error': 'Failed to store in graph'})
    
    except Exception as e:
        logging.error(f"Error processing upload: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/query', methods=['POST'])
def process_query():
    """Handle natural language queries"""
    try:
        data = request.get_json()
        question = data.get('question', '').strip()
        
        if not question:
            return jsonify({'success': False, 'error': 'No question provided'})
        
        # Process query
        result = query_engine.query_graph(question)
        
        return jsonify({
            'success': True,
            'result': result
        })
    
    except Exception as e:
        logging.error(f"Error processing query: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/search', methods=['POST'])
def search_entities():
    """Search for entities in the graph"""
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        
        if not query:
            return jsonify({'success': False, 'error': 'No search query provided'})
        
        results = graph_manager.search_entities(query)
        
        return jsonify({
            'success': True,
            'results': results
        })
    
    except Exception as e:
        logging.error(f"Error searching entities: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/stats')
def get_stats():
    """Get graph statistics"""
    try:
        stats = graph_manager.get_graph_stats()
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        logging.error(f"Error getting stats: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/clear', methods=['POST'])
def clear_graph():
    """Clear all graph data"""
    try:
        graph_manager.clear_graph()
        return jsonify({'success': True, 'message': 'Graph cleared successfully'})
    except Exception as e:
        logging.error(f"Error clearing graph: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/graph')
def graph_page():
    """Interactive graph visualization page"""
    return render_template('graph.html')

@app.route('/api/graph-data')
def get_graph_data():
    """Get graph data for visualization (nodes and links)"""
    try:
        with graph_manager.driver.session(database=graph_manager.database) as session:
            # Get all nodes with their properties
            nodes_query = """
            MATCH (n)
            RETURN id(n) as id, n.name as name, labels(n)[0] as type, 
                   n.description as description, properties(n) as properties
            """
            nodes_result = session.run(nodes_query)
            
            nodes = []
            node_map = {}  # Map Neo4j IDs to array indices
            
            for i, record in enumerate(nodes_result):
                node = {
                    'id': str(record['id']),
                    'name': record['name'] or f"Node {record['id']}",
                    'type': record['type'] or 'Unknown',
                    'description': record['description'] or '',
                    'properties': dict(record['properties']) if record['properties'] else {}
                }
                nodes.append(node)
                node_map[record['id']] = i
            
            # Get all relationships
            links_query = """
            MATCH (source)-[r]->(target)
            RETURN id(source) as source_id, id(target) as target_id, 
                   type(r) as relationship, r.description as description,
                   properties(r) as properties
            """
            links_result = session.run(links_query)
            
            links = []
            for record in links_result:
                link = {
                    'source': str(record['source_id']),
                    'target': str(record['target_id']),
                    'relationship': record['relationship'],
                    'description': record['description'] or '',
                    'properties': dict(record['properties']) if record['properties'] else {}
                }
                links.append(link)
            
            return jsonify({
                'success': True,
                'nodes': nodes,
                'links': links,
                'stats': {
                    'node_count': len(nodes),
                    'link_count': len(links)
                }
            })
            
    except Exception as e:
        logging.error(f"Error getting graph data: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.errorhandler(413)
def too_large(e):
    return jsonify({'success': False, 'error': 'File too large. Maximum size is 100MB.'}), 413

@app.errorhandler(500)
def server_error(e):
    return jsonify({'success': False, 'error': 'Internal server error.'}), 500

if __name__ == '__main__':
    if initialize_components():
        app.run(debug=Config.FLASK_DEBUG, host='0.0.0.0', port=5000)
    else:
        print("Failed to initialize components. Please check your configuration.")