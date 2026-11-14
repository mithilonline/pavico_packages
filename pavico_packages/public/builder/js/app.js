/* Pavico Package Builder — prototype UI (vanilla JS, no build step). */
(function () {
  const D = window.PAVICO_DATA;
  const S = window.PavicoSuppliers;
  const P = window.PavicoPricing;
  const I = window.PavicoItinerary;
  const fmt = P.fmt;

  const STEPS = ['Trip', 'Cities', 'Experiences', 'Package', 'Rates', 'Quote'];
  const TIERS = [
    { id: 'budget', label: 'Budget', hint: '3-star & above' },
    { id: 'mid', label: 'Mid-luxury', hint: '4-star' },
    { id: 'luxury', label: 'Luxury', hint: '5-star' },
  ];
  // Hotel-industry meal plan codes
  const MEALS = {
    EP: 'Room only (EP)',
    CP: 'Breakfast (CP)',
    MAP: 'Breakfast + dinner (MAP)',
    AP: 'All meals (AP)',
    AI: 'All inclusive (AI)',
  };
  const MEAL_HINTS = {
    EP: 'European Plan: room only, no meals',
    CP: 'Continental Plan: bed & breakfast',
    MAP: 'Modified American Plan: half board, breakfast + one main meal (usually dinner)',
    AP: 'American Plan: full board, breakfast, lunch and dinner',
    AI: 'All inclusive: all meals, snacks and selected drinks at the hotel',
  };
  const mealText = (k) => MEALS[k] || MEALS.CP;
  const FLIGHT_SOURCES = ['TBO', 'TripJack', 'MakeMyTrip', 'Airline direct', 'Other'];
  const DRAFT_KEY = 'pavico.draft.v2';
  const Store = window.PavicoStore;

  // ───────────── state ─────────────
  function isoIn(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
  function newRef() {
    const d = new Date();
    return `PAV-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  }
  function fresh() {
    return {
      ref: newRef(), step: 1, client: '', phone: '', customer: '', contact: '', destId: '', template: null, startDate: isoIn(30),
      adults: 2, children: 0, childAges: [], roomSharing: 2, roomsOverride: '',
      vehicle: '', vehicleCount: '', discountType: 'amt', discount: 0,
      extraCities: [], own: {},
      cities: [], picks: {}, tier: 'mid', mealPlan: 'CP', transfers: true,
      flightsPP: 0, flightsSource: 'TBO', visaPP: 0, insurancePP: 0, extras: [],
      rates: {}, marginPct: 10, gstPct: 5, edits: {}, view: 'client', pkgFilter: 'all',
      cat: { rec: false, pop: false, off: false },
      version: 0, // last saved version of this quote (0 = never saved)
      advancePct: 50, balanceDaysBefore: 2,
    };
  }
  const load = (key, fallback) => Store.local.get(key, fallback);
  const store = (key, v) => Store.local.set(key, v);

  let st = Object.assign(fresh(), load(DRAFT_KEY, {}));
  const sheet = Store.rates.all(); // shared rate sheet: { [cityId]: { [tier]: { hotel, rate, cab, act, source } } }

  // ───────────── helpers ─────────────
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const W = window.PavicoWiki;
  // The destination, plus any cities the team added by search and their own attractions
  function dest() {
    const d = D.destinations.find((x) => x.id === st.destId) || (st.customDest && st.customDest.id === st.destId ? st.customDest : null);
    if (!d) return null;
    (st.extraCities || []).forEach((x) => {
      if (!d.cities.some((c) => c.id === x.id)) d.cities.push({ id: x.id, name: x.name, suggestedNights: x.suggestedNights || 2, attractions: [], food: [], mustTry: [], custom: true });
    });
    Object.entries(st.own || {}).forEach(([cid, items]) => {
      const c = d.cities.find((x) => x.id === cid);
      if (c) items.forEach((it) => { if (!c.attractions.some((a) => a.id === it.id)) c.attractions.push(Object.assign({ hours: 2, own: true }, it)); });
    });
    return d;
  }
  const cityBlurb = (d, c) => (d.blurbFor ? d.blurbFor(c.id) : c.loaded ? `${c.attractions.length} things to do · Wikivoyage` : c.error ? 'Guide unavailable' : 'Wikivoyage guide');

  // Cities load their Wikivoyage listings the first time they are needed:
  //  · custom destinations get all their things to do from it
  //  · Pavico package cities keep their brochure items and gain eat/drink spots and extra sights
  const loadingCities = new Set();
  const ENRICH_KEY = 'pavico.wvcity.v2'; // v2: includes nearby sights from Wikipedia's map
  const WV_ALIAS = {
    'Ha Long cruise': 'Ha Long', 'Lan Ha Bay cruise': 'Cat Ba Island', 'Lake Kawaguchi': 'Fujikawaguchiko', Sohra: 'Cherrapunji',
    'North-west coast': 'Grand Baie', Havelock: 'Havelock Island', Neil: 'Neil Island', 'Isle of Skye': 'Skye', Kaza: 'Kaza (India)',
  };
  function mergeEnrichment(c, data) {
    if (c.enriched) return;
    // skip guide sights the brochure already covers ("City Palace" ⊂ "City Palace museum and courtyards")
    const have = c.attractions.map((a) => a.name.toLowerCase());
    data.attractions.forEach((a) => { const n = a.name.toLowerCase(); if (!have.some((h) => h.includes(n))) c.attractions.push(a); });
    c.food = data.food.slice();
    c.enriched = true;
  }
  (function applyCachedEnrichment() {
    const cache = load(ENRICH_KEY, {});
    D.destinations.forEach((d) => d.cities.forEach((c) => { if (cache[c.id]) mergeEnrichment(c, cache[c.id]); }));
  })();
  function ensureCity(cityId) {
    const d = dest();
    const c = d && d.cities.find((x) => x.id === cityId);
    if (!c || loadingCities.has(cityId)) return;
    const custom = d.source === 'wikivoyage' || c.custom;
    if (custom ? (c.loaded || c.error) : (c.enriched || c.enrichFailed)) return;
    loadingCities.add(cityId);
    W.loadCity({ id: c.id, name: custom ? c.name : (WV_ALIAS[c.name] || c.name) }).then((res) => {
      if (custom) {
        const own = c.attractions.filter((a) => a.own);
        Object.assign(c, res); delete c.error;
        own.forEach((a) => { if (!c.attractions.some((x) => x.id === a.id)) c.attractions.push(a); });
        return;
      }
      const data = {
        attractions: res.attractions.map((a, i) => Object.assign(a, { id: `${c.id}-wa${i}`, src: a.src || 'wv' })),
        food: res.food.map((f, i) => Object.assign(f, { id: `${c.id}-wf${i}` })),
      };
      const cache = load(ENRICH_KEY, {}); cache[c.id] = data; store(ENRICH_KEY, cache);
      mergeEnrichment(c, data);
    }).catch((e) => { if (custom) c.error = e.message; else c.enrichFailed = true; })
      .finally(() => { loadingCities.delete(cityId); render(); });
  }

  // Popularity: one Wikipedia lookup per attraction (shared with its photo), then one re-render
  const statsTried = new Set();
  let statsPending = false;
  function ensureStats() {
    if (statsPending) return;
    const jobs = [];
    uniqueCities().forEach((id) => {
      const c = cityOf(id);
      c.attractions.forEach((a) => {
        const k = `${c.name}|${a.name}`;
        if (W.cachedViews(c.name, a.name) === null && !statsTried.has(k)) { statsTried.add(k); jobs.push(W.statsFor(c.name, a.name)); }
      });
    });
    if (!jobs.length) return;
    statsPending = true;
    Promise.all(jobs).then(() => { statsPending = false; if (st.step === 3) render(); });
  }

  /**
   * Category sets for a city's attractions.
   *  pop  — the most-read Wikipedia articles among them
   *  off  — the least-known ones (few or no readers)
   *  rec  — Pavico picks (starred), the loaded package's picks, then the best-known
   *         Pavico-brochure sights and guide sights that fit the nights in this city
   */
  function categories(cityId) {
    const c = cityOf(cityId);
    const nights = st.cities.filter((x) => x.id === cityId).reduce((s, x) => s + +x.nights, 0);
    const fromGuide = (a) => a.src === 'wv' || a.src === 'near' || dest().source === 'wikivoyage';
    const ranked = c.attractions.map((a) => ({ a, v: W.cachedViews(c.name, a.name) || 0 })).sort((x, y) => y.v - x.v);
    const top = ranked.length ? ranked[0].v : 0;
    // relative to the city's best-known sight, so it works for Tokyo and for Munnar alike
    const pop = new Set(ranked.filter((x) => x.v > 0 && x.v >= Math.max(1500, top * 0.4)).map((x) => x.a.id));
    const off = new Set(ranked.filter((x) => !pop.has(x.a.id) && ((x.v > 0 && x.v < top * 0.15) || (x.v === 0 && fromGuide(x.a)))).map((x) => x.a.id));
    const rec = new Set(c.attractions.filter((a) => W.isPavicoPick(c.name, a.name)).map((a) => a.id));
    const t = st.template && pkgOf(st.template);
    if (t && t.destId === st.destId) ((t.picks[cityId] || {}).attractions || []).forEach((id) => rec.add(id));
    const cap = Math.max(3, nights * 5); // sightseeing hours the nights allow
    let used = c.attractions.filter((a) => rec.has(a.id)).reduce((s, a) => s + (a.hours || 1.5), 0);
    // brochure sights first; guide sights only when they have a real Wikipedia article
    [...ranked.filter((x) => !fromGuide(x.a)), ...ranked.filter((x) => fromGuide(x.a) && x.v > 0)].forEach((x) => {
      if (rec.has(x.a.id) || used + (x.a.hours || 1.5) > cap) return;
      rec.add(x.a.id); used += x.a.hours || 1.5;
    });
    return { rec, pop, off };
  }
  const CATS = [
    { id: 'rec', label: 'Recommended', hint: 'Pavico picks + what fits the nights' },
    { id: 'pop', label: 'Most popular', hint: 'The best-known sights' },
    { id: 'off', label: 'Off-beat', hint: 'Lesser-known places' },
  ];

  // photos: thumbnails are placeholders in the HTML, filled in after each render
  const thumb = (cityName, item) => `<span class="thumb" data-pc="${esc(cityName)}" data-pn="${esc(item.name)}" data-pf="${esc(item.image || '')}"></span>`;
  function hydratePhotos() {
    document.querySelectorAll('.thumb:not([data-done])').forEach((el) => {
      el.dataset.done = '1';
      W.photoFor(el.dataset.pc, el.dataset.pn, el.dataset.pf).then((hit) => {
        if (!hit) { el.classList.add('none'); return; }
        el.innerHTML = `<img src="${esc(hit.url)}" alt="" loading="lazy">`;
        const img = el.querySelector('img');
        img.onerror = () => { el.innerHTML = ''; el.classList.add('none'); };
      });
    });
  }
  const cityOf = (id) => dest() && dest().cities.find((c) => c.id === id);
  const pkgOf = (id) => D.packages.find((p) => p.id === id);
  const pax = () => (+st.adults || 0) + (+st.children || 0);
  const nightsTotal = () => st.cities.reduce((s, c) => s + (+c.nights || 0), 0);
  const tierLabel = (t) => TIERS.find((x) => x.id === t).label;
  const uniqueCities = () => [...new Set(st.cities.map((c) => c.id))];

  function templateActive() {
    const t = st.template && pkgOf(st.template);
    if (!t || t.destId !== st.destId || t.route.length !== st.cities.length) return null;
    return t.route.every((r, i) => r.id === st.cities[i].id && r.nights === +st.cities[i].nights) ? t : null;
  }

  function defaultHotelName(cityId, tier) {
    const t = st.template && pkgOf(st.template);
    const city = cityOf(cityId);
    if (t && t.hotels && city && t.hotels[city.name]) return t.hotels[city.name];
    return `${TIERS.find((x) => x.id === tier).hint} hotel or similar`;
  }
  function rateFor(cityId, tier) {
    const fromQuote = (st.rates[cityId] || {})[tier];
    const fromSheet = (sheet[cityId] || {})[tier];
    const r = Object.assign({ hotel: defaultHotelName(cityId, tier), rate: 0, xbed: 0, cab: 0, act: 0, source: 'ratesheet' }, fromSheet || {}, fromQuote || {});
    r.vehicles = Object.assign({}, (fromSheet || {}).vehicles, (fromQuote || {}).vehicles);
    return r;
  }
  function setRate(cityId, tier, field, value, vehicleId) {
    const cur = rateFor(cityId, tier);
    const merged = vehicleId
      ? Object.assign(cur, { vehicles: Object.assign({}, cur.vehicles, { [vehicleId]: value }) })
      : Object.assign(cur, { [field]: value });
    ((st.rates[cityId] = st.rates[cityId] || {})[tier] = merged);
    const city = cityOf(cityId);
    Store.rates.set(cityId, tier, merged, city ? city.name : '');
  }

  function quote(tierOverride) {
    const d = dest();
    if (!d || !st.cities.length) return null;
    const { lines, missing } = P.buildCostLines({ st, dest: d, tier: tierOverride || st.tier, rateFor });
    return { lines, missing, sum: P.summarize(lines, +st.marginPct || 0, +st.gstPct || 0, pax(), { type: st.discountType, value: st.discount }) };
  }
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const endDateIso = () => (st.startDate && st.cities.length ? isoLocal(I.addDays(st.startDate, nightsTotal())) : '');
  const prettyDate = (iso) => (iso ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`)) : '');

  function itinerary() {
    const t = templateActive();
    if (!t) return I.build(st, dest(), (cid) => ({ hotelName: rateFor(cid, st.tier).hotel }));
    const dayCity = [];
    t.route.forEach((r) => { for (let i = 0; i < r.nights; i++) dayCity.push(r); });
    const days = t.days.map(([title, bullets, tip], i) => {
      const r = dayCity[i] || t.route[t.route.length - 1];
      const last = i === t.days.length - 1;
      return {
        key: `t-${t.id}-${i}`, dayNo: i + 1, date: I.addDays(st.startDate, i), cityId: r.id, cityName: r.name,
        kind: i === 0 ? 'arrival' : last ? 'departure' : 'sightseeing', title, intro: '',
        items: bullets.map((b) => ({ name: b })), foods: [], tip,
        overnight: last ? null : rateFor(r.id, st.tier).hotel,
      };
    });
    return { days, warnings: [] };
  }

  function save() { store(DRAFT_KEY, st); }
  Store.onError = (err) => toast(`Not saved: ${err.message}`);

  /** In-app confirmation box (browser confirm() pop-ups can be blocked, which silently means "No"). */
  function askConfirm(message, okLabel = 'OK') {
    let m = $('#modal');
    if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal no-print'; document.body.appendChild(m); }
    m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
      <p>${esc(message)}</p>
      <div class="modal-actions"><button class="btn ghost" data-answer="0">Cancel</button><button class="btn primary" data-answer="1">${esc(okLabel)}</button></div>
    </div>`;
    m.hidden = false;
    m.querySelector('[data-answer="1"]').focus();
    return new Promise((resolve) => {
      const done = (yes) => { m.hidden = true; m.onclick = null; document.removeEventListener('keydown', onKey); resolve(yes); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      m.onclick = (e) => {
        const b = e.target.closest('[data-answer]');
        if (b) done(b.dataset.answer === '1'); else if (e.target === m) done(false);
      };
    });
  }

  // ───────────── PDF ─────────────
  // File name: Pavico_<Client>_<Package>_<N>N<D>D_<Ref>-v<version>.pdf
  function pdfFileName(version) {
    const part = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const t = templateActive();
    const d = dest();
    const pkg = t ? t.title : d ? d.name : 'Trip';
    return ['Pavico', part(st.client), part(pkg), `${nightsTotal()}N${nightsTotal() + 1}D`, `${st.ref}-v${version}`]
      .filter(Boolean).join('_') + '.pdf';
  }
  /**
   * The client document as a standalone A4 page: real text (selectable, editable in a PDF editor),
   * and a footer on every page with the quote number and "Page X of Y".
   */
  function printableHtml(title, version) {
    const doc = $('#client-doc').cloneNode(true);
    doc.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
    doc.querySelectorAll('img').forEach((i) => { i.setAttribute('src', i.src); i.removeAttribute('loading'); });
    doc.querySelectorAll('.thumb').forEach((t) => { if (!t.querySelector('img')) t.remove(); });
    doc.querySelectorAll('.day-photos').forEach((p) => { if (!p.children.length) p.remove(); });
    // screen styles, minus the phone layout (an A4 page is narrower than the phone breakpoint)
    const css = [...document.styleSheets].map((s) => {
      try {
        return [...s.cssRules].filter((r) => !(r.media && /max-width/.test(r.media.mediaText)) && !(r.media && /print/.test(r.media.mediaText))).map((r) => r.cssText).join('\n');
      } catch (e) { return ''; }
    }).join('\n');
    const foot = `Pavico · Quote ${st.ref}${version ? ` · v${version}` : ''}`.replace(/"/g, '');
    const printCss = `
      @page { size: A4; margin: 14mm 13mm 16mm;
        @bottom-left { content: "${foot}"; font: 8.5pt 'DM Sans', sans-serif; color: #4A5A72; }
        @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8.5pt 'DM Sans', sans-serif; color: #4A5A72; } }
      html, body { background: #fff !important; margin: 0; padding: 0; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 10.5pt; }
      .doc { box-shadow: none !important; border: 0 !important; border-radius: 0; margin: 0 !important; padding: 0 !important; max-width: none !important; width: auto; }
      .doc-hero h1 { font-size: 22pt; }
      .day { grid-template-columns: 80px 1fr; break-inside: avoid; page-break-inside: avoid; }
      .day-photos .thumb { width: 31%; height: 30mm; }
      .price-box, .facts, .two-col > div, .terms li, tr, .doc-head, .doc-foot { break-inside: avoid; page-break-inside: avoid; }
      h2 { break-after: avoid; page-break-after: avoid; }
      .doc-foot { display: none; }`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
      <style>${css}\n${printCss}</style></head><body>${doc.outerHTML}
      <p class="credit" style="margin-top:6mm">Pavico LLP, Pune · WhatsApp +91 93703 05751 · support@pavico.in · pavico.in</p></body></html>`;
  }

  /** Saves a version if the quote changed, then produces the client PDF named after that version. */
  async function downloadPdf(btn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing PDF…';
    const prevView = st.view;
    let name = '';
    try {
      const version = await saveVersion({ quiet: true });
      st.view = 'client'; render();
      await waitForImages($('#client-doc'));
      name = pdfFileName(version);
      const html = printableHtml(name.replace(/\.pdf$/, ''), version);
      if (Store.mode === 'erp') {
        const blob = await Store.pdf(html, name);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast(`Downloaded ${name}`);
      } else {
        printViaFrame(html);
        toast('Choose “Save as PDF” in the print window');
      }
    } catch (err) {
      toast(`PDF failed: ${err.message}`);
    } finally {
      btn.disabled = false; btn.textContent = label;
      st.view = prevView; render();
    }
  }
  // for checking the PDF layout from the browser console
  window.PavicoDebug = { printableHtml: () => printableHtml('preview', st.version) };

  /** Prototype (no server): the browser's own Save as PDF, which keeps text and the page footers. */
  function printViaFrame(html) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    const go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); };
    f.onload = () => setTimeout(go, 400);
  }
  function waitForImages(root, ms = 6000) {
    const imgs = root ? [...root.querySelectorAll('img')] : [];
    const each = imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r; })));
    return Promise.race([Promise.all(each), new Promise((r) => setTimeout(r, ms))]);
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }
  function canGo(step) {
    if (step >= 2 && !st.destId) return false;
    if (step >= 3 && !st.cities.length) return false;
    return true;
  }

  function applyTemplate(id) {
    const t = pkgOf(id);
    st.destId = t.destId; st.template = t.id; st.tier = t.tier; st.mealPlan = t.meals;
    st.cities = t.route.map((r) => ({ id: r.id, nights: r.nights }));
    st.picks = JSON.parse(JSON.stringify(t.picks));
    st.edits = {};
  }

  // ───────────── render ─────────────
  function render() {
    renderStepper();
    $('#main').innerHTML = [null, stepTrip, stepCities, stepExperiences, stepPackage, stepRates, stepQuote][st.step]();
    renderSummary();
    document.body.dataset.step = st.step;
    save();
    hydratePhotos();
    if (st.step >= 3 && dest()) uniqueCities().forEach(ensureCity);
    if (st.step === 3 && dest()) ensureStats();
  }

  function renderStepper() {
    $('#stepper').innerHTML = STEPS.map((s, i) => {
      const n = i + 1;
      const cls = n === st.step ? 'active' : n < st.step ? 'done' : '';
      return `<button class="step ${cls}" data-action="goto" data-step="${n}" ${canGo(n) ? '' : 'disabled'}><span class="num">${n}</span>${s}</button>`;
    }).join('');
  }

  function navButtons(nextLabel = 'Next', nextDisabled = false) {
    return `<div class="nav-row">
      ${st.step > 1 ? '<button class="btn ghost" data-action="back">Back</button>' : '<span></span>'}
      ${st.step < STEPS.length ? `<button class="btn primary" data-action="next" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button>` : ''}
    </div>`;
  }

  function priceText(p) {
    if (!p.price) return 'Price on request';
    return `${fmt(p.price)} for 2 ${p.gstIncluded ? 'incl. GST' : '+ GST'}`;
  }

  function roomsBlock() {
    const rp = P.roomPlan(st);
    return `<div class="grid4 rooms-row">
        <label class="field small"><span>Room sharing</span><select data-bind="roomSharing">
          <option value="2" ${rp.sharing === 2 ? 'selected' : ''}>2 per room (double)</option>
          <option value="3" ${rp.sharing === 3 ? 'selected' : ''}>3 per room (triple, group tours)</option></select></label>
        <label class="field small"><span>Rooms</span><input type="number" min="1" data-bind="roomsOverride" value="${esc(st.roomsOverride || '')}" placeholder="${rp.auto} (auto)"></label>
        <p class="muted small rooms-note">${rp.guests} guest${rp.guests !== 1 ? 's' : ''} need beds${rp.smallKids ? ` (+${rp.smallKids} child${rp.smallKids > 1 ? 'ren' : ''} 5 or under sharing)` : ''} → <strong>${rp.rooms} room${rp.rooms > 1 ? 's' : ''}</strong>${rp.extraBeds ? ` + ${rp.extraBeds} extra bed${rp.extraBeds > 1 ? 's' : ''}` : ''}${rp.overridden ? ' (set by you)' : ''}.
          ${rp.overfull ? '<span class="error-text">More than 3 people per room: add rooms.</span>' : ''}</p>
      </div>`;
  }

  // Step 1 — trip basics + start from a package
  function stepTrip() {
    const f = st.pkgFilter;
    const list = D.packages.filter((p) => f === 'all' || p.region === f);
    const cards = list.map((p) => `<button class="pkg-card ${st.template === p.id ? 'on' : ''}" data-action="use-package" data-id="${p.id}">
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<div class="photo-ph">Photo · ${esc(p.dest)}</div>`}
      <span class="pkg-body">
        <small class="eyebrow-ink">${esc(p.dest)}</small>
        <strong>${esc(p.title)}</strong>
        <span class="muted small">${p.nights}N / ${p.nights + 1}D · ${esc(p.route.map((r) => r.name).filter((n, i, a) => a.indexOf(n) === i).join(' · '))}</span>
        <span class="pkg-price">${priceText(p)}</span>
      </span>
    </button>`).join('');
    const group = (type, label) => `<optgroup label="${label}">${D.destinations.filter((d) => d.type === type)
      .map((d) => `<option value="${d.id}" ${d.id === st.destId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</optgroup>`;
    const ages = Array.from({ length: +st.children || 0 }, (_, i) =>
      `<label class="field small"><span>Child ${i + 1} age</span><input type="number" min="0" max="17" data-bind="childAges.${i}" value="${esc(st.childAges[i] ?? '')}"></label>`).join('');
    const t = st.template && pkgOf(st.template);
    return `<section class="card">
      <h1>Start a quote</h1>
      <p class="muted">Who is travelling, and when.</p>
      <div class="grid2">
        <div class="field client-search"><span>Client name</span>
          <input id="client-q" data-bind="client" value="${esc(st.client)}" placeholder="${Store.mode === 'erp' ? 'Type to search ERPNext customers & contacts' : 'e.g. Sharma family'}" autocomplete="off">
          <div id="client-results" class="wv-results"></div>
          ${st.customer || st.contact ? `<small class="linked">Linked to ERPNext ${st.customer ? `customer <strong>${esc(st.customer)}</strong>` : ''}${st.customer && st.contact ? ' · ' : ''}${st.contact ? `contact <strong>${esc(st.contact)}</strong>` : ''} <button class="btn link" data-action="unlink-client">Unlink</button></small>`
            : Store.mode === 'erp' && st.client ? '<small class="muted">New client: a contact is created in ERPNext when you save the quote.</small>' : ''}
        </div>
        <label class="field"><span>Client phone / WhatsApp</span><input data-bind="phone" value="${esc(st.phone)}" placeholder="Filled from the contact, or type it"></label>
      </div>
      <div class="grid4">
        <label class="field small"><span>Start date</span><input type="date" data-bind="startDate" value="${esc(st.startDate)}"></label>
        <label class="field small"><span>End date</span><input type="date" value="${esc(endDateIso())}" disabled title="Start date + total nights of the route">${st.cities.length ? '' : '<small class="muted">Set by the route</small>'}</label>
        <label class="field small"><span>Adults</span><input type="number" min="1" data-bind="adults" value="${st.adults}"></label>
        <label class="field small"><span>Children</span><input type="number" min="0" max="10" data-bind="children" value="${st.children}"></label>
      </div>
      ${ages ? `<div class="grid4">${ages}</div>` : ''}
      ${roomsBlock()}

      <div class="section-head">
        <h2>Start from a Pavico package</h2>
        <div class="seg small-seg">
          ${[['all', 'All'], ['india', 'India'], ['international', 'International']].map(([v, l]) => `<button class="${f === v ? 'on' : ''}" data-action="pkg-filter" data-v="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <p class="muted small">Loads the route, nights, hotel category and the brochure’s day-by-day plan. You can change anything after.</p>
      <div class="pkg-grid">${cards}</div>

      <h2>Or build a custom trip</h2>
      <div class="grid2">
        <label class="field"><span>A Pavico destination</span>
          <select data-bind="destId"><option value="">Choose…</option>${group('domestic', 'India')}${group('international', 'International')}</select>
        </label>
        <div class="field wv-search">
          <span>Any destination in the world</span>
          <input id="wv-q" placeholder="Search, e.g. Kerala, Switzerland, Sri Lanka" autocomplete="off">
          <div id="wv-results" class="wv-results"></div>
        </div>
      </div>
      ${st.customDest && st.customDest.id === st.destId ? `<p class="note">Building <strong>${esc(st.customDest.name)}</strong> from the Wikivoyage guide: ${st.customDest.cities.length} cit${st.customDest.cities.length === 1 ? 'y' : 'ies'} · ${st.customDest.type === 'domestic' ? 'India' : 'International'}
        <button class="btn link" data-action="flip-region">Mark as ${st.customDest.type === 'domestic' ? 'international' : 'India'}</button></p>` : ''}
      ${t ? `<p class="note">Using <strong>${esc(t.title)}</strong> as the starting point.</p>` : ''}
      ${navButtons(st.template ? 'Review cities' : 'Choose cities', !st.destId)}
    </section>`;
  }

  // Step 2 — cities (a city can appear twice, so rows are edited by position)
  function stepCities() {
    const d = dest();
    const t = templateActive();
    const cards = d.cities.map((c) => {
      const count = st.cities.filter((x) => x.id === c.id).length;
      return `<button class="city-card ${count ? 'on' : ''}" data-action="add-city" data-id="${c.id}">
        <div class="city-body"><strong>${esc(c.name)}</strong><span class="muted">${esc(cityBlurb(d, c))}</span>
        <span class="tag">${count ? `In route${count > 1 ? ` ×${count}` : ''} · add again` : `+ Add · suggested ${c.suggestedNights}N`}</span></div>
      </button>`;
    }).join('');
    const route = st.cities.map((sel, i) => {
      const c = cityOf(sel.id);
      return `<li class="route-row">
        <span class="route-num">${i + 1}</span><strong>${esc(c.name)}</strong>
        <div class="stepper-input">
          <button class="icon" data-action="nights" data-i="${i}" data-delta="-1" aria-label="Fewer nights">−</button>
          <span>${sel.nights} night${sel.nights > 1 ? 's' : ''}</span>
          <button class="icon" data-action="nights" data-i="${i}" data-delta="1" aria-label="More nights">+</button>
        </div>
        <div class="row-actions">
          <button class="icon" data-action="move" data-i="${i}" data-delta="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="icon" data-action="move" data-i="${i}" data-delta="1" ${i === st.cities.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button class="icon" data-action="remove-stop" data-i="${i}" aria-label="Remove">×</button>
        </div>
      </li>`;
    }).join('');
    const tp = st.template && pkgOf(st.template);
    return `<section class="card">
      <h1>${esc(d.name)}: route</h1>
      <p class="muted">Add cities in travel order and set nights. A city can appear twice (e.g. Srinagar at the start and end).</p>
      ${tp ? `<p class="note">${t ? `Matches <strong>${esc(tp.title)}</strong>, so the quote uses the brochure’s day-by-day plan.` : `Changed from <strong>${esc(tp.title)}</strong>, so the day plan is now built from the experiences you pick. <button class="btn link" data-action="use-package" data-id="${tp.id}">Reset to the package route</button>`}</p>` : ''}
      <div class="city-grid">${cards}</div>
      <div class="field wv-search add-city-search">
        <span>City or place not listed? (e.g. Ella, Nuwara Eliya, Munnar)</span>
        <input id="city-q" placeholder="Search any town or region to add it" autocomplete="off">
        <div id="city-results" class="wv-results"></div>
      </div>
      ${st.cities.length ? `<h2>Route · ${nightsTotal()}N / ${nightsTotal() + 1}D</h2><ol class="route">${route}</ol>` : ''}
      ${navButtons('Pick experiences', !st.cities.length)}
    </section>`;
  }

  // Step 3 — experiences
  function chip(c, kind, item, meta, cats) {
    const on = ((st.picks[c.id] || {})[kind] || []).includes(item.id);
    const star = W.isPavicoPick(c.name, item.name);
    const badges = cats ? [
      star ? '<span class="badge-tag pick">Pavico pick</span>' : cats.rec.has(item.id) ? '<span class="badge-tag rec">Recommended</span>' : '',
      cats.pop.has(item.id) ? '<span class="badge-tag pop">Popular</span>' : '',
      cats.off.has(item.id) ? '<span class="badge-tag off">Off-beat</span>' : '',
    ].join('') : '';
    return `<div class="chip ${on ? 'on' : ''}">
      ${thumb(c.name, item)}
      <button class="chip-main" data-action="toggle-pick" data-city="${c.id}" data-kind="${kind}" data-id="${item.id}" aria-pressed="${on}">
        <span class="check">${on ? '✓' : ''}</span><span class="chip-text"><span>${esc(item.name)}</span>${badges ? `<span class="badges">${badges}</span>` : ''}${meta ? `<small>${meta}</small>` : ''}</span>
      </button>
      <span class="photo-tools">
        ${kind === 'attractions' ? `<button class="mini" data-action="star" data-pc="${esc(c.name)}" data-pn="${esc(item.name)}">${star ? 'Remove Pavico pick' : '★ Pavico pick'}</button>` : ''}
        <label class="mini">Your photo<input type="file" accept="image/*" hidden data-upload-c="${esc(c.name)}" data-upload-n="${esc(item.name)}"></label>
        <button class="mini" data-action="hide-photo" data-pc="${esc(c.name)}" data-pn="${esc(item.name)}">No photo</button>
        ${item.own ? `<button class="mini" data-action="del-own" data-city="${c.id}" data-id="${item.id}">Remove</button>` : ''}
      </span>
    </div>`;
  }
  function stepExperiences() {
    const t = templateActive();
    const d = dest();
    const { warnings } = I.build(st, d, () => null);
    const meta = (a) => [a.own ? 'Added by you' : a.src === 'near' ? 'Nearby · Wikipedia' : '', a.hours ? `~${a.hours}h` : '', a.price ? esc(a.price.length > 40 ? `${a.price.slice(0, 40)}…` : a.price) : '', a.note ? esc(a.note.slice(0, 70)) + (a.note.length > 70 ? '…' : '') : ''].filter(Boolean).join(' · ');
    const loading = uniqueCities().some((id) => loadingCities.has(id));
    const statsLoading = statsPending;
    const blocks = uniqueCities().map((id) => {
      const c = cityOf(id);
      const cats = categories(id);
      const nights = st.cities.filter((x) => x.id === id).reduce((s, x) => s + +x.nights, 0);
      const status = !c.attractions.length ? (c.error ? `<p class="warn">Couldn’t load the guide for ${esc(c.name)}: ${esc(c.error)}</p>` : loadingCities.has(id) ? '<p class="muted">Loading things to do from Wikivoyage…</p>' : '<p class="muted">No listed things to do yet.</p>') : '';
      const food = c.food || [];
      return `<div class="exp-city">
        <h2>${esc(c.name)} <span class="muted">· ${nights}N</span></h2>
        ${status}
        ${c.attractions.length ? `<div class="exp-head"><h3>Things to do <span class="muted">· ${c.attractions.length}</span></h3>
          <button class="btn link" data-action="select-all" data-city="${c.id}" data-kind="attractions">Select all</button></div>
        <div class="chip-grid">${c.attractions.map((a) => chip(c, 'attractions', a, meta(a), cats)).join('')}</div>` : ''}
        <form class="own-add" data-own-city="${c.id}"><input name="own" placeholder="Add a place not listed, e.g. Nine Arch Bridge" autocomplete="off"><button class="btn ghost small" type="submit">+ Add</button></form>
        <div class="exp-head"><h3>Where to eat &amp; drink <span class="muted">· ${food.length}</span></h3>
          ${food.length ? `<button class="btn link" data-action="select-all" data-city="${c.id}" data-kind="food">Select all</button>` : ''}</div>
        ${food.length ? `<div class="chip-grid">${food.map((f) => chip(c, 'food', f, meta(Object.assign({}, f, { hours: 0 })))).join('')}</div>`
          : `<p class="muted small">${loadingCities.has(id) ? 'Loading from Wikivoyage…' : 'No eat & drink listings in the guide for this place.'}</p>`}
      </div>`;
    }).join('');
    const catBar = `<div class="cat-bar">
      ${CATS.map((k) => `<button class="cat-toggle ${st.cat[k.id] ? 'on' : ''}" data-action="toggle-cat" data-cat="${k.id}" aria-pressed="${!!st.cat[k.id]}">
        <span class="check">${st.cat[k.id] ? '✓' : ''}</span><span><strong>${k.label}</strong><small>${k.hint}</small></span></button>`).join('')}
    </div>
    <p class="muted small">Tick to select every attraction in that group across all cities; untick to clear them. Mix with your own picks.${loading || statsLoading ? ' <em>Still checking guides and popularity…</em>' : ''}</p>`;
    return `<section class="card">
      <h1>Things to do &amp; places to eat</h1>
      <p class="muted">${d.source === 'wikivoyage' ? 'From the Wikivoyage travel guide.' : 'Pavico brochure sights first, plus more from the Wikivoyage guide.'} Photos and popularity come from Wikipedia.</p>
      ${catBar}
      ${t ? `<p class="note">The route matches <strong>${esc(t.title)}</strong>, so the quote uses the brochure’s day plan. These picks are used when you change the route.</p>` : ''}
      ${!t && warnings.length ? `<div class="warn">${warnings.map(esc).join('<br>')}</div>` : ''}
      ${blocks}
      ${navButtons('Choose package')}
    </section>`;
  }

  function vehicleBlock(d) {
    const vp = P.vehiclePlan(st, d.type);
    const list = P.vehicleList(d.type);
    const autoId = P.suggestVehicle(d.type, pax());
    return `<div class="grid2 vehicle-row">
        <label class="field"><span>Vehicle</span><select data-bind="vehicle">
          <option value="" ${!st.vehicle ? 'selected' : ''}>Auto: ${esc(list.find((v) => v.id === autoId).label)}</option>
          ${list.map((v) => `<option value="${v.id}" ${st.vehicle === v.id ? 'selected' : ''}>${esc(v.label)} · up to ${v.seats}</option>`).join('')}</select>
          <small class="muted">${pax()} traveller${pax() !== 1 ? 's' : ''} with luggage.</small></label>
        <label class="field"><span>Number of vehicles</span><input type="number" min="1" data-bind="vehicleCount" value="${esc(st.vehicleCount || '')}" placeholder="${vp.needed} (auto)">
          ${vp.tooSmall ? `<small class="error-text">${vp.count} × ${esc(vp.vehicle.label)} seats only ${vp.count * vp.vehicle.seats}. Choose a bigger vehicle or more vehicles.</small>` : ''}</label>
      </div>`;
  }

  // Step 4 — package
  function stepPackage() {
    const d = dest();
    const tierCards = TIERS.map((t) => {
      const q = quote(t.id);
      const ready = !q.missing.length;
      return `<button class="tier-card ${st.tier === t.id ? 'on' : ''}" data-action="set-tier" data-tier="${t.id}">
        <strong>${t.label}</strong><span class="muted">${t.hint}</span>
        ${ready ? `<span class="tier-price">${fmt(q.sum.subtotalPP)}<small> /person + GST</small></span><span class="muted small">Total ${fmt(q.sum.total)} incl. GST</span>`
          : `<span class="muted small tier-missing">${q.missing.length} rate${q.missing.length > 1 ? 's' : ''} missing — add them in Rates</span>`}
      </button>`;
    }).join('');
    const extras = st.extras.map((x, i) => `<div class="extra-row">
      <input data-bind="extras.${i}.label" value="${esc(x.label)}" placeholder="e.g. Ha Long cruise, permits">
      <input type="number" data-bind="extras.${i}.amount" value="${esc(x.amount)}" placeholder="Total ₹">
      <button class="icon" data-action="del-extra" data-i="${i}" aria-label="Remove">×</button></div>`).join('');
    return `<section class="card">
      <h1>Choose the package</h1>
      <p class="muted">Tiers are priced side by side once their rates are in the rate sheet.</p>
      <div class="tier-grid">${tierCards}</div>
      <div class="grid2">
        <label class="field"><span>Meal plan</span><select data-bind="mealPlan">${Object.entries(MEALS).map(([k, v]) => `<option value="${k}" title="${MEAL_HINTS[k]}" ${st.mealPlan === k ? 'selected' : ''}>${v}</option>`).join('')}</select><small class="muted">${MEAL_HINTS[st.mealPlan] || ''}</small></label>
        <label class="field check-field"><input type="checkbox" data-bind="transfers" ${st.transfers ? 'checked' : ''}><span>Private vehicle for transfers &amp; sightseeing</span></label>
      </div>
      ${st.transfers ? vehicleBlock(d) : ''}
      <h2>Flights</h2>
      <p class="muted small">Check fares on TBO / TripJack / MMT and enter the per-person return fare. Leave 0 for land-only.</p>
      <div class="grid2">
        <label class="field"><span>Return fare per person (₹)</span><input type="number" min="0" data-bind="flightsPP" value="${st.flightsPP}"></label>
        <label class="field"><span>Fare source</span><select data-bind="flightsSource">${FLIGHT_SOURCES.map((s) => `<option ${st.flightsSource === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      ${d.type === 'international' ? `<h2>Visa &amp; insurance</h2>
        <div class="grid2">
          <label class="field"><span>Visa per person (₹)</span><input type="number" min="0" data-bind="visaPP" value="${st.visaPP}"></label>
          <label class="field"><span>Travel insurance per person (₹)</span><input type="number" min="0" data-bind="insurancePP" value="${st.insurancePP}"></label>
        </div>` : ''}
      <h2>Other costs</h2>
      <p class="muted small">Cruises, internal flights, permits, guides — anything not covered by the city rates.</p>
      ${extras}<button class="btn link" data-action="add-extra">+ Add a cost line</button>
      ${navButtons('Enter rates')}
    </section>`;
  }

  // Step 5 — rates (the Pavico rate sheet)
  function stepRates() {
    const sup = S.SUPPLIERS.map((s) => `<li class="sup ${s.status}"><strong>${esc(s.name)}</strong>
      <span class="pill">${s.status === 'connected' ? 'Active' : s.status === 'manual' ? 'Manual entry' : 'Needs API access'}</span>
      <small class="muted">${esc(s.note)}</small></li>`).join('');
    const rp = P.roomPlan(st);
    const vp = P.vehiclePlan(st, dest().type);
    const rows = uniqueCities().map((id) => {
      const c = cityOf(id);
      const r = rateFor(id, st.tier);
      const nights = st.cities.filter((x) => x.id === id).reduce((s, x) => s + +x.nights, 0);
      const f = (field, label, type = 'number', ph = '', val) => `<label class="field small"><span>${label}</span>
        <input type="${type}" ${type === 'number' ? 'min="0"' : ''} data-rate="${id}" data-field="${field}" ${field === 'veh' ? `data-veh="${vp.vehicle.id}"` : ''} value="${esc(val !== undefined ? val : type === 'number' ? (+r[field] || '') : r[field])}" placeholder="${ph}"></label>`;
      const vehRate = +(r.vehicles || {})[vp.vehicle.id] || (!Object.keys(r.vehicles || {}).length && +r.cab) || '';
      return `<div class="rate-city">
        <h2>${esc(c.name)} <span class="muted">· ${nights}N · ${tierLabel(st.tier)}</span></h2>
        <div class="rate-grid">
          ${f('hotel', 'Hotel', 'text', 'Hotel name or “or similar”')}
          <label class="field small"><span>Rate source</span><select data-rate="${id}" data-field="source">${S.SUPPLIERS.map((s) => `<option value="${s.id}" ${r.source === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          ${f('rate', `₹ per room per night (${mealText(st.mealPlan)})`, 'number', 'e.g. 6500')}
          ${rp.extraBeds ? f('xbed', '₹ extra bed per night (3rd person)', 'number', 'e.g. 1500') : ''}
          ${st.transfers ? f('veh', `₹ per day · ${esc(vp.vehicle.label)}`, 'number', 'e.g. 3500', vehRate) : ''}
          ${f('act', '₹ activities & entries per person', 'number', 'optional')}
        </div>
      </div>`;
    }).join('');
    return `<section class="card">
      <h1>Rates · ${tierLabel(st.tier)}</h1>
      <p class="muted">Enter each city’s costs once. They’re saved to the Pavico rate sheet and filled in on every future quote for this city and tier.</p>
      <ul class="suppliers">${sup}</ul>
      ${rows}
      ${navButtons('Build quote')}
    </section>`;
  }

  // Step 6 — quote
  function stepQuote() {
    const q = quote();
    return `<section class="quote-wrap">
      <div class="quote-toolbar no-print">
        <div class="seg">
          <button class="${st.view === 'client' ? 'on' : ''}" data-action="view" data-view="client">Client view</button>
          <button class="${st.view === 'internal' ? 'on' : ''}" data-action="view" data-view="internal">Internal costing</button>
        </div>
        <label class="field inline"><span>Margin %</span><input type="number" min="0" max="50" step="0.5" data-bind="marginPct" value="${st.marginPct}"></label>
        <label class="field inline discount"><span>Discount</span><input type="number" min="0" ${st.discountType === 'pct' ? 'max="100" step="0.5"' : 'step="100"'} data-bind="discount" value="${+st.discount || ''}" placeholder="0">
          <select data-bind="discountType"><option value="amt" ${st.discountType !== 'pct' ? 'selected' : ''}>₹</option><option value="pct" ${st.discountType === 'pct' ? 'selected' : ''}>%</option></select></label>
        <div class="spacer"></div>
        <button class="btn ghost" data-action="copy-wa">Copy for WhatsApp</button>
        <button class="btn ghost" data-action="save-quote">Save quote</button>
        <button class="btn primary" data-action="print">Download PDF</button>
      </div>
      ${st.startDate && st.startDate < isoIn(0) ? `<div class="warn no-print"><strong>Travel date has passed:</strong> ${esc(st.startDate)}. <button class="btn link" data-action="goto" data-step="1">Change it</button></div>` : ''}
      ${q.missing.length ? `<div class="warn no-print"><strong>Missing rates:</strong> ${q.missing.map(esc).join(' · ')}. <button class="btn link" data-action="goto" data-step="5">Add them</button></div>` : ''}
      ${st.view === 'internal' ? internalView(q) : ''}
      ${clientDoc(q)}
      <div class="no-print">${navButtons()}</div>
    </section>`;
  }

  function benchmark() {
    const t = st.template && pkgOf(st.template);
    if (!t || !t.price) return '';
    return `${esc(t.title)}: from ${priceText(t)}${t.priceNote ? ` (${esc(t.priceNote)})` : ''}`;
  }

  function internalView(q) {
    const cats = {};
    q.lines.forEach((l) => { (cats[l.category] = cats[l.category] || []).push(l); });
    const rows = Object.entries(cats).map(([cat, ls]) => `
      <tr class="cat"><td colspan="2">${esc(cat)}</td><td class="num">${fmt(ls.reduce((s, l) => s + l.amount, 0))}</td></tr>
      ${ls.map((l) => `<tr><td>${esc(l.label)}</td><td class="muted">${esc(l.detail)}</td><td class="num">${fmt(l.amount)}</td></tr>`).join('')}`).join('');
    const s = q.sum;
    const b = benchmark();
    return `<div class="card internal no-print">
      <h1>Internal costing <span class="pill warn-pill">Not for client</span></h1>
      <table class="cost">
        <thead><tr><th>Item</th><th>Calculation</th><th class="num">Cost</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">No costs yet. Add rates in step 5.</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="2">Base cost</td><td class="num">${fmt(s.base)}</td></tr>
          <tr><td colspan="2">Pavico margin (${st.marginPct}%)</td><td class="num">${fmt(s.margin)}</td></tr>
          ${s.discount ? `<tr><td colspan="2">Discount${st.discountType === 'pct' ? ` (${+st.discount}%)` : ''}${s.belowCost ? ' <span class="error-text">· more than the margin: selling below cost</span>' : ''}</td><td class="num">− ${fmt(s.discount)}</td></tr>` : ''}
          <tr><td colspan="2">Package price (before GST)</td><td class="num">${fmt(s.subtotal)}</td></tr>
          <tr><td colspan="2">GST (${st.gstPct}%)</td><td class="num">${fmt(s.gst)}</td></tr>
          <tr class="grand"><td colspan="2">Client pays</td><td class="num">${fmt(s.total)}</td></tr>
        </tfoot>
      </table>
      <p class="muted small">Per person: ${fmt(s.subtotalPP)} + ${fmt(s.gstPP)} GST = ${fmt(s.perPerson)} · Children are counted as full travellers in the per-person figure.</p>
      ${b ? `<p class="note">Website / brochure benchmark · ${b}</p>` : ''}
    </div>`;
  }

  function travellersText() {
    const a = +st.adults; const c = +st.children;
    const ages = st.childAges.slice(0, c).filter((x) => x !== '' && x != null);
    return `${a} adult${a !== 1 ? 's' : ''}${c ? `, ${c} child${c > 1 ? 'ren' : ''}${ages.length ? ` (age ${ages.join(', ')})` : ''}` : ''}`;
  }
  function dateRange() {
    const start = I.addDays(st.startDate, 0);
    const end = I.addDays(st.startDate, nightsTotal());
    if (!start) return '';
    const f = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${f.format(start)} – ${f.format(end)}`;
  }
  /** Payment terms: advance to confirm, balance a few days before travel. */
  function paymentText(total) {
    const adv = +st.advancePct || 50;
    const days = +st.balanceDaysBefore || 2;
    const advAmt = Math.round(total * adv / 100);
    if (adv >= 100) return `Pay the full amount (${fmt(total)}) to confirm your trip.`;
    const due = I.addDays(st.startDate, -days);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dueText = due && due > today
      ? `by ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(due)} (${days} day${days > 1 ? 's' : ''} before travel)`
      : 'at the time of booking';
    return `Pay ${adv}% advance (${fmt(advAmt)}) to confirm your trip. The balance ${100 - adv}% (${fmt(total - advAmt)}) is due ${dueText}.`;
  }

  // Meal wording that matches the chosen plan, so a brochure's "breakfast and dinner" never
  // survives into a CP (breakfast only) quote.
  const MEAL_PHRASE = { EP: 'room only', CP: 'with breakfast', MAP: 'with breakfast and dinner', AP: 'with all meals', AI: 'all inclusive' };
  const MEAL_EXCL = { EP: 'All meals', CP: 'Lunch and dinner', MAP: 'Lunch', AP: '', AI: '' };
  const STAY_RE = /\b(nights?|hotels?|resorts?|stays?)\b/i;
  const MEAL_IN_STAY_RE = /,?\s*(?:with\s+)?(?:daily\s+)?breakfast(?:\s+(?:and|&)\s+dinner)?(?:\s+daily)?/i;
  function adjustInclusionMeals(list, templateMeals) {
    if (templateMeals === st.mealPlan) return list;
    const out = [];
    list.forEach((line) => {
      if (/^\s*(daily breakfast|breakfast daily|breakfast and dinner daily|breakfast (?:and|&) dinner)\s*$/i.test(line)) return; // meal-only line
      if (STAY_RE.test(line) && MEAL_IN_STAY_RE.test(line) && !/cruise|camp|tent|ryokan/i.test(line)) {
        out.push(`${line.replace(MEAL_IN_STAY_RE, '').replace(/\s+,/g, ',').trim()}, ${MEAL_PHRASE[st.mealPlan] || ''}`.replace(/,\s*$/, ''));
      } else out.push(line);
    });
    if (!out.some((l) => /breakfast|room only|all meals|all inclusive/i.test(l))) out.push(`Meals: ${mealText(st.mealPlan)}`);
    return out;
  }
  function adjustExclusionMeals(list) {
    const out = list.filter((l) => !/^\s*(lunch(es)?( and (other )?dinners?)?|dinners?|lunch and dinner|meals not mentioned above|all meals)\s*$/i.test(l));
    if (MEAL_EXCL[st.mealPlan]) out.unshift(MEAL_EXCL[st.mealPlan]);
    return out;
  }
  function vehicleText() {
    const vp = P.vehiclePlan(st, dest().type);
    return `Private ${vp.count > 1 ? `${vp.count} × ` : ''}${vp.vehicle.label} for all transfers and sightseeing as per itinerary`;
  }

  function inclusions() {
    const t = templateActive();
    if (t) {
      let inc = adjustInclusionMeals(t.inc.slice(), t.meals);
      if (st.transfers) inc = inc.map((l) => (/^\s*private\b.*\b(sedan|suv|car|vehicle|innova|tempo)/i.test(l) ? vehicleText() : l));
      return [...inc, ...(+st.flightsPP > 0 ? ['Return flights (economy)'] : []), ...st.extras.filter((x) => x.label && +x.amount).map((x) => x.label)];
    }
    const rp = P.roomPlan(st);
    const list = [
      `${nightsTotal()} nights in ${TIERS.find((x) => x.id === st.tier).hint} hotels (${rp.rooms} room${rp.rooms > 1 ? 's' : ''}, ${rp.sharing === 3 ? 'triple' : 'double'} sharing${rp.extraBeds ? `, ${rp.extraBeds} extra bed${rp.extraBeds > 1 ? 's' : ''}` : ''})`,
      `Meals: ${mealText(st.mealPlan)}`,
    ];
    if (st.transfers) list.push(vehicleText());
    if (uniqueCities().some((id) => +rateFor(id, st.tier).act > 0)) list.push('Entry tickets and activities as listed');
    if (+st.flightsPP > 0) list.push('Return flights (economy)');
    if (+st.visaPP > 0) list.push('Tourist visa');
    if (+st.insurancePP > 0) list.push('Travel insurance');
    st.extras.filter((x) => x.label && +x.amount).forEach((x) => list.push(x.label));
    return list;
  }
  function exclusions() {
    const t = templateActive();
    let list = adjustExclusionMeals(t ? t.exc.slice() : ['Flights / train tickets', 'Personal expenses: laundry, tips, shopping', 'Anything not listed under inclusions']);
    if (+st.flightsPP > 0) list = list.filter((x) => !/^flights/i.test(x));
    return list;
  }

  function clientDoc(q) {
    const d = dest();
    const t = templateActive();
    const { days } = itinerary();
    const s = q.sum;
    const ed = (key, field, fallback) => esc((st.edits[key] && st.edits[key][field]) ?? fallback);
    const dayHtml = days.map((day) => `<article class="day">
      <div class="day-tag"><span>Day ${day.dayNo}</span><small>${I.dateLabel(day.date)}</small></div>
      <div class="day-body">
        <h3 contenteditable="true" data-edit="${day.key}" data-field="title">${ed(day.key, 'title', day.title)}</h3>
        <p class="city-line">${esc(day.cityName)}</p>
        ${day.intro ? `<p contenteditable="true" data-edit="${day.key}" data-field="intro">${ed(day.key, 'intro', day.intro)}</p>` : ''}
        ${day.items.length ? `<div class="day-photos">${day.items.slice(0, 3).map((x) => thumb(day.cityName, x)).join('')}</div>` : ''}
        ${day.items.length ? `<ul>${day.items.map((x) => `<li>${esc(x.name)}</li>`).join('')}</ul>` : ''}
        ${day.foods.length ? `<p class="food-line"><strong>Eat &amp; drink:</strong> ${day.foods.map((f) => esc(f.name)).join(' · ')}</p>` : ''}
        ${day.tip ? `<p class="tip"><strong>Pavico tip ·</strong> <span contenteditable="true" data-edit="${day.key}" data-field="tip">${ed(day.key, 'tip', day.tip)}</span></p>` : ''}
        ${day.overnight ? `<p class="overnight">Overnight: ${esc(day.overnight)}</p>` : ''}
      </div></article>`).join('');
    const hotelRows = st.cities.map((sel) => {
      const c = cityOf(sel.id);
      return `<tr><td>${esc(c.name)}</td><td>${esc(rateFor(c.id, st.tier).hotel)}</td><td>${sel.nights}N</td><td>${mealText(st.mealPlan)}</td></tr>`;
    }).join('');
    const title = t ? t.title : `${d.name}: ${nightsTotal()} nights / ${nightsTotal() + 1} days`;
    return `<div class="doc" id="client-doc">
      <header class="doc-head">
        <img class="doc-logo" src="${window.PAVICO_ASSETS || ''}img/logo-tagline.png" alt="Pavico — We plan, you experience">
        <div class="doc-ref"><span>Quote ${esc(st.ref)}${st.version ? ` · v${st.version}` : ''}</span><span>${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}</span></div>
      </header>
      <section class="doc-hero">
        <p class="eyebrow">${st.client ? `Prepared for ${esc(st.client)}` : 'Your trip'}</p>
        <h1>${esc(title)}</h1>
        <p>${st.cities.map((c) => `${esc(cityOf(c.id).name)} ${c.nights}N`).join(' → ')}${t ? ` · ${nightsTotal()} nights / ${nightsTotal() + 1} days` : ''}</p>
        <div class="facts">
          <div><small>Dates</small><strong>${dateRange()}</strong></div>
          <div><small>Travellers</small><strong>${travellersText()}</strong></div>
          <div><small>Package</small><strong>${tierLabel(st.tier)} · ${mealText(st.mealPlan)}</strong></div>
        </div>
      </section>
      <section><h2>Day-by-day plan</h2>${dayHtml}</section>
      <section><h2>Where you’ll stay</h2>
        <table class="hotels"><thead><tr><th>City</th><th>Hotel (or similar)</th><th>Nights</th><th>Meals</th></tr></thead><tbody>${hotelRows}</tbody></table>
      </section>
      <section class="two-col">
        <div><h2>Included</h2><ul class="ticks">${inclusions().map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><h2>Not included</h2><ul class="crosses">${exclusions().map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </section>
      ${t && t.add.length ? `<section><h2>Add on request</h2><ul class="crosses plus">${t.add.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
      <section class="price-box">
        <div><small>Package price per person</small><strong>${fmt(s.subtotalPP)}</strong><span>+ ${st.gstPct}% GST (${fmt(s.gstPP)})</span></div>
        <div><small>Total for ${pax()} traveller${pax() > 1 ? 's' : ''}</small><strong>${fmt(s.total)}</strong><span>including ${fmt(s.gst)} GST</span></div>
        ${s.discount ? `<p class="discount-note">Includes a special discount of ${fmt(s.discount)}.</p>` : ''}
      </section>
      <section class="terms">
        <h2>Good to know</h2>
        <ul>
          <li>Prices are valid for 7 days and subject to availability at the time of booking.</li>
          <li>Hotels are confirmed at booking; a similar hotel of the same category may be offered if one is unavailable.</li>
          <li>${esc(paymentText(s.total))}</li>
          <li>Cancellation charges depend on what hotels, airlines and operators charge on the date you cancel, plus the Pavico service fee. Flights follow the airline’s fare rules.</li>
          <li>Non-refundable once booked: attraction and theme-park tickets, permits, visa fees, insurance and peak-season hotel stays. Full policy: pavico.in/cancellation-policy</li>
        </ul>
      </section>
      <p class="credit">Photos: Wikimedia Commons and Wikipedia contributors (CC BY / CC BY-SA) and Pavico. Images are for illustration.${d.source === 'wikivoyage' ? ' Destination information adapted from Wikivoyage (CC BY-SA).' : ''}</p>
      <footer class="doc-foot"><strong>We plan, you experience.</strong><span>Pavico LLP, Pune · WhatsApp +91 93703 05751 · support@pavico.in · pavico.in</span></footer>
    </div>`;
  }

  function renderSummary() {
    const d = dest();
    const el = $('#summary');
    if (!d) { el.innerHTML = '<div class="sum-card"><h3>Quote summary</h3><p class="muted small">Pick a package or a destination to start.</p></div>'; return; }
    const q = quote();
    if (!q) { el.innerHTML = `<div class="sum-card"><h3>${esc(d.name)}</h3><p class="muted small">Add cities to see a price.</p></div>`; return; }
    const cats = {};
    q.lines.forEach((l) => { cats[l.category] = (cats[l.category] || 0) + l.amount; });
    const s = q.sum;
    const t = st.template && pkgOf(st.template);
    el.innerHTML = `<div class="sum-card">
      <h3>${esc(t ? t.title : d.name)}</h3>
      <p class="muted small">${st.startDate ? `${prettyDate(st.startDate)} – ${prettyDate(endDateIso())}<br>` : ''}${nightsTotal()}N · ${pax()} pax · ${P.roomPlan(st).rooms} rm · ${tierLabel(st.tier)} · ${esc(st.ref)}${st.version ? ` v${st.version}` : ' (not saved)'}</p>
      <dl>${Object.entries(cats).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>
      <dl class="totals">
        <div><dt>Base cost</dt><dd>${fmt(s.base)}</dd></div>
        <div><dt>Margin ${st.marginPct}%</dt><dd>${fmt(s.margin)}</dd></div>
        ${s.discount ? `<div><dt>Discount</dt><dd>− ${fmt(s.discount)}</dd></div>` : ''}
        <div><dt>GST ${st.gstPct}%</dt><dd>${fmt(s.gst)}</dd></div>
        <div class="grand"><dt>Total</dt><dd>${fmt(s.total)}</dd></div>
      </dl>
      <p class="pp">${fmt(s.subtotalPP)} <small>/person + GST</small></p>
      ${q.missing.length ? `<p class="sum-warn">${q.missing.length} rate${q.missing.length > 1 ? 's' : ''} missing</p>` : ''}
      ${t && t.price ? `<p class="muted small">Website: from ${priceText(t)}</p>` : ''}
    </div>`;
  }

  // ───────────── saved quotes ─────────────
  // What makes two versions different (not which screen was open)
  const quoteKey = (s) => JSON.stringify(Object.assign({}, s, { step: 0, view: '', version: 0, pkgFilter: '' }));

  /** Saves the quote as a new version if it changed since the last one. Resolves to the version number. */
  function saveVersion({ quiet } = {}) {
    // snapshot the rates used, so the saved quote doesn't change when the rate sheet does
    uniqueCities().forEach((id) => { ((st.rates[id] = st.rates[id] || {})[st.tier] = rateFor(id, st.tier)); });
    const latest = Store.quotes.get(st.ref);
    if (latest && quoteKey(latest.state) === quoteKey(st)) {
      st.version = latest.version; save();
      if (!quiet) toast(`No changes since ${st.ref} v${latest.version}`);
      return Promise.resolve(latest.version);
    }
    const v = latest ? latest.version + 1 : 1;
    const t = st.template && pkgOf(st.template);
    st.version = v; save();
    const q = quote();
    return Store.quotes.save({ ref: st.ref, version: v, client: st.client, title: t ? t.title : dest().name, total: q.sum.total, discount: q.sum.discount, endDate: endDateIso(), savedAt: Date.now(), state: JSON.parse(JSON.stringify(st)) })
      .then((ok) => {
        // ERPNext links (or creates) the client's contact: remember it so later versions stay linked
        if (ok && typeof ok === 'object' && (ok.contact || ok.customer)) {
          st.contact = ok.contact || st.contact; st.customer = ok.customer || st.customer;
          const saved = Store.quotes.get(st.ref, v); if (saved) Object.assign(saved.state, { contact: st.contact, customer: st.customer });
          save();
        }
        if (ok && !quiet) toast(`Saved ${st.ref} v${v}`);
        return v;
      });
  }

  const savedList = () => Store.quotes.list();
  function renderDrawer() {
    const groups = new Map();
    savedList().forEach((x) => { (groups.get(x.ref) || groups.set(x.ref, []).get(x.ref)).push(x); });
    const rows = [...groups.values()]
      .map((vs) => vs.sort((a, b) => a.version - b.version))
      .sort((a, b) => b[b.length - 1].savedAt - a[a.length - 1].savedAt);
    const day = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    $('#saved-drawer').innerHTML = `<div class="drawer-inner">
      <div class="drawer-head"><h2>Saved quotes</h2><button class="icon" data-action="toggle-saved" aria-label="Close">×</button></div>
      ${rows.length ? rows.map((vs) => { const x = vs[vs.length - 1]; return `<div class="saved-row">
        <div><strong>${esc(x.client || 'Unnamed client')}</strong><small class="muted">${esc(x.title)} · ${esc(x.ref)} · ${day(x.savedAt)}</small>
          <div class="versions">${vs.slice().reverse().map((q) => `<button class="ver ${q.ref === st.ref && q.version === st.version ? 'on' : ''}" data-action="open-saved" data-ref="${esc(q.ref)}" data-v="${q.version}" title="Saved ${new Date(q.savedAt).toLocaleString('en-IN')} · ${fmt(q.total)}">v${q.version}</button>`).join('')}</div>
        </div>
        <span>${fmt(x.total)}</span>
        <button class="btn ghost small" data-action="open-saved" data-ref="${esc(x.ref)}" data-v="${x.version}">Open v${x.version}</button>
        <button class="icon" data-action="del-saved" data-ref="${esc(x.ref)}" data-n="${vs.length}" aria-label="Delete">×</button>
      </div>`; }).join('') : '<p class="muted">No saved quotes yet. Use “Save quote” on the Quote step.</p>'}
      <p class="muted small">Every save keeps a new version (v1, v2…). Click a version to open it; saving it again makes the next version.</p>
      <p class="muted small">${Store.mode === 'erp' ? 'Saved in ERPNext, shared with the team.' : 'Prototype: quotes and the rate sheet are stored only in this browser.'}</p>
    </div>`;
  }

  // ───────────── WhatsApp text ─────────────
  function whatsappText() {
    const q = quote(); const s = q.sum; const d = dest();
    const t = templateActive();
    const { days } = itinerary();
    return [
      `*Pavico · ${t ? t.title : d.name} · ${nightsTotal()}N/${nightsTotal() + 1}D*`,
      st.client ? `Prepared for: ${st.client}` : '',
      `Dates: ${dateRange()}`,
      `Travellers: ${travellersText()} · ${tierLabel(st.tier)} · ${mealText(st.mealPlan)}`,
      '',
      '*Itinerary*',
      ...days.map((day) => `Day ${day.dayNo} (${I.dateLabel(day.date)}): ${(st.edits[day.key] && st.edits[day.key].title) || day.title}`),
      '',
      '*Hotels (or similar)*',
      ...st.cities.map((sel) => `${cityOf(sel.id).name}: ${rateFor(sel.id, st.tier).hotel} (${sel.nights}N)`),
      '',
      '*Price*',
      `${fmt(s.subtotalPP)} per person + ${st.gstPct}% GST`,
      `Total: ${fmt(s.total)} for ${pax()} traveller${pax() > 1 ? 's' : ''} (incl. GST)`,
      '',
      '*Payment*',
      paymentText(s.total),
      '',
      'We plan, you experience. — Pavico',
    ].filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n');
  }

  // ───────────── events ─────────────
  function setPath(path, value) {
    const keys = path.split('.');
    let o = st;
    keys.slice(0, -1).forEach((k, i) => {
      if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[k];
    });
    o[keys[keys.length - 1]] = value;
  }

  // destination search (updates only the results list, so the input keeps focus)
  let searchTimer;
  // Client search: ERPNext customers & contacts (or past quotes in the prototype)
  let clientTimer;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'client-q') return;
    clearTimeout(clientTimer);
    const q = e.target.value.trim();
    clientTimer = setTimeout(async () => {
      const box = $('#client-results');
      if (!box) return;
      if (q.length < 2) { box.innerHTML = ''; return; }
      const hits = await Store.clients.search(q).catch(() => []);
      box.innerHTML = hits.map((h, i) => `<button type="button" data-action="pick-client" data-i="${i}">
          <strong>${esc(h.title)}</strong> <small class="muted">${esc(h.type)}${h.phone ? ` · ${esc(h.phone)}` : ''}${h.customer && h.type !== 'Customer' ? ` · ${esc(h.customer)}` : ''}</small></button>`).join('')
        || '<span class="muted small">No match. The name you type is used as a new client.</span>';
      box._hits = hits;
    }, 250);
  });
  // Add any town or region to the route's city list
  let cityTimer;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'city-q') return;
    clearTimeout(cityTimer);
    const q = e.target.value;
    cityTimer = setTimeout(async () => {
      const box = $('#city-results');
      if (!box) return;
      const hits = await W.searchDestinations(q).catch(() => []);
      box.innerHTML = hits.map((h) => `<button type="button" data-action="add-wv-city" data-title="${esc(h)}">+ ${esc(h)}</button>`).join('')
        || (q.trim().length > 1 ? '<span class="muted small">No guide page found. Try a nearby town.</span>' : '');
    }, 250);
  });
  // Add your own attraction to a city
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-own-city]');
    if (!form) return;
    e.preventDefault();
    const name = form.elements.own.value.trim();
    if (!name) return;
    const cid = form.dataset.ownCity;
    const list = (st.own[cid] = st.own[cid] || []);
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) { toast('Already added'); return; }
    const id = `${cid}-own${Date.now().toString(36)}`;
    list.push({ id, name, hours: 2 });
    const p = (st.picks[cid] = st.picks[cid] || {});
    (p.attractions = p.attractions || []).push(id);
    toast(`Added ${name}`);
    render();
  });

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'wv-q') return;
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(async () => {
      const box = $('#wv-results');
      if (!box) return;
      try {
        const hits = await W.searchDestinations(q);
        box.innerHTML = hits.map((h) => `<button data-action="pick-wv" data-title="${esc(h)}">${esc(h)}</button>`).join('')
          || (q.trim().length > 1 ? '<span class="muted small">No guide found. Try the country or a nearby city.</span>' : '');
      } catch (err) { box.innerHTML = '<span class="muted small">Search is unavailable right now.</span>'; }
    }, 250);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.uploadC) {
      const file = el.files && el.files[0];
      if (!file) return;
      W.resizeImage(file).then((url) => {
        if (!W.setMyPhoto(el.dataset.uploadC, el.dataset.uploadN, url)) { toast('Browser storage is full; photo not saved'); return; }
        toast('Photo saved'); render();
      }).catch(() => toast('That file could not be read as an image'));
      return;
    }
    // Numbers can never go below their minimum (rates, travellers, discount…): show the error, keep the old value
    if (el.type === 'number' && el.value !== '' && el.min !== '' && +el.value < +el.min) {
      el.classList.add('invalid');
      toast(+el.min === 0 ? 'This can’t be negative. Enter 0 or more.' : `This must be at least ${el.min}.`);
      setTimeout(render, 1600);
      return;
    }
    if (el.type === 'number' && el.max !== '' && el.value !== '' && +el.value > +el.max) {
      el.classList.add('invalid');
      toast(`This can’t be more than ${el.max}.`);
      setTimeout(render, 1600);
      return;
    }
    if (el.dataset && el.dataset.rate) {
      const v = el.type === 'number' ? (+el.value || 0) : el.value;
      setRate(el.dataset.rate, st.tier, el.dataset.field, v, el.dataset.veh);
      render();
      return;
    }
    const path = el.dataset && el.dataset.bind;
    if (!path) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' && v !== '') v = +v;
    setPath(path, v);
    if (path === 'client') { st.customer = ''; st.contact = ''; }
    if (path === 'destId') { st.cities = []; st.picks = {}; st.edits = {}; st.template = null; st.extraCities = []; st.own = {}; }
    if (path === 'children') st.childAges = st.childAges.slice(0, +v);
    render();
  });

  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.edit) return;
    const key = el.dataset.edit; const field = el.dataset.field;
    st.edits[key] = st.edits[key] || {};
    st.edits[key][field] = el.textContent.trim();
    save();
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const ds = el.dataset;
    switch (a) {
      case 'goto': st.step = +ds.step; break;
      case 'next': if (canGo(st.step + 1)) st.step += 1; break;
      case 'back': st.step -= 1; break;
      case 'pkg-filter': st.pkgFilter = ds.v; break;
      case 'use-package': applyTemplate(ds.id); toast(`Loaded ${pkgOf(ds.id).title}`); break;
      case 'add-city': st.cities.push({ id: ds.id, nights: cityOf(ds.id).suggestedNights }); ensureCity(ds.id); break;
      case 'add-wv-city': {
        const id = `wv-${W.slug(ds.title)}`;
        const existing = dest().cities.find((c) => c.id === id || c.name.toLowerCase() === ds.title.toLowerCase());
        const cid = existing ? existing.id : id;
        if (!existing) st.extraCities.push({ id, name: ds.title, suggestedNights: 2 });
        st.cities.push({ id: cid, nights: existing ? existing.suggestedNights : 2 });
        ensureCity(cid);
        toast(`Added ${ds.title} to the route`);
        break;
      }
      case 'del-own': {
        st.own[ds.city] = (st.own[ds.city] || []).filter((x) => x.id !== ds.id);
        const c = cityOf(ds.city); if (c) c.attractions = c.attractions.filter((a) => a.id !== ds.id);
        const p = st.picks[ds.city] || {}; p.attractions = (p.attractions || []).filter((x) => x !== ds.id);
        break;
      }
      case 'pick-client': {
        const box = $('#client-results');
        const h = box && box._hits && box._hits[+ds.i];
        if (!h) return;
        st.client = h.title; st.phone = h.phone || st.phone;
        st.customer = h.customer || ''; st.contact = h.contact || '';
        break;
      }
      case 'unlink-client': st.customer = ''; st.contact = ''; break;
      case 'pick-wv': {
        const box = $('#wv-results');
        if (box) box.innerHTML = `<span class="muted small">Loading ${esc(ds.title)}…</span>`;
        W.loadDestination(ds.title).then((d) => {
          st.customDest = d; st.destId = d.id; st.template = null; st.cities = []; st.picks = {}; st.edits = {};
          toast(`${d.name}: ${d.cities.length} cit${d.cities.length === 1 ? 'y' : 'ies'} found`);
          render();
        }).catch((err) => { if (box) box.innerHTML = `<span class="muted small">Couldn’t load ${esc(ds.title)}: ${esc(err.message)}</span>`; });
        return;
      }
      case 'flip-region': st.customDest.type = st.customDest.type === 'domestic' ? 'international' : 'domestic'; break;
      case 'hide-photo': W.hidePhoto(ds.pc, ds.pn); break;
      case 'remove-stop': {
        const [removed] = st.cities.splice(+ds.i, 1);
        if (!st.cities.some((c) => c.id === removed.id)) delete st.picks[removed.id];
        break;
      }
      case 'nights': {
        const c = st.cities[+ds.i];
        c.nights = Math.max(1, Math.min(14, c.nights + +ds.delta));
        break;
      }
      case 'move': {
        const i = +ds.i; const j = i + +ds.delta;
        [st.cities[i], st.cities[j]] = [st.cities[j], st.cities[i]];
        break;
      }
      case 'toggle-pick': {
        const p = (st.picks[ds.city] = st.picks[ds.city] || {});
        const arr = (p[ds.kind] = p[ds.kind] || []);
        const i = arr.indexOf(ds.id);
        if (i >= 0) arr.splice(i, 1); else arr.push(ds.id);
        break;
      }
      case 'select-all': {
        const c = cityOf(ds.city);
        const kind = ds.kind || 'attractions';
        (st.picks[ds.city] = st.picks[ds.city] || {})[kind] = (c[kind] || []).map((x) => x.id);
        break;
      }
      case 'star': W.togglePavicoPick(ds.pc, ds.pn); break;
      case 'toggle-cat': {
        const k = ds.cat;
        st.cat[k] = !st.cat[k];
        uniqueCities().forEach((id) => {
          const cats = categories(id);
          const p = (st.picks[id] = st.picks[id] || {});
          const arr = (p.attractions = p.attractions || []);
          if (st.cat[k]) { cats[k].forEach((x) => { if (!arr.includes(x)) arr.push(x); }); return; }
          // untick: drop this group's items unless another ticked group still wants them
          const keep = new Set();
          CATS.forEach((o) => { if (st.cat[o.id]) cats[o.id].forEach((x) => keep.add(x)); });
          p.attractions = arr.filter((x) => !cats[k].has(x) || keep.has(x));
        });
        break;
      }
      case 'set-tier': st.tier = ds.tier; break;
      case 'add-extra': st.extras.push({ label: '', amount: '' }); break;
      case 'del-extra': st.extras.splice(+ds.i, 1); break;
      case 'view': st.view = ds.view; break;
      case 'print': downloadPdf(el); return;
      case 'copy-wa': {
        const text = whatsappText();
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
          .then(() => toast('Copied, paste it into WhatsApp'))
          .catch(() => { window.prompt('Copy this text:', text); });
        return;
      }
      case 'save-quote': saveVersion().then(render); return;
      case 'toggle-saved': {
        const dr = $('#saved-drawer');
        dr.hidden = !dr.hidden;
        if (!dr.hidden) renderDrawer();
        return;
      }
      case 'open-saved': {
        const x = Store.quotes.get(ds.ref, ds.v);
        if (x) {
          st = Object.assign(fresh(), x.state, { version: x.version });
          save();
          $('#saved-drawer').hidden = true;
          toast(`Opened ${x.ref} v${x.version}`);
        }
        break;
      }
      case 'del-saved': {
        const n = +ds.n || 1;
        askConfirm(`Delete quote ${ds.ref}${n > 1 ? ` and all its ${n} versions` : ''}? This can't be undone.`, 'Delete').then((yes) => {
          if (!yes) return;
          Store.quotes.remove(ds.ref);
          if (st.ref === ds.ref) { st.version = 0; save(); }
          renderDrawer();
          toast(`Deleted ${ds.ref}`);
        });
        return;
      }
      case 'new-quote': {
        const latest = st.destId && Store.quotes.get(st.ref);
        const unsaved = st.destId && (!latest || quoteKey(latest.state) !== quoteKey(st));
        (unsaved ? askConfirm('Start a new quote? Changes to the current quote since its last save will be lost.', 'Start new quote') : Promise.resolve(true))
          .then((yes) => {
            if (!yes) return;
            st = fresh(); save();
            $('#saved-drawer').hidden = true;
            render(); window.scrollTo(0, 0);
            toast(`New quote ${st.ref}`);
          });
        return;
      }
      default: return;
    }
    render();
  });

  render();
})();
