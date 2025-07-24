import logging
from typing import Dict, List, Any, Optional
from neo4j import GraphDatabase
from config import Config

class GraphManager:
    def __init__(self):
        self.uri = Config.NEO4J_URI
        self.username = Config.NEO4J_USERNAME
        self.password = Config.NEO4J_PASSWORD
        self.database = Config.NEO4J_DATABASE
        self.driver = None
        self._connect()
    
    def _connect(self):
        """Connect to Neo4j database"""
        try:
            self.driver = GraphDatabase.driver(
                self.uri,
                auth=(self.username, self.password)
            )
            # Verify connection
            self.driver.verify_connectivity()
            logging.info("Successfully connected to Neo4j")
            
            # Create indexes for better performance
            self._create_indexes()
            
        except Exception as e:
            logging.error(f"Failed to connect to Neo4j: {str(e)}")
            raise
    
    def _create_indexes(self):
        """Create indexes for entity names and full-text search"""
        with self.driver.session(database=self.database) as session:
            try:
                # Create indexes for entity types
                entity_types = ["Person", "Organization", "Location", "Product", "Concept"]
                for entity_type in entity_types:
                    session.run(f"CREATE INDEX IF NOT EXISTS FOR (n:{entity_type}) ON (n.name)")
                
                # Create full-text search index
                session.run("""
                    CREATE FULLTEXT INDEX entity_search IF NOT EXISTS
                    FOR (n:Person|Organization|Location|Product|Concept)
                    ON EACH [n.name, n.description]
                """)
                
                logging.info("Database indexes created successfully")
                
            except Exception as e:
                logging.warning(f"Error creating indexes: {str(e)}")
    
    def store_in_graph(self, entities: List[Dict[str, Any]], relationships: List[Dict[str, Any]]) -> bool:
        """Store entities and relationships in Neo4j graph"""
        try:
            with self.driver.session(database=self.database) as session:
                # Store entities
                for entity in entities:
                    self._create_entity(session, entity)
                
                # Store relationships
                for relationship in relationships:
                    self._create_relationship(session, relationship)
                
                logging.info(f"Stored {len(entities)} entities and {len(relationships)} relationships")
                return True
                
        except Exception as e:
            logging.error(f"Error storing data in graph: {str(e)}")
            return False
    
    def _create_entity(self, session, entity: Dict[str, Any]):
        """Create or update an entity node"""
        entity_type = entity["type"]
        name = entity["name"]
        description = entity.get("description", "")
        properties = entity.get("properties", {})
        
        # Prepare properties for Cypher
        cypher_props = {
            "name": name,
            "description": description,
            **properties
        }
        
        query = f"""
        MERGE (e:{entity_type} {{name: $name}})
        SET e += $props
        """
        
        session.run(query, name=name, props=cypher_props)
    
    def _create_relationship(self, session, relationship: Dict[str, Any]):
        """Create relationship between entities"""
        source = relationship["source"]
        target = relationship["target"]
        rel_type = relationship["relationship"].upper().replace(" ", "_").replace("-", "_")
        description = relationship.get("description", "")
        properties = relationship.get("properties", {})
        
        # Prepare properties for Cypher
        cypher_props = {
            "description": description,
            **properties
        }
        
        query = f"""
        MATCH (source) WHERE source.name = $source_name
        MATCH (target) WHERE target.name = $target_name
        MERGE (source)-[r:{rel_type}]->(target)
        SET r += $props
        """
        
        session.run(query, source_name=source, target_name=target, props=cypher_props)
    
    def search_entities(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search for entities using full-text search"""
        try:
            with self.driver.session(database=self.database) as session:
                cypher_query = """
                CALL db.index.fulltext.queryNodes('entity_search', $query)
                YIELD node, score
                RETURN node.name as name, labels(node)[0] as type, 
                       node.description as description, score
                ORDER BY score DESC
                LIMIT $limit
                """
                
                result = session.run(cypher_query, {"query": query, "limit": limit})
                return [dict(record) for record in result]
                
        except Exception as e:
            logging.error(f"Error searching entities: {str(e)}")
            return []
    
    def get_entity_relationships(self, entity_name: str) -> Dict[str, Any]:
        """Get all relationships for a specific entity"""
        try:
            with self.driver.session(database=self.database) as session:
                query = """
                MATCH (e {name: $name})-[r]-(connected)
                RETURN e.name as entity, labels(e)[0] as entity_type,
                       type(r) as relationship, r.description as rel_description,
                       connected.name as connected_entity, labels(connected)[0] as connected_type,
                       startNode(r).name = e.name as outgoing
                """
                
                result = session.run(query, name=entity_name)
                relationships = []
                
                for record in result:
                    relationships.append({
                        "entity": record["entity"],
                        "entity_type": record["entity_type"],
                        "relationship": record["relationship"],
                        "rel_description": record["rel_description"],
                        "connected_entity": record["connected_entity"],
                        "connected_type": record["connected_type"],
                        "outgoing": record["outgoing"]
                    })
                
                return {
                    "entity": entity_name,
                    "relationships": relationships
                }
                
        except Exception as e:
            logging.error(f"Error getting entity relationships: {str(e)}")
            return {"entity": entity_name, "relationships": []}
    
    def find_path(self, source_entity: str, target_entity: str, max_hops: int = 3) -> List[Dict[str, Any]]:
        """Find shortest path between two entities"""
        try:
            with self.driver.session(database=self.database) as session:
                query = f"""
                MATCH (source {{name: $source}}), (target {{name: $target}})
                MATCH path = shortestPath((source)-[*1..{max_hops}]-(target))
                RETURN path
                LIMIT 5
                """
                
                result = session.run(query, source=source_entity, target=target_entity)
                paths = []
                
                for record in result:
                    path = record["path"]
                    path_info = {
                        "nodes": [node["name"] for node in path.nodes],
                        "relationships": [rel.type for rel in path.relationships],
                        "length": len(path.relationships)
                    }
                    paths.append(path_info)
                
                return paths
                
        except Exception as e:
            logging.error(f"Error finding path: {str(e)}")
            return []
    
    def get_graph_stats(self) -> Dict[str, Any]:
        """Get statistics about the graph"""
        try:
            with self.driver.session(database=self.database) as session:
                # Count nodes by type
                node_counts = {}
                entity_types = ["Person", "Organization", "Location", "Product", "Concept"]
                
                for entity_type in entity_types:
                    result = session.run(f"MATCH (n:{entity_type}) RETURN count(n) as count")
                    count = result.single()["count"]
                    if count > 0:
                        node_counts[entity_type] = count
                
                # Count relationships
                result = session.run("MATCH ()-[r]->() RETURN count(r) as count")
                relationship_count = result.single()["count"]
                
                # Get relationship types
                result = session.run("""
                    MATCH ()-[r]->()
                    RETURN type(r) as relationship_type, count(r) as count
                    ORDER BY count DESC
                """)
                relationship_types = [dict(record) for record in result]
                
                return {
                    "node_counts": node_counts,
                    "total_nodes": sum(node_counts.values()),
                    "total_relationships": relationship_count,
                    "relationship_types": relationship_types
                }
                
        except Exception as e:
            logging.error(f"Error getting graph stats: {str(e)}")
            return {}
    
    def clear_graph(self):
        """Clear all data from the graph (use with caution)"""
        try:
            with self.driver.session(database=self.database) as session:
                session.run("MATCH (n) DETACH DELETE n")
                logging.info("Graph cleared successfully")
                
        except Exception as e:
            logging.error(f"Error clearing graph: {str(e)}")
    
    def close(self):
        """Close database connection"""
        if self.driver:
            self.driver.close()
            logging.info("Neo4j connection closed")
    
    def __del__(self):
        """Cleanup when object is destroyed"""
        self.close()