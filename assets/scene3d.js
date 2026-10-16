import * as THREE from './vendor/three/three.module.min.js';

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ======================= Earth ======================= */
function lonLatToRot(lon, lat) {
  // SphereGeometry maps texture u=(lon+180)/360 to phi = u*2PI; vertex x=-cos(phi), z=sin(phi).
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const az = Math.atan2(-Math.cos(phi), Math.sin(phi));
  return { y: -az, x: (lat * Math.PI) / 180 };
}

function createEarth(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x020403, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  camera.position.set(0, 0, 4.4);

  const tilt = new THREE.Group();      // latitude
  const spin = new THREE.Group();      // longitude
  tilt.add(spin);
  scene.add(tilt);

  const loader = new THREE.TextureLoader();
  const load = url => new Promise(res => loader.load(url, t => { t.anisotropy = 8; res(t); }, undefined, () => res(null)));
  const sunDir = new THREE.Vector3(0.62, 0.28, 0.73).normalize();

  const earthMat = new THREE.ShaderMaterial({
    uniforms: { dayTex: { value: null }, nightTex: { value: null }, waterTex: { value: null }, sunDir: { value: sunDir } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position,1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D dayTex; uniform sampler2D nightTex; uniform sampler2D waterTex; uniform vec3 sunDir;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN);
        float d = dot(n, sunDir);
        float dayMix = smoothstep(-0.18, 0.22, d);
        vec3 day = texture2D(dayTex, vUv).rgb;
        day = mix(vec3(dot(day, vec3(0.299,0.587,0.114))), day, 1.12);
        vec3 night = texture2D(nightTex, vUv).rgb;
        night = pow(night, vec3(1.35)) * vec3(1.0, 0.78, 0.48) * 2.1;
        vec3 col = mix(night, day * (0.18 + 0.95 * max(d, 0.0)), dayMix);
        float w = texture2D(waterTex, vUv).r;
        vec3 r = reflect(-sunDir, n);
        float spec = pow(max(dot(r, normalize(vV)), 0.0), 28.0) * w * 0.55 * dayMix;
        col += vec3(0.85, 0.92, 1.0) * spec;
        float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 3.2);
        col += vec3(0.32, 0.62, 1.0) * rim * (0.15 + 0.85 * smoothstep(-0.3, 0.4, d)) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), earthMat);
  spin.add(earth);

  const cloudMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { tex: { value: null }, sunDir: { value: sunDir } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform sampler2D tex; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN;
      void main(){ float a = texture2D(tex, vUv).r; float l = smoothstep(-0.2, 0.35, dot(normalize(vN), sunDir));
        gl_FragColor = vec4(vec3(1.0) * (0.08 + 0.92 * l), a * (0.12 + 0.68 * l)); }`
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.007, 128, 96), cloudMat);
  spin.add(clouds);

  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.09, 96, 72), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(normalMatrix*normal); vW = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
      void main(){ float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0,0.0,1.0))), 3.4);
        float l = 0.25 + 0.75 * smoothstep(-0.4, 0.5, dot(vW, sunDir));
        gl_FragColor = vec4(0.30, 0.62, 1.0, 1.0) * i * 2.4 * l; }`
  }));
  scene.add(atmo);

  // stars
  const N = 4200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = 70 + Math.random() * 30, s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    const b = 0.35 + Math.pow(Math.random(), 3) * 0.65, warm = Math.random() < 0.2;
    col.set([b, b * (warm ? 0.92 : 0.97), b * (warm ? 0.8 : 1.0)], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  scene.add(stars);

  // start pose: show the Atlantic/Africa side, slightly tilted
  const startRot = lonLatToRot(10, 12);
  spin.rotation.y = startRot.y; tilt.rotation.x = startRot.x;
  let idle = true, running = true, viewShift = 0;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    viewShift = w > 820 ? 190 : 0;           // keep the globe left of the side panel
    const yShift = w > 820 ? 0 : Math.round(h * 0.18);
    camera.setViewOffset(w, h, viewShift, yShift, w, h);
    camera.updateProjectionMatrix();
    if (idle) camera.position.z = camera.aspect < 1 ? Math.min(8, 3.1 / camera.aspect) : 4.4;
  }
  resize();
  window.addEventListener('resize', resize);

  let last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (idle) spin.rotation.y += dt * 0.06;
    clouds.rotation.y += dt * 0.012;
    stars.rotation.y += dt * 0.003;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const ready = Promise.all([load('assets/earth/day.jpg'), load('assets/earth/night.jpg'), load('assets/earth/water.jpg'), load('assets/earth/clouds.jpg')])
    .then(([d, n, w, c]) => {
      earthMat.uniforms.dayTex.value = d; earthMat.uniforms.nightTex.value = n;
      earthMat.uniforms.waterTex.value = w; cloudMat.uniforms.tex.value = c;
      return !!d;
    });

  function flyTo(lon, lat, ms, endDist) {
    idle = false;
    const t = lonLatToRot(lon, lat);
    const y0 = spin.rotation.y, x0 = tilt.rotation.x, z0 = camera.position.z;
    let dy = ((t.y - y0) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (dy > -0.6) dy -= Math.PI * 2;          // always sweep eastward, at least a good part of a turn
    if (REDUCED) ms = 0;
    return new Promise(resolve => {
      const t0 = performance.now();
      (function step(now) {
        const k = ms ? clamp((now - t0) / ms, 0, 1) : 1;
        const e = ease(k);
        spin.rotation.y = y0 + dy * e;
        tilt.rotation.x = x0 + (t.x - x0) * e;
        const ez = k < 0.35 ? 0 : ease((k - 0.35) / 0.65);
        camera.position.z = z0 + (endDist - z0) * ez;
        if (k < 1) requestAnimationFrame(step); else resolve();
      })(t0);
    });
  }

  function dispose() {
    running = false;
    window.removeEventListener('resize', resize);
    renderer.dispose();
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    [earthMat.uniforms.dayTex, earthMat.uniforms.nightTex, earthMat.uniforms.waterTex, cloudMat.uniforms.tex].forEach(u => u.value && u.value.dispose());
  }

  return { ready, flyTo, dispose };
}

/* ======================= Cell cube ======================= */
function rng(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1));

function sideTexture(g, lc, rand) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  const top = lc === 5 ? 18 : Math.round(10 + g * 34);
  const soilTop = lc === 4 ? '#8C6B45' : '#5A4029', soilBot = '#2B1E14';
  const grad = x.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, soilTop); grad.addColorStop(1, soilBot);
  x.fillStyle = grad; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5; i++) {                       // strata
    const y = 60 + i * 38 + rand() * 12;
    x.fillStyle = `rgba(${150 + rand() * 60},${110 + rand() * 40},${70 + rand() * 30},0.18)`;
    x.fillRect(0, y, 256, 6 + rand() * 10);
  }
  for (let i = 0; i < 160; i++) {                     // grit and pebbles
    const r = rand() < 0.9 ? 1 + rand() * 2 : 3 + rand() * 6;
    x.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.25)' : `rgba(${170 + rand() * 50},${150 + rand() * 40},${120 + rand() * 30},0.45)`;
    x.beginPath(); x.arc(rand() * 256, top + rand() * (256 - top), r, 0, Math.PI * 2); x.fill();
  }
  const turf = lc === 5 ? '#77756D' : lc === 6 ? '#3E6A5F' : mixHex('#C9AE7C', '#4E8A2E', g).getStyle();
  x.fillStyle = turf; x.fillRect(0, 0, 256, top);
  for (let i = 0; i < 256; i += 3) {                  // ragged turf edge
    x.fillRect(i, top - 1, 3, 2 + rand() * (4 + g * 10));
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function topTexture(g, lc, rand) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  const base = lc === 5 ? '#8A887F' : lc === 6 ? '#2E5E70' : mixHex('#D2B888', '#4A8A2A', g).getStyle();
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  if (lc === 3) {                                     // crop rows
    for (let i = 0; i < 256; i += 18) { x.fillStyle = `rgba(30,60,15,${0.18 + g * 0.3})`; x.fillRect(0, i, 256, 8); }
  }
  for (let i = 0; i < 900; i++) {
    x.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${0.05 + rand() * 0.1})` : `rgba(255,255,230,${0.04 + rand() * 0.08})`;
    x.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function createCube(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(3.75, 2.75, 3.75);
  camera.lookAt(0, 0.15, 0);
  scene.add(new THREE.HemisphereLight(0xe4f7d6, 0x24180c, 1.25));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4); sun.position.set(3, 6, 2); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xa8d8ff, 1.0); rim.position.set(-4, 2, -3); scene.add(rim);

  const holder = new THREE.Group(); scene.add(holder);
  let current = null, running = false, spin = 0, dragging = false, lastX = 0, vel = 0;

  // soft floor shadow
  const sh = document.createElement('canvas'); sh.width = sh.height = 128;
  const sx = sh.getContext('2d'); const rg = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
  rg.addColorStop(0, 'rgba(0,0,0,0.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = rg; sx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.25; scene.add(shadow);

  function build(c) {
    const rand = rng((c.id || 1) * 7919 + 13);
    const ndvi = c.ndvi == null ? 0.1 : c.ndvi;
    const g = clamp((ndvi - 0.06) / 0.36, 0, 1);
    const decline = c.chg != null && c.chg < 0 ? clamp(-c.chg / 0.16, 0, 0.75) : 0;
    const lc = c.lc;
    const grp = new THREE.Group();
    const H = 1.3, S = 2, topY = H / 2;

    const side = new THREE.MeshStandardMaterial({ map: sideTexture(g, lc, rand), roughness: 0.95 });
    const top = new THREE.MeshStandardMaterial({ map: topTexture(g, lc, rand), roughness: 0.9 });
    const bottom = new THREE.MeshStandardMaterial({ color: 0x1d140d, roughness: 1 });
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(S, H, S), [side, side, top, bottom, side, side]));

    // glass shell + glowing edges
    const shellGeo = new THREE.BoxGeometry(S + 0.14, H + 0.5, S + 0.14);
    const shell = new THREE.Mesh(shellGeo, new THREE.MeshPhysicalMaterial({ color: 0xcdeb9f, transparent: true, opacity: 0.07, roughness: 0.15, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
    shell.position.y = 0.25; grp.add(shell);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shellGeo), new THREE.LineBasicMaterial({ color: 0xcdeb9f, transparent: true, opacity: 0.45 }));
    edges.position.y = 0.25; grp.add(edges);

    const greens = ['#2F6B2A', '#3F7D2C', '#5C9A35', '#7FB04A', '#2B5E2E'];
    const dry = ['#B9A13B', '#A8863A', '#8E7B3F'];
    const spot = (m) => [(rand() * 2 - 1) * (S / 2 - m), (rand() * 2 - 1) * (S / 2 - m)];

    if (lc === 6) {
      const water = new THREE.Mesh(new THREE.BoxGeometry(S - 0.2, 0.06, S - 0.2), new THREE.MeshStandardMaterial({ color: 0x3f8aa8, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85 }));
      water.position.y = topY + 0.01; grp.add(water);
    }
    if (lc === 5) {                                     // built-up: small blocks
      const n = 6 + Math.floor(rand() * 6);
      for (let i = 0; i < n; i++) {
        const h = 0.12 + rand() * 0.5, w = 0.18 + rand() * 0.22;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: mixHex('#B9B2A3', '#E6E0D2', rand()), roughness: 0.8 }));
        const [x, z] = spot(0.2); b.position.set(x, topY + h / 2, z); grp.add(b);
      }
    }

    // trees: count and size follow greenness
    const trees = lc === 6 ? Math.round(g * 6) : lc === 5 ? Math.round(1 + g * 6) : Math.round(1 + g * 30);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4630, roughness: 1 });
    for (let i = 0; i < trees; i++) {
      const h = (0.18 + rand() * 0.32) * (0.65 + g * 0.7);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, h * 0.55, 6), trunkMat);
      trunk.position.y = h * 0.27; tree.add(trunk);
      const isDry = rand() < decline;
      const blobs = 2 + Math.floor(rand() * 2);
      for (let k = 0; k < blobs; k++) {
        const r = (0.09 + rand() * 0.1) * (0.7 + g * 0.6);
        const col = isDry ? dry[Math.floor(rand() * dry.length)] : greens[Math.floor(rand() * greens.length)];
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, flatShading: true }));
        f.position.set((rand() - 0.5) * r, h * 0.55 + k * r * 0.7, (rand() - 0.5) * r);
        f.rotation.set(rand() * 3, rand() * 3, 0);
        tree.add(f);
      }
      const [x, z] = spot(0.16); tree.position.set(x, topY, z);
      tree.rotation.y = rand() * Math.PI;
      grp.add(tree);
    }

    // grass tufts (instanced)
    const tufts = Math.round(g * 110) + (lc === 3 ? 30 : 0);
    if (tufts) {
      const geo = new THREE.ConeGeometry(0.022, 0.09, 4);
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: mixHex('#9A9A4A', '#4E9A33', g), roughness: 0.9, flatShading: true }), tufts);
      const m = new THREE.Matrix4();
      for (let i = 0; i < tufts; i++) {
        const [x, z] = spot(0.05); const s = 0.6 + rand() * 0.9;
        m.compose(new THREE.Vector3(x, topY + 0.04 * s, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 3, (rand() - 0.5) * 0.4)), new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, m);
      }
      grp.add(im);
    }

    // moss hanging over the sides when the cell is green
    const moss = Math.round(g * 26);
    for (let i = 0; i < moss; i++) {
      const r = 0.06 + rand() * 0.1;
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: greens[Math.floor(rand() * greens.length)], roughness: 0.9, flatShading: true }));
      const face = Math.floor(rand() * 4), along = (rand() * 2 - 1) * (S / 2 - 0.1), drop = rand() * 0.35;
      const e = S / 2 + r * 0.25;
      const p = [[e, along], [-e, along], [along, e], [along, -e]][face];
      f.position.set(p[0], topY - drop, p[1]);
      grp.add(f);
    }

    // rocks on dry ground
    const rocks = Math.round((1 - g) * 7);
    for (let i = 0; i < rocks; i++) {
      const r = 0.05 + rand() * 0.09;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: mixHex('#7D6A55', '#A79377', rand()), roughness: 1, flatShading: true }));
      const [x, z] = spot(0.15); rk.position.set(x, topY + r * 0.4, z); rk.rotation.set(rand() * 3, rand() * 3, 0);
      grp.add(rk);
    }
    return grp;
  }

  function disposeGroup(o) {
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    });
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  let last = performance.now(), t0 = 0;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t0 += dt;
    if (!dragging) { vel *= 0.94; spin += dt * (REDUCED ? 0 : 0.42) + vel; }
    holder.rotation.y = spin;
    holder.position.y = REDUCED ? 0 : Math.sin(t0 * 1.3) * 0.05;
    if (current && current.userData.intro < 1) {
      current.userData.intro = Math.min(1, current.userData.intro + dt * 1.6);
      const k = ease(current.userData.intro);
      current.scale.setScalar(0.7 + 0.3 * k);
      current.position.y = (1 - k) * -0.4;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!dragging) return; const d = (e.clientX - lastX) * 0.01; spin += d; vel = d * 0.25; lastX = e.clientX; });
  const up = () => { dragging = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  return {
    show(c) {
      resize();
      if (current) { holder.remove(current); disposeGroup(current); }
      current = build(c);
      current.userData.intro = REDUCED ? 1 : 0;
      holder.add(current);
      if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
    },
    stop() { running = false; },
    resize
  };
}

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

window.GS3 = webglOK() ? { createEarth, createCube } : null;
window.dispatchEvent(new Event('gs3'));
