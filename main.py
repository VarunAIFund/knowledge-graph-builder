#!/usr/bin/env python3
"""
Knowledge Graph Builder - Main Application
Converts documents and URLs into an interactive knowledge graph using Neo4j and OpenAI GPT.
"""

import os
import sys
import logging
from pathlib import Path

# Add current directory to path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

from logging_config import setup_logging, validate_environment
from document_processor import DocumentProcessor
from knowledge_extractor import KnowledgeExtractor
from graph_manager import GraphManager
from query_engine import QueryEngine
from config import Config

class KnowledgeGraphBuilder:
    """Main application class that orchestrates all components"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.document_processor = None
        self.knowledge_extractor = None
        self.graph_manager = None
        self.query_engine = None
        
    def initialize(self):
        """Initialize all system components"""
        try:
            self.logger.info("Initializing Knowledge Graph Builder...")
            
            # Validate environment
            validate_environment()
            
            # Initialize components
            self.graph_manager = GraphManager()
            self.document_processor = DocumentProcessor()
            self.knowledge_extractor = KnowledgeExtractor()
            self.query_engine = QueryEngine(self.graph_manager)
            
            self.logger.info("All components initialized successfully")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to initialize system: {str(e)}", exc_info=True)
            return False
    
    def process_document(self, source):
        """Process a document and add to knowledge graph"""
        try:
            self.logger.info(f"Processing document: {source}")
            
            # Step 1: Process document into chunks
            chunks = self.document_processor.ingest_document(source)
            self.logger.info(f"Document processed into {len(chunks)} chunks")
            
            # Step 2: Extract knowledge from each chunk
            all_entities = []
            all_relationships = []
            
            for i, (chunk_text, chunk_source, chunk_id) in enumerate(chunks):
                self.logger.debug(f"Processing chunk {i+1}/{len(chunks)}: {chunk_id}")
                
                extracted_data = self.knowledge_extractor.extract_knowledge(
                    chunk_text, chunk_source, chunk_id
                )
                
                if self.knowledge_extractor.validate_extraction(extracted_data):
                    all_entities.extend(extracted_data.get("entities", []))
                    all_relationships.extend(extracted_data.get("relationships", []))
                else:
                    self.logger.warning(f"Invalid extraction data for chunk {chunk_id}")
            
            # Step 3: Merge and deduplicate
            merged_data = self.knowledge_extractor.merge_extractions([{
                "entities": all_entities,
                "relationships": all_relationships
            }])
            
            # Step 4: Store in graph
            success = self.graph_manager.store_in_graph(
                merged_data["entities"],
                merged_data["relationships"]
            )
            
            if success:
                self.logger.info(f"Successfully processed {source}: "
                               f"{len(merged_data['entities'])} entities, "
                               f"{len(merged_data['relationships'])} relationships")
                return {
                    "success": True,
                    "chunks": len(chunks),
                    "entities": len(merged_data["entities"]),
                    "relationships": len(merged_data["relationships"])
                }
            else:
                self.logger.error(f"Failed to store data in graph for {source}")
                return {"success": False, "error": "Failed to store in graph"}
                
        except Exception as e:
            self.logger.error(f"Error processing document {source}: {str(e)}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    def query_knowledge(self, question):
        """Query the knowledge graph with natural language"""
        try:
            self.logger.info(f"Processing query: {question}")
            result = self.query_engine.query_graph(question)
            self.logger.info("Query processed successfully")
            return result
            
        except Exception as e:
            self.logger.error(f"Error processing query: {str(e)}", exc_info=True)
            return {
                "question": question,
                "answer": "An error occurred while processing your question.",
                "context": {},
                "entities": [],
                "error": str(e)
            }
    
    def get_statistics(self):
        """Get knowledge graph statistics"""
        try:
            stats = self.graph_manager.get_graph_stats()
            self.logger.info("Retrieved graph statistics")
            return stats
            
        except Exception as e:
            self.logger.error(f"Error getting statistics: {str(e)}", exc_info=True)
            return {}
    
    def clear_graph(self):
        """Clear all data from the graph"""
        try:
            self.graph_manager.clear_graph()
            self.logger.info("Graph cleared successfully")
            return True
            
        except Exception as e:
            self.logger.error(f"Error clearing graph: {str(e)}", exc_info=True)
            return False
    
    def shutdown(self):
        """Cleanup resources"""
        try:
            if self.graph_manager:
                self.graph_manager.close()
            self.logger.info("System shutdown complete")
            
        except Exception as e:
            self.logger.error(f"Error during shutdown: {str(e)}", exc_info=True)

def main():
    """Command line interface for testing"""
    setup_logging()
    
    app = KnowledgeGraphBuilder()
    
    if not app.initialize():
        print("Failed to initialize system. Check logs for details.")
        return 1
    
    try:
        print("Knowledge Graph Builder - Command Line Interface")
        print("Commands: process <file/url>, query <question>, stats, clear, quit")
        
        while True:
            try:
                command = input("\n> ").strip().split(' ', 1)
                
                if not command[0]:
                    continue
                    
                if command[0] == 'quit':
                    break
                    
                elif command[0] == 'process' and len(command) > 1:
                    result = app.process_document(command[1])
                    if result["success"]:
                        print(f"Success! Processed {result['chunks']} chunks, "
                              f"extracted {result['entities']} entities, "
                              f"{result['relationships']} relationships")
                    else:
                        print(f"Error: {result.get('error', 'Unknown error')}")
                
                elif command[0] == 'query' and len(command) > 1:
                    result = app.query_knowledge(command[1])
                    print(f"Q: {result['question']}")
                    print(f"A: {result['answer']}")
                    
                elif command[0] == 'stats':
                    stats = app.get_statistics()
                    print(f"Entities: {stats.get('total_nodes', 0)}")
                    print(f"Relationships: {stats.get('total_relationships', 0)}")
                    if stats.get('node_counts'):
                        print("Entity types:")
                        for entity_type, count in stats['node_counts'].items():
                            print(f"  {entity_type}: {count}")
                
                elif command[0] == 'clear':
                    if input("Clear all graph data? (y/N): ").lower() == 'y':
                        if app.clear_graph():
                            print("Graph cleared successfully")
                        else:
                            print("Error clearing graph")
                
                else:
                    print("Invalid command. Available: process, query, stats, clear, quit")
                    
            except KeyboardInterrupt:
                print("\nUse 'quit' to exit.")
                continue
                
    finally:
        app.shutdown()
        print("Goodbye!")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())