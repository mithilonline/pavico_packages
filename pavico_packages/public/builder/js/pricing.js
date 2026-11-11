/*
 * Pricing engine.
 *   Base cost   = hotels + vehicle + activities & entries + flights + visa/insurance + other lines
 *   Margin      = Base × margin%   (default 10%, editable per quote)
 *   Subtotal    = Base + Margin
 *   GST         = Subtotal × 5%    (always shown as a separate line to the client)
 *   Final price = Subtotal + GST
 * Costs come from the Pavico rate sheet (per city × tier). Missing rates are reported, never guessed.
 */
(function () {
  /**
   * @param ctx { st, dest, tier, rateFor(cityId, tier) -> { hotel, rate, cab, act } }
   * @returns { lines: [{ category, label, detail, amount }], missing: [string] }
   */
  function buildCostLines(ctx) {
    const { st, dest, tier, rateFor } = ctx;
    const lines = [];
    const missing = [];
    const adults = +st.adults || 0;
    const kids = +st.children || 0;
    const pax = adults + kids;
    const rooms = +st.rooms || 1;
    const seenAct = new Set();

    st.cities.forEach((sel, i) => {
      const city = dest.cities.find((c) => c.id === sel.id);
      if (!city) return;
      const nights = +sel.nights || 0;
      const r = rateFor(city.id, tier);

      if (+r.rate > 0) {
        lines.push({
          category: 'Hotels', label: `${city.name}: ${r.hotel || 'hotel'}`,
          detail: `${fmt(r.rate)} × ${rooms} room${rooms > 1 ? 's' : ''} × ${nights} night${nights > 1 ? 's' : ''}`,
          amount: r.rate * rooms * nights,
        });
      } else if (!missing.includes(`${city.name}: hotel rate`)) missing.push(`${city.name}: hotel rate`);

      if (st.transfers) {
        const days = nights + (i === st.cities.length - 1 ? 1 : 0);
        if (+r.cab > 0) {
          lines.push({ category: 'Transport', label: `${city.name}: private vehicle`, detail: `${fmt(r.cab)} × ${days} day${days > 1 ? 's' : ''}`, amount: r.cab * days });
        } else if (!missing.includes(`${city.name}: vehicle per day`)) missing.push(`${city.name}: vehicle per day`);
      }

      if (+r.act > 0 && !seenAct.has(city.id)) {
        seenAct.add(city.id);
        lines.push({ category: 'Activities & entries', label: `${city.name}: activities & entries`, detail: `${fmt(r.act)} × ${pax} pax`, amount: r.act * pax });
      }
    });

    if (+st.flightsPP > 0) {
      lines.push({ category: 'Flights', label: `Flights (${st.flightsSource || 'manual quote'})`, detail: `${fmt(st.flightsPP)} × ${pax} pax`, amount: st.flightsPP * pax });
    }
    if (dest.type === 'international') {
      if (+st.visaPP > 0) lines.push({ category: 'Visa & insurance', label: 'Visa', detail: `${fmt(st.visaPP)} × ${pax} pax`, amount: st.visaPP * pax });
      if (+st.insurancePP > 0) lines.push({ category: 'Visa & insurance', label: 'Travel insurance', detail: `${fmt(st.insurancePP)} × ${pax} pax`, amount: st.insurancePP * pax });
    }
    (st.extras || []).forEach((x) => {
      if (+x.amount) lines.push({ category: 'Other', label: x.label || 'Other', detail: 'Manual line', amount: +x.amount });
    });
    return { lines, missing };
  }

  function summarize(lines, marginPct, gstPct, pax) {
    const base = lines.reduce((s, l) => s + l.amount, 0);
    const margin = Math.round(base * (marginPct / 100));
    const subtotal = base + margin;
    const gst = Math.round(subtotal * (gstPct / 100));
    const total = subtotal + gst;
    const p = Math.max(pax, 1);
    return { base, margin, subtotal, gst, total, perPerson: Math.round(total / p), subtotalPP: Math.round(subtotal / p), gstPP: Math.round(gst / p) };
  }

  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  function fmt(n) { return inr.format(Math.round(+n || 0)); }

  window.PavicoPricing = { buildCostLines, summarize, fmt };
})();
