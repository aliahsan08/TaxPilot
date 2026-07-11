---
title: TaxPilot
emoji: ⚖️
colorFrom: indigo
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# TaxPilot ⚖️

TaxPilot is a premium AI assistant for Pakistani FBR income tax compliance, combining a deterministic calculation engine with semantic RAG retrieval capabilities. Built on a stateless FastAPI backend and a LangGraph workflow engine, it helps taxpayers navigate the Normal Tax Regime (NTR) rules, compute statutory return liabilities for Tax Year 2026/2027, and search through verified FBR regulatory documents.

---

## Key Features

- **Progressive NTR Tax Calculator**: Automatically aggregates Net Salary, Business Income, and Rental Property Income (calculating the automatic 20% repair deductions under Section 15).
- **Dynamic Regime Determination**: Classifies the taxpayer category as *Salaried Individual* or *Non-Salaried / Business* based on whether Salary exceeds 75% of taxable NTR income, applying appropriate progressive slabs.
- **Dynamic Parameter Overwrites**: Leverages LLM parsing to dynamically identify monthly or yearly income figures stated in user chat messages and override calculation parameters temporarily for that prompt (converting monthly values to annual figures automatically).
- **Tenth Schedule Penalties & Filers**: Correctly maps filers vs. non-filers according to FBR guidelines. Filers and non-filers are calculated with identical statutory return tax rates, as Tenth Schedule penalties apply to source withholding cash deductions rather than year-end slab rates.
- **RAG semantic search**: Resolves tax queries using dense vector chunk retrieval from verified FBR manuals and guides.
- **Interactive History**: View and manage previous session calculations, search results, and chat logs. Included is a secure trash interface to delete entries.
- **Built-in Rate Limiting**: Restricts requests to 15 actions per user per minute to safeguard API resources.

---

## Technology Stack

- **Frontend**: Vanilla HTML5, CSS3 (featuring HSL variables, glassmorphism, and responsive CSS grids), and modular JavaScript.
- **Backend API**: FastAPI (Python 3.11) with Uvicorn server layers.
- **Database ORM**: PostgreSQL database (hosted on **Supabase**) via SQLAlchemy.
- **Workflow Orchestration**: LangGraph workflow pipeline.
- **Semantic Search**: Qdrant Vector DB with `SentenceTransformer` text embeddings.
- **Large Language Model**: `llama-3.3-70b-versatile` hosted on Groq.

---

## Getting Started

### 1. Prerequisites

- Python 3.11+ installed.
- PostgreSQL database instance (or a free **Supabase** account).
- **Qdrant** instance (local, Docker, or Qdrant Cloud cluster).
- **Groq API Key** for conversational reasoning.

### 2. Environment Configurations

Create a `.env` file in the root workspace folder with the following variables:

```ini
# FastAPI Server Settings
HOST=0.0.0.0
PORT=8000
DEBUG=True

# Supabase PostgreSQL Connection
DATABASE_URL="postgresql+psycopg2://postgres:<password>@<supabase-pooler-host>:5432/postgres"

# Qdrant Vector DB Settings
QDRANT_HOST="your-qdrant-host-url"
QDRANT_PORT=6333
QDRANT_API_KEY="your-qdrant-api-key"
QDRANT_COLLECTION="taxpilot_docs"

# LLM API Settings
LLM_API_KEY="your-groq-api-key"
```

### 3. Local Installation & Run

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/taxpilot.git
   cd taxpilot
   ```

2. **Create and activate a virtual environment**:
   ```bash
   python -m venv .venv
   # Windows:
   .\.venv\Scripts\activate
   # Linux/macOS:
   source .venv/bin/activate
   ```

3. **Install Dependencies**:
   ```bash
   pip install -r backend/requirements.txt
   ```

4. **Initialize Database Tables**:
   At startup, FastAPI will automatically initialize PostgreSQL tables, indexes, and constraints if they do not exist.

5. **Start the FastAPI server**:
   ```bash
   python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

6. **Access the application**:
   Open [http://127.0.0.1:8000/login.html](http://127.0.0.1:8000/login.html) in your web browser.

---

## Containerized Deployment (Docker)

To deploy the application as a single Docker container hosting both the frontend files and the FastAPI backend:

### Build the Image
```bash
docker build -t taxpilot .
```

### Run the Container
```bash
docker run -d -p 7860:7860 \
  -e DATABASE_URL="your-supabase-db-url" \
  -e QDRANT_HOST="your-qdrant-host" \
  -e QDRANT_API_KEY="your-qdrant-api-key" \
  -e LLM_API_KEY="your-groq-api-key" \
  taxpilot
```

The application UI will be accessible at `http://localhost:7860/login.html` and the API documentation at `http://localhost:7860/docs`.

---

## Hugging Face Spaces Deployment

Since this project contains a valid Hugging Face frontmatter header and a customized Dockerfile, you can deploy it directly as a Docker Space:

1. Create a new Space on [Hugging Face](https://huggingface.co/new-space).
2. Choose **Docker** as the SDK.
3. Under **Repository Settings**, add the following **Repository Secrets**:
   * `DATABASE_URL`
   * `QDRANT_HOST`
   * `QDRANT_API_KEY`
   * `LLM_API_KEY`
4. Push the workspace repository to your Hugging Face Space git remote. It will automatically build and start the container on port `7860`.
