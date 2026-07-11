# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/backend \
    PORT=7860 \
    HOME=/home/user

# Setup system user for Hugging Face Spaces (UID 1000)
RUN useradd -m -u 1000 user

# Set working directory
WORKDIR /app

# Install system dependencies (build-essential for bcrypt compilation if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file first for caching
COPY backend/requirements.txt /app/requirements.txt

# Install dependencies
RUN pip install --no-cache-dir -r /app/requirements.txt

# Pre-download the SentenceTransformer model to cache it in the image layer
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Copy the entire workspace contents to the container
COPY --chown=user:user . /app

# Create necessary home directories and set permissions for user 1000
RUN mkdir -p /home/user/.cache && chown -R user:user /home/user

# Switch to the non-root user
USER user

# Expose port
EXPOSE 7860

# Run uvicorn server, binding to the PORT env variable defined by HF Spaces
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
