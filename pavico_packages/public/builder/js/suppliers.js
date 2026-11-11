/*
 * Where a rate came from. Today every rate is entered by the team (rate sheet or a portal quote).
 * Later, TBO / TripJack adapters on the Pavico backend can fill these automatically.
 * API credentials must live on the server — never in this browser code.
 */
(function () {
  const SUPPLIERS = [
    { id: 'ratesheet', name: 'Pavico rate sheet', status: 'connected', note: 'Rates your team enters here are saved and reused on every quote.' },
    { id: 'tbo', name: 'TBO', status: 'needs-api', note: 'Live rates need TBO API access (separate from the portal login). Until then, check the portal and enter the rate.' },
    { id: 'tripjack', name: 'TripJack', status: 'needs-api', note: 'Live rates need TripJack API access (separate from the portal login). Until then, check the portal and enter the rate.' },
    { id: 'mmt', name: 'MakeMyTrip (myPartner)', status: 'manual', note: 'No open B2B API. Check the portal and enter the rate.' },
    { id: 'direct', name: 'Hotel direct', status: 'manual', note: 'Contracted or direct rate from the hotel.' },
  ];
  window.PavicoSuppliers = { SUPPLIERS };
})();
