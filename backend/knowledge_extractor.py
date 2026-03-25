import json
import logging
import time
from typing import Dict, List, Any
from openai import OpenAI
from config import Config

class KnowledgeExtractor:
    def __init__(self):
        self.client = OpenAI(api_key=Config.OPENAI_API_KEY)
        self.model = "gpt-3.5-turbo"
        self.rate_limit_delay = 1  # seconds between API calls
        
    def extract_knowledge(self, text_chunk: str, source: str, chunk_id: str) -> Dict[str, Any]:
        """
        Extract entities and relationships from text chunk using GPT
        Returns structured data for graph storage
        """
        try:
            # Add rate limiting
            time.sleep(self.rate_limit_delay)
            
            prompt = self._create_extraction_prompt(text_chunk)
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_system_prompt()},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=4000
            )
            
            content = response.choices[0].message.content
            logging.debug(f"GPT response for chunk {chunk_id}: {content[:200]}...")
            
            # Try to clean the content in case there are extra characters
            content = content.strip()
            if content.startswith('```json'):
                content = content[7:]
            if content.endswith('```'):
                content = content[:-3]
            content = content.strip()
            
            extracted_data = json.loads(content)
            
            # Validate the extracted data structure
            if not isinstance(extracted_data, dict):
                logging.error(f"GPT response is not a dictionary: {type(extracted_data)}")
                return self._create_empty_extraction()
            
            if "entities" not in extracted_data or "relationships" not in extracted_data:
                logging.error(f"GPT response missing required keys: {extracted_data.keys()}")
                return self._create_empty_extraction()
            
            logging.info(f"Successfully extracted {len(extracted_data.get('entities', []))} entities and {len(extracted_data.get('relationships', []))} relationships from chunk {chunk_id}")
            
            # Add source information to all extracted elements
            self._add_source_info(extracted_data, source, chunk_id)
            
            return extracted_data
            
        except json.JSONDecodeError as e:
            logging.error(f"Failed to parse GPT response as JSON for chunk {chunk_id}: {str(e)}")
            logging.error(f"Raw response: {content}")
            return self._create_empty_extraction()
        except Exception as e:
            logging.error(f"Error in knowledge extraction for chunk {chunk_id}: {str(e)}")
            return self._create_empty_extraction()
    
    def _get_system_prompt(self) -> str:
        """System prompt for knowledge extraction"""
        return """You are an expert knowledge extraction system. Extract entities and relationships from text to build a knowledge graph.

CRITICAL: Return ONLY valid JSON. No explanations, no markdown formatting, no extra text.

Extract these entity types:
- Person: People mentioned in the text
- Organization: Companies, institutions, organizations  
- Location: Cities, countries, addresses, places
- Product: Products, services, technologies
- Concept: Ideas, concepts, topics, fields of study

For relationships, use these common types:
- founded, co_founded, works_for, leads, owns
- located_in, headquartered_in, based_in
- produces, develops, creates, invented
- studied_at, worked_at, collaborated_with

Return ONLY this JSON structure:
{
  "entities": [
    {
      "name": "exact entity name",
      "type": "Person",
      "description": "brief description"
    }
  ],
  "relationships": [
    {
      "source": "entity1 name",
      "target": "entity2 name",
      "relationship": "relationship_type",
      "description": "brief description"
    }
  ]
}

Extract all clear, factual information. Return ONLY valid JSON."""

    def _create_extraction_prompt(self, text_chunk: str) -> str:
        """Create extraction prompt for specific text chunk"""
        return f"""Extract entities and relationships from the following text:

TEXT:
{text_chunk}

Return the extracted knowledge as JSON following the specified format."""

    def _add_source_info(self, extracted_data: Dict[str, Any], source: str, chunk_id: str) -> None:
        """Add source information to extracted entities and relationships"""
        source_info = {
            "source": source,
            "chunk_id": chunk_id
        }
        
        # Add source info to entities
        for entity in extracted_data.get("entities", []):
            if "properties" not in entity:
                entity["properties"] = {}
            entity["properties"].update(source_info)
        
        # Add source info to relationships
        for relationship in extracted_data.get("relationships", []):
            if "properties" not in relationship:
                relationship["properties"] = {}
            relationship["properties"].update(source_info)
    
    def _create_empty_extraction(self) -> Dict[str, Any]:
        """Create empty extraction result on error"""
        return {
            "entities": [],
            "relationships": []
        }
    
    def validate_extraction(self, extracted_data: Dict[str, Any]) -> bool:
        """Validate the structure of extracted data"""
        try:
            required_keys = ["entities", "relationships"]
            if not all(key in extracted_data for key in required_keys):
                return False
            
            # Validate entities
            for entity in extracted_data["entities"]:
                required_entity_keys = ["name", "type", "description"]
                if not all(key in entity for key in required_entity_keys):
                    return False
                
                valid_types = ["Person", "Organization", "Location", "Product", "Concept"]
                if entity["type"] not in valid_types:
                    return False
            
            # Validate relationships
            for rel in extracted_data["relationships"]:
                required_rel_keys = ["source", "target", "relationship", "description"]
                if not all(key in rel for key in required_rel_keys):
                    return False
            
            return True
            
        except Exception as e:
            logging.error(f"Error validating extraction: {str(e)}")
            return False
    
    def merge_extractions(self, extractions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge multiple extraction results, removing duplicates"""
        merged_entities = []
        merged_relationships = []
        
        seen_entities = set()
        seen_relationships = set()
        
        for extraction in extractions:
            # Merge entities
            for entity in extraction.get("entities", []):
                entity_key = (entity["name"].lower(), entity["type"])
                if entity_key not in seen_entities:
                    merged_entities.append(entity)
                    seen_entities.add(entity_key)
            
            # Merge relationships
            for rel in extraction.get("relationships", []):
                rel_key = (rel["source"].lower(), rel["target"].lower(), rel["relationship"].lower())
                if rel_key not in seen_relationships:
                    merged_relationships.append(rel)
                    seen_relationships.add(rel_key)
        
        return {
            "entities": merged_entities,
            "relationships": merged_relationships
        }