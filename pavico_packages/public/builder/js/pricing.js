/*
 * Pricing engine.
 *   Base cost   = hotels (+ extra beds) + vehicle + activities & entries + flights + visa/insurance + other lines
 *   Margin      = Base × margin%   (default 10%, editable per quote)
 *   Discount    = optional, for negotiation (₹ or % of base + margin)
 *   Subtotal    = Base + Margin − Discount
 *   GST         = Subtotal × 5%    (always shown as a separate line to the client)
 *   Final price = Subtotal + GST
 * Costs come from the Pavico rate sheet (per city × tier). Missing rates are reported, never guessed.
 */
(function () {
  // Vehicles by group size. `seats` = travellers it carries comfortably with luggage.
  const VEHICLES = {
    domestic: [
      { id: 'sedan', label: 'Sedan (Dzire / Etios)', seats: 3 },
      { id: 'suv', label: 'SUV (Ertiga / Innova)', seats: 6 },
      { id: 'crysta', label: 'Innova Crysta', seats: 6 },
      { id: 'tt12', label: 'Tempo Traveller 12-seater', seats: 11 },
      { id: 'tt17', label: 'Tempo Traveller 17-seater', seats: 16 },
      { id: 'tt26', label: 'Tempo Traveller 26-seater', seats: 24 },
      { id: 'bus35', label: 'Mini coach 35-seater', seats: 33 },
      { id: 'bus45', label: 'Coach 45-seater', seats: 43 },
    ],
    international: [
      { id: 'car', label: 'Private car', seats: 3 },
      { id: 'mpv', label: 'MPV / SUV', seats: 6 },
      { id: 'van', label: 'Private van', seats: 10 },
      { id: 'minibus', label: 'Mini bus', seats: 20 },
      { id: 'coach', label: 'Coach', seats: 40 },
    ],
  };
  const vehicleList = (destType) => VEHICLES[destType === 'domestic' ? 'domestic' : 'international'];

  /** Smallest vehicle that fits the group (crysta is a premium option, never auto-picked). */
  function suggestVehicle(destType, pax) {
    const list = vehicleList(destType).filter((v) => v.id !== 'crysta');
    return (list.find((v) => v.seats >= pax) || list[list.length - 1]).id;
  }

  /** The chosen vehicle and how many are needed. */
  function vehiclePlan(st, destType) {
    const list = vehicleList(destType);
    const pax = (+st.adults || 0) + (+st.children || 0);
    const v = list.find((x) => x.id === st.vehicle) || list.find((x) => x.id === suggestVehicle(destType, pax));
    const needed = Math.max(1, Math.ceil(pax / v.seats));
    const count = +st.vehicleCount > 0 ? +st.vehicleCount : needed;
    return { vehicle: v, count, needed, auto: !st.vehicle, tooSmall: count * v.seats < pax };
  }

  /**
   * Rooms from the group: children 5 and under share the parents' bed, everyone else needs a bed.
   * sharing = 2 (double) or 3 (triple: double room + extra bed).
   */
  function roomPlan(st) {
    const adults = +st.adults || 0;
    const kids = +st.children || 0;
    const ages = (st.childAges || []).slice(0, kids);
    const smallKids = ages.filter((a) => a !== '' && a != null && +a <= 5).length;
    const guests = adults + kids - smallKids;
    const sharing = +st.roomSharing === 3 ? 3 : 2;
    const auto = Math.max(1, Math.ceil(guests / sharing));
    const rooms = +st.roomsOverride > 0 ? +st.roomsOverride : auto;
    const extraBeds = Math.min(rooms, Math.max(0, guests - rooms * 2));
    const overfull = guests > rooms * 3;
    return { guests, smallKids, sharing, rooms, auto, extraBeds, overfull, overridden: +st.roomsOverride > 0 };
  }

  /**
   * @param ctx { st, dest, tier, rateFor(cityId, tier) -> { hotel, rate, xbed, vehicles, cab, act } }
   * @returns { lines: [{ category, label, detail, amount }], missing: [string] }
   */
  function buildCostLines(ctx) {
    const { st, dest, tier, rateFor } = ctx;
    const lines = [];
    const missing = [];
    const miss = (m) => { if (!missing.includes(m)) missing.push(m); };
    const pax = (+st.adults || 0) + (+st.children || 0);
    const rp = roomPlan(st);
    const vp = vehiclePlan(st, dest.type);
    const seenAct = new Set();

    st.cities.forEach((sel, i) => {
      const city = dest.cities.find((c) => c.id === sel.id);
      if (!city) return;
      const nights = +sel.nights || 0;
      const r = rateFor(city.id, tier);
      const n = `${nights} night${nights > 1 ? 's' : ''}`;

      if (+r.rate > 0) {
        lines.push({
          category: 'Hotels', label: `${city.name}: ${r.hotel || 'hotel'}`,
          detail: `${fmt(r.rate)} × ${rp.rooms} room${rp.rooms > 1 ? 's' : ''} × ${n}`,
          amount: r.rate * rp.rooms * nights,
        });
      } else miss(`${city.name}: hotel rate`);

      if (rp.extraBeds > 0) {
        if (+r.xbed > 0) {
          lines.push({ category: 'Hotels', label: `${city.name}: extra bed`, detail: `${fmt(r.xbed)} × ${rp.extraBeds} bed${rp.extraBeds > 1 ? 's' : ''} × ${n}`, amount: r.xbed * rp.extraBeds * nights });
        } else miss(`${city.name}: extra bed rate`);
      }

      if (st.transfers) {
        const days = nights + (i === st.cities.length - 1 ? 1 : 0);
        const perDay = +((r.vehicles || {})[vp.vehicle.id]) || 0;
        // rates saved before vehicle types existed had one `cab` figure; keep using it until a type-specific rate is entered
        const legacy = !perDay && !Object.keys(r.vehicles || {}).length ? +r.cab || 0 : 0;
        const rate = perDay || legacy;
        if (rate > 0) {
          lines.push({
            category: 'Transport', label: `${city.name}: ${vp.vehicle.label}${vp.count > 1 ? ` ×${vp.count}` : ''}`,
            detail: `${fmt(rate)} × ${days} day${days > 1 ? 's' : ''}${vp.count > 1 ? ` × ${vp.count} vehicles` : ''}`,
            amount: rate * days * vp.count,
          });
        } else miss(`${city.name}: ${vp.vehicle.label} per day`);
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

  /** discount: { type: 'amt' | 'pct', value } — taken off the package price before GST. */
  function summarize(lines, marginPct, gstPct, pax, discount) {
    const base = lines.reduce((s, l) => s + l.amount, 0);
    const margin = Math.round(base * (marginPct / 100));
    const beforeDiscount = base + margin;
    const dv = Math.max(0, +(discount && discount.value) || 0);
    const disc = Math.min(beforeDiscount, Math.round(discount && discount.type === 'pct' ? beforeDiscount * dv / 100 : dv));
    const subtotal = beforeDiscount - disc;
    const gst = Math.round(subtotal * (gstPct / 100));
    const total = subtotal + gst;
    const p = Math.max(pax, 1);
    return {
      base, margin, beforeDiscount, discount: disc, belowCost: disc > margin, subtotal, gst, total,
      perPerson: Math.round(total / p), subtotalPP: Math.round(subtotal / p), gstPP: Math.round(gst / p),
    };
  }

  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  function fmt(n) { return inr.format(Math.round(+n || 0)); }

  window.PavicoPricing = { buildCostLines, summarize, fmt, roomPlan, vehiclePlan, vehicleList, suggestVehicle };
})();
