import logging
from typing import List, Dict, Any
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer
from app.config import settings

logger = logging.getLogger(__name__)

class QdrantService:
    """
    Service wrapper for managing connections and queries to the Qdrant vector database.
    """
    def __init__(self):
        self.enabled = False
        self.client = None
        self.encoder = None

        try:
            logger.info("Initializing local SentenceTransformer model (all-MiniLM-L6-v2)...")
            self.encoder = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Embedding encoder initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize sentence transformer: {e}")
            raise RuntimeError(f"Embedding encoder initialization failed: {e}") from e

        try:
            if settings.QDRANT_HOST:
                host = settings.QDRANT_HOST
                if not (host.startswith("http://") or host.startswith("https://")):
                    url = f"http://{host}:{settings.QDRANT_PORT}"
                else:
                    url = host
                logger.info(f"Connecting to Qdrant at {url}...")
                self.client = QdrantClient(
                    url=url,
                    api_key=settings.QDRANT_API_KEY if settings.QDRANT_API_KEY else None,
                    timeout=5.0
                )
                self.enabled = True
                logger.info("Successfully connected to Qdrant client.")
            else:
                raise ValueError("QDRANT_HOST setting is not configured.")
        except Exception as e:
            logger.error(f"Failed to connect to Qdrant: {e}")
            raise ConnectionError(f"Qdrant connection failed: {e}") from e

    def search_documents(self, query: str, limit: int = 4) -> List[Dict[str, Any]]:
        """
        Embeds a search query and queries Qdrant to retrieve semantically relevant context chunks.

        Args:
            query: The text search query from the user.
            limit: The maximum number of relevant documents to return.

        Returns:
            A list of dictionary mappings representing retrieved document metadata and content.
        """
        if not self.enabled or not self.client or not self.encoder:
            raise ConnectionError("Qdrant service is disabled or client is not connected.")

        try:
            collections = self.client.get_collections()
            collection_names = [c.name for c in collections.collections]
            
            if settings.QDRANT_COLLECTION not in collection_names:
                raise KeyError(f"Collection '{settings.QDRANT_COLLECTION}' not found in Qdrant database.")

            query_vector = self.encoder.encode(query).tolist()
            
            results = self.client.search(
                collection_name=settings.QDRANT_COLLECTION,
                query_vector=query_vector,
                limit=limit
            )
            
            hits = []
            for hit in results:
                payload = hit.payload or {}
                hits.append({
                    "content": payload.get("content", ""),
                    "source": payload.get("source", "FBR Document"),
                    "section": payload.get("section", "General Guidelines"),
                    "score": hit.score
                })
            return hits
            
        except Exception as e:
            logger.error(f"Error during Qdrant search: {e}")
            raise RuntimeError(f"Qdrant search query failed: {e}") from e
