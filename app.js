/**
 * MUSEGEO V1 HYBRIDE — LOGIQUE FRONTEND
 * No-DB Architecture + Analyse Agronomique Déterministe
 */

(function () {
  "use strict";

  // --- CONFIGURATION ---
  const PLOUASNE_COORDS = [48.301, -2.007];
  const MAP_ZOOM = 14;

  // --- INITIALISATION CARTE ---
  const map = L.map("map", { zoomControl: false }).setView(PLOUASNE_COORDS, MAP_ZOOM);
  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; MuseGeo V1 · Copernicus Sentinel-2',
    maxZoom: 19,
  }).addTo(map);

  const drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  const drawControl = new L.Control.Draw({
    draw: {
      polygon: { allowIntersection: false, shapeOptions: { color: "#2e7d32", fillOpacity: 0.3 } },
      polyline: false, circle: false, rectangle: false, marker: false, circlemarker: false,
    },
    edit: { featureGroup: drawnItems, remove: true }
  });

  const polygonDrawer = new L.Draw.Polygon(map, drawControl.options.draw.polygon);
  document.getElementById("btn-draw").addEventListener("click", () => polygonDrawer.enable());

  // --- ÉTAT LOCAL ---
  let parcelles = JSON.parse(localStorage.getItem("musegeo_v1_parcelles") || "[]");
  let activeParcelId = null;
  let mainChart = null;

  // --- GESTION DES PARCELLES ---
  map.on(L.Draw.Event.CREATED, (e) => {
    const id = "P" + Date.now();
    const layer = e.layer;
    const geoJSON = layer.toGeoJSON();
    
    const newParcel = { id, name: "Parcelle " + (parcelles.length + 1), geoJSON, history: [] };
    parcelles.push(newParcel);
    saveAndRefresh();
    selectParcel(id);
  });

  function saveAndRefresh() {
    localStorage.setItem("musegeo_v1_parcelles", JSON.stringify(parcelles));
    renderParcelList();
    renderMapLayers();
  }

  function renderParcelList() {
    const list = document.getElementById("parcel-list");
    list.innerHTML = parcelles.length === 0 ? '<p style="font-size:12px;color:gray;text-align:center;margin-top:20px;">Aucune parcelle dessinée.</p>' : "";
    
    parcelles.forEach(p => {
      const item = document.createElement("div");
      item.className = `parcel-item ${p.id === activeParcelId ? 'active' : ''}`;
      item.onclick = () => selectParcel(p.id);
      item.innerHTML = `
        <span class="parcel-name">${p.name}</span>
        <button class="btn-del" onclick="deleteParcel('${p.id}', event)">🗑️</button>
      `;
      list.appendChild(item);
    });
  }

  function renderMapLayers() {
    drawnItems.clearLayers();
    parcelles.forEach(p => {
      if (p.geoJSON) {
        const layer = L.geoJSON(p.geoJSON, {
          style: { color: "#2e7d32", weight: 2, fillOpacity: 0.2 }
        });
        layer.on("click", () => selectParcel(p.id));
        drawnItems.addLayer(layer);
      }
    });
  }

  window.deleteParcel = function(id, e) {
    e.stopPropagation();
    if (confirm("Supprimer cette parcelle ?")) {
      parcelles = parcelles.filter(p => p.id !== id);
      if (activeParcelId === id) closeDashboard();
      saveAndRefresh();
    }
  };

  // --- SELECTION ET DASHBOARD ---
  window.selectParcel = function(id) {
    activeParcelId = id;
    renderParcelList();

    if (window.innerWidth <= 1024) {
      document.getElementById("sidebar").classList.remove("active");
    }

    const parcel = parcelles.find(p => p.id === id);
    if (!parcel) return;

    if (parcel.geoJSON) {
      const layer = L.geoJSON(parcel.geoJSON);
      map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 16 });
      updateCopernicusLink(layer.getBounds().getCenter());
    } else {
      updateCopernicusLink({ lat: PLOUASNE_COORDS[0], lng: PLOUASNE_COORDS[1] });
    }

    document.getElementById("dash-title").innerText = parcel.name;
    document.getElementById("dashboard").classList.add("active");

    updateDashboardUI();
  }

  function updateDashboardUI() {
    const parcel = parcelles.find(p => p.id === activeParcelId);
    if (!parcel || !parcel.history || parcel.history.length === 0) {
      document.getElementById("diag-text").innerText = "Aucune donnée importée pour cette parcelle. Utilisez la zone d'importation CSV.";
      document.getElementById("biomass-est").innerText = "Estimation Biomasse : -- kg MS/ha";
      document.getElementById("last-update").innerText = "Dernière mesure : --/--/----";
      if (mainChart) mainChart.destroy();
      return;
    }

    renderCharts();
    runDiagnostic();
  }

  function renderCharts() {
    const ctx = document.getElementById("mainChart").getContext("2d");
    if (mainChart) mainChart.destroy();

    const parcel = parcelles.find(p => p.id === activeParcelId);
    const activeTab = document.querySelector(".tab.active").dataset.index;
    
    const history = parcel.history.filter(d => d[activeTab] !== undefined).sort((a,b) => new Date(a.date) - new Date(b.date));

    if (history.length === 0) {
      document.getElementById("biomass-est").innerText = "Données " + activeTab.toUpperCase() + " manquantes.";
      return;
    }

    document.getElementById("last-update").innerText = `Dernière mesure : ${history[history.length-1].date}`;
    
    if (activeTab === 'ndvi') {
        const lastVal = history[history.length-1].ndvi;
        const biomass = Math.round(lastVal * 3500);
        document.getElementById("biomass-est").innerText = `Estimation Biomasse : ${biomass} kg MS/ha (empirique)`;
    } else {
        document.getElementById("biomass-est").innerText = "";
    }

    mainChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: history.map(d => d.date),
        datasets: [{
          label: activeTab.toUpperCase(),
          data: history.map(d => d[activeTab]),
          borderColor: activeTab === 'ndvi' ? "#00e676" : "#00b0ff",
          backgroundColor: "rgba(0, 230, 118, 0.05)",
          borderWidth: 3,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: "#fff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { 
            y: { 
                beginAtZero: true, 
                max: 1.0,
                grid: { color: "rgba(255,255,255,0.05)" },
                ticks: { color: "rgba(255,255,255,0.5)" }
            }, 
            x: { 
                grid: { display: false },
                ticks: { color: "rgba(255,255,255,0.5)" }
            } 
        },
        plugins: { 
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label + ': ' + context.parsed.y.toFixed(3);
                        if (activeTab === 'ndvi') {
                            label += ' | Env. ' + Math.round(context.parsed.y * 3500) + ' kg MS/ha';
                        }
                        return label;
                    }
                }
            }
        }
      }
    });
  }

  function runDiagnostic() {
    const parcel = parcelles.find(p => p.id === activeParcelId);
    const history = [...parcel.history].sort((a,b) => new Date(a.date) - new Date(b.date));
    const latest = history[history.length - 1];
    const diagEl = document.getElementById("diag-text");

    let message = "";
    
    // 1. NDWI Stress Hydrique
    if (latest.ndwi !== undefined && latest.ndwi < 0.3) {
        message = "💧 Stress hydrique probable – Surveiller l'irrigation";
    } 
    // 2. Chute brutale NDVI (Pleine saison Mai-Août)
    else if (history.length >= 2) {
        const prev = history[history.length - 2];
        const diff = prev.ndvi - latest.ndvi;
        const month = new Date(latest.date).getMonth() + 1;
        if (diff > 0.15 && month >= 5 && month <= 8) {
            message = `⚠️ Alerte : chute brutale détectée le ${latest.date} – Fauche accidentelle ? Piétinement ? Maladie ?`;
        }
    }

    // 3. Seuils NDVI si aucun message prioritaire
    if (!message && latest.ndvi !== undefined) {
        const val = latest.ndvi;
        if (val < 0.2) message = "🔴 Sol nu ou stress sévère – Vérifier immédiatement";
        else if (val < 0.4) message = "🟠 Végétation rare – Surveillance conseillée";
        else if (val < 0.6) message = "🟡 Végétation modérée – Potentiel moyen";
        else if (val < 0.8) message = "🟢 Végétation dense – Bon potentiel";
        else message = "🌟 Végétation très dense – Excellent potentiel";
    }

    diagEl.innerText = message || "Données insuffisantes pour un diagnostic.";
  }

  // --- PARSER CSV ---
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

  dropZone.onclick = () => fileInput.click();
  
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("dragover"); };
  dropZone.ondragleave = () => dropZone.classList.remove("dragover");
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  };

  function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
        alert("Veuillez sélectionner un fichier CSV.");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => processCSV(e.target.result);
    reader.readAsText(file);
  }

  function processCSV(content) {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return alert("Fichier CSV vide ou invalide.");

    const separator = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(separator).map(h => h.toLowerCase().trim());
    
    const dateIdx = headers.findIndex(h => h.includes("date") || h.includes("time"));
    const valueIdx = headers.findIndex(h => h.includes("mean") || h.includes("c0-mean"));

    if (dateIdx === -1 || valueIdx === -1) {
        return alert("❌ Format non reconnu. Vérifiez que votre export Copernicus est au format CSV avec des colonnes date et mean.");
    }

    const isNDWI = headers.some(h => h.includes("ndwi"));
    const indicator = isNDWI ? "ndwi" : "ndvi";

    const newData = lines.slice(1).map(line => {
        const parts = line.split(separator);
        if (parts.length <= Math.max(dateIdx, valueIdx)) return null;
        
        let date = parts[dateIdx].replace(/"/g, "");
        if (date.includes("T")) date = date.split("T")[0]; // YYYY-MM-DD
        
        const rawVal = parts[valueIdx].replace(/"/g, "").replace(",", ".");
        const value = parseFloat(rawVal);
        return { date, value };
    }).filter(d => d && !isNaN(d.value));

    if (newData.length === 0) return alert("Aucune donnée valide trouvée.");

    let targetParcel = parcelles.find(p => p.id === activeParcelId);
    
    if (!targetParcel) {
        const id = "P" + Date.now();
        const dateStr = new Date().toLocaleDateString("fr-FR");
        targetParcel = { id, name: "Import du " + dateStr, geoJSON: null, history: [] };
        parcelles.push(targetParcel);
        activeParcelId = id;
    }

    newData.forEach(d => {
        let entry = targetParcel.history.find(h => h.date === d.date);
        if (!entry) {
            entry = { date: d.date };
            targetParcel.history.push(entry);
        }
        entry[indicator] = d.value;
    });

    saveAndRefresh();
    window.selectParcel(activeParcelId);
  }

  // --- BACKUP & EXPORT ---
  document.getElementById("btn-export-all").onclick = () => {
    const dataStr = JSON.stringify(parcelles, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "musegeo_export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById("btn-import-backup").onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (re) => {
            try {
                const imported = JSON.parse(re.target.result);
                if (Array.isArray(imported)) {
                    parcelles = imported;
                    saveAndRefresh();
                    alert("Backup restauré avec succès !");
                }
            } catch (err) { alert("Fichier JSON invalide."); }
        };
        reader.readAsText(file);
    };
    input.click();
  };

  // --- UTILITAIRES ---
  window.toggleSheets = () => {
    const content = document.getElementById("sheets-content");
    const icon = document.getElementById("sheets-icon");
    content.classList.toggle("active");
    icon.innerText = content.classList.contains("active") ? "▲" : "▼";
  };

  window.closeDashboard = () => {
    document.getElementById("dashboard").classList.remove("active");
    activeParcelId = null;
    renderParcelList();
  };

  window.loadV0Demo = () => {
    const mockId = "P_SIMULATION";
    // Si elle existe déjà, on la supprime pour repartir sur une simu propre
    parcelles = parcelles.filter(p => p.id !== mockId);

    const demoParcel = {
        id: mockId,
        name: "🌾 Simulation Prairie (Plouasne)",
        geoJSON: {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [[[ -2.007, 48.301 ], [ -2.005, 48.301 ], [ -2.005, 48.299 ], [ -2.007, 48.299 ], [ -2.007, 48.301 ]]]
            }
        },
        history: [
            { date: "2024-03-10", ndvi: 0.35, ndwi: 0.40 },
            { date: "2024-03-25", ndvi: 0.48, ndwi: 0.38 },
            { date: "2024-04-10", ndvi: 0.62, ndwi: 0.35 },
            { date: "2024-04-28", ndvi: 0.78, ndwi: 0.32 },
            { date: "2024-05-15", ndvi: 0.85, ndwi: 0.31 },
            { date: "2024-05-22", ndvi: 0.52, ndwi: 0.28 } // Simulation d'une fauche accidentelle (chute brutale)
        ]
    };
    parcelles.unshift(demoParcel); // Mettre en haut de liste
    saveAndRefresh();
    window.selectParcel(mockId);
  };

  function updateCopernicusLink(center) {
    const link = document.getElementById("link-copernicus-browser");
    const params = new URLSearchParams({
      zoom: "15", lat: center.lat.toFixed(6), lng: center.lng.toFixed(6),
      themeId: "DEFAULT-THEME", datasetId: "S2_L2A_CDAS", layerId: "NDVI"
    });
    link.href = `https://browser.dataspace.copernicus.eu/?${params.toString()}`;
  }

  document.querySelectorAll(".tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      if (activeParcelId) updateDashboardUI();
    };
  });

  // --- SIDEBAR DRAG & TOGGLE ---
  const sidebar = document.getElementById("sidebar");
  const resizer = document.getElementById("resizer");
  const btnToggle = document.getElementById("btn-toggle-sidebar");

  btnToggle.addEventListener("click", () => {
    const isMobile = window.innerWidth <= 1024;
    if (isMobile) {
      sidebar.classList.toggle("active");
    } else {
      sidebar.classList.toggle("collapsed");
      setTimeout(() => map.invalidateSize(), 300);
    }
  });

  let isResizing = false;
  resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    let newWidth = e.clientX;
    if (newWidth < 280) newWidth = 280;
    if (newWidth > window.innerWidth * 0.5) newWidth = window.innerWidth * 0.5;
    document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);
    map.invalidateSize();
  });
  window.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove("dragging");
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
      map.invalidateSize();
    }
  });

  // --- BOOTSTRAP ---
  renderParcelList();
  renderMapLayers();

})();
