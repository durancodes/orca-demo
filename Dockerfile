# Stage 1: build the web UI
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: API + static UI
FROM python:3.11-slim
WORKDIR /app/backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ORCA_WEB_DIR=/app/web/dist
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/web/dist
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"
CMD ["uvicorn", "orca.api:app", "--host", "0.0.0.0", "--port", "8000"]
