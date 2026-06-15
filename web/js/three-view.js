import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PHASE_COLORS } from "./util.js";
import { iconSVG } from "./icons.js";

// Real 3D environment (Google-Earth style): the actual satellite map is draped
// on the ground as a texture (Esri World Imagery export — no API key), and the
// jump track arcs above it as a phase-coloured 3D tube, with sky, fog, ground
// pins and an animated marker. Orbit / zoom / pan + a play/scrub control.
export function mount3D(container, scrubInput, playBtn, jump) {
  const samples = jump.series.filter((s) => s.lat != null && s.lng != null && s.alt != null);
  if (samples.length < 2) {
    container.innerHTML = '<p class="muted" style="padding:2rem;text-align:center">' +
      "Geen GPS-track beschikbaar voor 3D-weergave.</p>";
    return () => {};
  }

  // --- projection: lat/lng -> local metres around the first sample ---
  const lat0 = samples[0].lat, lng0 = samples[0].lng;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const minAlt = Math.min(...samples.map((s) => s.alt));

  // bbox (padded) for the ground map
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const s of samples) {
    minLat = Math.min(minLat, s.lat); maxLat = Math.max(maxLat, s.lat);
    minLng = Math.min(minLng, s.lng); maxLng = Math.max(maxLng, s.lng);
  }
  // Build a SQUARE world in metres around the track centre (no stretching) and
  // cover a much larger area -> lots of real surrounding map, not empty terrain.
  const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
  const trackHalfM = Math.max((maxLng - minLng) * mPerDegLng, (maxLat - minLat) * mPerDegLat) / 2;
  const worldHalfM = Math.max(trackHalfM * 3.5, 2500); // ~5 km+ across = much more map
  const halfLat = worldHalfM / mPerDegLat, halfLng = worldHalfM / mPerDegLng;
  minLat = cLat - halfLat; maxLat = cLat + halfLat;
  minLng = cLng - halfLng; maxLng = cLng + halfLng;

  const widthM = worldHalfM * 2;   // east-west (square)
  const depthM = worldHalfM * 2;   // north-south
  const groundCx = (cLng - lng0) * mPerDegLng;
  const groundCz = -(cLat - lat0) * mPerDegLat;

  const toLocal = (s, hScale) => new THREE.Vector3(
    (s.lng - lng0) * mPerDegLng,
    (s.alt - minAlt) * hScale,
    -(s.lat - lat0) * mPerDegLat
  );

  // compress altitude so the tower stays framable while the map stays prominent
  const maxRel = Math.max(...samples.map((s) => s.alt - minAlt), 1);
  const horizSpan = Math.max(widthM, depthM, 100);
  const hScale = Math.min(1, Math.max(0.12, (horizSpan * 0.85) / maxRel));
  const pts = samples.map((s) => toLocal(s, hScale));

  // --- scene ---
  const scene = new THREE.Scene();
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.Fog(0xcfe0f5, horizSpan * 4, horizSpan * 22);

  const width = container.clientWidth || 800;
  const height = 480;
  const camera = new THREE.PerspectiveCamera(
    52, width / height,
    Math.max(2, horizSpan * 0.02),   // near: avoid z-fighting at distance
    horizSpan * 60                   // far
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.domElement.id = "three-canvas";
  container.innerHTML = "";
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495; // don't go under the ground

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(1, 2, 1.4);
  scene.add(dir);

  // large surrounding terrain so the world extends to the horizon (into the fog)
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(horizSpan * 26, horizSpan * 26, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x6f8a5e })
  );
  far.rotation.x = -Math.PI / 2;
  far.position.set(groundCx, -1.5, groundCz);
  scene.add(far);

  // --- ground: high-res satellite TILES (Esri World Imagery, no API key) ---
  // Many small 256px tiles at the highest zoom that fits the budget -> sharp,
  // and they stream in fast & in parallel (each ~8 KB) instead of one slow image.
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const tileGroup = new THREE.Group();
  scene.add(tileGroup);

  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); };
  const x2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

  // pick the highest zoom that stays within the tile budget
  const MAX_TILES = 300;
  let Z = 14, x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (let z = 19; z >= 12; z--) {
    const ax0 = lon2x(minLng, z), ax1 = lon2x(maxLng, z);
    const ay0 = lat2y(maxLat, z), ay1 = lat2y(minLat, z);
    if ((ax1 - ax0 + 1) * (ay1 - ay0 + 1) <= MAX_TILES) { Z = z; x0 = ax0; x1 = ax1; y0 = ay0; y1 = ay1; break; }
  }
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const lonW = x2lon(x, Z), lonE = x2lon(x + 1, Z);
      const latN = y2lat(y, Z), latS = y2lat(y + 1, Z);
      const xW = (lonW - lng0) * mPerDegLng, xE = (lonE - lng0) * mPerDegLng;
      const zN = -(latN - lat0) * mPerDegLat, zS = -(latS - lat0) * mPerDegLat;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(xE - xW, zS - zN),
        new THREE.MeshBasicMaterial({ color: 0x6f8a5e })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((xW + xE) / 2, 0.05, (zN + zS) / 2);
      tileGroup.add(mesh);
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`;
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        mesh.material.dispose();
        mesh.material = new THREE.MeshBasicMaterial({ map: tex });
      });
    }
  }

  // --- track as a phase-coloured 3D tube ---
  const radius = Math.max(horizSpan * 0.004, 2);
  let seg = [pts[0]];
  let segPhase = samples[0].phase;
  for (let i = 1; i < pts.length; i++) {
    seg.push(pts[i]);
    const last = i === pts.length - 1;
    if (samples[i].phase !== segPhase || last) {
      if (seg.length >= 2) addTube(seg, segPhase);
      seg = [pts[i]];
      segPhase = samples[i].phase;
    }
  }
  function addTube(points, phase) {
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, Math.max(points.length * 3, 8), radius, 10, false);
    const col = new THREE.Color(PHASE_COLORS[phase] || "#ffffff");
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.5 });
    scene.add(new THREE.Mesh(geo, mat));
  }

  // framing: focus on the track itself (the big ground extends around it)
  const trackBox = new THREE.Box3().setFromPoints(pts);
  const center = trackBox.getCenter(new THREE.Vector3());
  const trackSpan = Math.max(trackBox.getSize(new THREE.Vector3()).length(), horizSpan * 0.4);

  // --- ground pins: small precise marker + thin reference pole + label ---
  const headR = Math.max(radius * 0.7, 2);      // small dot (metres-scale)
  const poleR = Math.max(radius * 0.08, 0.4);   // thin vertical reference line
  const labelSize = Math.max(horizSpan * 0.015, 10); // keep the label readable
  // EXIT marker = where freefall actually begins (not the first climb sample)
  let exitIdx = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].phase === "freefall" || samples[i].phase === "exit") { exitIdx = i; break; }
  }
  pin(pts[exitIdx], 0xf6a23b, "EXIT");
  pin(pts[pts.length - 1], 0x10d68a, "LANDING");
  if (jump.target && jump.target.lat != null) {
    const tp = new THREE.Vector3((jump.target.lng - lng0) * mPerDegLng, 0, -(jump.target.lat - lat0) * mPerDegLat);
    pin(tp, 0x2f6bff, "TARGET");
  }
  function pin(p, color, text) {
    const h = Math.max(p.y, headR * 2);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(poleR, poleR, h, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 })
    );
    pole.position.set(p.x, h / 2, p.z);
    scene.add(pole);
    const head = sphere(color, headR);
    head.position.copy(p);
    scene.add(head);
    scene.add(label(text, p, color, labelSize));
  }

  // animated position marker — clearly visible bright dot for the playback
  const pos = sphere(0xffffff, Math.max(radius * 1.6, 5));
  pos.add(new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(radius * 2.4, 8), 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })
  ));
  pos.position.copy(pts[pts.length - 1]);
  scene.add(pos);

  // camera framing — lower, cinematic angle so the horizon + sky stay visible
  camera.position.set(center.x + trackSpan * 1.15, trackBox.max.y * 0.55 + trackSpan * 0.22, center.z + trackSpan * 1.5);
  controls.target.set(center.x, center.y * 0.5, center.z);
  controls.update();

  // --- scrub / play (smooth, fixed 30-second playback) ---
  const END = pts.length - 1;
  const DURATION_MS = 30000;
  scrubInput.min = 0;
  scrubInput.max = END;
  scrubInput.step = "any";
  scrubInput.value = END;
  let playing = false;
  let head = END; // float playhead index

  // place the marker smoothly between the two surrounding samples
  function setHead(f) {
    head = Math.max(0, Math.min(END, f));
    const i = Math.floor(head);
    const frac = head - i;
    pos.position.lerpVectors(pts[i], pts[Math.min(i + 1, END)], frac);
    scrubInput.value = head;
  }
  scrubInput.addEventListener("input", () => { playing = false; playBtn.innerHTML = iconSVG("play", 16); setHead(Number(scrubInput.value)); });
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.innerHTML = iconSVG(playing ? "pause" : "play", 16);
    if (playing && head >= END) setHead(0);
  });

  let raf, last = performance.now();
  function animate(now) {
    raf = requestAnimationFrame(animate);
    const dt = now - last; last = now;
    if (playing) {
      setHead(head + (END / DURATION_MS) * dt); // full run in 30 s
      controls.target.lerp(pos.position, 0.05);   // camera follows the marker
      if (head >= END) { playing = false; playBtn.innerHTML = iconSVG("play", 16); }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  animate(performance.now());

  function onResize() {
    const w = container.clientWidth || width;
    camera.aspect = w / height;
    camera.updateProjectionMatrix();
    renderer.setSize(w, height);
  }
  window.addEventListener("resize", onResize);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    tileGroup.traverse((o) => {
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      if (o.geometry) o.geometry.dispose();
    });
    controls.dispose();
    renderer.dispose();
  };
}

function sphere(color, r) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), new THREE.MeshBasicMaterial({ color }));
}

function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#5d8fd6");
  g.addColorStop(0.55, "#a9c8ee");
  g.addColorStop(1, "#dcebfb");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function label(text, position, color, size) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 72;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 40px Inter, sans-serif";
  const w = ctx.measureText(text).width + 28;
  ctx.fillStyle = "rgba(15,23,42,0.82)";
  roundRect(ctx, (256 - w) / 2, 8, w, 52, 12); ctx.fill();
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.beginPath(); ctx.arc((256 - w) / 2 + 22, 34, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
  ctx.fillText(text, (256 - w) / 2 + 38, 36);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.position.copy(position).add(new THREE.Vector3(0, size * 1.5, 0));
  spr.scale.set(size * 6, size * 1.7, 1);
  return spr;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
