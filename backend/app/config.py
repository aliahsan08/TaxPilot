import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    # Load settings from .env file
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # FastAPI Server Settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = Field(False, description="Enable debug mode. Must be False in production.")

    # Supabase Connection details
    DATABASE_URL: str = Field(..., description="PostgreSQL connection string for Supabase")
    SUPABASE_URL: str = Field("https://hqxxyiobvjizfvhosjch.supabase.co", description="Supabase API URL")
    SUPABASE_ANON_KEY: str = Field(..., description="Supabase client anonymous public key")

    # Qdrant Vector DB Settings
    QDRANT_HOST: str = Field(..., description="Qdrant connection host")
    QDRANT_PORT: int = 6333
    QDRANT_API_KEY: str = Field("", description="Qdrant auth key if hosted on Cloud")
    QDRANT_COLLECTION: str = "taxpilot_docs"

    # LLM Settings
    LLM_API_KEY: str = Field(..., description="LLM API Key (e.g. Groq)")

# Initialize singleton settings
settings = Settings()
