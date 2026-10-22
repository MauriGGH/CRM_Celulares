import json
import os
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
BACKEND_URL = os.getenv("BACKEND_INGEST_URL", "http://localhost:3001/internal/v1/ingest/batches")
TOKEN = os.getenv("INGEST_SERVICE_TOKEN", "dev-token")
TIPO_CAMBIO_USD_MXN = 20.0

def parsear_capacidad_gb(texto_cap: str):
    texto = texto_cap.strip().upper()
    match = re.search(r"(\d+)\s*(TB|GB)", texto)
    if not match:
        return None
    valor = int(match.group(1))
    unidad = match.group(2)
    return valor * 1024 if unidad == "TB" else valor

def parsear_ram_gb(texto_ram: str):
    if not texto_ram:
        return None
    primera_parte = texto_ram.split("/")[0]
    return parsear_capacidad_gb(primera_parte)

def convertir_precio_mxn(precio_raw: str) -> str:
    limpio = str(precio_raw).replace(",", "")
    match = re.search(r"(\d+(?:\.\d+)?)", limpio)
    if not match:
        return "0.00"
    usd = float(match.group(1))
    mxn = usd * TIPO_CAMBIO_USD_MXN
    return f"{mxn:.2f}"

def transformar_datos(ruta_json: Path) -> list:
    with open(ruta_json, "r", encoding="utf-8") as f:
        celulares_crudos = json.load(f)

    records = []
    for item in celulares_crudos:
        item_id = item.get("id")
        brand = item.get("marca", "").strip()
        model = item.get("modelo", "").strip()
        source_url = item.get("url_gsmarena", "").strip()
        imagen_url = item.get("imagen", "").strip()
        price_mxn = convertir_precio_mxn(item.get("precio", "0"))
        ram_gb = parsear_ram_gb(item.get("memoria_ram", ""))

        raw_storages = [s.strip() for s in item.get("almacenamiento", "").split("/") if s.strip()]
        if not raw_storages:
            raw_storages = [""]

        for raw_st in raw_storages:
            storage_gb = parsear_capacidad_gb(raw_st)
            sufijo_id = f"-{storage_gb}gb" if storage_gb else ""
            external_id = f"gsmarena-{item_id}{sufijo_id}"

            record = {
                "external_id": external_id,
                "source_url": source_url,
                "brand": brand,
                "model": model,
                "storage_gb": storage_gb,
                "ram_gb": ram_gb,
                "color": None,
                "condition": "nuevo",
                "price": price_mxn,
                "currency": "MXN",
                "in_stock": True,
                "gtin": None,
                "specs": {
                    "processor": item.get("procesador"),
                    "display_info": item.get("pantalla"),
                    "dimensions_weight": item.get("medidas"),
                    "battery_info": item.get("bateria"),
                    "main_camera": item.get("camara_principal"),
                    "os": item.get("sistema_operativo")
                },
                "images": [imagen_url] if imagen_url else []
            }
            records.append(record)

    return records

def generar_lote_payload(records: list) -> dict:
    ahora_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "schema_version": "1.0",
        "source": "gsmarena",
        "scraped_at": ahora_iso,
        "records": records[:1000]
    }

def enviar_al_backend(payload: dict, idempotency_key: str = "lote-gsmarena-01"):
    body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        BACKEND_URL,
        data=body_bytes,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Idempotency-Key": idempotency_key,
            "Content-Type": "application/json"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"Éxito HTTP {resp.status}: {resp.read().decode('utf-8')}")
    except urllib.error.HTTPError as e:
        print(f"Error HTTP {e.code}: {e.read().decode('utf-8')}")
    except urllib.error.URLError as e:
        print(f"Backend apagado o inaccesible en {BACKEND_URL} ({e.reason}).")

if __name__ == "__main__":
    ruta_entrada = BASE_DIR / "celulares.json"
    ruta_salida = BASE_DIR / "ingest-batch.ready.json"

    registros_limpios = transformar_datos(ruta_entrada)
    lote = generar_lote_payload(registros_limpios)

    with open(ruta_salida, "w", encoding="utf-8") as f:
        json.dump(lote, f, indent=2, ensure_ascii=False)

    print(f"Transformados 100 modelos en {len(registros_limpios)} variantes válidas.")
    print(f"Archivo listo guardado en: {ruta_salida}")
    enviar_al_backend(lote)