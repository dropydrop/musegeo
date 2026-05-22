/**
 * MUSEGEO - PROTOTYPE DÉMO
 * Logique Frontend - Vanilla JS
 */

// --- 1. CONFIGURATION & INITIALISATION CARTE ---
// Coordonnées approximatives de Plouasne (Bretagne)
const PLOUASNE_COORDS = [48.324, -1.942];
const MAP_ZOOM = 14;

// Initialisation de la carte Leaflet
const map = L.map("map").setView(PLOUASNE_COORDS, MAP_ZOOM);

// Fond de carte OpenStreetMap (Standard, gratuit, sans clé API)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors - MuseGeo Démo',
  maxZoom: 19,
}).addTo(map);

// Couche pour stocker les polygones dessinés
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// --- 2. CONFIGURATION DE L'OUTIL DE DESSIN ---
// Configuration de Leaflet.draw sans ajouter l'interface par défaut (on utilise notre propre bouton)
const drawControl = new L.Control.Draw({
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: "#2e7d32",
        fillOpacity: 0.4,
        weight: 2,
      },
    },
    polyline: false,
    circle: false,
    rectangle: false,
    marker: false,
    circlemarker: false,
  },
  edit: false, // Pas de mode édition complexe pour la V1 démo
});

// Instance du module de dessin de polygone
const polygonDrawer = new L.Draw.Polygon(map, drawControl.options.draw.polygon);

// Activation du mode dessin au clic sur le bouton
document.getElementById("btn-draw").addEventListener("click", () => {
  polygonDrawer.enable();
});

// --- 3. ÉTAT LOCAL (PERSISTANCE) ---
let parcelles = []; // Array of { id, name, geoJSON }
let ndviChart = null; // Instance Chart.js

function loadParcelles() {
  const saved = localStorage.getItem("musegeo_parcelles");
  if (saved) {
    parcelles = JSON.parse(saved);
  }
}

function saveParcelles() {
  localStorage.setItem("musegeo_parcelles", JSON.stringify(parcelles));
}

// --- 4. GESTION DES PARCELLES ---
// Écouteur de fin de dessin Leaflet.draw
map.on(L.Draw.Event.CREATED, function (e) {
  const layer = e.layer;

  const newParcelle = {
    id: Date.now().toString(), // ID unique basé sur le timestamp
    name: `Parcelle ${parcelles.length + 1}`,
    geoJSON: layer.toGeoJSON(),
  };

  parcelles.push(newParcelle);
  saveParcelles();
  renderParcellesUI();

  // Auto-sélection de la nouvelle parcelle
  selectParcelle(newParcelle.id);
});

function renderParcellesUI() {
  const listEl = document.getElementById("parcelles-list");
  listEl.innerHTML = "";

  if (parcelles.length === 0) {
    listEl.innerHTML = `<div class="empty-state">Aucune parcelle.<br>Cliquez sur "Dessiner une parcelle" pour commencer.</div>`;
  } else {
    parcelles.forEach((p) => {
      const item = document.createElement("div");
      item.className = "parcelle-item";
      item.dataset.id = p.id;
      item.onclick = () => selectParcelle(p.id);

      item.innerHTML = `
                <span class="parcelle-name">${p.name}</span>
                <button class="btn-delete" onclick="deleteParcelle('${p.id}', event)" title="Supprimer la parcelle">🗑️</button>
            `;
      listEl.appendChild(item);
    });
  }

  drawParcellesOnMap();
}

function drawParcellesOnMap() {
  drawnItems.clearLayers();

  parcelles.forEach((p) => {
    const layer = L.geoJSON(p.geoJSON, {
      style: {
        color: "#2e7d32",
        weight: 2,
        fillOpacity: 0.4,
      },
    });

    // Au clic sur le polygone sur la carte, on sélectionne la parcelle
    layer.on("click", () => selectParcelle(p.id));
    drawnItems.addLayer(layer);
  });
}

window.deleteParcelle = function (id, event) {
  event.stopPropagation(); // Évite de déclencher la sélection au clic

  if (confirm("Voulez-vous vraiment supprimer cette parcelle ?")) {
    parcelles = parcelles.filter((p) => p.id !== id);
    saveParcelles();
    renderParcellesUI();

    // Fermer le dashboard si on vient de supprimer la parcelle active
    document.getElementById("dashboard-panel").classList.remove("active");
  }
};

function selectParcelle(id) {
  // 1. Mise à jour de l'UI (Sidebar active state)
  document.querySelectorAll(".parcelle-item").forEach((el) => {
    el.classList.remove("active");
    if (el.dataset.id === id) el.classList.add("active");
  });

  // 2. Centrer la carte sur la parcelle
  const parcelle = parcelles.find((p) => p.id === id);
  let center = PLOUASNE_COORDS;
  if (parcelle) {
    const layer = L.geoJSON(parcelle.geoJSON);
    map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 16 });
    center = layer.getBounds().getCenter();
  }

  // 3. Récupération et affichage des données NDVI
  const ndviData = fetchNDVI(id);
  renderChart(ndviData);
  renderDiagnostic(ndviData);

  // 4. Mise à jour du lien Copernicus dynamique
  updateDynamicCopernicusLink(center);

  // 5. Ouvrir le dashboard
  document.getElementById("dashboard-panel").classList.add("active");
}

/**
 * Génère l'URL Copernicus pour une coordonnée donnée
 */
function updateDynamicCopernicusLink(center) {
  const linkEl = document.getElementById("link-copernicus-dynamic");
  if (!linkEl) return;

  const lat = center.lat || center[0];
  const lng = center.lng || center[1];

  // Dates par défaut (3 derniers mois)
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(today.getMonth() - 3);

  const formatDate = (d) => d.toISOString().split("T")[0];
  const fromTime = formatDate(threeMonthsAgo) + "T00:00:00.000Z";
  const toTime = formatDate(today) + "T23:59:59.999Z";

  const visualizationUrl = "https://sh.dataspace.copernicus.eu/ogc/wms/a91f72b3-1e51-44f5-8e7c-6cd379246614";

  const params = new URLSearchParams({
    zoom: "15",
    lat: lat.toFixed(6),
    lng: lng.toFixed(6),
    themeId: "DEFAULT-THEME",
    visualizationUrl: visualizationUrl,
    datasetId: "S2_L2A_CDAS",
    fromTime: fromTime,
    toTime: toTime,
    layerId: "NDVI",
  });

  const url = "https://browser.dataspace.copernicus.eu/?" + params.toString();
  linkEl.href = url;
}

// --- 5. SIMULATION NDVI (Coeur de la démo) ---
/**
 * RÈGLE 4 : Génère une série temporelle simulée pour une parcelle.
 * Architecture évolutive : Dans la V2, cette fonction fera un appel fetch() vers Copernicus via Supabase.
 */
function fetchNDVI(parcelleId) {
  // Utilisation des derniers chiffres de l'ID pour avoir un rendu constant (déterministe) pour une même parcelle
  const seed = parseInt(parcelleId.slice(-3)) || 123;

  const dates = [
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
  ];
  // Courbe standard : valeurs basses au printemps, pic en été, baisse en automne
  const baseCurve = [0.3, 0.45, 0.65, 0.8, 0.75, 0.6, 0.45, 0.35];

  const data = [];

  // Détermination pseudo-aléatoire d'une anomalie (1 chance sur 3 d'avoir un stress)
  const hasAnomaly = seed % 3 === 0;
  const anomalyIndex = hasAnomaly ? 4 + (seed % 3) : -1; // Stress en juillet, aout ou septembre

  for (let i = 0; i < dates.length; i++) {
    let value = baseCurve[i] + Math.sin(seed + i) * 0.05; // Légère variation naturelle
    let isCloud = false;
    let isAnomaly = false;

    // Simulation d'un nuage (valeur artificielle très basse)
    if ((seed + i) % 7 === 0 && i !== anomalyIndex) {
      value = 0.15;
      isCloud = true;
    }

    // Simulation de l'anomalie
    if (i === anomalyIndex) {
      value = value - 0.35; // Chute brutale du NDVI
      isAnomaly = true;
    }

    // Bornage réaliste entre 0.1 et 0.9
    value = Math.max(0.1, Math.min(0.9, value));

    data.push({
      date: dates[i],
      value: parseFloat(value.toFixed(2)),
      isCloud: isCloud,
      isAnomaly: isAnomaly,
    });
  }

  return data;
}

// --- 6. AFFICHAGE DU GRAPHIQUE (Chart.js) ---
function renderChart(ndviData) {
  const ctx = document.getElementById("ndviChart").getContext("2d");

  if (ndviChart) {
    ndviChart.destroy();
  }

  const labels = ndviData.map((d) => d.date);
  const dataPoints = ndviData.map((d) => d.value);

  ndviChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Indice de Végétation (NDVI)",
          data: dataPoints,
          borderColor: "#2e7d32",
          backgroundColor: "rgba(46, 125, 50, 0.1)",
          borderWidth: 2,
          // Règle de couleur : Gris pour nuage, Rouge pour anomalie, Vert normal
          pointBackgroundColor: ndviData.map((d) => {
            if (d.isCloud) return "#9e9e9e";
            if (d.isAnomaly) return "#d32f2f";
            return "#2e7d32";
          }),
          pointBorderColor: "#ffffff",
          pointRadius: ndviData.map((d) =>
            d.isAnomaly ? 6 : d.isCloud ? 4 : 5,
          ),
          pointHoverRadius: 8,
          fill: true,
          tension: 0.3, // Courbe légèrement lissée
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      scales: {
        y: {
          min: 0,
          max: 1,
          title: {
            display: true,
            text: "Valeur NDVI",
          },
        },
      },
      plugins: {
        legend: {
          display: false, // Légende cachée pour simplifier l'UI (le titre fait office de légende)
        },
        tooltip: {
          callbacks: {
            // RÈGLE 4 : Affichage spécifique pour les nuages
            label: function (context) {
              const d = ndviData[context.dataIndex];
              if (d.isCloud) {
                return " Donnée masquée (nuage/sol nu)";
              }
              return ` NDVI : ${d.value}`;
            },
          },
        },
      },
    },
  });
}

// --- 7. DIAGNOSTIC RAG SIMULÉ ---
function renderDiagnostic(ndviData) {
  const contentEl = document.getElementById("diagnostic-content");
  const anomalyEl = document.getElementById("diagnostic-anomaly");

  // Les nuages ne sont pas pris en compte pour l'analyse
  const validData = ndviData.filter((d) => !d.isCloud);

  if (validData.length === 0) {
    contentEl.innerHTML = "Données insuffisantes pour établir un diagnostic.";
    anomalyEl.innerHTML = "";
    return;
  }

  // Trouvons le pic de saison (valeur maximale de NDVI atteinte) et son mois
  let peakPoint = validData[0];
  for (let i = 1; i < validData.length; i++) {
    if (validData[i].value > peakPoint.value) {
      peakPoint = validData[i];
    }
  }

  const anomalyPoint = ndviData.find((d) => d.isAnomaly);
  let diagnosticText = "";

  // 1. Analyse basée sur le Pic de Saison (Potentiel fourrager global)
  if (peakPoint.value > 0.75) {
    diagnosticText += `🟢 <strong>Fort potentiel fourrager :</strong> Excellent pic de végétation atteint en ${peakPoint.date} (NDVI de ${peakPoint.value}). La parcelle montre une dynamique de croissance optimale.`;
  } else if (peakPoint.value >= 0.55) {
    diagnosticText += `🟡 <strong>Production moyenne :</strong> Pic de végétation modéré en ${peakPoint.date} (NDVI de ${peakPoint.value}). Rendement correct mais à surveiller selon les besoins de votre cheptel.`;
  } else {
    diagnosticText += `🔴 <strong>Faible vigueur générale :</strong> Le pic de végétation est resté bas (NDVI max de ${peakPoint.value} en ${peakPoint.date}). Risque important de déficit fourrager sur cette parcelle.`;
  }

  // 2. Analyse de la tendance récente (évite de fausser avec la baisse automnale normale)
  if (anomalyPoint) {
    diagnosticText += `<br><br>📈 <strong>Tendance récente :</strong> Perturbée. Une baisse brutale et précoce a été enregistrée en ${anomalyPoint.date}, en déviation de la courbe saisonnière normale.`;
  } else {
    diagnosticText += `<br><br>📈 <strong>Tendance récente :</strong> Déclin automnal physiologique normal en cours (sénescence naturelle de fin de saison).`;
  }

  contentEl.innerHTML = diagnosticText;

  // Recherche d'une anomalie dans toute la série
  if (anomalyPoint) {
    anomalyEl.innerHTML = `
            <div class="anomaly-alert">
                ⚠️ <strong>Anomalie détectée en ${anomalyPoint.date} :</strong> 
                une baisse rapide a été enregistrée. Vérifier l'état de la parcelle. 
                <br><br><em>(Raison possible : Stress hydrique localisé, ravageur, ou fauche précoce)</em>
            </div>
        `;
  } else {
    anomalyEl.innerHTML = "";
  }
}

// --- 8. LOGIQUE DU SONDAGE ET INTERACTIONS SECONDAIRES ---

// Ouverture / Fermeture modal
document.getElementById("btn-open-survey").addEventListener("click", () => {
  document.getElementById("survey-modal").classList.add("active");
});

document.getElementById("btn-close-survey").addEventListener("click", () => {
  document.getElementById("survey-modal").classList.remove("active");
});

// Soumission du formulaire
document.getElementById("survey-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const utilite = document.getElementById("survey-utilite").value;
  const feature = document.getElementById("survey-feature").value;

  console.log("=== RÉSULTATS DU SONDAGE (POUR V2) ===");
  console.log("Utilité perçue :", utilite);
  console.log("Fonctionnalité prioritaire :", feature);

  alert(
    "Merci ! Votre avis a bien été enregistré. Il sera précieux pour concevoir la V2 de l'outil.",
  );

  document.getElementById("survey-modal").classList.remove("active");
  e.target.reset(); // Vider le formulaire
});

// Lien INRAE (Simulation)
document.getElementById("link-inrae").addEventListener("click", (e) => {
  e.preventDefault();
  alert(
    "Exemple de fiche technique INRAE – VERSION DÉMO.\n\n(Dans la version finale, ce lien ouvrira une vraie fiche technique adaptée au contexte local et à l'anomalie détectée).",
  );
});

// Fermeture du Dashboard
document.getElementById("btn-close-dashboard").addEventListener("click", () => {
  document.getElementById("dashboard-panel").classList.remove("active");
  document
    .querySelectorAll(".parcelle-item")
    .forEach((el) => el.classList.remove("active"));
});

// --- 9. BOOTSTRAP ---
document.addEventListener("DOMContentLoaded", () => {
  loadParcelles();
  renderParcellesUI();
});
