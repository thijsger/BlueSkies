import { PHASE_COLORS, PHASE_LABEL } from "./util.js";

// Render the GPS ground track on a real map (Leaflet + Esri satellite imagery,
// no API key needed). The track is split into phase-coloured segments;
// exit / landing / target are marked. Great for reading the canopy pattern.
export function mountMap(container, jump) {
  const samples = (jump.series || []).filter((s) => s.lat != null && s.lng != null);
  if (typeof L === "undefined" || samples.length < 2) {
    container.innerHTML = '<p class="muted" style="padding:2rem;text-align:center">Geen GPS-track beschikbaar voor de kaart.</p>';
    return () => {};
  }

  const map = L.map(container, { zoomControl: true, attributionControl: true });

  const sat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics" }
  );
  const labels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, opacity: 0.9 }
  );
  const plain = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 20, attribution: "&copy; OpenStreetMap &copy; CARTO" }
  );

  const satGroup = L.layerGroup([sat, labels]).addTo(map);
  L.control.layers(
    { "Satelliet": satGroup, "Kaart": plain },
    null,
    { position: "topright" }
  ).addTo(map);

  // phase-coloured track segments (overlap by one point so they connect)
  let segStart = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].phase !== samples[i - 1].phase) {
      addSegment(segStart, i - 1);
      segStart = i - 1;
    }
  }
  addSegment(segStart, samples.length - 1);

  function addSegment(a, b) {
    if (b <= a) return;
    const pts = [];
    for (let i = a; i <= b; i++) pts.push([samples[i].lat, samples[i].lng]);
    const color = PHASE_COLORS[samples[a].phase] || "#888";
    // subtle dark casing under the coloured line for contrast on imagery
    L.polyline(pts, { color: "#0b1020", weight: 6, opacity: 0.4, lineJoin: "round", lineCap: "round" }).addTo(map);
    L.polyline(pts, { color, weight: 3.5, opacity: 0.98, lineJoin: "round", lineCap: "round" }).addTo(map);
  }

  // markers
  const s = jump.summary || {};
  marker(s.exitPoint, "EXIT", "#e8870f");
  marker(s.landingPoint, "LANDING", "#08b97a");
  marker(jump.target, "TARGET", "#2f6bff");

  function marker(p, label, color) {
    if (!p || p.lat == null) return;
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: "",
        html: `<div class="map-pin"><i style="background:${color}"></i><b>${label}</b></div>`,
        iconSize: [0, 0],
      }),
    }).addTo(map);
  }

  // phase legend control
  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "map-legend");
    const present = [...new Set(samples.map((x) => x.phase))];
    div.innerHTML = present
      .map((ph) => `<span><i style="background:${PHASE_COLORS[ph]}"></i>${PHASE_LABEL[ph] || ph}</span>`)
      .join("");
    return div;
  };
  legend.addTo(map);

  const bounds = L.latLngBounds(samples.map((x) => [x.lat, x.lng]));
  map.fitBounds(bounds.pad(0.18));
  setTimeout(() => map.invalidateSize(), 80);

  return () => { map.remove(); };
}
