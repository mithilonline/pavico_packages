/*
 * Builds the builder's catalogue (destinations → cities → things to do) from the real Pavico packages.
 * Inputs: data/pavico-packages.js (curated brochures) + data/site-packages.js (pavico.in, for images and links).
 * No prices are invented here: costs come from the Pavico rate sheet the team fills in (see app.js).
 */
(function () {
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // logistics lines that are not "things to do"
  const NOISE = /^(airport pick|meet your|private (pickup|pick-up|transfer|car|drive)|pick-up|check (in|out)|breakfast|slow breakfast|drive (to|on|back|down|east|north)|morning drive|early start|drop|rest|fly |flight|direct|transfer to|back to the resort|back at the resort|big bags|your bags|your suitcases|your overnight|a morning soak|lunch|change to|on to |easy evening|easy morning|evening at leisure|evening free|afternoon free|a slow evening|airport drop|port blair airport|paro airport|morning flight|last swim|a morning on|brunch|leave skye|the longest|option|or fly|or a riverside|night:|evening in town|kullu valley|through the atal|sleep in|sunset on deck)/i;

  function guessHours(text) {
    const m = text.match(/about ([\d.]+)\s*hrs?/i);
    if (m) return Math.min(+m[1], 7);
    if (/full day|day trip|trek|safari|hike|cruise|boat (tour|day)|disneyland|day 1|day 2/i.test(text)) return 3.5;
    return 1.5;
  }

  const site = {};
  (window.PAVICO_PACKAGES || []).forEach((p) => { site[p.id] = p; });

  const destMap = new Map();
  const packages = window.PAVICO_PACKAGES_CURATED.map((p) => {
    const nights = p.stays.reduce((s, x) => s + x[1], 0);
    const pkg = Object.assign({}, p, {
      nights,
      // the site stores most photos as relative paths; resolve them against pavico.in
      image: site[p.id] && site[p.id].image ? new URL(site[p.id].image, 'https://pavico.in/').href : null,
      url: site[p.id] ? `https://pavico.in/holidays/${p.id}` : null,
      destId: slug(p.dest),
      route: p.stays.map(([name, n]) => ({ id: slug(name), name, nights: n })),
    });

    if (!destMap.has(pkg.destId)) {
      destMap.set(pkg.destId, { id: pkg.destId, name: p.dest, type: p.region === 'india' ? 'domestic' : 'international', cities: [], packages: [] });
    }
    const dest = destMap.get(pkg.destId);
    dest.packages.push(pkg.id);

    // day i is spent in the city where night i is slept (the last day stays in the last city)
    const dayCity = [];
    pkg.route.forEach((r) => { for (let i = 0; i < r.nights; i++) dayCity.push(r); });
    dayCity.push(pkg.route[pkg.route.length - 1]);

    pkg.route.forEach((r) => {
      if (!dest.cities.find((c) => c.id === r.id)) {
        dest.cities.push({ id: r.id, name: r.name, suggestedNights: r.nights, attractions: [], food: [], mustTry: [], fromPackages: [] });
      }
      const c = dest.cities.find((x) => x.id === r.id);
      if (!c.fromPackages.includes(pkg.id)) c.fromPackages.push(pkg.id);
    });

    pkg.picks = {};
    p.days.forEach(([, bullets], i) => {
      const r = dayCity[i] || dayCity[dayCity.length - 1];
      bullets.forEach((raw) => {
        if (NOISE.test(raw.trim()) || /then your (suv|car)/i.test(raw)) return;
        const b = raw.replace(/,? if (flight )?time allows$/i, '');
        // an activity that names another city on this route belongs to that city (e.g. "Betaab and Aru … Pahalgam cab")
        const named = pkg.route.find((x) => x.id !== r.id && new RegExp(`\\b${x.name}\\b`, 'i').test(b));
        const city = dest.cities.find((c) => c.id === (named || r).id);
        let item = city.attractions.find((a) => a.name.toLowerCase() === b.toLowerCase());
        if (!item) {
          item = { id: `${city.id}-a${city.attractions.length}`, name: b, area: city.name, hours: guessHours(b), adult: 0, child: 0 };
          city.attractions.push(item);
        }
        (pkg.picks[city.id] = pkg.picks[city.id] || { attractions: [] }).attractions.push(item.id);
      });
    });
    return pkg;
  });

  const destinations = [...destMap.values()].map((d) => {
    d.blurbFor = (cid) => {
      const c = d.cities.find((x) => x.id === cid);
      return c ? `${c.attractions.length} things to do · in ${c.fromPackages.length} Pavico package${c.fromPackages.length > 1 ? 's' : ''}` : '';
    };
    return d;
  });

  window.PAVICO_DATA = { destinations, packages, slug };
})();
