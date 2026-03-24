// =========================
// MAPA
// =========================
let map = L.map("map", {
    preferCanvas: true,
    zoomControl: true,
    zoomSnap: 0.5,
    zoomDelta: 0.5
}).setView([-9, -75], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 4
}).addTo(map);

let climateLayer = null;
let indiceLayer = null;
let legend = null;
let capasLayers = {};
let activeMode = "climate";
let activeIndiceTipo = null;

// Cache frontend
const apiCache = new Map();

// =========================
// DICCIONARIOS
// =========================
const variables_dict = {
    pr: "Cambio relativo de la precipitación (%)",
    tasmax: "Cambio proyectado de la temperatura máxima (°C)",
    tasmin: "Cambio proyectado de la temperatura mínima (°C)"
};

const estaciones_dict = {
    annual: "Anual",
    def: "Verano (DJF)",
    mam: "Otoño (MAM)",
    jja: "Invierno (JJA)",
    son: "Primavera (SON)"
};

const indice_dict = {
    agricola: "Agricultura",
    electrica: "Electricidad",
    vivienda: "Vivienda",
    mineria: "Minería",
    salud: "Salud",
    cultura: "Cultura"
};

// =========================
// COLORES OFICIALES
// =========================
const prec_colors = [
    "#663300","#7b4d1b","#916836","#a68351","#bc9d6d","#d2b888","#e7d3a3",
    "#c1f4db","#a1d4bf","#80b3a3","#609387","#40736b","#20534f","#003333"
];

const temp_colors = [
    "#ffffcc","#fff7b9","#fff0a7","#ffe895","#fee983","#fed572","#fec460",
    "#feb44e","#fea446","#fd953f","#fd8038","#fc6531","#fb4b29","#f03523",
    "#e61f1d","#d7121f","#c70723","#b30026","#9a0026","#800026"
];

// =========================
// HELPERS
// =========================
function showLoading() {
    document.getElementById("loading").classList.remove("hidden");
}

function hideLoading() {
    document.getElementById("loading").classList.add("hidden");
}

function formatPeriodo(periodo) {
    return periodo.replace("_", "–");
}

function resetIndiceButtons() {
    document.querySelectorAll(".btn-indice").forEach(btn => {
        btn.classList.remove("active");
    });
}

function removeLegend() {
    if (legend) {
        map.removeControl(legend);
        legend = null;
    }
}

function clearIndiceLayer() {
    if (indiceLayer) {
        map.removeLayer(indiceLayer);
        indiceLayer = null;
    }
    resetIndiceButtons();
}

function clearClimateLayer() {
    if (climateLayer) {
        map.removeLayer(climateLayer);
        climateLayer = null;
    }
}

function getClimateDistrictName(props) {
    const candidates = ["DISTRITO", "distrito", "NOMBDIST", "NOMBRE", "name"];
    for (const c of candidates) {
        if (props[c] !== undefined && props[c] !== null && String(props[c]).trim() !== "") {
            return String(props[c]).trim();
        }
    }
    return "Distrito";
}

function getIndiceDistrictName(props) {
    const candidates = [
        "DISTRITO",
        "distrito",
        "NOMBDIST",
        "nomdist",
        "DIST_NOM",
        "NOMBRE_DIST",
        "nombdist"
    ];

    for (const c of candidates) {
        if (props[c] !== undefined && props[c] !== null && String(props[c]).trim() !== "") {
            return String(props[c]).trim().toUpperCase();
        }
    }

    return "SIN DATO";
}

function getIndiceValue(props) {
    const candidates = ["valor", "VALOR", "indice", "INDICE", "categoria", "CATEGORIA"];
    for (const c of candidates) {
        if (props[c] !== undefined && props[c] !== null) return props[c];
    }
    return null;
}

async function fetchCached(url) {
    if (apiCache.has(url)) {
        return apiCache.get(url);
    }

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Error al cargar ${url}`);
    }

    const data = await res.json();
    apiCache.set(url, data);
    return data;
}

function updateMapBounds(layer) {
    try {
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
            if (!window.__mapCenteredOnce) {
                map.fitBounds(bounds, { padding: [20, 20] });
                window.__mapCenteredOnce = true;
            }
        }
    } catch (e) {
        console.warn("No se pudo ajustar el zoom:", e);
    }
}

// =========================
// CLASIFICACIÓN CLIMA
// =========================
function getColor(value, variable) {
    if (value === null || value === undefined || isNaN(value)) {
        return "#cccccc";
    }

    let bins, colors;

    if (variable === "pr") {
        bins = [-999,-90,-75,-60,-45,-30,-15,0,15,30,45,60,75,90,999];
        colors = prec_colors;
    } else {
        bins = [-999,0.2,0.4,0.6,0.8,1.0,1.2,1.4,1.6,1.8,2.0,2.2,
                2.4,2.6,2.8,3.0,3.2,3.4,3.6,3.8,999];
        colors = temp_colors;
    }

    for (let i = 0; i < bins.length - 1; i++) {
        if (value > bins[i] && value <= bins[i + 1]) {
            return colors[i];
        }
    }

    return "#cccccc";
}

// =========================
// LEYENDA CLIMA
// =========================
function addLegend(variable) {
    removeLegend();

    legend = L.control({ position: "bottomleft" });

    legend.onAdd = function () {
        const div = L.DomUtil.create("div", "legend");

        if (variable === "pr") {
            const labels = [
                "<= -90","-90 a -75","-75 a -60","-60 a -45","-45 a -30",
                "-30 a -15","-15 a 0","0 a 15","15 a 30","30 a 45",
                "45 a 60","60 a 75","75 a 90",">= 90"
            ];

            div.innerHTML = "<b>Δ P (%)</b><br>";

            for (let i = 0; i < labels.length; i++) {
                div.innerHTML += `<i style="background:${prec_colors[i]}"></i> ${labels[i]}<br>`;
            }
        } else {
            const labels = [
                "<= 0.2","0.2 a 0.4","0.4 a 0.6","0.6 a 0.8","0.8 a 1.0",
                "1.0 a 1.2","1.2 a 1.4","1.4 a 1.6","1.6 a 1.8","1.8 a 2.0",
                "2.0 a 2.2","2.2 a 2.4","2.4 a 2.6","2.6 a 2.8","2.8 a 3.0",
                "3.0 a 3.2","3.2 a 3.4","3.4 a 3.6","3.6 a 3.8",">= 3.8"
            ];

            div.innerHTML = "<b>Δ T (°C)</b><br>";

            for (let i = 0; i < labels.length; i++) {
                div.innerHTML += `<i style="background:${temp_colors[i]}"></i> ${labels[i]}<br>`;
            }
        }

        return div;
    };

    legend.addTo(map);
}

// =========================
// LEYENDA ÍNDICE
// =========================
function addIndiceLegend() {
    removeLegend();

    legend = L.control({ position: "bottomleft" });

    legend.onAdd = function () {
        const div = L.DomUtil.create("div", "legend");

        div.innerHTML = `
            <b>Índice Multipeligro Climático (IMC) - SSP5-8.5 - 2050 </b><br><br>

            <i style="background:#d7191c"></i>
             <b>Muy Alto (0.75-1)</b>:
            Peligros climáticos extremos (inundaciones, sequías, calor/frío severo)
            <br><br>

            <i style="background:#f7941d"></i>
             <b>Alto (0.5-0.75)</b>:
            Eventos climáticos intensos y frecuentes (lluvias intensas, olas de calor/frío)
            <br><br>

            <i style="background:#f1dd00"></i>
             <b>Medio (0.25-0.5)</b>:
            Variabilidad climática moderada (episodios de lluvia o temperatura fuera de lo normal)
            <br><br>

            <i style="background:#9bc68b"></i>
             <b>Bajo (0-0.25)</b>:
            Condiciones climáticas normales o poco significativas
        `;

        return div;
    };

    legend.addTo(map);
}

function getIndiceColor(rawValue) {
    if (rawValue === null || rawValue === undefined) return "#cccccc";

    if (typeof rawValue === "string") {
        const txt = rawValue.toLowerCase();
        if (txt.includes("muy")) return "#d7191c";
        if (txt.includes("alto")) return "#f7941d";
        if (txt.includes("medio")) return "#f1dd00";
        if (txt.includes("bajo")) return "#9bc68b";
    }

    const value = parseFloat(rawValue);
    if (isNaN(value)) return "#cccccc";

    if (value >= 0.75) return "#d7191c";
    if (value >= 0.5) return "#f7941d";
    if (value >= 0.25) return "#f1dd00";
    return "#9bc68b";
}

// =========================
// CARGAR OPCIONES
// =========================
async function loadOptions() {
    showLoading();

    try {
        const data = await fetchCached("/options");

        fillSelect("periodo", data.periodos, null, true);
        fillSelect("variable", data.variables, variables_dict, false);
        fillSelect("estacion", data.estaciones, estaciones_dict, false);

        createIndiceButtons(data.indice || []);
        createCapas(data.capas || []);

        await loadClimateMap();
    } catch (err) {
        console.error(err);
        alert("No se pudieron cargar las opciones.");
    } finally {
        hideLoading();
    }
}

function fillSelect(id, values, dict = null, isPeriodo = false) {
    const sel = document.getElementById(id);
    sel.innerHTML = "";

    values.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = isPeriodo ? formatPeriodo(v) : (dict?.[v] || v);
        sel.appendChild(opt);
    });
}

// =========================
// MAPA CLIMÁTICO
// =========================
async function loadClimateMap() {
    const variable = document.getElementById("variable").value;
    const estacion = document.getElementById("estacion").value;
    const periodo = document.getElementById("periodo").value;

    const url = `/mapdata/${variable}/${estacion}/${periodo}`;

    showLoading();

    try {
        clearIndiceLayer();
        activeMode = "climate";
        activeIndiceTipo = null;

        const data = await fetchCached(url);

        clearClimateLayer();

        climateLayer = L.geoJSON(data, {
            renderer: L.canvas(),
            style: feature => ({
                fillColor: getColor(feature.properties.valor, variable),
                color: "#666666",
                weight: 0.35,
                fillOpacity: 0.85,
                interactive: true
            }),
            onEachFeature: (feature, layer) => {
                const distrito = getClimateDistrictName(feature.properties);
                const val = feature.properties.valor;

                let label = "Sin dato";
                if (val !== null && val !== undefined && !isNaN(val)) {
                    if (variable === "pr") {
                        label = `∆P: ${Number(val).toFixed(1)}%`;
                    } else {
                        label = `∆T: ${Number(val).toFixed(1)}°C`;
                    }
                }

                layer.bindPopup(`<b>DISTRITO:</b> ${distrito}<br><b>${label}</b>`);
            }
        }).addTo(map);

        addLegend(variable);
        updateMapBounds(climateLayer);

    } catch (err) {
        console.warn("No se pudo cargar el mapa climático", err);
        clearClimateLayer();
        removeLegend();
    } finally {
        hideLoading();
    }
}

// =========================
// ÍNDICE MULTIPELIGRO
// =========================
function createIndiceButtons(indices) {
    const container = document.getElementById("indice");
    container.innerHTML = "";

    indices.forEach(tipo => {
        const btn = document.createElement("button");
        btn.innerText = indice_dict[tipo] || tipo;
        btn.className = "btn-indice";
        btn.dataset.tipo = tipo;

        btn.onclick = async () => {
            resetIndiceButtons();
            btn.classList.add("active");
            await loadIndice(tipo);
        };

        container.appendChild(btn);
    });
}

async function loadIndice(tipo) {
    const periodo = document.getElementById("periodo").value;
    const url = `/indice/${tipo}/${periodo}`;

    showLoading();

    try {
        const data = await fetchCached(url);

        clearClimateLayer();
        if (indiceLayer) {
            map.removeLayer(indiceLayer);
        }

        activeMode = "indice";
        activeIndiceTipo = tipo;

        indiceLayer = L.geoJSON(data, {
            renderer: L.canvas(),
            style: feature => {
                const raw = getIndiceValue(feature.properties);
                return {
                    fillColor: getIndiceColor(raw),
                    color: "#5e005e",
                    weight: 0.6,
                    fillOpacity: 0.8,
                    interactive: true
                };
            },
            onEachFeature: (feature, layer) => {
                const distrito = getIndiceDistrictName(feature.properties);
                const raw = getIndiceValue(feature.properties);

                let imcText = "Sin dato";
                if (raw !== null && raw !== undefined && !isNaN(parseFloat(raw))) {
                    imcText = Number(raw).toFixed(2);
                } else if (raw !== null && raw !== undefined) {
                    imcText = String(raw);
                }

                layer.bindPopup(`
                    <b>DISTRITO:</b> ${distrito}<br>
                    <b>IMC:</b> ${imcText}
                `);
            }
        }).addTo(map);

        addIndiceLegend();
        updateMapBounds(indiceLayer);

    } catch (err) {
        alert("No existe índice para ese periodo");
        console.error(err);
    } finally {
        hideLoading();
    }
}

// =========================
// CAPAS
// =========================
function createCapas(capas) {
    const container = document.getElementById("capas");
    container.innerHTML = "";

    capas.forEach(capa => {
        const row = document.createElement("div");
        row.className = "capa-row";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.id = `chk_${capa}`;

        const label = document.createElement("label");
        label.htmlFor = chk.id;
        label.innerText = capa;

        chk.onchange = async () => {
            await toggleLayer(capa, chk.checked);
        };

        row.appendChild(chk);
        row.appendChild(label);
        container.appendChild(row);
    });
}

async function toggleLayer(capa, visible) {
    if (visible) {
        const url = `/layer/${capa}`;
        showLoading();

        try {
            const data = await fetchCached(url);

            if (capasLayers[capa]) {
                map.removeLayer(capasLayers[capa]);
            }

            capasLayers[capa] = L.geoJSON(data, {
                renderer: L.canvas(),
                style: {
                    color: "#000000",
                    weight: 1.0,
                    fillOpacity: 0
                },
                interactive: false
            }).addTo(map);
        } catch (err) {
            alert(`No se pudo cargar la capa ${capa}`);
            console.error(err);
        } finally {
            hideLoading();
        }
    } else {
        if (capasLayers[capa]) {
            map.removeLayer(capasLayers[capa]);
            capasLayers[capa] = null;
        }
    }
}

// =========================
// EVENTOS
// =========================
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("periodo").addEventListener("change", async () => {
        if (activeMode === "indice" && activeIndiceTipo) {
            await loadIndice(activeIndiceTipo);
        } else {
            await loadClimateMap();
        }
    });

    document.getElementById("variable").addEventListener("change", async () => {
        await loadClimateMap();
    });

    document.getElementById("estacion").addEventListener("change", async () => {
        await loadClimateMap();
    });

    loadOptions();
});