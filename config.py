import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
    NEO4J_URI = os.getenv('NEO4J_URI')
    NEO4J_USERNAME = os.getenv('NEO4J_USERNAME')
    NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD')
    NEO4J_DATABASE = os.getenv('NEO4J_DATABASE')
    
    CHUNK_SIZE = 800
    CHUNK_OVERLAP = 100
    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
    
    FLASK_SECRET_KEY = os.getenv('FLASK_SECRET_KEY', 'dev-key-change-in-production')
    FLASK_DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'