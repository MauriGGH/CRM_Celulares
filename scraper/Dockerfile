# syntax=docker/dockerfile:1
# Imagen base del servicio de scraping/limpieza (Python 3.12).
# El equipo de datos (D3) es dueño de requirements.txt y del código en scraper/;
# este Dockerfile solo fija la forma: dependencias en una etapa, usuario sin root.
# Si algún spider necesita scrapy-playwright, cambiar la base a
# mcr.microsoft.com/playwright/python:v1.48.0-jammy en ambas etapas.
FROM python:3.12-slim AS deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt ./
RUN python -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt

FROM python:3.12-slim AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 scraper
WORKDIR /app
COPY --from=deps /opt/venv /opt/venv
COPY --chown=scraper:scraper . .
USER scraper
# El comando real lo define el equipo de datos (p. ej. "python -m scraper.run").
CMD ["python", "-m", "scraper"]
