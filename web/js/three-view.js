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

  // --- ground: satellite map texture (sits just above the far terrain) ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, depthM, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x355c3a }) // fallback colour until tiles load
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(groundCx, 0, groundCz);
  scene.add(ground);

  // load Esri World Imagery for the bbox (no API key). Progressive: a fast 1024
  // texture appears almost instantly, then a crisp 2048 swaps in when ready.
  const ar = widthM / depthM;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const esriUrl = (sz) => {
    const px = ar >= 1 ? sz : Math.round(sz * ar);
    const pz = ar >= 1 ? Math.round(sz / ar) : sz;
    return "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export" +
      `?bbox=${minLng},${minLat},${maxLng},${maxLat}&bboxSR=4326&imageSR=4326` +
      `&size=${px},${pz}&format=jpg&transparent=false&f=image`;
  };
  const setGround = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    if (ground.material.map) ground.material.map.dispose();
    ground.material.map = tex;
    ground.material.color.set(0xffffff);
    ground.material.needsUpdate = true;
  };
  loader.load(esriUrl(1024), (low) => { setGround(low); loader.load(esriUrl(2048), setGround); });

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
  pin(pts[0], 0xf6a23b, "EXIT");
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

  // animated position marker — small precise dot (no big halo)
  const pos = sphere(0xffffff, Math.max(radius * 0.9, 2.5));
  pos.position.copy(pts[pts.length - 1]);
  scene.add(pos);

  // camera framing — lower, cinematic angle so the horizon + sky stay visible
  camera.position.set(center.x + trackSpan * 1.15, trackBox.max.y * 0.55 + trackSpan * 0.22, center.z + trackSpan * 1.5);
  controls.target.set(center.x, center.y * 0.5, center.z);
  controls.update();

  // --- scrub / play ---
  scrubInput.min = 0;
  scrubInput.max = pts.length - 1;
  scrubInput.value = pts.length - 1;
  let playing = false;
  let idx = pts.length - 1;
  function setIdx(i) {
    idx = Math.max(0, Math.min(pts.length - 1, Math.round(i)));
    pos.position.copy(pts[idx]);
    scrubInput.value = idx;
  }
  scrubInput.addEventListener("input", () => setIdx(Number(scrubInput.value)));
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.innerHTML = iconSVG(playing ? "pause" : "play", 16);
    if (playing && idx >= pts.length - 1) setIdx(0);
  });

  let raf, last = performance.now();
  function animate(now) {
    raf = requestAnimationFrame(animate);
    const dt = now - last; last = now;
    if (playing) {
      setIdx(idx + (pts.length / 12000) * dt);
      if (idx >= pts.length - 1) { playing = false; playBtn.innerHTML = iconSVG("play", 16); }
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
