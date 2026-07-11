import logging
import uuid
import bcrypt
import time
import requests
from collections import defaultdict
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from langchain_core.messages import HumanMessage, AIMessage
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db import get_db, init_db, User, TaxProfile, IncomeDeclaration, ChatThread
from app.graph.workflow import app_graph

# In-memory rate limiter cache tracking user_id -> request timestamps
rate_limit_store = defaultdict(list)

def get_supabase_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """
    Authenticates requests using the client's Supabase JWT access token.
    Queries the Supabase Auth server API to confirm token validity.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header. Expected: Bearer <JWT>"
        )
    token = authorization.split(" ")[1]
    
    url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.SUPABASE_ANON_KEY
    }
    try:
        response = requests.get(url, headers=headers, timeout=5.0)
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session token."
            )
        return response.json()  # Returns dict containing user metadata, id, email etc.
    except requests.RequestException as e:
        logger.error(f"Failed to contact Supabase Auth server: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication server connection error."
        )


def check_rate_limit(user_id: str) -> None:
    """
    Checks if a user has exceeded the threshold of 15 requests per minute.
    """
    now = time.time()
    user_key = str(user_id)
    timestamps = [t for t in rate_limit_store[user_key] if now - t < 60.0]
    rate_limit_store[user_key] = timestamps

    if len(timestamps) >= 15:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded (Max 15 requests/min). Please wait a minute before trying again."
        )
    rate_limit_store[user_key].append(now)

def hash_password(password: str) -> str:
    """
    Hashes a plain password using bcrypt.
    """
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(password: str, hashed: str) -> bool:
    """
    Verifies a plain password against its bcrypt hash.
    """
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TaxPilot API Backend",
    description="FBR Income Tax Compliance RAG and Calculator API powered by FastAPI and LangGraph",
    version="1.0.0",
    docs_url=None,
    redoc_url=None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    """
    Startup lifecycle handler. Initializes the database schema.
    """
    logger.info("Starting up TaxPilot Backend API server...")
    try:
        init_db()
    except Exception as e:
        logger.error(f"Database initialization failed: {e}. Starting without db sync.")

def safe_uuid(id_str: str) -> uuid.UUID:
    """
    Safely converts a string parameter to a UUID, raising 400 Bad Request if invalid.
    """
    try:
        return uuid.UUID(id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid identifier format.")

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    jurisdiction: Optional[str] = "RTO Lahore"

class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    jurisdiction: Optional[str] = "RTO Lahore"
    is_atl_active: bool = True
    residency: str = "Resident"
    entity: str = "Individual"
    special_status: str = "None"
    tax_year: int = 2026

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    is_atl_active: bool
    residency: str
    entity: str
    special_status: str
    jurisdiction: Optional[str] = "RTO Lahore"
    tax_year: Optional[int] = 2026

class IncomeUpdate(BaseModel):
    gross_amount: float
    admissible_deductions: float = 0.0

class DeclarationItem(BaseModel):
    gross_amount: float
    admissible_deductions: float = 0.0

class DeclarationsUpdate(BaseModel):
    declarations: Dict[str, DeclarationItem]

class ChatCreate(BaseModel):
    user_id: str
    thread_id: Optional[str] = None
    title: Optional[str] = "New Tax Inquiry"

class UserMessageRequest(BaseModel):
    message: str = Field(..., max_length=4000)
    user_id: str

@app.get("/health")
def health_check():
    """
    Health check diagnostic handler.
    """
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/config")
def get_public_config():
    """
    Exposes Supabase URL and Anon/Public key for frontend client initialization.
    """
    return {
        "SUPABASE_URL": settings.SUPABASE_URL,
        "SUPABASE_ANON_KEY": settings.SUPABASE_ANON_KEY
    }

@app.post("/api/chats")
def create_chat_thread(payload: ChatCreate, current_user: Dict[str, Any] = Depends(get_supabase_user), db: Session = Depends(get_db)):
    """
    Creates a new conversational thread.
    """
    if payload.user_id != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You can only create threads for your own account."
        )
        
    u_uuid = safe_uuid(payload.user_id)
    t_uuid = safe_uuid(payload.thread_id) if payload.thread_id else uuid.uuid4()
    
    existing = db.query(ChatThread).filter(ChatThread.thread_id == t_uuid).first()
    if existing:
        return {
            "thread_id": str(existing.thread_id),
            "user_id": str(existing.user_id),
            "title": existing.title,
            "created_at": existing.created_at
        }
        
    thread = ChatThread(
        thread_id=t_uuid,
        user_id=u_uuid,
        title=payload.title
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    
    return {
        "thread_id": str(thread.thread_id),
        "user_id": str(thread.user_id),
        "title": thread.title,
        "created_at": thread.created_at
    }

@app.get("/api/chats/user/{user_id}")
def get_user_chats(user_id: str, current_user: Dict[str, Any] = Depends(get_supabase_user), db: Session = Depends(get_db)):
    """
    Retrieves all active conversational threads created by the taxpayer.
    """
    if user_id != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Access denied to other user's threads."
        )
        
    u_uuid = safe_uuid(user_id)
    threads = db.query(ChatThread).filter(
        ChatThread.user_id == u_uuid,
        ChatThread.is_archived == False
    ).order_by(ChatThread.last_accessed_at.desc()).all()
    
    result = []
    for t in threads:
        summary = ""
        try:
            config = {"configurable": {"thread_id": str(t.thread_id)}}
            state = app_graph.get_state(config)
            messages = state.values.get("messages", [])
            for msg in messages:
                if isinstance(msg, AIMessage):
                    summary = msg.content[:180] + "..." if len(msg.content) > 180 else msg.content
                    break
        except Exception as e:
            logger.error(f"Error retrieving summary for thread {t.thread_id}: {e}")

        result.append({
            "thread_id": str(t.thread_id),
            "title": t.title,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "last_accessed_at": t.last_accessed_at.isoformat() if t.last_accessed_at else None,
            "calculation_cache": t.calculation_cache,
            "citations_cache": t.citations_cache,
            "summary": summary
        })
    return result

@app.get("/api/chats/{chat_id}/messages")
def get_chat_messages(chat_id: str, current_user: Dict[str, Any] = Depends(get_supabase_user), db: Session = Depends(get_db)):
    """
    Loads raw message feed history within a specific thread context.
    """
    t_uuid = safe_uuid(chat_id)
    thread = db.query(ChatThread).filter(ChatThread.thread_id == t_uuid).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Chat thread not found.")
    if str(thread.user_id) != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Access denied to this chat thread."
        )
        
    config = {"configurable": {"thread_id": str(t_uuid)}}
    state = app_graph.get_state(config)
    messages = state.values.get("messages", [])
    
    formatted_messages = []
    for msg in messages:
        sender = "ai" if isinstance(msg, AIMessage) else "user"
        formatted_messages.append({
            "sender": sender,
            "text": msg.content,
            "timestamp": datetime.utcnow().strftime("%I:%M %p")
        })
        
    return formatted_messages

@app.post("/api/chats/{chat_id}/message")
def post_chat_message(chat_id: str, payload: UserMessageRequest, current_user: Dict[str, Any] = Depends(get_supabase_user), db: Session = Depends(get_db)):
    """
    Posts a user message into the thread and executes the LangGraph agent pipeline.
    """
    if payload.user_id != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: User ID mismatch."
        )
        
    t_uuid = safe_uuid(chat_id)
    u_uuid = safe_uuid(payload.user_id)
    
    thread = db.query(ChatThread).filter(ChatThread.thread_id == t_uuid).first()
    if thread and str(thread.user_id) != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Access denied to this chat thread."
        )
        
    check_rate_limit(payload.user_id)
    
    if not thread:
        thread = ChatThread(thread_id=t_uuid, user_id=u_uuid, title=payload.message[:40] + "...")
        db.add(thread)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            thread = db.query(ChatThread).filter(ChatThread.thread_id == t_uuid).first()
            if not thread:
                raise HTTPException(status_code=500, detail="Database race condition: failed to load concurrently created thread.")
    elif thread.title == "New Tax Inquiry":
        thread.title = payload.message[:40] + "..." if len(payload.message) > 40 else payload.message
        db.commit()

    config = {"configurable": {"thread_id": str(t_uuid)}}
    inputs = {
        "messages": [HumanMessage(content=payload.message)],
        "user_id": str(u_uuid),
        "thread_id": str(t_uuid)
    }
    
    try:
        logger.info(f"Executing LangGraph pipeline for thread {t_uuid}...")
        result = app_graph.invoke(inputs, config=config)
        
        final_messages = result.get("messages", [])
        if not final_messages:
            raise HTTPException(status_code=500, detail="Agent failed to produce response.")
            
        final_msg = final_messages[-1].content
        
        db.refresh(thread)
        
        return {
            "response": final_msg,
            "calculation": thread.calculation_cache,
            "citations": thread.citations_cache,
            "topic": thread.title
        }
        
    except Exception as e:
        logger.error(f"Error executing agent workflow: {e}", exc_info=True)
        return {
            "response": "I encountered an error while processing your request. Please try again.",
            "calculation": None,
            "citations": [],
            "topic": thread.title
        }

@app.delete("/api/chats/{chat_id}")
def delete_chat_thread(chat_id: str, current_user: Dict[str, Any] = Depends(get_supabase_user), db: Session = Depends(get_db)):
    """
    Deletes a conversational thread context from database storage.
    """
    t_uuid = safe_uuid(chat_id)
    thread = db.query(ChatThread).filter(ChatThread.thread_id == t_uuid).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Chat session not found")
    if str(thread.user_id) != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Access denied."
        )
        
    db.delete(thread)
    db.commit()
    return {"message": "Chat thread deleted successfully"}

# Mount frontend static files to serve the UI dynamically from same port
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    favicon_path = os.path.join(static_dir, "favicon.svg")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path, media_type="image/svg+xml")
    return {"message": "Favicon not found"}

@app.get("/")
def read_root():
    home_path = os.path.join(static_dir, "home.html")
    if os.path.exists(home_path):
        return FileResponse(home_path)
    return {"message": "TaxPilot Web App Static Site"}

if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

