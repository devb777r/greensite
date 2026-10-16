(function () {
  'use strict';

  /* ---------- constants ---------- */
  var LIVE = 'IQ-BG';
  var SPACING_KM = 5, MAX_SITES = 20, HALF_LAT = 1 / 240, R_EARTH = 6371000;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOBILE = function () { return window.matchMedia('(max-width: 820px)').matches; };

  var EN = {
    'IQ-DA': 'Duhok', 'IQ-AR': 'Erbil', 'IQ-BA': 'Basra', 'IQ-MU': 'Muthanna', 'IQ-SU': 'Sulaymaniyah', 'IQ-DI': 'Diyala',
    'IQ-WA': 'Wasit', 'IQ-MA': 'Maysan', 'IQ-AN': 'Anbar', 'IQ-NA': 'Najaf', 'IQ-NI': 'Nineveh', 'IQ-SD': 'Salah al-Din',
    'IQ-TS': 'Kirkuk', 'IQ-BG': 'Baghdad', 'IQ-BB': 'Babil', 'IQ-QA': 'Al-Qadisiyah', 'IQ-DQ': 'Dhi Qar', 'IQ-KA': 'Karbala'
  };

  var L = {
    priority: ['أولوية عالية', 'أولوية متوسطة', 'أولوية منخفضة', 'مستبعدة (مبنية أو مي)'],
    cluster: ['أقل خضرة، مستقرة', 'خضرة متوسطة وتتراجع', 'أعلى خضرة', 'غير مصنفة'],
    soil: ['تربة واعدة أكثر', 'تربة مختلطة', 'تربة أقل وعداً', 'ماكو بيانات تربة'],
    legend: { priority: ['عالية', 'متوسطة', 'منخفضة', 'مستبعدة'], cluster: ['أقل خضرة', 'تتراجع', 'أعلى خضرة', 'غير مصنفة'], soil: ['واعدة', 'مختلطة', 'أقل وعداً', 'ماكو بيانات'] },
    group: ['أرض مفتوحة قليلة الخضرة', 'منطقة خضراء تتراجع', 'ماكو إشارة واضحة', 'خلية مبنية', 'مي أو خلية مختلطة'],
    lc: ['غطاء أشجار', 'شجيرات', 'أعشاب', 'أرض زراعية', 'أرض جرداء', 'مبنية', 'مي دائمة'],
    conf: ['عالية', 'متوسطة'],
    note: { 0: 'أشجار موجودة: يمكن تحتاج عناية أكثر من زراعة جديدة.', 3: 'أرض زراعية: تأكد من حقوق الزراعة والاستخدام الحالي.',
      5: 'مركز الخلية مبني: مستبعدة من الفرز المباشر.', 6: 'مركز الخلية مي: مستبعدة من الفرز المباشر.',
      def: 'فرز أولي بس: افحص استخدام الأرض ووصول المي بالموقع.' }
  };
  var COL = {
    priority: ['#8EE06A', '#F2B84B', '#C77B5C', '#3C4538'],
    cluster: ['#E3925A', '#A994F5', '#62C795', '#3C4538'],
    soil: ['#8EE06A', '#E6CB57', '#D98656', '#3C4538']
  };
  var FIELD = { priority: 'p', cluster: 'cl', soil: 'pot' };
  var HEIGHT = {
    priority: [950, 460, 120, 0],
    cluster: [220, 440, 760, 0],
    soil: [800, 420, 160, 0]
  };

  var $ = function (id) { return document.getElementById(id); };
  var state = { view: 'intro', mode: 'priority', minKm: 0, reveal: 0, h3d: 1, sel: null, sites: [] };
  var map, cells = [], govs, pins = [], labels = {}, hoverId = null;

  /* ---------- helpers ---------- */
  function nf(n) { return n.toLocaleString('en-US'); }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function animate(ms, fn, done) {
    if (REDUCED) { fn(1); if (done) done(); return; }
    var t0 = performance.now();
    (function tick(now) {
      var t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(tick); else if (done) done();
    })(t0);
  }
  function norm(s) {
    return (s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْ]/g, '').replace(/^ال/, '').trim();
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function panelPad() {
    if (MOBILE()) return { top: 60, bottom: Math.round(window.innerHeight * 0.44), left: 12, right: 12 };
    return { top: 40, bottom: 40, left: 40, right: 400 };
  }

  /* ---------- boot ---------- */
  Promise.all([
    fetch('data/cells.json').then(function (r) { return r.json(); }),
    fetch('data/iraq.geojson').then(function (r) { return r.json(); }),
    fetch('data/iraq-outline.geojson').then(function (r) { return r.json(); })
  ]).then(function (res) { boot(res[0], res[1], res[2]); })
    .catch(function () { $('intro').querySelector('p').textContent = 'ما كدرنا نحمّل البيانات. حدّث الصفحة.'; });

  function boot(d, gj, outline) {
    prepCells(d);
    govs = gj;
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        projection: { type: 'globe' },
        sky: { 'sky-color': '#0A120D', 'horizon-color': '#1d3324', 'fog-color': '#0A120D', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.6, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 9, 0] },
        sources: {
          sat: { type: 'raster', tileSize: 256, maxzoom: 18,
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Boundaries: Natural Earth' }
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#0A120D' } },
          { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.12, 'raster-brightness-max': 0.9, 'raster-contrast': 0.06, 'raster-fade-duration': 400 } }
        ]
      },
      center: [38, 24], zoom: MOBILE() ? 0.9 : 1.5, pitch: 0, bearing: 0,
      maxPitch: 70, attributionControl: { compact: true }, dragRotate: true
    });

    map.on('load', function () {
      addLayers(outline);
      buildList();
      buildLabels();
      bindUI();
      setTimeout(startIntro, 350);
    });
  }

  function prepCells(d) {
    var clat = median(d.lat), clon = median(d.lon), cosc = Math.cos(clat * Math.PI / 180);
    state.center = [clon, clat];
    for (var i = 0; i < d.id.length; i++) {
      var x = (d.lon[i] - clon) * Math.PI / 180 * cosc * R_EARTH, y = (d.lat[i] - clat) * Math.PI / 180 * R_EARTH;
      cells.push({ i: i, id: d.id[i], lat: d.lat[i], lon: d.lon[i], rank: d.rank[i], p: d.p[i], cl: d.cl[i], pot: d.pot[i], grp: d.grp[i], lc: d.lc[i],
        conf: d.conf[i], ndvi: d.ndvi[i], chg: d.chg[i], anom: d.anom[i], soc: d.soc[i], sand: d.sand[i], sig: d.sig[i], unc: d.unc[i],
        x: x, y: y, dist: Math.round(Math.hypot(x, y) / 10) / 100 });
    }
    state.pool = cells.filter(function (c) { return c.p !== 3; }).sort(function (a, b) { return a.rank - b.rank || a.id - b.id; });
    state.maxDist = Math.max.apply(null, cells.map(function (c) { return c.dist; }));
    var lats = d.lat, lons = d.lon;
    state.cityBounds = [[Math.min.apply(null, lons), Math.min.apply(null, lats)], [Math.max.apply(null, lons), Math.max.apply(null, lats)]];
  }

  function cellPoly(c) {
    var hw = HALF_LAT / Math.cos(c.lat * Math.PI / 180);
    return [[[c.lon - hw, c.lat - HALF_LAT], [c.lon + hw, c.lat - HALF_LAT], [c.lon + hw, c.lat + HALF_LAT], [c.lon - hw, c.lat + HALF_LAT], [c.lon - hw, c.lat - HALF_LAT]]];
  }

  function circle(center, km) {
    var pts = [], lat = center[1] * Math.PI / 180;
    for (var k = 0; k <= 96; k++) {
      var a = k / 96 * 2 * Math.PI;
      pts.push([center[0] + (km * 1000 * Math.cos(a)) / (R_EARTH * Math.cos(lat)) * 180 / Math.PI, center[1] + (km * 1000 * Math.sin(a)) / R_EARTH * 180 / Math.PI]);
    }
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } };
  }

  /* ---------- layers ---------- */
  function addLayers(outline) {
    var holes = [];
    var g = outline.geometry;
    (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach(function (poly) { holes.push(poly[0].slice().reverse()); });
    map.addSource('mask', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
      coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]].concat(holes) } } });
    map.addSource('govs', { type: 'geojson', data: govs });
    map.addSource('outline', { type: 'geojson', data: outline });

    map.addLayer({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#050a06', 'fill-opacity': 0 } });
    map.addLayer({ id: 'gov-fill', type: 'fill', source: 'govs', paint: {
      'fill-color': ['case', ['==', ['get', 'iso'], LIVE], '#CDEB9F', '#EEF3E6'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], ['case', ['==', ['get', 'iso'], LIVE], 0.32, 0.1], ['==', ['get', 'iso'], LIVE], 0.16, 0],
      'fill-opacity-transition': { duration: 300 } } });
    map.addLayer({ id: 'gov-line', type: 'line', source: 'govs', paint: { 'line-color': '#EEF3E6', 'line-opacity': 0, 'line-width': 0.8 } });
    map.addLayer({ id: 'outline', type: 'line', source: 'outline', paint: { 'line-color': '#EEF3E6', 'line-opacity': 0, 'line-width': 1.6, 'line-blur': 0.4 } });
    map.addLayer({ id: 'live-line', type: 'line', source: 'govs', filter: ['==', ['get', 'iso'], LIVE], paint: { 'line-color': '#CDEB9F', 'line-width': 2.2, 'line-opacity': 0 } });

    var feats = cells.map(function (c) {
      return { type: 'Feature', id: c.i, properties: { i: c.i, p: c.p, cl: c.cl, pot: c.pot, dist: c.dist }, geometry: { type: 'Polygon', coordinates: cellPoly(c) } };
    });
    map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
    map.addLayer({ id: 'cells', type: 'fill-extrusion', source: 'cells', layout: { visibility: 'none' },
      paint: { 'fill-extrusion-color': colorExpr(), 'fill-extrusion-height': heightExpr(), 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0, 'fill-extrusion-vertical-gradient': true } });
    map.addLayer({ id: 'cells-sel', type: 'fill-extrusion', source: 'cells', filter: ['==', ['get', 'i'], -1],
      paint: { 'fill-extrusion-color': '#EAF8D2', 'fill-extrusion-height': ['+', heightExpr(), 30], 'fill-extrusion-opacity': 0.95 } });
    map.addSource('ring', { type: 'geojson', data: circle(state.center, 0.01) });
    map.addLayer({ id: 'ring', type: 'line', source: 'ring', layout: { visibility: 'none' },
      paint: { 'line-color': '#CDEB9F', 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
  }

  function colorExpr() {
    var f = FIELD[state.mode], c = COL[state.mode];
    return ['match', ['get', f], 0, c[0], 1, c[1], 2, c[2], c[3]];
  }
  function heightExpr() {
    var f = FIELD[state.mode], h = HEIGHT[state.mode];
    var base = ['case', ['==', ['get', 'p'], 3], 0, ['match', ['get', f], 0, h[0], 1, h[1], 2, h[2], h[3]]];
    var grow = ['min', 1, ['max', 0, ['/', ['-', state.reveal, ['get', 'dist']], 9]]];
    return ['+', 8, ['*', base, grow, state.h3d]];
  }
  function refreshCells() {
    map.setPaintProperty('cells', 'fill-extrusion-height', heightExpr());
    map.setPaintProperty('cells-sel', 'fill-extrusion-height', ['+', heightExpr(), 30]);
  }

  /* ---------- governorates list + labels ---------- */
  function buildList() {
    var items = govs.features.map(function (f) { return f.properties; });
    items.sort(function (a, b) { return (b.iso === LIVE) - (a.iso === LIVE) || a.ar.localeCompare(b.ar, 'ar'); });
    var ul = $('govs');
    items.forEach(function (p) {
      var live = p.iso === LIVE;
      var li = document.createElement('li');
      li.className = 'gov ' + (live ? 'live' : 'soon');
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      li.dataset.iso = p.iso;
      li.dataset.key = norm(p.ar) + ' ' + p.ar + ' ' + EN[p.iso].toLowerCase();
      li.innerHTML = '<span class="dot"></span><span class="nm"><b>' + p.ar + '</b><small>' + EN[p.iso] + '</small></span><span class="tag">' + (live ? 'متاحة' : 'قريباً') + '</span>';
      li.addEventListener('click', function () { chooseGov(p.iso); });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseGov(p.iso); } });
      li.addEventListener('mouseenter', function () { setHover(p.iso); });
      li.addEventListener('mouseleave', function () { setHover(null); });
      ul.appendChild(li);
    });
  }

  function buildLabels() {
    govs.features.forEach(function (f) {
      var p = f.properties, el = document.createElement('div');
      el.className = 'gov-label' + (p.iso === LIVE ? ' live' : '');
      el.textContent = p.ar;
      el.classList.add('off');
      if (p.iso === LIVE) el.addEventListener('click', function () { chooseGov(LIVE); });
      labels[p.iso] = { el: el, marker: new maplibregl.Marker({ element: el }).setLngLat([p.cx, p.cy]).addTo(map) };
    });
  }
  function showLabels(on) {
    Object.keys(labels).forEach(function (k, idx) {
      var el = labels[k].el;
      el.style.transitionDelay = on && !REDUCED ? (k === LIVE ? 200 : 300 + idx * 35) + 'ms' : '0ms';
      el.classList.toggle('off', !on);
    });
  }

  function featureByIso(iso) {
    for (var i = 0; i < govs.features.length; i++) if (govs.features[i].properties.iso === iso) return govs.features[i];
  }
  function setHover(iso) {
    if (hoverId !== null) map.setFeatureState({ source: 'govs', id: hoverId }, { hover: false });
    hoverId = null;
    Array.prototype.forEach.call(document.querySelectorAll('.gov'), function (li) { li.classList.toggle('is-hover', li.dataset.iso === iso); });
    Object.keys(labels).forEach(function (k) { labels[k].el.classList.toggle('hot', k === iso); });
    if (!iso || state.view !== 'iraq') return;
    var f = featureByIso(iso);
    if (f) { hoverId = f.id; map.setFeatureState({ source: 'govs', id: hoverId }, { hover: true }); }
  }

  function chooseGov(iso) {
    var f = featureByIso(iso);
    if (iso !== LIVE) {
      toast('محافظة ' + f.properties.ar + ' قريباً. حالياً بغداد بس متاحة.');
      setHover(iso);
      return;
    }
    if (state.view === 'iraq') enterCity();
  }

  /* ---------- camera choreography ---------- */
  function iraqCamera() {
    return map.cameraForBounds([[38.77, 29.06], [48.56, 37.37]], { padding: panelPad() });
  }

  function startIntro() {
    $('intro').classList.add('gone');
    setTimeout(function () { $('intro').remove(); }, 1300);
    var cam = iraqCamera();
    if (!map.isStyleLoaded()) { /* still fine */ }
    if (REDUCED) { map.jumpTo(Object.assign({}, cam, { pitch: 0 })); }
    else {
      map.flyTo(Object.assign({}, cam, { pitch: 18, bearing: 0, duration: 5200, curve: 1.25, essential: true,
        easing: function (t) { return easeInOut(t); } }));
    }
    setTimeout(function () { document.body.classList.remove('is-intro'); }, REDUCED ? 0 : 2600);
    setTimeout(function () { enterIraq(true); }, REDUCED ? 0 : 3400);
  }

  function fade(layer, prop, to, ms) {
    var from = map.getPaintProperty(layer, prop) || 0;
    if (typeof from !== 'number') from = 0;
    animate(ms, function (t) { map.setPaintProperty(layer, prop, from + (to - from) * easeInOut(t)); });
  }

  function enterIraq(first) {
    state.view = 'iraq';
    fade('mask', 'fill-opacity', 0.5, 1200);
    fade('gov-line', 'line-opacity', 0.28, 1200);
    fade('outline', 'line-opacity', 0.85, 1200);
    fade('live-line', 'line-opacity', 1, 1200);
    showLabels(true);
    if (!first) {
      var cam = iraqCamera();
      map.flyTo(Object.assign({}, cam, { pitch: 18, bearing: 0, duration: REDUCED ? 0 : 2600, curve: 1.3, essential: true }));
    }
  }

  function enterCity() {
    state.view = 'flying';
    setHover(null);
    showLabels(false);
    fade('gov-line', 'line-opacity', 0, 900);
    fade('outline', 'line-opacity', 0.25, 900);
    swapView('city');
    var cam = cityCamera();
    var go = function () {
      map.setLayoutProperty('cells', 'visibility', 'visible');
      map.setLayoutProperty('ring', 'visibility', state.minKm > 0 ? 'visible' : 'none');
      state.view = 'city';
      $('toggle-3d').hidden = false; $('reset-view').hidden = false;
      fade('cells', 'fill-extrusion-opacity', 0.9, 900);
      fade('live-line', 'line-opacity', 0.55, 900);
      fade('mask', 'fill-opacity', 0.62, 900);
      var R = state.maxDist + 12;
      animate(2200, function (t) { state.reveal = R * easeInOut(t); refreshCells(); }, function () { placePins(); });
    };
    if (REDUCED) { map.jumpTo(cam); go(); return; }
    map.flyTo(Object.assign({}, cam, { duration: 4200, curve: 1.6, essential: true, easing: easeInOut }));
    map.once('moveend', go);
  }

  function cityCamera() {
    var cam = map.cameraForBounds(state.cityBounds, { padding: panelPad() });
    return { center: cam.center, zoom: cam.zoom + (MOBILE() ? 0.8 : 0.35), pitch: state.h3d ? 56 : 0, bearing: state.h3d ? -22 : 0 };
  }

  function leaveCity() {
    state.view = 'leaving';
    closeCard();
    clearPins();
    map.setLayoutProperty('ring', 'visibility', 'none');
    var R0 = state.reveal;
    fade('cells', 'fill-extrusion-opacity', 0, 700);
    animate(700, function (t) { state.reveal = R0 * (1 - t); refreshCells(); }, function () {
      map.setLayoutProperty('cells', 'visibility', 'none');
    });
    $('toggle-3d').hidden = true; $('reset-view').hidden = true;
    swapView('iraq');
    enterIraq(false);
  }

  function swapView(which) {
    var a = $('view-iraq'), b = $('view-city');
    var show = which === 'city' ? b : a, hide = which === 'city' ? a : b;
    hide.hidden = true; show.hidden = false;
    show.classList.remove('enter'); void show.offsetWidth; show.classList.add('enter');
    if (MOBILE()) $('panel').classList.remove('min');
  }

  /* ---------- Baghdad tools ---------- */
  function renderLegend() {
    var f = FIELD[state.mode], counts = [0, 0, 0, 0];
    cells.forEach(function (c) { counts[c[f]]++; });
    var html = '';
    L.legend[state.mode].forEach(function (nm, k) {
      if (!counts[k]) return;
      html += '<span><i style="background:' + COL[state.mode][k] + '"></i>' + nm + '<em>' + nf(counts[k]) + '</em></span>';
    });
    $('legend').innerHTML = html;
  }

  function pickSites(minKm) {
    var kept = [], lim = SPACING_KM * 1000 - 1e-6;
    for (var i = 0; i < state.pool.length && kept.length < MAX_SITES; i++) {
      var c = state.pool[i];
      if (c.dist < minKm) continue;
      var ok = true;
      for (var j = 0; j < kept.length; j++) if (Math.hypot(c.x - kept[j].x, c.y - kept[j].y) < lim) { ok = false; break; }
      if (ok) kept.push(c);
    }
    return kept;
  }

  function renderSites() {
    state.sites = pickSites(state.minKm);
    var ol = $('sites'); ol.innerHTML = '';
    if (!state.sites.length) ol.innerHTML = '<li class="empty">ماكو مناطق مؤهلة بهالمسافة. قلّل البعد.</li>';
    state.sites.forEach(function (c, k) {
      var li = document.createElement('li');
      li.className = 'site'; li.tabIndex = 0; li.dataset.i = c.i;
      li.innerHTML = '<span class="n">' + (k + 1) + '</span><span class="t">' + L.lc[c.lc] + '<small>' + L.priority[c.p] + '، ترتيب ' + c.rank + '</small></span><span class="d">' + c.dist.toFixed(1) + ' كم</span>';
      li.addEventListener('click', function () { selectCell(c, true); });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCell(c, true); } });
      ol.appendChild(li);
    });
    if (state.view === 'city') { clearPins(); placePins(); }
    map.getSource('ring').setData(circle(state.center, Math.max(0.01, state.minKm)));
    if (state.view === 'city') map.setLayoutProperty('ring', 'visibility', state.minKm > 0 ? 'visible' : 'none');
    markSel();
  }

  function clearPins() { pins.forEach(function (m) { m.remove(); }); pins = []; }
  function placePins() {
    state.sites.forEach(function (c, k) {
      var el = document.createElement('button');
      el.type = 'button'; el.className = 'pin'; el.textContent = k + 1;
      el.setAttribute('aria-label', 'منطقة ' + (k + 1));
      el.addEventListener('click', function (e) { e.stopPropagation(); selectCell(c, false); });
      var m = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -4] }).setLngLat([c.lon, c.lat]).addTo(map);
      pins.push(m);
      setTimeout(function () { el.classList.add('show'); }, REDUCED ? 0 : 60 * k);
    });
    markSel();
  }

  function markSel() {
    var id = state.sel ? state.sel.i : -1;
    Array.prototype.forEach.call(document.querySelectorAll('.site'), function (li) { li.classList.toggle('on', +li.dataset.i === id); });
    pins.forEach(function (m, k) { m.getElement().classList.toggle('on', state.sites[k] && state.sites[k].i === id); });
  }

  function selectCell(c, fly) {
    state.sel = c;
    map.setFilter('cells-sel', ['==', ['get', 'i'], c.i]);
    if (fly) map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 11.3), pitch: state.h3d ? 52 : 0, duration: REDUCED ? 0 : 1600, essential: true, padding: panelPad() });
    renderCard(c);
    markSel();
    if (MOBILE()) $('panel').classList.add('min');
  }
  function closeCard() {
    state.sel = null;
    $('card').hidden = true;
    if (map.getLayer('cells-sel')) map.setFilter('cells-sel', ['==', ['get', 'i'], -1]);
    markSel();
  }

  function fmt(v, d, sign) { if (v === null || v === undefined) return '—'; var s = v.toFixed(d); return sign && v > 0 ? '+' + s : s; }

  function renderCard(c) {
    var k = state.sites.indexOf(c), col = COL.priority[c.p];
    var sig = [];
    if (c.sig & 1) sig.push('الخضرة الحالية منخفضة مقارنة ببقية بغداد');
    if (c.sig & 2) sig.push('الخضرة نزلت عن الـ 12 شهر السابقة');
    if (c.sig & 4) sig.push('أقل من مستواها المعتاد بنفس الأشهر');
    var lim = ['نوع الأرض قيمة وحدة بمركز الخلية'];
    if (c.unc & 1) lim.push('بيانات التربة ناقصة');
    if (c.unc & 2) lim.push('بعض الأشهر الأخيرة قراءتها غير موثوقة');
    if (c.unc & 4) lim.push('ماكو مقارنة موسمية');
    var soil = c.soc === null ? 'بيانات التربة ناقصة، ومو معناها تربة ضعيفة' : L.soil[c.pot] + ': كربون عضوي ' + c.soc.toFixed(1) + ' غم/كغم، رمل ' + Math.round(c.sand) + ' غم/كغم';
    var gm = 'https://www.google.com/maps/search/?api=1&query=' + c.lat.toFixed(6) + ',' + c.lon.toFixed(6);
    $('card').innerHTML =
      '<div class="card-h"><h3>' + (k >= 0 ? 'منطقة ' + (k + 1) + ' من 20' : L.lc[c.lc]) + '<small>خلية ' + c.id + '، ترتيب ' + nf(c.rank) + ' من ' + nf(cells.length) + '</small></h3>' +
      '<button class="x" id="card-x" type="button" aria-label="سكّر التفاصيل"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
      '<span class="badge" style="background:' + col + '22;color:' + col + ';border:1px solid ' + col + '55">' + L.priority[c.p] + '</span>' +
      '<div class="metrics"><div class="metric"><span>NDVI</span><b>' + fmt(c.ndvi, 2) + '</b></div><div class="metric"><span>التغير</span><b>' + fmt(c.chg, 2, true) + '</b></div><div class="metric"><span>الموسمي</span><b>' + fmt(c.anom, 2, true) + '</b></div></div>' +
      '<dl class="rows"><dt>نوع الأرض</dt><dd>' + L.lc[c.lc] + '</dd><dt>المجموعة</dt><dd>' + L.group[c.grp] + '</dd><dt>البعد عن المركز</dt><dd>' + c.dist.toFixed(1) + ' كم</dd><dt>ثقة البيانات</dt><dd>' + L.conf[c.conf] + '</dd></dl>' +
      '<div class="why"><b>ليش هالترتيب</b>' + (sig.length ? '<ul><li>' + sig.join('</li><li>') + '</li></ul>' : 'ماكو إشارة حاجة واضحة.') + '</div>' +
      '<div class="why"><b>التربة</b>' + soil + '</div>' +
      '<div class="why"><b>قبل ما تنزل</b><span class="note">' + (L.note[c.lc] || L.note.def) + '</span></div>' +
      '<div class="why"><b>حدود البيانات</b>' + lim.join('، ') + '.</div>' +
      '<a class="gm" href="' + gm + '" target="_blank" rel="noopener noreferrer">افتح الموقع بـ Google Maps</a>';
    $('card').hidden = false;
    $('card-x').addEventListener('click', closeCard);
  }

  /* ---------- UI bindings ---------- */
  function bindUI() {
    $('c-cells').textContent = nf(cells.length);
    $('dist').max = Math.floor(state.maxDist - 6);
    renderLegend();
    renderSites();

    $('q').addEventListener('input', function (e) {
      var q = norm(e.target.value), any = false;
      Array.prototype.forEach.call(document.querySelectorAll('.gov'), function (li) {
        var hit = !q || li.dataset.key.indexOf(q) !== -1 || li.dataset.key.indexOf(e.target.value.trim().toLowerCase()) !== -1;
        li.hidden = !hit; if (hit) any = true;
      });
      $('govs-empty').hidden = any;
    });
    $('q').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = document.querySelector('.gov:not([hidden])');
      if (first) chooseGov(first.dataset.iso);
    });

    map.on('mousemove', 'gov-fill', function (e) {
      if (state.view !== 'iraq' || !e.features.length) return;
      var iso = e.features[0].properties.iso;
      map.getCanvas().style.cursor = 'pointer';
      if (!hoverId || featureByIso(iso).id !== hoverId) setHover(iso);
    });
    map.on('mouseleave', 'gov-fill', function () { map.getCanvas().style.cursor = ''; if (state.view === 'iraq') setHover(null); });
    map.on('click', 'gov-fill', function (e) { if (state.view === 'iraq' && e.features.length) chooseGov(e.features[0].properties.iso); });

    map.on('click', 'cells', function (e) {
      if (state.view !== 'city' || !e.features.length) return;
      var c = cells[e.features[0].properties.i];
      if (c) selectCell(c, false);
    });
    map.on('mouseenter', 'cells', function () { if (state.view === 'city') map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cells', function () { map.getCanvas().style.cursor = ''; });

    $('back').addEventListener('click', leaveCity);

    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b, _, all) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (o) { o.setAttribute('aria-checked', o === b ? 'true' : 'false'); });
        state.mode = b.dataset.mode;
        map.setPaintProperty('cells', 'fill-extrusion-color', colorExpr());
        refreshCells();
        renderLegend();
      });
    });

    $('dist').addEventListener('input', function (e) {
      state.minKm = +e.target.value;
      $('dist-out').textContent = state.minKm + ' كم';
      renderSites();
    });

    $('toggle-3d').addEventListener('click', function () {
      var on = state.h3d < 0.5;
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      var from = state.h3d;
      animate(900, function (t) { state.h3d = from + ((on ? 1 : 0) - from) * easeInOut(t); refreshCells(); });
      map.easeTo({ pitch: on ? 56 : 0, bearing: on ? -22 : 0, duration: REDUCED ? 0 : 1100 });
    });
    $('reset-view').addEventListener('click', function () {
      map.flyTo(Object.assign({}, cityCamera(), { duration: REDUCED ? 0 : 1800, essential: true }));
    });

    $('grip').addEventListener('click', function () { $('panel').classList.toggle('min'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.sel) closeCard(); });
  }
})();
