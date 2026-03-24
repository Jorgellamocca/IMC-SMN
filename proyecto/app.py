from flask import Flask, render_template, jsonify
import os
import json
import geopandas as gpd

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

DATA_DIR = "data"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

LAYER_PATHS = {
    "departamentos": os.path.join(BASE_DIR, "data", "layers", "Departamental.shp"),
    "provincias": os.path.join(BASE_DIR, "data", "layers", "Provincial.shp"),
    "cuencas": os.path.join(BASE_DIR, "data", "layers", "UH.shp"),
}

VALID_VARIABLES = {"pr", "tasmax", "tasmin"}
VALID_ESTACIONES = {"def", "mam", "jja", "son", "annual", "anual"}

# =========================
# CACHE / ÍNDICES
# =========================
GEOJSON_CACHE = {}
CLIMATE_INDEX = {}
INDICE_INDEX = {}
OPTIONS_CACHE = None

# Si quieres simplificar geometrías para más velocidad:
# SIMPLIFY_TOLERANCE = 0.001
SIMPLIFY_TOLERANCE = None


def normalize_estacion(value: str) -> str:
    v = value.strip().lower()
    if v == "anual":
        return "annual"
    return v


def parse_climate_filename(filename: str):
    """
    Ejemplo esperado:
    distritos_cambio_pr_DEF_cmip6_2036_2065_5km.geojson
    distritos_cambio_tasmin_annual_cmip6_2036_2065_5km.geojson
    """
    if not filename.endswith(".geojson"):
        return None

    name = filename[:-8]
    parts = name.split("_")

    if len(parts) < 8:
        return None

    if parts[0].lower() != "distritos":
        return None

    if parts[1].lower() != "cambio":
        return None

    variable = parts[2].lower()
    estacion = normalize_estacion(parts[3])
    escenario = parts[4].lower()
    periodo = f"{parts[5]}_{parts[6]}"

    if variable not in VALID_VARIABLES:
        return None

    if estacion not in VALID_ESTACIONES:
        return None

    if escenario != "cmip6":
        return None

    return {
        "filename": filename,
        "variable": variable,
        "estacion": estacion,
        "periodo": periodo,
    }


def parse_indice_filename(filename: str):
    """
    Ejemplo:
    indice_multipeligro_agricola_2036_2065.geojson
    """
    if not filename.endswith(".geojson"):
        return None

    name = filename[:-8]
    parts = name.split("_")

    if len(parts) < 5:
        return None

    if parts[0].lower() != "indice" or parts[1].lower() != "multipeligro":
        return None

    tipo = parts[2].lower()
    periodo = f"{parts[3]}_{parts[4]}"

    return {
        "filename": filename,
        "tipo": tipo,
        "periodo": periodo,
    }


def build_indexes():
    global CLIMATE_INDEX, INDICE_INDEX, OPTIONS_CACHE

    climate_index = {}
    indice_index = {}

    variables = set()
    estaciones = set()
    periodos = set()
    indices = set()

    if not os.path.isdir(DATA_DIR):
        CLIMATE_INDEX = {}
        INDICE_INDEX = {}
        OPTIONS_CACHE = {
            "variables": [],
            "estaciones": [],
            "periodos": [],
            "indice": [],
            "capas": list(LAYER_PATHS.keys())
        }
        return

    for f in os.listdir(DATA_DIR):
        climate = parse_climate_filename(f)
        if climate:
            key = (
                climate["variable"],
                climate["estacion"],
                climate["periodo"]
            )
            climate_index[key] = os.path.join(DATA_DIR, climate["filename"])
            variables.add(climate["variable"])
            estaciones.add(climate["estacion"])
            periodos.add(climate["periodo"])
            continue

        indice = parse_indice_filename(f)
        if indice:
            key = (indice["tipo"], indice["periodo"])
            indice_index[key] = os.path.join(DATA_DIR, indice["filename"])
            indices.add(indice["tipo"])

    variable_order = ["pr", "tasmax", "tasmin"]
    estacion_order = ["annual", "def", "mam", "jja", "son"]
    indice_order = ["agricola", "electrica", "vivienda", "mineria", "salud", "cultura"]

    CLIMATE_INDEX = climate_index
    INDICE_INDEX = indice_index
    OPTIONS_CACHE = {
        "variables": [v for v in variable_order if v in variables],
        "estaciones": [e for e in estacion_order if e in estaciones],
        "periodos": sorted(periodos),
        "indice": [i for i in indice_order if i in indices],
        "capas": list(LAYER_PATHS.keys())
    }


def load_geojson_cached(path: str):
    if path in GEOJSON_CACHE:
        return GEOJSON_CACHE[path]

    gdf = gpd.read_file(path)

    if gdf.crs is not None and gdf.crs.to_string() != "EPSG:4326":
        gdf = gdf.to_crs(epsg=4326)

    if SIMPLIFY_TOLERANCE is not None:
        gdf["geometry"] = gdf["geometry"].simplify(
            tolerance=SIMPLIFY_TOLERANCE,
            preserve_topology=True
        )

    geojson_dict = json.loads(gdf.to_json())
    GEOJSON_CACHE[path] = geojson_dict
    return geojson_dict


def preload_static_layers():
    for _, shp_path in LAYER_PATHS.items():
        if os.path.exists(shp_path):
            try:
                load_geojson_cached(shp_path)
            except Exception as e:
                print(f"[WARN] No se pudo precargar capa {shp_path}: {e}")


def preload_first_files(limit=4):
    loaded = 0
    for _, path in CLIMATE_INDEX.items():
        try:
            load_geojson_cached(path)
            loaded += 1
            if loaded >= limit:
                break
        except Exception as e:
            print(f"[WARN] No se pudo precargar {path}: {e}")

    loaded = 0
    for _, path in INDICE_INDEX.items():
        try:
            load_geojson_cached(path)
            loaded += 1
            if loaded >= limit:
                break
        except Exception as e:
            print(f"[WARN] No se pudo precargar índice {path}: {e}")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/options")
def options():
    return jsonify(OPTIONS_CACHE)


@app.route("/mapdata/<variable>/<estacion>/<periodo>")
def mapdata(variable, estacion, periodo):
    variable = variable.lower().strip()
    estacion = normalize_estacion(estacion)
    periodo = periodo.strip()

    path = CLIMATE_INDEX.get((variable, estacion, periodo))

    if path is None:
        return jsonify({
            "error": f"No se encontró archivo para variable={variable}, estacion={estacion}, periodo={periodo}"
        }), 404

    return jsonify(load_geojson_cached(path))


@app.route("/indice/<tipo>/<periodo>")
def indice(tipo, periodo):
    tipo = tipo.lower().strip()
    periodo = periodo.strip()

    path = INDICE_INDEX.get((tipo, periodo))

    if path is None:
        return jsonify({
            "error": f"No se encontró índice para tipo={tipo}, periodo={periodo}"
        }), 404

    return jsonify(load_geojson_cached(path))


@app.route("/layer/<capa>")
def layer(capa):
    capa = capa.lower().strip()

    if capa not in LAYER_PATHS:
        return jsonify({"error": "Capa no válida"}), 404

    shp_path = LAYER_PATHS[capa]

    if not os.path.exists(shp_path):
        return jsonify({"error": f"No existe {shp_path}"}), 404

    return jsonify(load_geojson_cached(shp_path))


build_indexes()
preload_static_layers()
preload_first_files(limit=4)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8085))
    app.run(host="0.0.0.0", port=port, debug=False)
