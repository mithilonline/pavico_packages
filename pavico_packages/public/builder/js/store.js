/*
 * Where the team's shared data lives.
 *   Browser mode (prototype): localStorage, this browser only.
 *   ERP mode: the ERPNext app (pavico_packages) puts the data in window.PAVICO_BOOT when the page loads,
 *             and every change is saved to ERPNext, shared by the whole team.
 * Per-browser things (the open draft, Wikipedia/Wikivoyage caches) always stay in localStorage.
 */
(function () {
  const BOOT = window.PAVICO_BOOT || null;
  const mode = BOOT ? 'erp' : 'browser';

  const local = {
    get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  const KEYS = { quotes: 'pavico.quotes.v2', rates: 'pavico.ratesheet.v1', picks: 'pavico.picks.v1', photos: 'pavico.myphotos.v1', hidden: 'pavico.hiddenphotos.v1' };
  const data = {};
  Object.keys(KEYS).forEach((n) => {
    const empty = n === 'quotes' ? [] : {};
    data[n] = BOOT ? (BOOT[n] || empty) : local.get(KEYS[n], empty);
  });

  // quotes saved before versioning count as version 1
  data.quotes.forEach((q) => { if (!q.version) q.version = 1; });

  let onError = (err) => console.error(err);

  function call(method, args) {
    return fetch(`/api/method/pavico_packages.api.${method}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Frappe-CSRF-Token': window.PAVICO_CSRF || '' },
      body: JSON.stringify(args),
    }).then(async (r) => {
      if (r.ok) return (await r.json()).message;
      let msg = `ERPNext didn't save this (${r.status})`;
      try {
        const j = await r.json();
        const m = j._server_messages && JSON.parse(JSON.parse(j._server_messages)[0]).message;
        if (m) msg = String(m).replace(/<[^>]+>/g, '');
      } catch (e) { /* keep the generic message */ }
      throw new Error(msg);
    });
  }

  /** Saves one change. Browser mode rewrites the whole key; ERP mode sends just the change. */
  function persist(name, method, args) {
    if (mode === 'browser') return Promise.resolve(local.set(KEYS[name], data[name]));
    return call(method, args).then((m) => m || true).catch((err) => { onError(err); return false; });
  }

  window.PavicoStore = {
    mode,
    local,
    set onError(fn) { onError = fn; },

    // Each save of a quote is a new version: { ref, version, client, title, total, savedAt, state }
    quotes: {
      list: () => data.quotes,
      versions: (ref) => data.quotes.filter((q) => q.ref === ref).sort((a, b) => a.version - b.version),
      get: (ref, version) => {
        const vs = data.quotes.filter((q) => q.ref === ref).sort((a, b) => a.version - b.version);
        return version ? vs.find((q) => q.version === +version) : vs[vs.length - 1];
      },
      save(entry) {
        data.quotes = [entry].concat(data.quotes.filter((q) => !(q.ref === entry.ref && q.version === entry.version)));
        return persist('quotes', 'save_quote', { entry });
      },
      /** Removes one version, or every version of the quote when no version is given. */
      remove(ref, version) {
        data.quotes = data.quotes.filter((q) => !(q.ref === ref && (!version || q.version === +version)));
        return persist('quotes', 'delete_quote', { ref, version: version || 0 });
      },
    },

    // Client lookup: ERPNext customers & contacts; in the prototype, clients of saved quotes
    clients: {
      search(q) {
        if (mode === 'erp') return call('search_clients', { txt: q }).then((r) => r || []);
        const seen = new Set();
        const ql = q.toLowerCase();
        return Promise.resolve(data.quotes
          .map((x) => ({ title: x.client || (x.state && x.state.client) || '', phone: (x.state && x.state.phone) || '', type: 'Past quote' }))
          .filter((x) => x.title && x.title.toLowerCase().includes(ql) && !seen.has(x.title) && seen.add(x.title))
          .slice(0, 8));
      },
    },

    /** ERP mode: the server turns the quote HTML into a text PDF (page numbers, quote no.). Resolves to a Blob. */
    pdf(html, filename) {
      return fetch('/api/method/pavico_packages.api.quote_pdf', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.PAVICO_CSRF || '' },
        body: JSON.stringify({ html, filename }),
      }).then(async (r) => {
        if (!r.ok || !/pdf/.test(r.headers.get('Content-Type') || '')) throw new Error(`the server couldn’t make the PDF (${r.status})`);
        return r.blob();
      });
    },

    rates: {
      /** { [cityId]: { [tier]: { hotel, rate, cab, act, source } } } */
      all: () => data.rates,
      set(cityId, tier, rate, cityName) {
        (data.rates[cityId] = data.rates[cityId] || {})[tier] = rate;
        return persist('rates', 'set_rate', { city_id: cityId, city_name: cityName || '', tier, rate });
      },
    },

    picks: {
      has: (key) => !!data.picks[key],
      toggle(key, city, attraction) {
        const on = !data.picks[key];
        if (on) data.picks[key] = true; else delete data.picks[key];
        persist('picks', 'set_pick', { key, city, attraction, on: on ? 1 : 0 });
        return on;
      },
    },

    photos: {
      mine: (key) => data.photos[key] || null,
      isHidden: (key) => !!data.hidden[key],
      set(key, dataUrl, city, attraction) {
        data.photos[key] = dataUrl; delete data.hidden[key];
        if (mode === 'browser') {
          local.set(KEYS.hidden, data.hidden);
          const ok = local.set(KEYS.photos, data.photos);
          if (!ok) delete data.photos[key]; // browser storage full
          return ok;
        }
        persist('photos', 'set_photo', { key, city, attraction, image: dataUrl });
        return true;
      },
      hide(key, city, attraction) {
        delete data.photos[key]; data.hidden[key] = true;
        if (mode === 'browser') { local.set(KEYS.photos, data.photos); local.set(KEYS.hidden, data.hidden); return; }
        persist('photos', 'hide_photo', { key, city, attraction });
      },
    },
  };
})();
