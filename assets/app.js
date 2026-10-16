(function () {
  'use strict';

  var SPACING_KM = 5;
  var MAX_SITES = 20;
  var HALF_LAT = 1 / 240;            // MODIS 30-arc-second cell: 0.008333 deg tall
  var R = 6371000;

  var LABELS = {
    priority: ['أولوية عالية', 'أولوية متوسطة', 'أولوية منخفضة', 'مستبعدة (مبنية أو مي)'],
    priorityShort: ['عالية', 'متوسطة', 'منخفضة', 'مستبعدة'],
    cluster: ['كلستر 0: أقل خضرة، مستقرة', 'كلستر 1: خضرة متوسطة وتتراجع', 'كلستر 2: أعلى خضرة', 'غير مصنفة'],
    soil: ['تربة واعدة أكثر', 'تربة مختلطة', 'تربة أقل وعداً', 'تحتاج تقييم (ماكو بيانات تربة)'],
    group: ['أرض مفتوحة قليلة الخضرة', 'منطقة خضراء تتراجع', 'ماكو إشارة واضحة', 'خلية مبنية (لازم فحص الاستخدام)', 'مي أو خلية مختلطة'],
    lc: ['غطاء أشجار', 'شجيرات', 'أعشاب', 'أرض زراعية', 'أرض جرداء أو نبات قليل', 'مبنية', 'مي دائمة'],
    conf: ['عالية', 'متوسطة'],
    note: {
      0: 'أشجار موجودة: يمكن تحتاج عناية وصيانة أكثر من زراعة جديدة.',
      3: 'أرض زراعية: تأكد من حقوق الزراعة والاستخدام الحالي.',
      5: 'مركز الخلية مبني: مستبعدة من الفرز المباشر للزراعة.',
      6: 'مركز الخلية مي: مستبعدة من الفرز المباشر للزراعة.',
      def: 'فرز أولي بس: افحص استخدام الأرض ووصول المي بالموقع.'
    }
  };
  var COLORS = {
    priority: ['#7CCB4E', '#F2AE40', '#D9604C', '#56604A'],
    cluster: ['#E0894A', '#A78BFA', '#5FC08A', '#7C8473'],
    soil: ['#7CCB4E', '#E8C547', '#D9824C', '#7C8473']
  };

  var state = { mode: 'priority', minKm: 0, stars: true, top100: false, excluded: true, selected: null };
  var cells = [], layers = [], starLayer, top100Layer, ring, map, baseSat, baseStreet, selOutline;

  function fmt(v, d, sign) {
    if (v === null || v === undefined) return 'غير متوفر';
    var s = v.toFixed(d);
    return sign && v > 0 ? '+' + s : s;
  }
  function nf(n) { return n.toLocaleString('en-US'); }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  fetch('data/cells.json').then(function (r) { return r.json(); }).then(init).catch(function () {
    document.getElementById('map-loading').textContent = 'ما كدرنا نحمّل البيانات. حدّث الصفحة وجرّب مرة ثانية.';
  });

  function init(d) {
    var n = d.id.length;
    var clat = median(d.lat), clon = median(d.lon), cosc = Math.cos(clat * Math.PI / 180);
    for (var i = 0; i < n; i++) {
      var x = (d.lon[i] - clon) * Math.PI / 180 * cosc * R;
      var y = (d.lat[i] - clat) * Math.PI / 180 * R;
      cells.push({
        id: d.id[i], lat: d.lat[i], lon: d.lon[i], rank: d.rank[i], p: d.p[i], fp: d.fp[i], cl: d.cl[i], pot: d.pot[i],
        grp: d.grp[i], lc: d.lc[i], conf: d.conf[i], ndvi: d.ndvi[i], chg: d.chg[i], anom: d.anom[i], soc: d.soc[i], sand: d.sand[i],
        sig: d.sig[i], unc: d.unc[i], t100: d.t100[i], x: x, y: y,
        dist: Math.round(Math.hypot(x, y) / 10) / 100
      });
    }
    state.center = [clat, clon];
    state.pool = cells.filter(function (c) { return c.p !== 3; })
      .sort(function (a, b) { return a.rank - b.rank || a.id - b.id; });
    var maxD = Math.ceil(Math.max.apply(null, cells.map(function (c) { return c.dist; })));
    document.getElementById('dist').max = Math.max(0, maxD - 5);
    document.getElementById('st-cells').textContent = nf(n);
    document.getElementById('st-high').textContent = nf(cells.filter(function (c) { return c.p === 0; }).length);

    buildMap();
    bindControls();
    recolor();
    updateStars();
    document.getElementById('map-loading').hidden = true;
  }

  function buildMap() {
    map = L.map('leaflet', { preferCanvas: true, zoomControl: true, attributionControl: true, minZoom: 8, maxZoom: 18 });
    baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
    }).addTo(map);
    baseStreet = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '© OpenStreetMap contributors'
    });
    var renderer = L.canvas({ padding: 0.3 });
    var bounds = L.latLngBounds([]);
    cells.forEach(function (c, i) {
      var hw = HALF_LAT / Math.cos(c.lat * Math.PI / 180);
      var b = [[c.lat - HALF_LAT, c.lon - hw], [c.lat + HALF_LAT, c.lon + hw]];
      bounds.extend(b);
      var r = L.rectangle(b, { renderer: renderer, weight: 0.4, color: 'rgba(14,19,5,.55)', fillOpacity: 0.62 });
      r.on('click', function () { select(c, false); });
      r.addTo(map);
      layers[i] = r;
    });
    state.bounds = bounds;
    map.fitBounds(bounds, { padding: [10, 10] });

    ring = L.circle(state.center, { radius: 1, color: '#38E1FF', weight: 1.5, dashArray: '6 6', fill: false, interactive: false });
    L.marker(state.center, {
      interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'center-icon', iconSize: [22, 22], iconAnchor: [11, 11],
        html: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 2v18M2 11h18" stroke="#0b0f04" stroke-width="5" stroke-linecap="round"/><path d="M11 2v18M2 11h18" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>' })
    }).addTo(map);
    top100Layer = L.layerGroup();
    cells.filter(function (c) { return c.t100; }).forEach(function (c) {
      L.circleMarker([c.lat, c.lon], { radius: 7, color: '#38E1FF', weight: 1.5, fillColor: '#38E1FF', fillOpacity: 0.15 })
        .on('click', function () { select(c, false); }).addTo(top100Layer);
    });
    starLayer = L.layerGroup().addTo(map);
  }

  function colorOf(c) {
    if (state.mode === 'priority') return COLORS.priority[c.p];
    if (state.mode === 'cluster') return COLORS.cluster[c.cl];
    return COLORS.soil[c.pot];
  }

  function recolor() {
    cells.forEach(function (c, i) {
      var hide = !state.excluded && c.p === 3;
      layers[i].setStyle({ fillColor: colorOf(c), fillOpacity: hide ? 0 : 0.62, opacity: hide ? 0 : 1 });
    });
    renderLegend();
  }

  function renderLegend() {
    var key = state.mode, names = LABELS[key === 'soil' ? 'soil' : key], cols = COLORS[key];
    var field = key === 'priority' ? 'p' : key === 'cluster' ? 'cl' : 'pot';
    var counts = names.map(function () { return 0; });
    cells.forEach(function (c) { counts[c[field]]++; });
    var title = key === 'priority' ? 'أولوية التشجير' : key === 'cluster' ? 'مجموعات K-Means' : 'التربة (أولي)';
    var html = '<h4>' + title + '</h4>';
    names.forEach(function (nm, i) {
      if (!counts[i]) return;
      html += '<div class="row"><span class="sw" style="background:' + cols[i] + '"></span><span>' + nm + '</span><span class="c">' + nf(counts[i]) + '</span></div>';
    });
    if (state.stars) html += '<div class="row"><span class="star">★</span><span>أفضل 20 منطقة</span></div>';
    document.getElementById('legend').innerHTML = html;
  }

  function pickSites(minKm) {
    var kept = [];
    var lim = SPACING_KM * 1000 - 1e-6;
    for (var i = 0; i < state.pool.length && kept.length < MAX_SITES; i++) {
      var c = state.pool[i];
      if (c.dist < minKm) continue;
      var ok = true;
      for (var j = 0; j < kept.length; j++) {
        if (Math.hypot(c.x - kept[j].x, c.y - kept[j].y) < lim) { ok = false; break; }
      }
      if (ok) kept.push(c);
    }
    return kept;
  }

  function starIcon(n) {
    return L.divIcon({
      className: 'star-icon', iconSize: [30, 30], iconAnchor: [15, 15],
      html: '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 2.5l3.6 7.6 8.3 1-6.1 5.7 1.6 8.2L15 21l-7.4 4 1.6-8.2-6.1-5.7 8.3-1z" fill="#38E1FF" stroke="#04252C" stroke-width="1.6" stroke-linejoin="round"/><text x="15" y="18.5" text-anchor="middle" font-size="9" font-weight="700" fill="#04252C" font-family="Arial">' + n + '</text></svg>'
    });
  }

  function updateStars() {
    var sites = pickSites(state.minKm);
    state.sites = sites;
    starLayer.clearLayers();
    sites.forEach(function (c, i) {
      L.marker([c.lat, c.lon], { icon: starIcon(i + 1), title: 'منطقة ' + (i + 1), zIndexOffset: 1000 })
        .on('click', function () { select(c, false); }).addTo(starLayer);
    });
    if (state.minKm > 0) { ring.setRadius(state.minKm * 1000); ring.addTo(map); } else { map.removeLayer(ring); }
    var meta = document.getElementById('sl-meta');
    meta.textContent = (state.minKm > 0 ? 'من ' + state.minKm + ' كم وأبعد' : 'كل المسافات') + ' · ' + sites.length + ' منطقة';
    var ol = document.getElementById('sl-list');
    ol.innerHTML = '';
    if (!sites.length) {
      ol.innerHTML = '<li class="muted" style="cursor:default">ماكو مناطق مؤهلة بهالمسافة. قلّل البعد.</li>';
    }
    sites.forEach(function (c, i) {
      var li = document.createElement('li');
      li.tabIndex = 0;
      li.dataset.id = c.id;
      li.innerHTML = '<span class="num">' + (i + 1) + '</span><span class="t">' + LABELS.lc[c.lc] +
        '<small>' + LABELS.priority[c.p] + ' · ترتيب ' + c.rank + '</small></span><span class="d">' + c.dist.toFixed(1) + ' كم</span>';
      li.addEventListener('click', function () { select(c, true); });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c, true); } });
      ol.appendChild(li);
    });
    markList();
  }

  function markList() {
    var lis = document.querySelectorAll('#sl-list li');
    for (var i = 0; i < lis.length; i++) lis[i].classList.toggle('on', state.selected && +lis[i].dataset.id === state.selected.id);
  }

  function select(c, fly) {
    state.selected = c;
    if (selOutline) map.removeLayer(selOutline);
    var hw = HALF_LAT / Math.cos(c.lat * Math.PI / 180);
    selOutline = L.rectangle([[c.lat - HALF_LAT, c.lon - hw], [c.lat + HALF_LAT, c.lon + hw]],
      { color: '#38E1FF', weight: 3, fill: false, interactive: false }).addTo(map);
    if (fly) map.flyTo([c.lat, c.lon], Math.max(map.getZoom(), 14), { duration: 0.8 });
    renderInspector(c);
    markList();
    if (window.matchMedia('(max-width:960px)').matches && !fly) {
      document.getElementById('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderInspector(c) {
    var siteIdx = state.sites ? state.sites.indexOf(c) : -1;
    var col = COLORS.priority[c.p];
    var sigs = [];
    if (c.sig & 1) sigs.push('الخضرة الحالية منخفضة مقارنة ببقية بغداد');
    if (c.sig & 2) sigs.push('الخضرة نزلت مقارنة بالـ 12 شهر السابقة');
    if (c.sig & 4) sigs.push('أقل من مستواها المعتاد بنفس الأشهر');
    var unc = ['نوع الأرض قيمة وحدة بمركز الخلية'];
    if (c.lc === 3) unc.push('أرض زراعية: تأكد من الاستخدام قبل أي تشجير');
    if (c.lc === 4) unc.push('أرض جرداء: هذا ما يعني أنها صالحة للزراعة تلقائياً');
    if (c.lc === 0) unc.push('أشجار موجودة: العناية ممكن أهم من الزراعة الجديدة');
    if (c.lc === 5) unc.push('خلية 1 كم مركزها مبني: ما نعرف إذا بيها مساحة مفتوحة');
    if (c.lc === 6) unc.push('خلية مختلطة بيها مي');
    if (c.unc & 1) unc.push('بيانات التربة ناقصة');
    if (c.unc & 2) unc.push('بعض الأشهر الأخيرة قراءة NDVI بيها غير موثوقة');
    if (c.unc & 4) unc.push('ماكو مقارنة موسمية متوفرة');
    var soil = c.soc === null ? 'بيانات التربة ناقصة (مو معناها تربة ضعيفة)' :
      'كربون عضوي ' + c.soc.toFixed(1) + ' غم/كغم، رمل ' + Math.round(c.sand) + ' غم/كغم';
    var gm = 'https://www.google.com/maps/search/?api=1&query=' + c.lat.toFixed(6) + ',' + c.lon.toFixed(6);
    var html =
      '<h3>' + (siteIdx >= 0 ? 'منطقة ' + (siteIdx + 1) + ' من أفضل 20' : 'خلية رقم ' + c.id) + '</h3>' +
      '<span class="ins-badge" style="background:' + col + '22;color:' + col + ';border:1px solid ' + col + '66">' + LABELS.priority[c.p] + '</span>' +
      '<dl class="kv">' +
      '<dt>الترتيب</dt><dd>' + nf(c.rank) + ' من ' + nf(cells.length) + '</dd>' +
      '<dt>نوع الأرض</dt><dd>' + LABELS.lc[c.lc] + '</dd>' +
      '<dt>المجموعة</dt><dd>' + LABELS.group[c.grp] + '</dd>' +
      '<dt>البعد عن المركز</dt><dd>' + c.dist.toFixed(1) + ' كم</dd>' +
      '<dt>NDVI آخر 12 شهر</dt><dd dir="ltr" style="text-align:right">' + fmt(c.ndvi, 3) + '</dd>' +
      '<dt>التغير السنوي</dt><dd dir="ltr" style="text-align:right">' + fmt(c.chg, 3, true) + '</dd>' +
      '<dt>الفرق الموسمي</dt><dd dir="ltr" style="text-align:right">' + fmt(c.anom, 3, true) + '</dd>' +
      '<dt>التربة</dt><dd>' + LABELS.soil[c.pot] + '</dd>' +
      '<dt>K-Means</dt><dd>' + LABELS.cluster[c.cl] + '</dd>' +
      '<dt>ثقة البيانات</dt><dd>' + LABELS.conf[c.conf] + '</dd>' +
      '<dt>الإحداثيات</dt><dd dir="ltr" style="text-align:right">' + c.lat.toFixed(5) + ', ' + c.lon.toFixed(5) + '</dd>' +
      '</dl>' +
      '<a class="gmaps" href="' + gm + '" target="_blank" rel="noopener noreferrer">افتح بـ Google Maps ↗</a>' +
      '<div class="ins-block"><b>ليش هالترتيب</b>' + (sigs.length ? '<ul><li>' + sigs.join('</li><li>') + '</li></ul>' : 'ماكو إشارة حاجة واضحة.') + '</div>' +
      '<div class="ins-block"><b>التربة</b>' + soil + '</div>' +
      '<div class="ins-block"><b>ملاحظة استخدام الأرض</b><span class="warn">' + (LABELS.note[c.lc] || LABELS.note.def) + '</span></div>' +
      '<div class="ins-block"><b>حدود البيانات</b><ul><li>' + unc.join('</li><li>') + '</li></ul></div>';
    var el = document.getElementById('inspector');
    el.innerHTML = html;
    el.scrollTop = 0;
  }

  function bindSeg(attr, fn) {
    var btns = document.querySelectorAll('[data-' + attr + ']');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(btns, function (o) { o.setAttribute('aria-checked', o === b ? 'true' : 'false'); });
        fn(b.getAttribute('data-' + attr));
      });
    });
  }

  function bindControls() {
    bindSeg('mode', function (m) { state.mode = m; recolor(); });
    bindSeg('base', function (b) {
      if (b === 'sat') { map.removeLayer(baseStreet); baseSat.addTo(map); }
      else { map.removeLayer(baseSat); baseStreet.addTo(map); }
      baseSat.bringToBack(); baseStreet.bringToBack();
    });
    var range = document.getElementById('dist'), out = document.getElementById('dist-out');
    range.addEventListener('input', function () {
      state.minKm = +range.value;
      out.textContent = range.value + ' كم';
      updateStars();
    });
    document.getElementById('show-stars').addEventListener('change', function (e) {
      state.stars = e.target.checked;
      if (state.stars) starLayer.addTo(map); else map.removeLayer(starLayer);
      renderLegend();
    });
    document.getElementById('show-top100').addEventListener('change', function (e) {
      if (e.target.checked) top100Layer.addTo(map); else map.removeLayer(top100Layer);
    });
    document.getElementById('show-excluded').addEventListener('change', function (e) {
      state.excluded = e.target.checked; recolor();
    });
  }
})();
