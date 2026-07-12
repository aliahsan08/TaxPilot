import json
import logging
import re
from typing import Dict, Any, List
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from app.config import settings
from app.db import SessionLocal, User, TaxProfile, IncomeDeclaration, ChatThread
from app.services.calculator import calculate_salary_tax
from app.services.qdrant_service import qdrant_service
from app.graph.state import AgentState

logger = logging.getLogger(__name__)

# Main LLM: Llama 3.3 70B
main_llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    api_key=settings.LLM_API_KEY,
    temperature=0.2
)

# Primary Fallback LLM: Qwen3 32B
primary_fallback_llm = ChatGroq(
    model="qwen/qwen3-32b",
    api_key=settings.LLM_API_KEY,
    temperature=0.2
)

# Secondary Fallback LLM: Llama 4 Scout 17B
secondary_fallback_llm = ChatGroq(
    model="meta-llama/llama-4-scout-17b-16e-instruct",
    api_key=settings.LLM_API_KEY,
    temperature=0.2
)

def safe_llm_invoke(messages: list) -> Any:
    try:
        logger.info("Attempting to query main model llama-3.3-70b-versatile...")
        return main_llm.invoke(messages)
    except Exception as e:
        logger.warning(f"Main model query failed: {e}. Trying primary fallback qwen/qwen3-32b...")
        try:
            return primary_fallback_llm.invoke(messages)
        except Exception as e2:
            logger.warning(f"Primary fallback query failed: {e2}. Trying secondary fallback meta-llama/llama-4-scout-17b-16e-instruct...")
            try:
                return secondary_fallback_llm.invoke(messages)
            except Exception as e3:
                logger.error(f"All models failed. Main: {e}, Primary Fallback: {e2}, Secondary Fallback: {e3}")
                raise e3


def clean_llm_response(raw_text: str) -> str:
    """Strips Chain-of-Thought reasoning and trailing metadata from LLM outputs."""
    # 1. Remove the entire <think>...</think> block (including newlines)
    clean_text = re.sub(r'<think>.*?</think>', '', raw_text, flags=re.DOTALL)
    
    # 2. Clean up any trailing timestamps or system leakage (e.g., "10:33 PM" or "05:21 PM")
    clean_text = re.sub(r'\b\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)?\b', '', clean_text)
    
    # 3. Strip leading/trailing whitespace left over from deletions
    return clean_text.strip()

def extract_text_content(content: Any) -> str:
    """
    Extracts plain text content from LangChain message response objects.

    Args:
        content: The raw response content field.

    Returns:
        The extracted string content.
    """
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        texts = []
        for part in content:
            if isinstance(part, dict) and "text" in part:
                texts.append(part["text"])
            elif isinstance(part, str):
                texts.append(part)
        text = "".join(texts)
    else:
        text = str(content)
    return clean_llm_response(text)

def load_state_node(state: AgentState) -> Dict[str, Any]:
    """
    Loads active user profile metadata and income declarations from database.

    Args:
        state: The current AgentState dict.

    Returns:
        A dictionary updating loaded tax profile parameters and calculator inputs.
    """
    user_id = state.get("user_id")
    if not user_id:
        raise ValueError("Loading state failed: user_id is missing from AgentState.")
        
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.user_id == user_id).first()
        if not user:
            user = User(user_id=user_id, email=f"user_{user_id[:8]}@example.pk", full_name="Valued Taxpayer")
            db.add(user)
            db.commit()
            db.refresh(user)

        profile = db.query(TaxProfile).filter(
            TaxProfile.user_id == user_id, 
            TaxProfile.tax_year == 2026
        ).first()

        if not profile:
            profile = TaxProfile(
                user_id=user_id,
                tax_year=2026,
                is_atl_active=True,
                residency="Resident",
                entity="Individual",
                special_status="None",
                jurisdiction="RTO Lahore"
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)

        declarations = db.query(IncomeDeclaration).filter(
            IncomeDeclaration.profile_id == profile.profile_id
        ).all()

        profile_dict = {
            "profile_id": str(profile.profile_id),
            "tax_year": profile.tax_year,
            "is_atl_active": profile.is_atl_active,
            "residency": profile.residency,
            "entity": profile.entity,
            "special_status": profile.special_status,
            "jurisdiction": profile.jurisdiction,
            "wealth_statement_filed": profile.wealth_statement_filed
        }

        calculator_inputs = {
            "gross_salary": 0.0,
            "admissible_deductions": 0.0,
            "business_gross": 0.0,
            "property_gross": 0.0
        }
        for dec in declarations:
            if dec.income_head == "Salary":
                calculator_inputs["gross_salary"] = float(dec.gross_amount)
                calculator_inputs["admissible_deductions"] = float(dec.admissible_deductions)
            elif dec.income_head == "Business":
                calculator_inputs["business_gross"] = float(dec.gross_amount)
            elif dec.income_head == "Property":
                calculator_inputs["property_gross"] = float(dec.gross_amount)

        logger.info(f"DB state loaded for user {user_id}: {profile_dict}")
        return {
            "tax_profile": profile_dict,
            "calculator_inputs": calculator_inputs,
            "eligibility_inputs": {}
        }
    except Exception as e:
        logger.error(f"Error loading state from PostgreSQL: {e}")
        raise RuntimeError(f"Database session state retrieval failed: {e}") from e
    finally:
        db.close()

def intent_classifier_node(state: AgentState) -> Dict[str, Any]:
    """
    Classifies user intent and extracts numeric parameter overrides in a single LLM request.

    Args:
        state: The current AgentState dict.

    Returns:
        Updates for user intent, next node route, and adjusted calculator inputs.
    """
    messages = state.get("messages", [])
    if not messages:
        return {"intent": "generic", "next_node": "response_generator"}
        
    last_message = messages[-1].content
    
    prompt = (
        "You are an expert tax agent assistant. Analyze the user's query and perform two tasks:\n"
        "1. Classify the intent into exactly one of: 'calculator', 'eligibility', 'qa', or 'generic'.\n"
        "   - 'calculator': wants tax calculations, mentions salary/business/property income math, etc.\n"
        "   - 'eligibility': asks if they are required to register or file returns, exemptions, etc.\n"
        "   - 'qa': general tax law questions, processes, definitions, deadlines, etc.\n"
        "   - 'generic': greetings, general chat, or comments.\n"
        "2. Extract any explicit numeric override amounts the user specifies in their prompt for:\n"
        "   - 'salary': gross annual salary/income amount. (CRITICAL: If the user states a monthly figure, e.g. 'monthly salary of 150,000' or '150k per month', automatically multiply it by 12 to convert it to an annual/yearly salary amount before returning it.)\n"
        "   - 'business': business annual gross income. (CRITICAL: If stated as a monthly figure, convert to annual by multiplying by 12.)\n"
        "   - 'property': property rental annual gross income. (CRITICAL: If stated as a monthly figure, convert to annual by multiplying by 12.)\n"
        "   If no explicit amount is mentioned for a category in this query, set it to null.\n\n"
        f"Query: \"{last_message}\"\n\n"
        "Output ONLY valid JSON matching this schema: {\"intent\": \"category\", \"overrides\": {\"salary\": null|number, \"business\": null|number, \"property\": null|number}}"
    )
    
    intent = "generic"
    overrides = {}
    try:
        response = safe_llm_invoke([HumanMessage(content=prompt)])
        raw_content = extract_text_content(response.content)
        # Extract JSON substring between first { and last }
        match = re.search(r"(\{.*\})", raw_content, re.DOTALL)
        if match:
            clean_json = match.group(1)
        else:
            clean_json = raw_content
        data = json.loads(clean_json.strip())
        
        intent = data.get("intent", "generic").strip().lower()
        if intent not in ["calculator", "qa", "eligibility", "generic"]:
            intent = "generic"
        overrides = data.get("overrides", {})
    except Exception as e:
        logger.error(f"Intent & override classification failed: {e}")
        raise RuntimeError(f"LLM Classification failed: {e}") from e

    if intent == "calculator":
        next_node = "tax_calculator"
    elif intent == "eligibility":
        next_node = "eligibility_engine"
    elif intent == "qa":
        next_node = "rag_retriever"
    else:
        next_node = "response_generator"

    calc_inputs = state.get("calculator_inputs", {}) or {}
    new_calc_inputs = dict(calc_inputs)
    
    if intent == "calculator" and overrides:
        sal_override = overrides.get("salary")
        bus_override = overrides.get("business")
        prop_override = overrides.get("property")
        
        if sal_override is not None:
            new_calc_inputs["gross_salary"] = float(sal_override)
        if bus_override is not None:
            new_calc_inputs["business_gross"] = float(bus_override)
        if prop_override is not None:
            new_calc_inputs["property_gross"] = float(prop_override)

    return {
        "intent": intent, 
        "next_node": next_node, 
        "calculator_inputs": new_calc_inputs
    }

def info_collector_node(state: AgentState) -> Dict[str, Any]:
    """
    Identifies if essential parameters are missing and updates state targets.

    Args:
        state: The current AgentState dict.

    Returns:
        Updates containing identified missing parameter strings and updated routing.
    """
    intent = state.get("intent")
    calc_inputs = state.get("calculator_inputs", {}) or {}
    missing_fields = []
    
    if intent == "calculator":
        total_gross = (
            calc_inputs.get("gross_salary", 0.0) +
            calc_inputs.get("business_gross", 0.0) +
            calc_inputs.get("property_gross", 0.0)
        )
        if total_gross == 0.0:
            missing_fields.append("gross_salary")
            
    elif intent == "eligibility":
        elig_inputs = state.get("eligibility_inputs", {})
        if not elig_inputs:
            pass

    return {
        "calculator_inputs": calc_inputs,
        "missing_fields": missing_fields,
        "next_node": "response_generator" if missing_fields else state.get("next_node")
    }

def rag_retriever_node(state: AgentState) -> Dict[str, Any]:
    """
    Retrieves guide chunks from Qdrant vector database matching the user prompt.

    Args:
        state: The current AgentState dict.

    Returns:
        Dict wrapping list of matching document chunks and routing targets.
    """
    messages = state.get("messages", [])
    if not messages:
        return {"retrieved_documents": [], "next_node": "response_generator"}
        
    last_message = messages[-1].content
    logger.info(f"Retrieving context for query: {last_message}")
    
    try:
        hits = qdrant_service.search_documents(last_message, limit=4)
        logger.info(f"Retrieved {len(hits)} matching sections from Vector store.")
        return {
            "retrieved_documents": hits,
            "next_node": "response_generator"
        }
    except Exception as e:
        logger.error(f"RAG retrieval node failed: {e}")
        raise RuntimeError(f"RAG semantic query execution failed: {e}") from e

def tax_calculator_node(state: AgentState) -> Dict[str, Any]:
    """
    Invokes deterministic Python tax calculation routines for loaded income streams.

    Args:
        state: The current AgentState dict.

    Returns:
        Updates containing the nested dictionary calculation metrics and citation lists.
    """
    calc_inputs = state.get("calculator_inputs", {})
    profile = state.get("tax_profile", {})
    
    gross = calc_inputs.get("gross_salary", 0.0)
    deductions = calc_inputs.get("admissible_deductions", 0.0)
    business = calc_inputs.get("business_gross", 0.0)
    property_val = calc_inputs.get("property_gross", 0.0)
    is_filer = profile.get("is_atl_active", True)
    
    results = calculate_salary_tax(
        gross_salary=gross,
        admissible_deductions=deductions,
        is_atl_active=is_filer,
        business_gross=business,
        property_gross=property_val
    )
    logger.info(f"Tax calculation computed successfully: {results['total_tax_owed']}")
    
    citations = []
    if gross > 0 or business > 0 or property_val > 0:
        citations.append({
            "section": "First Schedule, Part I, Division I",
            "text": "Prescribes progressive income tax slabs and rates for individuals (salaried and non-salaried/business), including merged NTR streams."
        })
        
    return {
        "calculation_results": results,
        "citations": citations,
        "next_node": "response_generator"
    }

def eligibility_engine_node(state: AgentState) -> Dict[str, Any]:
    """
    Applies Section 114 statutory FBR limits to assess user registration requirements.

    Args:
        state: The current AgentState dict.

    Returns:
        Dictionary detailing filing requirements, validation flags, and FBR citations.
    """
    profile = state.get("tax_profile", {})
    calc_inputs = state.get("calculator_inputs", {})
    
    income = calc_inputs.get("gross_salary", 0.0)
    income_threshold = 600000.0 if profile.get("entity") == "Individual" else 400000.0
    
    reasons = []
    is_required = False
    
    if income > income_threshold:
        is_required = True
        reasons.append(f"Annual taxable income (PKR {income:,.2f}) exceeds the statutory threshold of PKR {income_threshold:,.2f}.")
        
    citations = [{
        "section": "Section 114 (Filing Requirements)",
        "text": "Outlines conditions under which an individual, AOP, or company is legally obligated to file an annual income tax return."
    }]
    
    eligibility_results = {
        "is_required": is_required,
        "reasons": reasons,
        "checked_income": income,
        "threshold": income_threshold
    }
    
    return {
        "eligibility_results": eligibility_results,
        "citations": citations,
        "next_node": "response_generator"
    }

def clean_source_name(source: str) -> str:
    """
    Cleans raw document source names to clean display titles.
    """
    if not source:
        return "FBR Document"
    # Remove file extension if present
    name = source
    if name.lower().endswith(".pdf"):
        name = name[:-4]
        
    name_lower = name.lower()
    if "rules2002" in name_lower or "rules_2002" in name_lower or "rules 2002" in name_lower:
        return "INCOME TAX RULES, 2002"
    elif "rules" in name_lower and "2002" in name_lower:
        return "INCOME TAX RULES, 2002"
    elif "ordinance2001" in name_lower or "ordinance_2001" in name_lower or "ordinance 2001" in name_lower:
        return "INCOME TAX ORDINANCE, 2001"
    elif "ordinance" in name_lower and "2001" in name_lower:
        return "INCOME TAX ORDINANCE, 2001"
    elif "finance" in name_lower and "2026" in name_lower:
        return "FINANCE ACT, 2026"
    elif "finance" in name_lower:
        return "FINANCE ACT"
    
    # Generic replacements or fallbacks
    return name.replace("_", " ").replace("-", " ").strip().upper()

def response_generator_node(state: AgentState) -> Dict[str, Any]:
    """
    Synthesizes model responses, dynamic tables, and references into a final conversational message.

    Args:
        state: The current AgentState dict.

    Returns:
        Updates wrapping the final conversational AIMessage content and active citations.
    """
    intent = state.get("intent", "generic")
    missing_fields = state.get("missing_fields", [])
    
    if missing_fields:
        if "gross_salary" in missing_fields:
            return {
                "messages": [AIMessage(content="To calculate your estimated income tax liability for Tax Year 2026, could you please provide your gross annual salary?")]
            }
        return {
            "messages": [AIMessage(content="Could you please provide the missing profile or income parameters?")]
        }

    history = state.get("messages", [])[:-1]
    last_query = state.get("messages", [])[-1].content if state.get("messages") else ""
    
    # Filter message history to only include HumanMessage and AIMessage, and keep the last 3 text pairs (6 messages)
    chat_history = [
        msg for msg in history 
        if isinstance(msg, (HumanMessage, AIMessage))
    ]
    context_history = chat_history[-6:]
    
    profile = state.get("tax_profile", {})
    calc_results = state.get("calculation_results", {})
    elig_results = state.get("eligibility_results", {})
    retrieved = state.get("retrieved_documents", [])
    
    citations = []
    
    system_prompt = (
        "You are a strict tax compliance assistant named TaxPilot.\n"
        "If a user asks a query completely unrelated to finance, tax, or FBR compliance (e.g., recipes, mechanical repairs), instantly output the standard refusal message: 'I am TaxPilot, an assistant specialized only in Pakistani FBR tax compliance, calculations, and filing eligibility. I cannot assist with out-of-scope requests.' Do not reason through out-of-scope requests or explain why you cannot answer.\n"
        "CRITICAL RULES:\n"
        "- Never introduce yourself, greet the taxpayer, or use conversational preambles/boilerplate.\n"
        "- Answer the user's question directly, precisely, and with high conciseness.\n"
        "- Explain complex tax rules in clean, plain English.\n\n"
    )
    
    user_context = f"Taxpayer Profile: Tax Year 2026, Residency: {profile.get('residency')}, Entity: {profile.get('entity')}, ATL status: {'Filer' if profile.get('is_atl_active') else 'Non-Filer'}.\n"
    
    if intent == "calculator" and calc_results:
        gross = calc_results.get("gross_salary", 0.0)
        deductions = calc_results.get("admissible_deductions", 0.0)
        business = calc_results.get("business_income", 0.0)
        property_val = calc_results.get("rental_income", 0.0)
        tax = calc_results.get("total_tax_owed", 0.0)
        slab = calc_results.get("slab_name", "")
        rate_desc = calc_results.get("rate_description", "")
        effective = calc_results.get("effective_rate", "0%")
        
        audit_log = (
            f"[CALCULATOR NODE - AUDIT LOG]\n"
            f"User Input Salary: PKR {gross:,.2f}\n"
            f"Business Income: PKR {business:,.2f}\n"
            f"Rental Property Income: PKR {property_val:,.2f}\n"
            f"Taxpayer Status: {'Active ATL (Filer)' if profile.get('is_atl_active') else 'Inactive (Non-Filer)'}\n"
            f"Slab Determined: {slab}\n"
            f"Base Tax: PKR {calc_results.get('base_tax', 0):,.2f}\n"
            f"Variable Tax: PKR {calc_results.get('variable_tax', 0):,.2f}\n"
            f"Calculated Total Tax: PKR {tax:,.2f}"
        )
        
        audit_log_html = audit_log.replace('\n', '<br>')
        
        rows = []
        if gross > 0:
            rows.append(f'<tr><td>Gross Annual Salary</td><td>{gross:,.2f}</td></tr>')
        if business > 0:
            rows.append(f'<tr><td>Business/Non-Salaried Income</td><td>{business:,.2f}</td></tr>')
        if property_val > 0:
            rows.append(f'<tr><td>Gross Property Rental Income</td><td>{property_val:,.2f}</td></tr>')
            rows.append(f'<tr><td>Property Repairs Deduction (20%)</td><td>-{(property_val * 0.2):,.2f}</td></tr>')
        if deductions > 0:
            rows.append(f'<tr><td>Admissible Deductions (Zakat/etc.)</td><td>-{deductions:,.2f}</td></tr>')
            
        rows.append(f'<tr style="border-top: 2px solid var(--border-color);"><td><strong>Total Taxable NTR Income</strong></td><td><strong>{calc_results.get("taxable_income", 0):,.2f}</strong></td></tr>')
        rows.append(f'<tr><td>Applicable Slab (First Schedule)</td><td>{slab}</td></tr>')
        rows.append(f'<tr><td>Tax Slab Slabs Formula</td><td>{rate_desc} <a class="cit-badge" data-cit-idx="0">1st Schedule</a></td></tr>')
        rows.append(f'<tr class="text-success font-semibold"><td><strong>Total Tax Payable</strong></td><td><strong>{tax:,.2f}</strong></td></tr>')
        rows.append(f'<tr><td>Effective Tax Rate</td><td>{effective}</td></tr>')
        
        rows_html = "".join(rows)
        table_html = (
            f'<div class="audit-log-box">{audit_log_html}</div>'
            f'<h3>Tax Computation Summary</h3>'
            f'<table class="tax-table">'
            f'<thead><tr><th>Description</th><th>Amount (PKR)</th></tr></thead>'
            f'<tbody>{rows_html}</tbody></table>'
        )
        
        prompt = (
            f"Provide a clear, detailed, and comprehensive explanation of this tax calculation for the taxpayer:\n"
            f"Taxpayer Profile: Tax Year 2026, Residency: {profile.get('residency')}, Entity: {profile.get('entity')}, ATL status: {'Filer' if profile.get('is_atl_active') else 'Non-Filer'}.\n"
            f"Tax calculation details:\n"
            f"- Gross Salary: PKR {gross:,.2f}\n"
            f"- Business/Non-Salaried Income: PKR {business:,.2f}\n"
            f"- Rental Property Income: PKR {property_val:,.2f}\n"
            f"- Taxable Income: PKR {calc_results.get('taxable_income', 0):,.2f}\n"
            f"- Determined Slab: {slab}\n"
            f"- Base Tax: PKR {calc_results.get('base_tax', 0):,.2f}\n"
            f"- Variable Tax: PKR {calc_results.get('variable_tax', 0):,.2f}\n"
            f"- Total Tax Payable: PKR {tax:,.2f}\n"
            f"- Effective Tax Rate: {effective}\n\n"
            "INSTRUCTIONS:\n"
            "1. Explain step-by-step how the tax is calculated using progressive slabs under the First Schedule of the Income Tax Ordinance. Mention how the salary/business income falls into the determined slab and how base tax and variable rate are applied.\n"
            "2. Reference the taxpayer's filer status (Active ATL) and explain how being a filer impacts their tax liability or rates compared to non-filers.\n"
            "3. Insert the exact placeholder '{{TAX_COMPUTATION_TABLE}}' at the beginning or within your explanation where the summary table should be rendered. Do NOT generate the HTML table or list the raw keys yourself; only output the placeholder.\n"
            "4. Append the HTML citation badge '<a class=\"cit-badge\" data-cit-idx=\"0\">1st Schedule</a>' when referring to the First Schedule or slab rates.\n"
            "5. Conclude your response with the standard disclaimer:\n"
            "'FBR Compliance Disclaimer: This is a simulation based on the approved specs for the current tax year. The results do not constitute professional tax advice.'\n"
            "6. Make the response detailed, professional, and well-structured, but directly get to the point without greeting preambles.\n"
            "7. CRITICAL FORMATTING RULES: 1. Do not output raw HTML tags like <div>, <h3>, or <table>. 2. Use standard Markdown for headings (###) and standard Markdown tables for all data summaries (excluding the {{TAX_COMPUTATION_TABLE}} placeholder itself). 3. Do not append system metadata, times, or system statuses to the end of the generated text."
        )
    elif intent == "eligibility" and elig_results:
        required_text = "REQUIRED to file a return" if elig_results.get("is_required") else "NOT required to file a return"
        reasons_text = "\n".join([f"- {r}" for r in elig_results.get("reasons", [])]) or "- Income does not exceed registration thresholds."
        
        prompt = (
            f"Explain clearly and in detail whether the user is required to register or file an income tax return based on these checks:\n"
            f"Filing Requirement: {required_text}\n"
            f"Statutory Reasons:\n{reasons_text}\n\n"
            "INSTRUCTIONS:\n"
            "1. Provide a detailed explanation of the user's filing requirements under Section 114 of the Income Tax Ordinance, 2001.\n"
            "2. Explain the statutory filing threshold (e.g., PKR 600,000 for salaried individuals, PKR 400,000 for non-salaried) and how the user's income compares to this threshold.\n"
            "3. Explain the next steps the user should take (e.g., registering on the FBR Iris portal and submitting the return).\n"
            "4. Append the HTML citation badge '<a class=\"cit-badge\" data-cit-idx=\"0\">Section 114</a>' next to mentions of Section 114 or filing requirements.\n"
            "5. Keep the response professional, detailed, and directly address the user without greeting preambles.\n"
            "6. Format your response using clear Markdown headers (###) and bullet points. Ensure all cross-referenced sections (e.g., **Section 114**) are highlighted in bold syntax."
        )
    elif intent == "generic":
        prompt = (
            f"Respond politely and professionally to the user's message: \"{last_query}\"\n"
            "Keep the response direct, concise, and helpful. Do NOT use greetings, welcome boilerplate, or conversational preambles. Focus on guiding the user on how TaxPilot can assist them with FBR income tax compliance, slab calculations, or filing eligibility check tasks.\n"
            "If the user message is completely unrelated to finance, tax, or FBR compliance (e.g., recipes, mechanical repairs), instantly output the standard refusal message: 'I am TaxPilot, an assistant specialized only in Pakistani FBR tax compliance, calculations, and filing eligibility. I cannot assist with out-of-scope requests.' Do not reason through out-of-scope requests or explain why you cannot answer."
        )
    else:
        context_str = ""
        citations = []
        for i, doc in enumerate(retrieved):
            clean_src = clean_source_name(doc['source'])
            context_str += f"[Chunk {i+1}]: Source: {clean_src} > Section: {doc['section']}\nContent: {doc['content']}\n\n"
            citations.append({
                "section": f"{clean_src} - {doc['section']}",
                "text": doc['content']
            })
            
        prompt = (
            f"Answer the user query: \"{last_query}\"\n\n"
            f"Context from FBR Documents:\n{context_str}\n"
            "CRITICAL INSTRUCTIONS FOR RESPONSE:\n"
            "1. Answer the query directly, professionally, and in detail. Do NOT include any greeting, preamble, introductory boilerplate, or concluding conversational text. Start with the direct answer.\n"
            "2. Provide complete and comprehensive information with clear explanations of steps or rules. Use structured bullet points or ordered lists, ensuring each point contains at least one or two descriptive sentences with necessary context and details.\n"
            "3. For every key fact, step, or rule stated from the FBR Documents, you MUST append a clickable citation badge using the EXACT HTML format: "
            "'<a class=\"cit-badge\" data-cit-idx=\"X\">Section Label</a>' where X is the 0-indexed document chunk number and 'Section Label' is the specific rule/section (e.g., 'Rule 44' or 'Section 114').\n"
            "4. NEVER output markdown-style links like [Rule 44](...) or footnote links for citations. ONLY use the HTML '<a class=\"cit-badge\" data-cit-idx=\"X\">Section Label</a>' format.\n"
            "5. If a fact cannot be supported by the provided context, state that clearly and briefly.\n"
            "6. If the provided reference chunks do not contain explicit step-by-step instructions for a task, state clearly what is available in the text first, and then direct the user to official FBR resources. Do not speculate, invent placeholder steps, or complain about missing context."
        )
        
    try:
        messages_to_send = [
            SystemMessage(content=system_prompt + user_context)
        ] + list(context_history) + [
            HumanMessage(content=prompt)
        ]
        
        response = safe_llm_invoke(messages_to_send)
        raw_content = extract_text_content(response.content)
        
        if intent == "calculator" and calc_results:
            if "{{TAX_COMPUTATION_TABLE}}" in raw_content:
                raw_content = raw_content.replace("{{TAX_COMPUTATION_TABLE}}", table_html)
            else:
                raw_content = table_html + "\n\n" + raw_content
                
        final_citations = state.get("citations", []) if (intent in ["calculator", "eligibility"]) else citations
        return {
            "messages": [AIMessage(content=raw_content)],
            "citations": final_citations
        }
    except Exception as e:
        logger.error(f"Response generation LLM call failed: {e}")
        raise RuntimeError(f"Response synthesis LLM request failed: {e}") from e

def memory_updater_node(state: AgentState) -> Dict[str, Any]:
    """
    Caches ongoing session computation values to PostgreSQL thread storage.

    Args:
        state: The current AgentState dict.

    Returns:
        Empty dictionary representing completed lifecycle updates.
    """
    user_id = state.get("user_id")
    thread_id = state.get("thread_id")
    calc_results = state.get("calculation_results", {})
    citations = state.get("citations", [])
    
    if not thread_id or not user_id:
        return {}
        
    db: Session = SessionLocal()
    try:
        thread = db.query(ChatThread).filter(ChatThread.thread_id == thread_id, ChatThread.user_id == user_id).first()
        if thread:
            if calc_results:
                thread.calculation_cache = {
                    "grossSalary": calc_results.get("gross_salary"),
                    "taxableSalary": calc_results.get("taxable_income"),
                    "taxOwed": calc_results.get("total_tax_owed"),
                    "rateText": calc_results.get("rate_description"),
                    "effectiveRate": calc_results.get("effective_rate"),
                    "salaryIncome": calc_results.get("salary_income"),
                    "businessIncome": calc_results.get("business_income"),
                    "rentalIncome": calc_results.get("rental_income"),
                    "taxableIncome": calc_results.get("taxable_income")
                }
            if citations:
                thread.citations_cache = citations
            
            thread.last_accessed_at = func.now()
            db.commit()
            
        logger.info(f"Database memory successfully synchronized for thread {thread_id}.")
    except Exception as e:
        logger.error(f"Error during memory update: {e}")
        db.rollback()
        raise RuntimeError(f"Database thread synchronization failed: {e}") from e
    finally:
        db.close()
        
    return {}
