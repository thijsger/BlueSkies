import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PHASE_COLORS } from "./util.js";
import { iconSVG } from "./icons.js";

// Render the full 3D jump track (exit -> freefall -> canopy -> landing),
// coloured by phase, with ground plane + exit/landing markers, orbit controls
// and an animated marker driven by an external scrub control.
export function mount3D(container, scrubInput, playBtn, jump) {
  const samples = jump.series.filter((s) => s.lat != null && s.lng != null && s.alt != null);
  if (samples.length < 2) {
    container.innerHTML = '<p class="muted" style="padding:2rem;text-align:center">' +
      "Geen GPS-track beschikbaar voor 3D-weergave.</p>";
    return () => {};
  }

  // Project lat/lng/alt into local meters around the first sample.
  const lat0 = samples[0].lat;
  const lng0 = samples[0].lng;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const minAlt = Math.min(...samples.map((s) => s.alt));

  const pts = samples.map((s) => new THREE.Vector3(
    (s.lng - lng0) * mPerDegLng,    // x = east
    s.alt - minAlt,                 // y = up
    -(s.lat - lat0) * mPerDegLat    // z = north (negated for right-handed view)
  ));

  // scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);

  const width = container.clientWidth || 800;
  const height = 460;
  const camera = new THREE.PerspectiveCamera(55, width / height, 1, 200000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.domElement.id = "three-canvas";
  container.innerHTML = "";
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 1);
  scene.add(dir);

  // bounds for framing + ground
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 100);

  // ground plane at y=0 (landing level)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 3, span * 3),
    new THREE.MeshBasicMaterial({ color: 0x12331f, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, 0, center.z);
  scene.add(ground);
  const grid = new THREE.GridHelper(span * 3, 30, 0x2f4a3a, 0x1b2b22);
  grid.position.set(center.x, 0.1, center.z);
  scene.add(grid);

  // track coloured by phase (line segments)
  const colors = [];
  const positions = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const c = new THREE.Color(PHASE_COLORS[samples[i].phase] || "#ffffff");
    positions.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const track = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }));
  scene.add(track);

  // vertical drop lines under the freefall portion for depth cue
  const dropPos = [];
  for (let i = 0; i < pts.length; i += 3) {
    if (samples[i].phase === "freefall") {
      dropPos.push(pts[i].x, pts[i].y, pts[i].z, pts[i].x, 0, pts[i].z);
    }
  }
  if (dropPos.length) {
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.Float32BufferAttribute(dropPos, 3));
    scene.add(new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: 0x33414d, transparent: true, opacity: 0.4 })));
  }

  // markers
  const markerSize = span * 0.02 + 5;
  const exitMarker = sphere(0xf59e0b, markerSize);
  exitMarker.position.copy(pts[0]);
  scene.add(exitMarker);
  const landMarker = sphere(0x10b981, markerSize);
  landMarker.position.copy(pts[pts.length - 1]);
  scene.add(landMarker);
  scene.add(label("EXIT", pts[0], 0xf59e0b, markerSize));
  scene.add(label("LANDING", pts[pts.length - 1], 0x10b981, markerSize));

  // optional target marker
  if (jump.target && jump.target.lat != null) {
    const tx = (jump.target.lng - lng0) * mPerDegLng;
    const tz = -(jump.target.lat - lat0) * mPerDegLat;
    const tm = sphere(0x2f81f7, markerSize * 0.9);
    tm.position.set(tx, 0, tz);
    scene.add(tm);
    scene.add(label("TARGET", new THREE.Vector3(tx, 0, tz), 0x2f81f7, markerSize));
  }

  // animated position marker
  const pos = sphere(0xffffff, markerSize * 1.2);
  pos.position.copy(pts[0]);
  scene.add(pos);

  // camera framing
  camera.position.set(center.x + span * 1.2, box.max.y + span * 0.8, center.z + span * 1.2);
  controls.target.copy(center);
  controls.update();

  // scrub / play
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

  let raf;
  let last = performance.now();
  function animate(now) {
    raf = requestAnimationFrame(animate);
    const dt = now - last;
    last = now;
    if (playing) {
      setIdx(idx + (pts.length / 12000) * dt); // ~12s full playback
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

  // cleanup
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    controls.dispose();
    renderer.dispose();
    geo.dispose();
  };
}

function sphere(color, r) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 16, 16),
    new THREE.MeshBasicMaterial({ color })
  );
}

function label(text, position, color, size) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(text, 8, 44);
  const tex = new THREE.CanvasTexture(canvas);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.position.copy(position).add(new THREE.Vector3(0, size * 3, 0));
  spr.scale.set(size * 8, size * 2, 1);
  return spr;
}
