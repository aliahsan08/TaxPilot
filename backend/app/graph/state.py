from typing import TypedDict, Annotated, Sequence, List, Dict, Any
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    """
    State representing the context of a TaxPilot conversation session.
    """
    # Standard conversation messages list
    messages: Annotated[Sequence[BaseMessage], add_messages]
    
    # Session metadata identifiers
    user_id: str
    thread_id: str
    
    # Active FBR Tax Profile (loaded from Supabase Postgres)
    tax_profile: Dict[str, Any]
    
    # Parameters for progressive slab calculation
    calculator_inputs: Dict[str, Any]
    calculation_results: Dict[str, Any]
    
    # Parameters for return filing eligibility validation
    eligibility_inputs: Dict[str, Any]
    eligibility_results: Dict[str, Any]
    
    # RAG Context & Citations
    retrieved_documents: List[Dict[str, Any]]
    citations: List[Dict[str, Any]]
    
    # Agent Intent Classification & Routing state
    intent: str  # 'calculator' | 'qa' | 'eligibility' | 'generic'
    missing_fields: List[str]  # Fields required to collect from user
    next_node: str  # Destination routing target
