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

/* ======================= Photo cube: the team's render rebuilt as a real 3D cube ======================= */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function glassEnv(renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.03,0.06,0.04), vec3(0.75,0.85,0.72), smoothstep(-0.1, 0.9, h)); gl_FragColor = vec4(c,1.0);} '
  })));
  const lamp = (w, h, c, p) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); s.add(m); };
  lamp(4, 1.5, new THREE.Color(4, 4, 3.8), [-3, 5, 5]);
  lamp(1.2, 5, new THREE.Color(1.2, 2.4, 1.4), [6, 1, 2]);
  lamp(3, 1, new THREE.Color(2.4, 2.0, 1.2), [2, -4, -6]);
  const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(s, 0.02).texture; pm.dispose(); return t;
}

function createPhotoCube(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.environment = glassEnv(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = url => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  const leftT = tex('assets/cube/left.webp'), rightT = tex('assets/cube/right.webp'), topT = tex('assets/cube/top.webp'), folT = tex('assets/cube/foliage.webp');
  const lightDir = new THREE.Vector3(-0.35, 0.55, 0.75).normalize();
  const clock = { t: 0 };

  // glass faces: the render's own panels, with a light sweep and a gentle angle-dependent sheen
  const faceMat = map => new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, time: { value: 0 }, lightDir: { value: lightDir } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `
      uniform sampler2D map; uniform float time; uniform vec3 lightDir;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec3 n = normalize(vN), v = normalize(vV);
        vec3 c = texture2D(map, vUv).rgb;
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        c *= 0.78 + 0.32 * max(dot(n, lightDir), 0.0);
        float fres = pow(1.0 - ndv, 3.0);
        vec3 rb = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 1.2 + vUv.x * 0.5 + time * 0.03));
        c += rb * fres * 0.12;
        float sweep = fract(time * 0.075);
        float band = smoothstep(0.06, 0.0, abs(vP.x * 0.2 + vP.y * 0.16 + 0.5 - sweep * 1.6));
        c += vec3(1.0, 1.0, 0.95) * band * 0.13;
        c += vec3(0.85, 0.95, 0.85) * fres * 0.1;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const faces = [faceMat(rightT), faceMat(rightT), new THREE.MeshBasicMaterial({ map: topT, color: 0xa89884 }), new THREE.MeshBasicMaterial({ color: 0x0b120c }), faceMat(leftT), faceMat(leftT)];
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), faces);

  // real glass edges: thick polished bars with spherical corners
  const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xe8f4ea, metalness: 0.1, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3.0, transparent: true, opacity: 0.5, iridescence: 0.8, iridescenceIOR: 1.6, depthWrite: false });
  const edges = new THREE.Group();
  const bar = new THREE.CylinderGeometry(0.016, 0.016, 2, 12);
  for (let i = 0; i < 4; i++) {
    const x = i & 1 ? 1 : -1, z = i & 2 ? 1 : -1;
    const v = new THREE.Mesh(bar, edgeMat); v.position.set(x, 0, z); edges.add(v);
    const h1 = new THREE.Mesh(bar, edgeMat); h1.rotation.z = Math.PI / 2; h1.position.set(0, x, z); edges.add(h1);
    const h2 = new THREE.Mesh(bar, edgeMat); h2.rotation.x = Math.PI / 2; h2.position.set(x, z, 0); edges.add(h2);
  }
  const ball = new THREE.SphereGeometry(0.022, 12, 10);
  for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(ball, edgeMat); c.position.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1); edges.add(c); }

  // foliage: photo leaf clumps from the render, layered in 3D around trunks, swaying in a light breeze
  const folMat = new THREE.MeshBasicMaterial({ map: folT, alphaTest: 0.42, side: THREE.DoubleSide, transparent: false });
  folMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = { value: 0 };
    folMat.userData.shader = sh;
    sh.vertexShader = 'uniform float uTime;\nattribute vec2 tile;\n' + sh.vertexShader
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.5 + tile;\n#endif')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = (position.y + 0.5);
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        transformed.x += sin(uTime * 1.2 + ip.x * 2.7 + ip.z * 1.9) * 0.05 * sway;
        transformed.z += cos(uTime * 0.9 + ip.z * 2.3) * 0.035 * sway;`);
  };
  function buildFoliage(g, decline, seed) {
    const r = prng(seed);
    const cards = [];     // {p:[x,y,z], s, yaw, pitch, tile, shade}
    const T = { conifer: [0, 0.5], broad: [0.5, 0.5], fern: [0, 0], bush: [0.5, 0] };
    const trunks = [];
    const nTrees = Math.round(0.5 + g * 3.6);
    for (let i = 0; i < nTrees; i++) {
      const x = (r() * 1.3 - 0.65), z = (r() * 1.3 - 0.65), h = 0.8 + r() * 0.9 * (0.6 + g * 0.6);
      const kind = r() < 0.5 ? 'conifer' : 'broad';
      trunks.push({ x, z, h });
      const n = Math.round(26 + g * 34);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * (0.45 + g * 0.25), y = 1 + h * (0.45 + r() * 0.6);
        const out = rr / 0.7;
        cards.push({ p: [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr], s: 0.42 + r() * 0.35, yaw: a + (r() - 0.5) * 1.2, pitch: (r() - 0.5) * 0.5, tile: T[kind], shade: 0.62 + 0.38 * out });
      }
    }
    const nBush = Math.round(6 + g * 16);
    for (let i = 0; i < nBush; i++) {
      const x = r() * 1.9 - 0.95, z = r() * 1.9 - 0.95, rad = 0.2 + r() * 0.2;
      const kind = r() < 0.55 ? 'bush' : 'fern';
      const n = 6 + Math.round(r() * 6);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2;
        cards.push({ p: [x + Math.cos(a) * rad * 0.4, 1 + rad * (0.35 + r() * 0.4), z + Math.sin(a) * rad * 0.4], s: rad * (1.4 + r() * 0.7), yaw: a, pitch: kind === 'fern' ? -0.35 + (r() - 0.5) * 0.4 : (r() - 0.5) * 0.4, tile: T[kind], shade: 0.7 + r() * 0.3 });
      }
    }
    // ferns and vines spilling over the four top edges
    const nEdge = Math.round(4 + g * 18);
    for (let i = 0; i < nEdge; i++) {
      const side = Math.floor(r() * 4), along = r() * 1.9 - 0.95, out = 1.0;
      const px = side === 0 ? out : side === 1 ? -out : along, pz = side === 2 ? out : side === 3 ? -out : along;
      const yaw = side === 0 ? Math.PI / 2 : side === 1 ? -Math.PI / 2 : side === 2 ? 0 : Math.PI;
      const hang = r() < 0.45;
      cards.push({ p: [px * 1.02, hang ? 0.78 - r() * 0.35 : 1.12, pz * 1.02], s: hang ? 0.38 + r() * 0.3 : 0.45 + r() * 0.3, yaw: yaw + (r() - 0.5) * 0.6, pitch: hang ? 0.1 : -0.55, tile: hang ? T.broad : T.fern, shade: 0.75 + r() * 0.25 });
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    const tiles = new Float32Array(cards.length * 2);
    cards.forEach((c, i) => tiles.set(c.tile, i * 2));
    geo.setAttribute('tile', new THREE.InstancedBufferAttribute(tiles, 2));
    const mesh = new THREE.InstancedMesh(geo, folMat, cards.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), col = new THREE.Color();
    const dryTint = new THREE.Color('#C7A35E');
    cards.forEach((c, i) => {
      e.set(c.pitch, c.yaw, (r() - 0.5) * 0.3); q.setFromEuler(e);
      m.compose(new THREE.Vector3(...c.p), q, new THREE.Vector3(c.s, c.s, c.s));
      mesh.setMatrixAt(i, m);
      col.setScalar(c.shade);
      if (r() < decline * 0.6 || g < 0.15) col.multiply(dryTint);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const grp = new THREE.Group(); grp.add(mesh);
    const bark = new THREE.MeshStandardMaterial({ color: 0x3d3024, roughness: 1 });
    trunks.forEach(t => {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.05, t.h, 8), bark);
      tr.position.set(t.x, 1 + t.h / 2, t.z); tr.rotation.z = (r() - 0.5) * 0.18; grp.add(tr);
    });
    return grp;
  }
  scene.add(new THREE.HemisphereLight(0xdff0d8, 0x1a140c, 1.6));

  // drifting motes of light around the cube
  const motes = (() => {
    const n = 140, pos = new Float32Array(n * 3), spd = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([(Math.random() - 0.5) * 5.5, Math.random() * 5 - 2, (Math.random() - 0.5) * 4], i * 3); spd[i] = 0.05 + Math.random() * 0.12; }
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.3, 'rgba(220,255,200,0.45)'); gr.addColorStop(1, 'rgba(200,255,180,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    pts.userData.spd = spd; return pts;
  })();
  scene.add(motes);

  const spinG = new THREE.Group(); spinG.add(box); spinG.add(edges);
  const floatG = new THREE.Group(); floatG.add(spinG); scene.add(floatG);
  let foliage = null;

  let running = false, last = 0, intro = 1, w = 0, h = 0;
  function resize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;      // layout size, not affected by CSS transforms
    if (!cw || !ch || (cw === w && ch === h)) return;
    w = cw; h = ch;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock.t += REDUCED ? 0 : dt;
    const t = clock.t;
    spinG.rotation.y = -Math.PI / 4 + t * 0.2 + Math.sin(t * 0.35) * 0.18;
    floatG.position.y = Math.sin(t * 0.9) * 0.07;
    floatG.rotation.z = Math.sin(t * 0.5) * 0.025;
    camera.position.set(Math.sin(t * 0.13) * 0.7, 1.8 + Math.sin(t * 0.21) * 0.25, 8.9);
    camera.lookAt(0, 0.7, 0);
    faces.forEach(m => { if (m.uniforms) m.uniforms.time.value = t; });
    if (folMat.userData.shader) folMat.userData.shader.uniforms.uTime.value = t;
    const p = motes.geometry.attributes.position, spd = motes.userData.spd;
    for (let i = 0; i < spd.length; i++) { let y = p.getY(i) + spd[i] * dt; if (y > 3.2) y = -2; p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(t * 0.5 + i) * 0.0015); }
    p.needsUpdate = true;
    if (intro < 1) { intro = Math.min(1, intro + dt * 0.9); const k = ease(intro); floatG.scale.setScalar(0.8 + 0.2 * k); floatG.position.y -= (1 - k) * 0.5; }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  return {
    show(c) {
      resize();
      const ndvi = c && c.ndvi != null ? c.ndvi : 0.3;
      const g = clamp((ndvi - 0.05) / 0.36, 0, 1);
      const decline = c && c.chg != null && c.chg < 0 ? clamp(-c.chg / 0.16, 0, 0.8) : 0;
      if (foliage) { spinG.remove(foliage); foliage.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      foliage = buildFoliage(c && (c.lc === 5 || c.lc === 6) ? g * 0.4 : g, decline, (c && c.id ? c.id : 1) * 977 + 3);
      spinG.add(foliage);
      intro = REDUCED ? 1 : 0;
      if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
    },
    stop() { running = false; },
    resize
  };
}

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

window.GS3 = webglOK() ? { createEarth, createPhotoCube } : null;
window.dispatchEvent(new Event('gs3'));
