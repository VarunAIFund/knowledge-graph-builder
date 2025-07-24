import logging
import logging.handlers
import os
from datetime import datetime

def setup_logging():
    """Configure comprehensive logging for the application"""
    
    # Create logs directory if it doesn't exist
    log_dir = 'logs'
    os.makedirs(log_dir, exist_ok=True)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    # Clear any existing handlers
    root_logger.handlers.clear()
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)
    
    # File handler for all logs
    file_handler = logging.handlers.RotatingFileHandler(
        filename=os.path.join(log_dir, 'knowledge_graph.log'),
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
    )
    file_handler.setFormatter(file_formatter)
    root_logger.addHandler(file_handler)
    
    # Error file handler
    error_handler = logging.handlers.RotatingFileHandler(
        filename=os.path.join(log_dir, 'errors.log'),
        maxBytes=5*1024*1024,  # 5MB
        backupCount=3,
        encoding='utf-8'
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(file_formatter)
    root_logger.addHandler(error_handler)
    
    # API calls handler for monitoring OpenAI usage
    api_logger = logging.getLogger('api_calls')
    api_handler = logging.handlers.RotatingFileHandler(
        filename=os.path.join(log_dir, 'api_calls.log'),
        maxBytes=5*1024*1024,  # 5MB
        backupCount=3,
        encoding='utf-8'
    )
    api_formatter = logging.Formatter(
        '%(asctime)s - %(message)s'
    )
    api_handler.setFormatter(api_formatter)
    api_logger.addHandler(api_handler)
    api_logger.setLevel(logging.INFO)
    
    logging.info("Logging system initialized successfully")

class RateLimiter:
    """Simple rate limiter for API calls"""
    
    def __init__(self, max_requests_per_minute=60):
        self.max_requests = max_requests_per_minute
        self.requests = []
        self.logger = logging.getLogger(__name__)
    
    def wait_if_needed(self):
        """Wait if rate limit would be exceeded"""
        import time
        
        now = time.time()
        # Remove requests older than 1 minute
        self.requests = [req_time for req_time in self.requests if now - req_time < 60]
        
        if len(self.requests) >= self.max_requests:
            # Wait until the oldest request is over 1 minute old
            oldest_request = min(self.requests)
            wait_time = 60 - (now - oldest_request) + 1  # Add 1 second buffer
            if wait_time > 0:
                self.logger.info(f"Rate limit reached. Waiting {wait_time:.2f} seconds")
                time.sleep(wait_time)
        
        self.requests.append(now)

class ErrorHandler:
    """Centralized error handling and reporting"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
    
    def handle_document_processing_error(self, source, error):
        """Handle document processing errors"""
        error_msg = f"Document processing failed for {source}: {str(error)}"
        self.logger.error(error_msg, exc_info=True)
        return {
            "success": False,
            "error": f"Failed to process document: {str(error)}",
            "source": source
        }
    
    def handle_knowledge_extraction_error(self, chunk_id, error):
        """Handle knowledge extraction errors"""
        error_msg = f"Knowledge extraction failed for chunk {chunk_id}: {str(error)}"
        self.logger.error(error_msg, exc_info=True)
        return {
            "entities": [],
            "relationships": [],
            "error": str(error)
        }
    
    def handle_graph_storage_error(self, error):
        """Handle graph storage errors"""
        error_msg = f"Graph storage failed: {str(error)}"
        self.logger.error(error_msg, exc_info=True)
        return {
            "success": False,
            "error": f"Failed to store in graph: {str(error)}"
        }
    
    def handle_query_error(self, query, error):
        """Handle query processing errors"""
        error_msg = f"Query processing failed for '{query}': {str(error)}"
        self.logger.error(error_msg, exc_info=True)
        return {
            "question": query,
            "answer": "I encountered an error while processing your question. Please try again or rephrase your query.",
            "context": {},
            "entities": [],
            "error": str(error)
        }
    
    def handle_api_error(self, api_name, error):
        """Handle API errors (OpenAI, Neo4j)"""
        error_msg = f"{api_name} API error: {str(error)}"
        self.logger.error(error_msg, exc_info=True)
        
        # Log API errors separately for monitoring
        api_logger = logging.getLogger('api_calls')
        api_logger.error(f"{api_name} - ERROR - {str(error)}")
        
        return {
            "success": False,
            "error": f"{api_name} service temporarily unavailable. Please try again later."
        }

def log_api_call(service, operation, details=None):
    """Log API calls for monitoring and debugging"""
    api_logger = logging.getLogger('api_calls')
    message = f"{service} - {operation}"
    if details:
        message += f" - {details}"
    api_logger.info(message)

def validate_environment():
    """Validate that all required environment variables are set"""
    from config import Config
    
    required_vars = {
        'OPENAI_API_KEY': Config.OPENAI_API_KEY,
        'NEO4J_URI': Config.NEO4J_URI,
        'NEO4J_USERNAME': Config.NEO4J_USERNAME,
        'NEO4J_PASSWORD': Config.NEO4J_PASSWORD,
        'NEO4J_DATABASE': Config.NEO4J_DATABASE
    }
    
    missing_vars = []
    for var_name, var_value in required_vars.items():
        if not var_value:
            missing_vars.append(var_name)
    
    if missing_vars:
        error_msg = f"Missing required environment variables: {', '.join(missing_vars)}"
        logging.error(error_msg)
        raise ValueError(error_msg)
    
    logging.info("Environment validation successful")
    return True