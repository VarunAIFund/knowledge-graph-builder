import os
import requests
import tiktoken
from bs4 import BeautifulSoup
from typing import List, Tuple
import logging
from urllib.parse import urlparse
from config import Config

class DocumentProcessor:
    def __init__(self):
        self.encoding = tiktoken.get_encoding("cl100k_base")
        self.chunk_size = Config.CHUNK_SIZE
        self.chunk_overlap = Config.CHUNK_OVERLAP
        self.max_file_size = Config.MAX_FILE_SIZE
        
    def ingest_document(self, source: str) -> List[Tuple[str, str, str]]:
        """
        Process document from file path or URL
        Returns: List of (chunk_text, source, chunk_id) tuples
        """
        try:
            if self._is_url(source):
                text = self._extract_text_from_url(source)
                source_type = "url"
            else:
                text = self._extract_text_from_file(source)
                source_type = "file"
            
            chunks = self._chunk_text(text)
            
            return [(chunk, source, f"{source_type}_{i}") for i, chunk in enumerate(chunks)]
        
        except Exception as e:
            logging.error(f"Error processing document {source}: {str(e)}")
            raise
    
    def _is_url(self, source: str) -> bool:
        """Check if source is a URL"""
        try:
            result = urlparse(source)
            return all([result.scheme, result.netloc])
        except Exception:
            return False
    
    def _extract_text_from_url(self, url: str) -> str:
        """Extract clean text from URL using BeautifulSoup"""
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            
            # Check content length
            content_length = len(response.content)
            if content_length > self.max_file_size:
                raise ValueError(f"Content too large: {content_length} bytes exceeds {self.max_file_size} bytes")
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Remove script and style elements
            for script in soup(["script", "style", "nav", "footer", "header", "aside"]):
                script.decompose()
            
            # Extract text from main content areas
            main_content = soup.find('main') or soup.find('article') or soup.find('div', class_='content') or soup.body
            
            if main_content:
                text = main_content.get_text()
            else:
                text = soup.get_text()
            
            # Clean up text
            lines = (line.strip() for line in text.splitlines())
            text = '\n'.join(line for line in lines if line)
            
            return text
        
        except Exception as e:
            logging.error(f"Error extracting text from URL {url}: {str(e)}")
            raise
    
    def _extract_text_from_file(self, file_path: str) -> str:
        """Extract text from file"""
        try:
            # Check file size
            file_size = os.path.getsize(file_path)
            if file_size > self.max_file_size:
                raise ValueError(f"File too large: {file_size} bytes exceeds {self.max_file_size} bytes")
            
            # For now, only handle text files
            with open(file_path, 'r', encoding='utf-8') as f:
                text = f.read()
            
            return text
        
        except Exception as e:
            logging.error(f"Error reading file {file_path}: {str(e)}")
            raise
    
    def _chunk_text(self, text: str) -> List[str]:
        """
        Split text into chunks with overlap using tiktoken for accurate token counting
        """
        tokens = self.encoding.encode(text)
        chunks = []
        
        start = 0
        while start < len(tokens):
            end = min(start + self.chunk_size, len(tokens))
            
            chunk_tokens = tokens[start:end]
            chunk_text = self.encoding.decode(chunk_tokens)
            
            chunks.append(chunk_text)
            
            # Move start position considering overlap
            if end == len(tokens):
                break
            
            start = end - self.chunk_overlap
        
        return chunks
    
    def get_chunk_info(self, text: str) -> dict:
        """Get information about how text would be chunked"""
        tokens = self.encoding.encode(text)
        num_chunks = max(1, (len(tokens) + self.chunk_size - 1) // self.chunk_size)
        
        return {
            'total_tokens': len(tokens),
            'estimated_chunks': num_chunks,
            'chunk_size': self.chunk_size,
            'overlap': self.chunk_overlap
        }