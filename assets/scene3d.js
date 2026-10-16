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

/* ======================= Cell cube: faceted iridescent glass + leaf foliage ======================= */
function rng(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1));

// A cube whose faces are broken into small pyramid-shaped triangular facets, like cut crystal.
function facetedCubeGeometry(n, depth, rand, palette) {
  const pos = [], cols = [];
  const pal = palette.map(h => new THREE.Color(h));
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }
  ];
  const P = (f, s, t, h) => [f.n[0] * (1 - h) + f.u[0] * s + f.v[0] * t, f.n[1] * (1 - h) + f.u[1] * s + f.v[1] * t, f.n[2] * (1 - h) + f.u[2] * s + f.v[2] * t];
  const tri = (a, b, c, nrm) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
    const c0 = pal[Math.floor(rand() * pal.length)].clone().lerp(pal[Math.floor(rand() * pal.length)], rand() * 0.5);
    const lift = rand() < 0.08 ? 0.35 : 0;                // occasional bright glint facet
    c0.offsetHSL(0, 0, lift);
    for (let k = 0; k < 3; k++) cols.push(c0.r, c0.g, c0.b);
  };
  faces.forEach(f => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const s0 = -1 + (2 * i) / n, s1 = -1 + (2 * (i + 1)) / n, t0 = -1 + (2 * j) / n, t1 = -1 + (2 * (j + 1)) / n;
      const a = P(f, s0, t0, 0), b = P(f, s1, t0, 0), c = P(f, s1, t1, 0), d = P(f, s0, t1, 0);
      const h = (rand() < 0.5 ? 1 : -0.6) * depth * (0.5 + rand());
      const m = P(f, (s0 + s1) / 2 + (rand() - 0.5) * 0.12, (t0 + t1) / 2 + (rand() - 0.5) * 0.12, h);
      tri(a, b, m, f.n); tri(b, c, m, f.n); tri(c, d, m, f.n); tri(d, a, m, f.n);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

// A sprite sheet cell with a small spray of leaves (white, tinted per instance).
function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const leaf = (cx, cy, len, w, ang) => {
    x.save(); x.translate(cx, cy); x.rotate(ang);
    const gr = x.createLinearGradient(0, -w, 0, w);
    gr.addColorStop(0, 'rgba(235,245,225,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(200,215,190,1)');
    x.fillStyle = gr;
    x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * 0.45, -w, len, 0); x.quadraticCurveTo(len * 0.45, w, 0, 0); x.fill();
    x.strokeStyle = 'rgba(150,170,140,0.7)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 0); x.lineTo(len * 0.92, 0); x.stroke();
    x.restore();
  };
  const r = rng(77);
  x.strokeStyle = 'rgba(120,100,80,1)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(128, 250); x.quadraticCurveTo(120, 160, 132, 70); x.stroke();
  for (let i = 0; i < 16; i++) {
    const t = i / 16, y = 240 - t * 175, side = i % 2 ? 1 : -1;
    leaf(126 + side * 2, y, 46 + r() * 36 - t * 20, 13 + r() * 7, (side > 0 ? -0.5 : Math.PI + 0.5) + (r() - 0.5) * 0.5);
  }
  leaf(130, 70, 44, 13, -Math.PI / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function envTexture(renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
      vec3 top = vec3(0.42,0.52,0.40), mid = vec3(0.07,0.13,0.08), bot = vec3(0.01,0.02,0.015);
      vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, bot, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0); }`
  })));
  const panel = (w, h, col, p, look) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(...look); s.add(m); };
  panel(5, 2.2, new THREE.Color(3.4, 3.4, 3.1), [3, 6, 4], [0, 0, 0]);
  panel(2.4, 6, new THREE.Color(0.5, 2.2, 0.9), [-7, 1, -2], [0, 0, 0]);
  panel(3, 1.6, new THREE.Color(2.4, 1.9, 0.5), [6, -1, -4], [0, 0, 0]);
  panel(1.6, 5, new THREE.Color(0.6, 1.2, 2.6), [-3, 2, 7], [0, 0, 0]);
  panel(1.4, 4, new THREE.Color(2.2, 0.7, 1.9), [7, 2, 3], [0, 0, 0]);
  panel(6, 1.2, new THREE.Color(1.2, 2.0, 1.0), [0, -6, 3], [0, 0, 0]);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.035).texture;
  pm.dispose();
  return tex;
}

function createCube(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.environment = envTexture(renderer);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
  camera.position.set(0, 0.7, 8.6);
  camera.lookAt(0, 0.25, 0);
  const key = new THREE.DirectionalLight(0xfff3dc, 2.6); key.position.set(4, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fe0a8, 1.4); rim.position.set(-6, 2, -4); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xdff2d0, 0x0c140c, 0.5));

  const leafTex = leafTexture();
  const coreTex = leafTex.clone(); coreTex.wrapS = coreTex.wrapT = THREE.RepeatWrapping; coreTex.repeat.set(3, 3); coreTex.needsUpdate = true;
  const spinG = new THREE.Group(); scene.add(spinG);
  let current = null, running = false, spin = 0.6, dragging = false, lastX = 0, vel = 0;

  function build(c) {
    const rand = rng((c.id || 1) * 7919 + 13);
    const ndvi = c.ndvi == null ? 0.1 : c.ndvi;
    const g = clamp((ndvi - 0.05) / 0.36, 0, 1);
    const decline = c.chg != null && c.chg < 0 ? clamp(-c.chg / 0.16, 0, 0.8) : 0;
    const lc = c.lc;
    const tilt = new THREE.Group();
    tilt.rotation.set(0.6155, Math.PI / 4, 0); tilt.rotation.order = 'XYZ';                    // stand the cube on its corner like the reference

    // inner core seen through the glass
    const coreCol = lc === 6 ? '#0F2E3A' : lc === 5 ? '#2A2B27' : mixHex('#5E4B32', '#10270F', g).getStyle();
    const core = new THREE.Mesh(new THREE.BoxGeometry(1.84, 1.84, 1.84), new THREE.MeshStandardMaterial({
      color: coreCol, roughness: 0.9, map: coreTex, emissive: new THREE.Color(coreCol).multiplyScalar(0.25)
    }));
    tilt.add(core);

    // faceted iridescent glass shell
    const glassTint = '#FFFFFF';
    const prism = lc === 6 ? ['#2E5F74', '#3F8098', '#7FB6C4', '#2B4A57', '#B6C77E'] : lc === 5 ? ['#5B5E57', '#7C7F76', '#A3A69B', '#4A4C46', '#B9A86E']
      : g < 0.25 ? ['#5E5034', '#7A6A48', '#9C8A5E', '#3F4A2E', '#B8A06A', '#4E5A3A', '#2E3324']
      : ['#24472B', '#355F3A', '#4F7A44', '#2D5560', '#8FA858', '#B39B52', '#1E3A26', '#6E8F6A'];
    const glass = new THREE.Mesh(facetedCubeGeometry(4, 0.07, rand, prism), new THREE.MeshPhysicalMaterial({
      vertexColors: true, color: glassTint, metalness: 0.35, roughness: 0.035, transmission: 0.42, thickness: 0.9, ior: 1.55,
      iridescence: 1, iridescenceIOR: 1.85, iridescenceThicknessRange: [250, 900],
      clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.6, specularIntensity: 1, flatShading: true
    }));
    tilt.add(glass);

    // foliage: instanced leaf sprays grouped into bushes and tree crowns
    const greens = ['#2E5A1F', '#3E6E27', '#4F8230', '#5F9438', '#36622A', '#6E9E3F'];
    const dry = ['#A88B3A', '#8E6E2C', '#B79A4A', '#7A6233'];
    const clusters = [];
    const nBush = lc === 6 ? Math.round(1 + g * 5) : lc === 5 ? Math.round(1 + g * 6) : Math.round(2 + g * 34);
    for (let i = 0; i < nBush; i++) {
      const R = (0.18 + rand() * 0.22) * (0.55 + g * 0.6);
      let x = rand() * 2 - 1, z = rand() * 2 - 1, y = 1 + R * 0.35;
      if (rand() < 0.3) {                                  // spill over an upper edge and hang down the side
        const e = Math.floor(rand() * 4), drop = rand() * 0.55;
        if (e === 0) { x = 1 + R * 0.25; } else if (e === 1) { x = -1 - R * 0.25; } else if (e === 2) { z = 1 + R * 0.25; } else { z = -1 - R * 0.25; }
        y = 1 - drop;
      }
      clusters.push({ x, y, z, R });
    }
    const nTrees = lc === 6 || lc === 5 ? Math.round(g * 2) : Math.round(g * 4.4);
    const trunks = [];
    for (let i = 0; i < nTrees; i++) {
      const x = (rand() * 1.4 - 0.7), z = (rand() * 1.4 - 0.7), h = 0.35 + rand() * 0.55 * (0.6 + g * 0.6);
      trunks.push({ x, z, h });
      const crowns = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < crowns; k++) clusters.push({ x: x + (rand() - 0.5) * 0.5, y: 1 + h * (0.75 + rand() * 0.35), z: z + (rand() - 0.5) * 0.5, R: 0.2 + rand() * 0.18 });
    }
    const carpet = lc === 5 ? Math.round(g * 120) : lc === 6 ? Math.round(g * 80) : Math.round(40 + g * 900);
    let total = carpet; clusters.forEach(cl => { cl.k = Math.min(220, Math.round(cl.R * cl.R * 2300)); total += cl.k; });
    if (total) {
      const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
        map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, envMapIntensity: 0.7
      }), total);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
      let idx = 0;
      for (let k = 0; k < carpet; k++) {
        v.set(rand() * 2.02 - 1.01, 1.02 + rand() * 0.1 * (0.4 + g), rand() * 2.02 - 1.01);
        e.set(-Math.PI / 2 + (rand() - 0.5) * 1.4, rand() * Math.PI * 2, (rand() - 0.5) * 1.4); q.setFromEuler(e);
        const sz = 0.1 + rand() * 0.09; s.set(sz, sz, sz);
        m.compose(v, q, s); leaves.setMatrixAt(idx, m);
        const isDry = rand() < decline * 0.65 || g < 0.12;
        col.set(isDry ? dry[Math.floor(rand() * dry.length)] : greens[Math.floor(rand() * greens.length)]);
        col.offsetHSL(0, 0, (rand() - 0.6) * 0.08);
        leaves.setColorAt(idx, col); idx++;
      }
      clusters.forEach(cl => {
        for (let k = 0; k < cl.k; k++) {
          const u = rand() * 2 - 1, th = rand() * Math.PI * 2, rr = cl.R * Math.pow(0.35 + 0.65 * rand(), 0.6), sq = Math.sqrt(1 - u * u);
          v.set(cl.x + rr * sq * Math.cos(th), cl.y + rr * u * 0.8, cl.z + rr * sq * Math.sin(th));
          e.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2); q.setFromEuler(e);
          const sz = (0.12 + rand() * 0.12) * (0.85 + cl.R * 0.6);
          s.set(sz, sz, sz);
          m.compose(v, q, s); leaves.setMatrixAt(idx, m);
          const isDry = rand() < decline * 0.65 || g < 0.12;
          col.set(isDry ? dry[Math.floor(rand() * dry.length)] : greens[Math.floor(rand() * greens.length)]);
          col.offsetHSL(0, 0, (u * 0.06) + (rand() - 0.5) * 0.05);   // lighter on top, darker underneath
          leaves.setColorAt(idx, col);
          idx++;
        }
      });
      leaves.instanceMatrix.needsUpdate = true; leaves.instanceColor.needsUpdate = true;
      tilt.add(leaves);
    }
    if (trunks.length) {
      const bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
      trunks.forEach(t => {
        const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.035, t.h, 6), bark);
        tr.position.set(t.x, 1 + t.h / 2, t.z); tr.rotation.z = (rand() - 0.5) * 0.25; tilt.add(tr);
      });
    }
    // sparse dry grass on barren cells
    if (g < 0.3 && lc !== 5 && lc !== 6) {
      const n = 40;
      const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.012, 0.14, 3), new THREE.MeshStandardMaterial({ color: 0xB59F6A, roughness: 1 }), n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) m.compose(new THREE.Vector3(rand() * 1.8 - 0.9, 1.06, rand() * 1.8 - 0.9), new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6)), new THREE.Vector3(1, 0.6 + rand(), 1)), grass.setMatrixAt(i, m);
      tilt.add(grass);
    }
    const wrap = new THREE.Group(); wrap.add(tilt); wrap.scale.setScalar(0.92);
    return wrap;
  }

  function disposeGroup(o) {
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      mats.forEach(mt => mt.dispose());
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
    if (!dragging) { vel *= 0.94; spin += dt * (REDUCED ? 0 : 0.32) + vel; }
    spinG.rotation.y = spin;
    spinG.position.y = REDUCED ? 0 : Math.sin(t0 * 1.1) * 0.06;
    if (current && current.userData.intro < 1) {
      current.userData.intro = Math.min(1, current.userData.intro + dt * 1.4);
      const k = ease(current.userData.intro);
      current.scale.setScalar(0.92 * (0.75 + 0.25 * k));
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', ev => { dragging = true; lastX = ev.clientX; canvas.setPointerCapture(ev.pointerId); });
  canvas.addEventListener('pointermove', ev => { if (!dragging) return; const d = (ev.clientX - lastX) * 0.01; spin += d; vel = d * 0.25; lastX = ev.clientX; });
  const up = () => { dragging = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  return {
    show(c) {
      resize();
      if (current) { spinG.remove(current); disposeGroup(current); }
      current = build(c);
      current.userData.intro = REDUCED ? 1 : 0;
      spinG.add(current);
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
