"""
Application configuration using Pydantic Settings.
Loads from environment variables and .env file.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    
    # API Keys (can be updated at runtime via /api/keys)
    gemini_api_key: str = ""
    mineru_api_key: str = ""
    
    # MinerU Cloud API base URL
    mineru_api_base: str = "https://mineru.net/api/v4"
    
    # MinerU Local API URL (if running locally via Docker or pip)
    mineru_local_url: str = ""
    
    # Rate limiting
    gemini_rpm_limit: int = 15  # Requests per minute for free tier
    
    # Auth — optional API key to protect the backend
    api_key: str = ""
    
    # CORS — comma-separated allowed origins
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:1420,http://127.0.0.1:1420,tauri://localhost"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


def get_settings() -> Settings:
    """Get settings instance. Created fresh each time for development."""
    return Settings()


# Global settings instance (created on import)
settings = get_settings()


def update_api_keys(gemini_key: str | None = None, mineru_key: str | None = None):
    """Update API keys at runtime."""
    global settings
    if gemini_key is not None:
        settings.gemini_api_key = gemini_key
    if mineru_key is not None:
        settings.mineru_api_key = mineru_key
