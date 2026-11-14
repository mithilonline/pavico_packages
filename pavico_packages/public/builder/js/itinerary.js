/*
 * Day-wise itinerary builder.
 * Groups picked attractions by area so a day doesn't zig-zag across town,
 * fills each day up to a time budget, and warns when picks don't fit the nights.
 */
(function () {
  const FULL_DAY_HRS = 7;
  const ARRIVAL_DAY_HRS = 3;

  function addDays(iso, n) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d;
  }
  const dateFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  function build(st, dest, hotelFor) {
    const days = [];
    const warnings = [];
    const placed = new Set(); // a city visited twice doesn't repeat its activities
    let dayNo = 0;

    st.cities.forEach((sel, ci) => {
      const city = dest.cities.find((c) => c.id === sel.id);
      if (!city) return;
      const isLast = ci === st.cities.length - 1;
      const nights = Math.max(1, +sel.nights || 1);
      const nDays = nights + (isLast ? 1 : 0);
      const picks = (st.picks && st.picks[city.id]) || {};
      const prev = ci > 0 ? dest.cities.find((c) => c.id === st.cities[ci - 1].id) : null;

      // timed activities, grouped by area (keeps first-seen area order)
      const acts = [
        ...(city.attractions || []).filter((a) => (picks.attractions || []).includes(a.id)),
        ...(city.mustTry || []).filter((m) => (picks.mustTry || []).includes(m.id)),
      ].filter((a) => !placed.has(a.id));
      const areaOrder = [];
      acts.forEach((a) => { if (!areaOrder.includes(a.area)) areaOrder.push(a.area); });
      const sorted = areaOrder.flatMap((ar) => acts.filter((a) => a.area === ar));

      const cityDays = [];
      for (let d = 0; d < nDays; d++) {
        let kind = 'sightseeing';
        let cap = FULL_DAY_HRS;
        if (d === 0) { kind = ci === 0 ? 'arrival' : 'transfer'; cap = ARRIVAL_DAY_HRS; }
        if (isLast && d === nDays - 1) { kind = 'departure'; cap = 0; }
        cityDays.push({ kind, cap, used: 0, items: [], foods: [] });
      }

      // longest first; prefer a day already in the same area, else the tightest day it still fits (best-fit)
      const place = (a) => {
        const fits = cityDays.filter((cd) => cd.cap - cd.used >= a.hours);
        let day = fits.find((cd) => cd.items.some((x) => x.area === a.area));
        if (!day) day = fits.sort((x, y) => (x.cap - x.used) - (y.cap - y.used))[0];
        if (!day) {
          // a later visit to the same city may still fit it
          const laterVisit = st.cities.slice(ci + 1).some((x) => x.id === city.id);
          if (!laterVisit) warnings.push(`${city.name}: “${a.name}” doesn’t fit in ${nights} night${nights > 1 ? 's' : ''} — add a night or drop something.`);
          return;
        }
        day.items.push(a); day.used += a.hours; placed.add(a.id);
      };
      [...sorted].sort((x, y) => y.hours - x.hours).forEach(place);
      // keep each day's activities in area order
      cityDays.forEach((cd) => cd.items.sort((x, y) => sorted.indexOf(x) - sorted.indexOf(y)));

      // food suggestions spread over non-departure days
      const foods = city.food.filter((f) => (picks.food || []).includes(f.id) && !placed.has(f.id));
      foods.forEach((f) => placed.add(f.id));
      const foodDays = cityDays.filter((cd) => cd.kind !== 'departure');
      foods.forEach((f, i) => foodDays[i % foodDays.length].foods.push(f));

      const hotel = hotelFor(city.id);
      cityDays.forEach((cd, d) => {
        let title;
        if (cd.kind === 'arrival') title = `Arrive in ${city.name}`;
        else if (cd.kind === 'transfer') title = `${prev.name} → ${city.name}`;
        else if (cd.kind === 'departure') title = `Departure from ${city.name}`;
        else title = cd.items.length ? cd.items.slice(0, 2).map((x) => x.name).join(' & ') : `Leisure day in ${city.name}`;

        let intro = '';
        if (cd.kind === 'arrival') intro = `Arrive in ${city.name}. Our driver meets you and takes you to your hotel. Check in and settle in.`;
        if (cd.kind === 'transfer') {
          intro = city.transferIn && city.transferIn.mode === 'flight'
            ? `Check out and fly from ${prev.name} to ${city.name}. Transfer to your hotel and check in.`
            : `Check out and drive from ${prev.name} to ${city.name}. Check in at your hotel.`;
        }
        if (cd.kind === 'departure') intro = `Breakfast and check out. Transfer to the airport / station for your journey home with lots of memories.`;
        if (cd.kind === 'sightseeing' && !cd.items.length) intro = `A free day to explore ${city.name} at your own pace.`;

        days.push({
          key: `${ci}-${city.id}-${d}`, dayNo: ++dayNo, date: addDays(st.startDate, dayNo - 1),
          cityId: city.id, cityName: city.name, kind: cd.kind, title, intro,
          items: cd.items, foods: cd.foods,
          overnight: cd.kind === 'departure' ? null : (hotel ? hotel.hotelName : null),
        });
      });
    });

    return { days, warnings };
  }

  function dateLabel(d) { return d ? dateFmt.format(d) : ''; }

  window.PavicoItinerary = { build, dateLabel, addDays };
})();
