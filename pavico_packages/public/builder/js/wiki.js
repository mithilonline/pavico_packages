/*
 * Any-destination catalogue + attraction photos, from free Wikimedia sources (no API key):
 *   Wikivoyage  → a destination's cities, and each city's See / Do / Eat / Drink listings (CC BY-SA)
 *   Wikipedia / Wikimedia Commons → a photo per attraction (CC BY / CC BY-SA, credited in the quote)
 * Only place names are sent — never client details.
 */
(function () {
  const WV = 'https://en.wikivoyage.org/w/api.php';
  const WP = 'https://en.wikipedia.org/w/api.php';
  const PHOTO_CACHE = 'pavico.wikilookup.v3';
  const Store = window.PavicoStore;
  const load = (k, f) => Store.local.get(k, f);
  const store = (k, v) => Store.local.set(k, v);
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const api = async (base, params) => {
    const url = `${base}?${new URLSearchParams(Object.assign({ format: 'json', origin: '*' }, params))}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Wikimedia request failed (${r.status})`);
    return r.json();
  };
  const clean = (s) => String(s || '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^{}]*\}\}/g, '').replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  async function wikitext(title) {
    const j = await api(WV, { action: 'parse', page: title, prop: 'wikitext', redirects: 1 });
    if (j.error) throw new Error(j.error.info);
    return { title: j.parse.title, text: j.parse.wikitext['*'] };
  }

  function section(text, names) {
    const re = new RegExp(`^==\\s*(${names.join('|')})\\s*==\\s*$`, 'im');
    const m = text.match(re);
    if (!m) return '';
    const rest = text.slice(m.index + m[0].length);
    const next = rest.search(/^==[^=].*==\s*$/m);
    return next >= 0 ? rest.slice(0, next) : rest;
  }

  async function searchDestinations(q) {
    if (!q || q.trim().length < 2) return [];
    const j = await api(WV, { action: 'opensearch', search: q.trim(), limit: 8, namespace: 0 });
    return j[1];
  }

  /** A destination page → its listed cities (or the page itself when it is a city). */
  async function loadDestination(title, regionHint) {
    const { title: name, text } = await wikitext(title);
    const partOf = (text.match(/\{\{IsPartOf\|([^}]*)\}\}/i) || [])[1] || '';
    const cityLinks = [];
    const block = section(text, ['Cities', 'Other destinations']);
    block.split('\n').filter((l) => /^\*/.test(l.trim()) || /name\s*=\s*\[\[/.test(l)).forEach((l) => {
      const m = l.match(/\[\[([^\]|#]+)/);
      if (m && !/^(Image|File):/i.test(m[1])) cityLinks.push(m[1].trim());
    });
    const cityNames = [...new Set(cityLinks)].slice(0, 18);
    const isCity = !cityNames.length;
    const india = regionHint ? regionHint === 'india' : /india|kerala|rajasthan|goa|himachal|karnataka|tamil|maharashtra|kashmir|ladakh|sikkim|assam|meghalaya|uttarakhand|andaman/i.test(`${partOf} ${name}`);
    return {
      id: `wv-${slug(name)}`, name, type: india ? 'domestic' : 'international', source: 'wikivoyage', partOf,
      cities: (isCity ? [name] : cityNames).map((c) => ({
        id: `wv-${slug(c)}`, name: c, suggestedNights: 2, attractions: [], food: [], mustTry: [], loaded: false, fromPackages: [],
      })),
    };
  }

  // listings are read only from See / Do / Eat / Drink — "Get around" listings are ferries and tourist offices
  function parseInto(out, text, sectionKind) {
    const re = /\{\{\s*(see|do|eat|drink|listing|sleep)\s*\n?\s*\|([\s\S]*?)\n?\}\}/gi;
    let m;
    while ((m = re.exec(text))) {
      const kind = m[1].toLowerCase() === 'listing' ? sectionKind : m[1].toLowerCase();
      if (kind === 'sleep') continue;
      const params = {};
      m[2].split(/\|(?![^[]*\]\])/).forEach((part) => {
        const i = part.indexOf('=');
        if (i > 0) params[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
      });
      const name = clean(params.name);
      if (!name || name.length > 80) continue;
      const item = {
        name, note: clean(params.content).slice(0, 140), price: clean(params.price),
        image: params.image || '', area: '', hours: kind === 'do' ? 2.5 : 1.5, adult: 0, child: 0,
      };
      if (kind === 'eat' || kind === 'drink') { if (out.food.length < 8) out.food.push(item); } else if (out.attractions.length < 24) out.attractions.push(item);
    }
  }
  function finish(out, text, cityId) {
    // district-split cities (Tokyo, London…) have few listings: fall back to bold names in See / Do
    if (out.attractions.length < 4) {
      const seeDo = section(text, ['See']) + section(text, ['Do']);
      (seeDo.match(/'''([^']{3,60})'''/g) || []).forEach((b) => {
        const name = clean(b);
        if (!out.attractions.some((a) => a.name === name) && out.attractions.length < 20) out.attractions.push({ name, note: '', image: '', area: '', hours: 1.5, adult: 0, child: 0 });
      });
    }
    out.attractions.forEach((a, i) => { a.id = `${cityId}-a${i}`; });
    out.food.forEach((f, i) => { f.id = `${cityId}-f${i}`; });
  }

  const SIGHT_RE = /\b(temple|kovil|devalaya|vihara|stupa|dagoba|fort|fortress|palace|bridge|museum|waterfall|falls|lake|beach|national park|sanctuary|reserve|garden|viewpoint|view point|peak|mountain|hill|cave|monument|memorial|church|cathedral|mosque|basilica|shrine|monastery|gompa|castle|tower|statue|market|bazaar|zoo|aquarium|ruins|archaeological|heritage|tea estate|plantation|dam|island|lighthouse|square|park|rock|gate|tomb|mausoleum|step ?well|ghat|valley|glacier|canyon|gorge|springs?)\b/i;
  const NOT_SIGHT_RE = /\b(railway station|station|school|college|university|hospital|road|highway|street|hotel|airport|village|town|city|district|division|electoral|constituency|company|bank|club|stadium|bus|river\b(?! cruise)|suburb|neighbourhood|neighborhood|municipal|council|office|ministry|church of [a-z]+ diocese|cemetery)\b/i;
  /** Up to 8 notable places within 10 km of the city, from Wikipedia's coordinates. */
  async function nearbySights(text, have, cityName) {
    const g = text.match(/\{\{\s*geo\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)/i);
    if (!g) return [];
    const geo = await api(WP, { action: 'query', list: 'geosearch', gscoord: `${g[1]}|${g[2]}`, gsradius: 10000, gslimit: 60 });
    const ids = (geo.query && geo.query.geosearch || []).map((p) => p.pageid);
    if (!ids.length) return [];
    const info = await api(WP, { action: 'query', pageids: ids.slice(0, 50).join('|'), prop: 'description' });
    const known = have.map((a) => words(a.name));
    const out = [];
    ids.forEach((id) => {
      const p = info.query && info.query.pages && info.query.pages[id];
      if (!p || out.length >= 8) return;
      const title = p.title.replace(/\s*\([^)]*\)\s*$/, '');
      const desc = p.description || '';
      const label = `${title} ${desc}`;
      if (!SIGHT_RE.test(label) || NOT_SIGHT_RE.test(desc || title)) return;
      // already listed? any distinctive shared word counts ("Dhowa rock temple" = "Dhowa Temple"),
      // ignoring the city's own name and its common spelling variants (Rawana/Ravana)
      const own = new Set([...words(cityName || ''), 'falls', 'waterfall', 'fort', 'palace', 'museum', 'bridge', 'rock', 'hill', 'hills', 'peak', 'garden', 'gardens', 'church', 'mosque', 'shrine', 'national', 'station', 'house', 'tower', 'market', 'square', 'point', 'view', 'gate', 'cave', 'caves', 'kovil', 'vihara', 'devalaya']);
      const norm = (x) => x.replace(/w/g, 'v');
      const w = words(title).filter((x) => !own.has(x)).map(norm);
      if (!w.length || known.some((k) => k.map(norm).some((x) => !own.has(x) && w.includes(x)))) return;
      known.push(words(title));
      out.push({ name: title, note: desc.slice(0, 140), price: '', image: '', area: '', hours: 1.5, adult: 0, child: 0, src: 'near' });
    });
    return out;
  }

  async function loadCity(city) {
    const { text } = await wikitext(city.name);
    const out = { attractions: [], food: [] };
    [['see', ['See']], ['do', ['Do']], ['eat', ['Eat']], ['drink', ['Drink']]].forEach(([k, names]) => parseInto(out, section(text, names), k));
    // big cities split their guide into district pages: read the first few districts' listings too
    const districts = section(text, ['Districts']);
    if (out.attractions.length < 10 && districts) {
      let links = [...new Set((districts.match(/\[\[([^\]|#]+)/g) || []).map((l) => l.slice(2).trim()).filter((l) => !/^(Image|File):/i.test(l)))];
      const subpages = links.filter((l) => l.toLowerCase().startsWith(`${city.name.toLowerCase()}/`));
      links = (subpages.length ? subpages : links).slice(0, 5);
      const pages = await Promise.all(links.map((l) => wikitext(l).catch(() => null)));
      pages.filter(Boolean).forEach((p) => {
        const before = out.attractions.length;
        const part = { attractions: [], food: [] }; // up to 6 per district so one district can't fill the list
        parseInto(part, section(p.text, ['See']), 'see');
        parseInto(part, section(p.text, ['Do']), 'do');
        out.attractions.push(...part.attractions.slice(0, 6).filter((a) => !out.attractions.some((x) => x.name === a.name)));
        const area = p.title.replace(/^.*\//, '').replace(new RegExp(`^${city.name}\\s*`, 'i'), '') || p.title;
        out.attractions.slice(before).forEach((a) => { a.area = area; });
      });
    }
    // sights the guide doesn't list but Wikipedia's map knows about (e.g. Nine Arch Bridge near Ella)
    try { (await nearbySights(text, out.attractions, city.name)).forEach((a) => out.attractions.push(a)); } catch (e) { /* optional */ }
    finish(out, text, city.id);
    return Object.assign(out, { loaded: true, blurb: clean((text.match(/^[^{|=\n[][^\n]{40,}$/m) || [''])[0]).slice(0, 120) });
  }

  // ───────────── photos ─────────────
  const photoKey = (cityName, itemName) => `${cityName}|${itemName}`.toLowerCase();
  function searchText(name, cityName) {
    // "Walk across the meadow to St Mary’s Church" → "St Mary’s Church Gulmarg"-ish: keep the named part
    const core = name.split(/ – | — |: |, |\(/)[0]
      .replace(/^(walk|cruise|drive|morning|afternoon|evening|sunset|visit|stop|explore|photo stops?)( (at|in|on|to|across|around|through|over|by|the|walk|safari))*\s+/i, '');
    return `${core} ${cityName}`.trim();
  }

  // at most 3 lookups at a time keeps us polite to the Wikipedia API
  let active = 0;
  const waiting = [];
  const limited = (fn) => new Promise((resolve) => {
    const run = () => { active++; fn().then(resolve, () => resolve(null)).finally(() => { active--; if (waiting.length) waiting.shift()(); }); };
    if (active < 3) run(); else waiting.push(run);
  });
  const inflight = {};
  const STOP = new Set(['the', 'and', 'with', 'from', 'your', 'walk', 'ride', 'tour', 'visit', 'view', 'park', 'temple', 'lake', 'beach', 'river', 'city', 'old', 'new', 'evening', 'morning', 'sunset', 'night']);
  const words = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));

  /**
   * One Wikipedia lookup per attraction gives both its photo and its popularity
   * (page views over 60 days). `matched` says whether the page found really is this attraction,
   * so a wrong search hit never makes an obscure place look popular.
   * Resolves to { url, page, title, views, matched } (fields may be empty). Cached in this browser.
   */
  function lookup(cityName, itemName) {
    const key = photoKey(cityName, itemName);
    const cache = load(PHOTO_CACHE, {});
    if (key in cache) return Promise.resolve(cache[key]);
    if (inflight[key]) return inflight[key];
    inflight[key] = limited(async () => {
      let hit = { views: 0, matched: false };
      try {
        const j = await api(WP, { action: 'query', generator: 'search', gsrsearch: searchText(itemName, cityName), gsrlimit: 1, prop: 'pageimages|pageviews|coordinates', piprop: 'thumbnail', pithumbsize: 480, pvipdays: 60 });
        const page = j.query && Object.values(j.query.pages)[0];
        if (page) {
          const own = words(searchText(itemName, '')); const title = words(page.title);
          hit = {
            title: page.title,
            page: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
            url: page.thumbnail ? page.thumbnail.source : null,
            views: Object.values(page.pageviews || {}).reduce((s, v) => s + (v || 0), 0),
            // a place article has map coordinates; articles about a deity, person or festival don't
            matched: own.some((w) => title.includes(w)) && !!page.coordinates,
          };
        }
      } catch (e) { delete inflight[key]; return null; } // network trouble: don't cache, try again next time
      const c = load(PHOTO_CACHE, {}); c[key] = hit; store(PHOTO_CACHE, c);
      return hit;
    });
    return inflight[key];
  }

  /** Photo for an attraction: your own upload wins, then the listing's Commons image, then Wikipedia. */
  function photoFor(cityName, itemName, commonsFile) {
    const key = photoKey(cityName, itemName);
    const mine = Store.photos.mine(key);
    if (mine) return Promise.resolve({ url: mine, mine: true });
    if (Store.photos.isHidden(key)) return Promise.resolve(null);
    if (commonsFile) {
      const file = commonsFile.replace(/^(File|Image):/i, '');
      return Promise.resolve({ url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=480`, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}` });
    }
    return lookup(cityName, itemName).then((hit) => (hit && hit.url ? hit : null));
  }

  /** Popularity for an attraction: 60-day Wikipedia views, 0 when no matching article. */
  function statsFor(cityName, itemName) {
    return lookup(cityName, itemName).then((hit) => (hit && hit.matched ? hit.views : 0));
  }
  function cachedViews(cityName, itemName) {
    const hit = load(PHOTO_CACHE, {})[photoKey(cityName, itemName)];
    return hit === undefined ? null : (hit && hit.matched ? hit.views : 0);
  }

  // Pavico picks (attractions the team starred) and team photos are shared data: see store.js
  const isPavicoPick = (cityName, itemName) => Store.picks.has(photoKey(cityName, itemName));
  const togglePavicoPick = (cityName, itemName) => Store.picks.toggle(photoKey(cityName, itemName), cityName, itemName);
  const setMyPhoto = (cityName, itemName, dataUrl) => Store.photos.set(photoKey(cityName, itemName), dataUrl, cityName, itemName);
  const hidePhoto = (cityName, itemName) => Store.photos.hide(photoKey(cityName, itemName), cityName, itemName);
  /** Shrinks an uploaded photo so it fits in browser storage. */
  function resizeImage(file, max = 640) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  window.PavicoWiki = {
    searchDestinations, loadDestination, loadCity, photoFor, statsFor, cachedViews,
    isPavicoPick, togglePavicoPick, setMyPhoto, hidePhoto, resizeImage, slug,
  };
})();
