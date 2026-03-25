import json
import logging
import time
from typing import Dict, List, Any, Optional
from openai import OpenAI
from graph_manager import GraphManager
from config import Config

class QueryEngine:
    def __init__(self, graph_manager: GraphManager):
        self.client = OpenAI(api_key=Config.OPENAI_API_KEY)
        self.graph_manager = graph_manager
        self.model = "gpt-3.5-turbo"
        self.rate_limit_delay = 1
    
    def query_graph(self, natural_language_question: str) -> Dict[str, Any]:
        """
        Answer natural language questions using the knowledge graph
        """
        try:
            # Step 1: Analyze the question and extract key entities/concepts
            entities = self._extract_query_entities(natural_language_question)
            
            # Step 2: Retrieve relevant context from the graph
            context = self._retrieve_graph_context(entities, natural_language_question)
            
            # Step 3: Generate answer using GPT with graph context
            answer = self._generate_answer(natural_language_question, context)
            
            return {
                "question": natural_language_question,
                "answer": answer,
                "context": context,
                "entities": entities
            }
            
        except Exception as e:
            logging.error(f"Error processing query: {str(e)}")
            return {
                "question": natural_language_question,
                "answer": "I encountered an error while processing your question. Please try again.",
                "context": {},
                "entities": []
            }
    
    def _extract_query_entities(self, question: str) -> List[str]:
        """Extract key entities/concepts from the question"""
        try:
            time.sleep(self.rate_limit_delay)
            
            prompt = f"""
            Analyze the following question and extract the key entities, concepts, or names that would be relevant for searching a knowledge graph.
            
            Question: {question}
            
            Return only the key terms as a JSON list of strings. Focus on:
            - Proper names (people, organizations, locations)
            - Products or services
            - Key concepts or topics
            
            Example: ["Apple", "iPhone", "Steve Jobs"]
            """
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that extracts key entities from questions for knowledge graph search."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=200
            )
            
            content = response.choices[0].message.content.strip()
            entities = json.loads(content)
            
            return entities if isinstance(entities, list) else []
            
        except Exception as e:
            logging.error(f"Error extracting query entities: {str(e)}")
            # Fallback: simple keyword extraction
            words = question.split()
            return [word.strip('.,!?').title() for word in words if len(word) > 3]
    
    def _retrieve_graph_context(self, entities: List[str], question: str) -> Dict[str, Any]:
        """Retrieve relevant context from the knowledge graph"""
        context = {
            "entities": [],
            "relationships": [],
            "paths": []
        }
        
        try:
            # Search for each entity
            for entity in entities:
                # Direct entity search
                search_results = self.graph_manager.search_entities(entity, limit=5)
                context["entities"].extend(search_results)
                
                # Get relationships for found entities
                for result in search_results:
                    if result["name"]:
                        rel_info = self.graph_manager.get_entity_relationships(result["name"])
                        if rel_info["relationships"]:
                            context["relationships"].extend(rel_info["relationships"])
            
            # Find paths between entities if multiple entities found
            unique_entities = list(set([e["name"] for e in context["entities"]]))
            if len(unique_entities) >= 2:
                for i in range(len(unique_entities)):
                    for j in range(i + 1, min(i + 3, len(unique_entities))):  # Limit path searches
                        paths = self.graph_manager.find_path(unique_entities[i], unique_entities[j])
                        context["paths"].extend(paths)
            
            # Remove duplicates
            context["entities"] = self._deduplicate_list(context["entities"], "name")
            context["relationships"] = self._deduplicate_relationships(context["relationships"])
            
            return context
            
        except Exception as e:
            logging.error(f"Error retrieving graph context: {str(e)}")
            return context
    
    def _deduplicate_list(self, items: List[Dict], key: str) -> List[Dict]:
        """Remove duplicate items based on a key"""
        seen = set()
        result = []
        for item in items:
            if item.get(key) and item[key] not in seen:
                seen.add(item[key])
                result.append(item)
        return result
    
    def _deduplicate_relationships(self, relationships: List[Dict]) -> List[Dict]:
        """Remove duplicate relationships"""
        seen = set()
        result = []
        for rel in relationships:
            key = (rel.get("entity", ""), rel.get("connected_entity", ""), rel.get("relationship", ""))
            if key not in seen:
                seen.add(key)
                result.append(rel)
        return result
    
    def _generate_answer(self, question: str, context: Dict[str, Any]) -> str:
        """Generate answer using GPT with graph context"""
        try:
            time.sleep(self.rate_limit_delay)
            
            # Format context for GPT
            context_text = self._format_context(context)
            
            prompt = f"""
            Answer the following question using the provided knowledge graph context. 
            Be comprehensive but concise, and cite specific relationships and entities when relevant.
            If the context doesn't contain enough information to answer the question, say so honestly.
            
            Question: {question}
            
            Knowledge Graph Context:
            {context_text}
            
            Instructions:
            - Use the entities and relationships provided to answer the question
            - Include specific names, relationships, and details from the context
            - If there are multiple relevant entities or relationships, mention them
            - End with source attribution when possible
            - If the context is insufficient, explain what information would be needed
            """
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a knowledgeable assistant that answers questions using knowledge graph data. Provide accurate, well-sourced answers."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                max_tokens=500
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logging.error(f"Error generating answer: {str(e)}")
            return "I encountered an error while generating the answer. Please try again."
    
    def _format_context(self, context: Dict[str, Any]) -> str:
        """Format context data for GPT prompt"""
        formatted = []
        
        # Format entities
        if context["entities"]:
            formatted.append("ENTITIES:")
            for entity in context["entities"][:10]:  # Limit to avoid token overflow
                formatted.append(f"- {entity['name']} ({entity['type']}): {entity.get('description', 'No description')}")
            formatted.append("")
        
        # Format relationships
        if context["relationships"]:
            formatted.append("RELATIONSHIPS:")
            for rel in context["relationships"][:15]:  # Limit to avoid token overflow
                formatted.append(f"- {rel['entity']} -> {rel['relationship']} -> {rel['connected_entity']}")
                if rel.get('rel_description'):
                    formatted.append(f"  Description: {rel['rel_description']}")
            formatted.append("")
        
        # Format paths
        if context["paths"]:
            formatted.append("CONNECTION PATHS:")
            for path in context["paths"][:5]:  # Limit to avoid token overflow
                nodes_str = " -> ".join(path["nodes"])
                formatted.append(f"- {nodes_str} (length: {path['length']})")
            formatted.append("")
        
        return "\n".join(formatted)
    
    def get_suggestions(self, partial_question: str) -> List[str]:
        """Get question suggestions based on available graph data"""
        try:
            # Get some graph statistics to suggest questions
            stats = self.graph_manager.get_graph_stats()
            
            suggestions = []
            
            # Add general suggestions based on available entity types
            if "Person" in stats.get("node_counts", {}):
                suggestions.append("Who are the key people mentioned in the documents?")
                suggestions.append("What relationships exist between different people?")
            
            if "Organization" in stats.get("node_counts", {}):
                suggestions.append("What organizations are discussed?")
                suggestions.append("Which companies are mentioned and what do they do?")
            
            if "Product" in stats.get("node_counts", {}):
                suggestions.append("What products or services are mentioned?")
                suggestions.append("How are different products related?")
            
            if "Location" in stats.get("node_counts", {}):
                suggestions.append("What locations are important in the content?")
                suggestions.append("Where are different organizations located?")
            
            # Add relationship-based suggestions
            if stats.get("relationship_types"):
                top_relationships = stats["relationship_types"][:3]
                for rel_type in top_relationships:
                    suggestions.append(f"Tell me about {rel_type['relationship_type'].lower()} relationships in the data")
            
            return suggestions[:8]  # Return top 8 suggestions
            
        except Exception as e:
            logging.error(f"Error getting suggestions: {str(e)}")
            return ["What information is available in the knowledge graph?"]