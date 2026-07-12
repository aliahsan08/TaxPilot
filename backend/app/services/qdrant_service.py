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
        
        # Local BM25 cache & index
        self.docs_cache = []
        self.bm25 = None
        self.bm25_initialized = False

        try:
            logger.info("Initializing local SentenceTransformer model (all-MiniLM-L6-v2)...")
            self.encoder = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Embedding encoder initialized successfully.")
        except Exception as e:
            logger.warning(f"Failed to initialize sentence transformer during startup: {e}. Qdrant search will be disabled.")

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
                logger.warning("QDRANT_HOST is not configured. Qdrant service is disabled.")
        except Exception as e:
            logger.warning(f"Failed to connect to Qdrant during initialization: {e}. Qdrant service is disabled.")

    def _initialize_bm25(self):
        """
        Scrolls and caches all document payloads from Qdrant Cloud to build a local BM25 keyword index.
        """
        if not self.enabled or not self.client:
            return
        try:
            logger.info("Building in-memory document cache from Qdrant for BM25...")
            all_docs = []
            offset = None
            while True:
                res = self.client.scroll(
                    collection_name=settings.QDRANT_COLLECTION,
                    limit=100,
                    with_payload=True,
                    with_vectors=False,
                    offset=offset
                )
                points, next_offset = res
                for p in points:
                    payload = p.payload or {}
                    text = payload.get("text") or payload.get("content") or ""
                    document = payload.get("document") or payload.get("source") or "FBR Document"
                    h1 = payload.get("H1") or payload.get("H2") or payload.get("H3") or payload.get("section") or "General Guidelines"
                    if text:
                        all_docs.append({
                            "content": text,
                            "source": document,
                            "section": h1
                        })
                offset = next_offset
                if not offset:
                    break
            
            self.docs_cache = all_docs
            logger.info(f"Loaded {len(self.docs_cache)} documents into local cache.")
            
            if self.docs_cache:
                from rank_bm25 import BM25Okapi
                tokenized_corpus = [doc["content"].lower().split() for doc in self.docs_cache]
                self.bm25 = BM25Okapi(tokenized_corpus)
                self.bm25_initialized = True
                logger.info("BM25 index successfully initialized.")
        except Exception as e:
            logger.error(f"Failed to initialize local BM25 index: {e}")

    def search_documents(self, query: str, limit: int = 4) -> List[Dict[str, Any]]:
        """
        Retrieves semantically relevant document chunks using hybrid Cosine vector + BM25 keyword search.
        Fuses the results using Reciprocal Rank Fusion (RRF).

        Args:
            query: The text search query from the user.
            limit: The maximum number of relevant documents to return.

        Returns:
            A list of dictionary mappings representing retrieved document metadata and content.
        """
        if not self.enabled or not self.client or not self.encoder:
            logger.warning("Search query requested but Qdrant service is disabled or disconnected.")
            return []

        try:
            # Lazy initialize the BM25 index
            if not self.bm25_initialized:
                self._initialize_bm25()

            collections = self.client.get_collections()
            collection_names = [c.name for c in collections.collections]
            
            if settings.QDRANT_COLLECTION not in collection_names:
                raise KeyError(f"Collection '{settings.QDRANT_COLLECTION}' not found in Qdrant database.")

            query_vector = self.encoder.encode(query).tolist()
            
            # 1. Vector Cosine Search (Dense)
            vector_hits = []
            if hasattr(self.client, "query_points"):
                results = self.client.query_points(
                    collection_name=settings.QDRANT_COLLECTION,
                    query=query_vector,
                    limit=10
                )
                points = results.points
            elif hasattr(self.client, "search"):
                points = self.client.search(
                    collection_name=settings.QDRANT_COLLECTION,
                    query_vector=query_vector,
                    limit=10
                )
            else:
                raise AttributeError("QdrantClient has neither 'query_points' nor 'search' method.")
            
            for hit in points:
                payload = hit.payload or {}
                vector_hits.append({
                    "content": payload.get("text") or payload.get("content") or "",
                    "source": payload.get("document") or payload.get("source") or "FBR Document",
                    "section": payload.get("H1") or payload.get("H2") or payload.get("H3") or payload.get("section") or "General Guidelines"
                })

            # 2. Local BM25 Search (Sparse Keyword)
            bm25_hits = []
            if self.bm25_initialized and self.bm25:
                tokenized_query = query.lower().split()
                doc_scores = self.bm25.get_scores(tokenized_query)
                top_indices = sorted(range(len(doc_scores)), key=lambda i: doc_scores[i], reverse=True)[:10]
                for idx in top_indices:
                    if doc_scores[idx] > 0.0:  # Only include results with query term overlap
                        bm25_hits.append(self.docs_cache[idx])

            # 3. Reciprocal Rank Fusion (RRF)
            K = 60
            rrf_scores = {}
            
            def get_doc_key(doc):
                return (doc["content"], doc["source"], doc["section"])

            # Rank documents in vector search
            for rank, doc in enumerate(vector_hits):
                key = get_doc_key(doc)
                rrf_scores[key] = rrf_scores.get(key, 0.0) + (1.0 / (K + rank + 1))

            # Rank documents in BM25 search
            for rank, doc in enumerate(bm25_hits):
                key = get_doc_key(doc)
                rrf_scores[key] = rrf_scores.get(key, 0.0) + (1.0 / (K + rank + 1))

            # Sort merged docs by fusion score
            sorted_docs = sorted(rrf_scores.keys(), key=lambda k: rrf_scores[k], reverse=True)
            
            # Map back to standard dict list format
            merged_hits = []
            for doc_key in sorted_docs[:limit]:
                content, source, section = doc_key
                merged_hits.append({
                    "content": content,
                    "source": source,
                    "section": section,
                    "score": rrf_scores[doc_key]
                })

            logger.info(f"Hybrid search returned {len(merged_hits)} RRF-merged hits.")
            return merged_hits
            
        except Exception as e:
            logger.error(f"Error during hybrid Qdrant search: {e}")
            raise RuntimeError(f"Qdrant search query failed: {e}") from e

# Instantiate the service singleton to be imported by application nodes
qdrant_service = QdrantService()
