import logging
from typing import Dict, Any
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from app.config import settings
from app.graph.state import AgentState
from app.graph.nodes import (
    load_state_node,
    intent_classifier_node,
    info_collector_node,
    rag_retriever_node,
    tax_calculator_node,
    eligibility_engine_node,
    response_generator_node,
    memory_updater_node
)

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Define Workflow Routing Logic
# --------------------------------------------------------------------------

def route_from_classifier(state: AgentState) -> str:
    """
    Routes from classifier to info_collector (for calculator/eligibility)
    or directly to retriever/response generator.
    """
    intent = state.get("intent", "generic")
    if intent in ["calculator", "eligibility"]:
        return "info_collector"
    elif intent == "qa":
        return "rag_retriever"
    else:
        return "response_generator"

def route_from_collector(state: AgentState) -> str:
    """
    Routes from info_collector to the appropriate calculation/eligibility engine,
    or falls back to response generator if fields are missing.
    """
    next_node = state.get("next_node", "response_generator")
    if next_node in ["tax_calculator", "eligibility_engine", "response_generator"]:
        return next_node
    return "response_generator"

# --------------------------------------------------------------------------
# Build StateGraph
# --------------------------------------------------------------------------

workflow = StateGraph(AgentState)

# Add all nodes
workflow.add_node("load_state", load_state_node)
workflow.add_node("intent_classifier", intent_classifier_node)
workflow.add_node("info_collector", info_collector_node)
workflow.add_node("rag_retriever", rag_retriever_node)
workflow.add_node("tax_calculator", tax_calculator_node)
workflow.add_node("eligibility_engine", eligibility_engine_node)
workflow.add_node("response_generator", response_generator_node)
workflow.add_node("memory_updater", memory_updater_node)

# Set entry point
workflow.set_entry_point("load_state")

# Load state always leads to classification
workflow.add_edge("load_state", "intent_classifier")

# Intent classifier conditional routing
workflow.add_conditional_edges(
    "intent_classifier",
    route_from_classifier,
    {
        "info_collector": "info_collector",
        "rag_retriever": "rag_retriever",
        "response_generator": "response_generator"
    }
)

# Information collector conditional routing
workflow.add_conditional_edges(
    "info_collector",
    route_from_collector,
    {
        "tax_calculator": "tax_calculator",
        "eligibility_engine": "eligibility_engine",
        "response_generator": "response_generator"
    }
)

# Core engine execution edges lead to response compilation
workflow.add_edge("tax_calculator", "response_generator")
workflow.add_edge("eligibility_engine", "response_generator")
workflow.add_edge("rag_retriever", "response_generator")

# Response generation leads to state/database synchronization
workflow.add_edge("response_generator", "memory_updater")

# End execution after database/memory update
workflow.add_edge("memory_updater", END)

# --------------------------------------------------------------------------
# Configure checkpointer persistence with Postgres (Memory fallback)
# --------------------------------------------------------------------------

try:
    from langgraph.checkpoint.postgres import PostgresSaver
    from psycopg_pool import ConnectionPool
    
    if settings.DATABASE_URL and ("postgres" in settings.DATABASE_URL or "postgresql" in settings.DATABASE_URL):
        logger.info("Initializing PostgresSaver checkpointer with connection pool...")
        # Normalize SQLAlchemy psycopg2 dialect to standard postgresql URI
        conn_info = settings.DATABASE_URL
        if conn_info.startswith("postgresql+psycopg2://"):
            conn_info = conn_info.replace("postgresql+psycopg2://", "postgresql://", 1)
        elif conn_info.startswith("postgres+psycopg2://"):
            conn_info = conn_info.replace("postgres+psycopg2://", "postgresql://", 1)
            
        # Initialize pool synchronously
        pool = ConnectionPool(conninfo=conn_info, max_size=10, open=True)
        checkpointer = PostgresSaver(pool)
        logger.info("PostgresSaver checkpointer initialized successfully.")
    else:
        logger.warning("DATABASE_URL is not PostgreSQL. Falling back to MemorySaver checkpointer.")
        checkpointer = MemorySaver()
except Exception as e:
    logger.error(f"Failed to load PostgresSaver checkpointer: {e}. Falling back to MemorySaver.")
    checkpointer = MemorySaver()

# Compile graph
app_graph = workflow.compile(checkpointer=checkpointer)
