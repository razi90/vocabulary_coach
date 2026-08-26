/* Persistenz der App.

   Die Wahrheit liegt in Postgres hinter der HTTP-API; dieses Modul ist nur der
   Zugang dazu. IndexedDB und localStorage sind bewusst weg – zwei Quellen der
   Wahrheit ohne Konfliktauflösung waren die schlechtere Variante, und ohne
   laufenden Server soll die App gar nicht erst so tun, als funktioniere sie. */
const STORE = (() => {
  let snapshot = null;
  let ready = false;

  async function call(method, route, body) {
    const res = await fetch(`/api/${route}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch (e) { /* egal */ }
      throw new Error(`${method} ${route}: ${res.status}${detail ? ` – ${detail}` : ""}`);
    }
    const type = res.headers.get("content-type") || "";
    return type.includes("application/json") ? res.json() : res.text();
  }

  async function init() {
    snapshot = await call("GET", "snapshot");
    ready = true;
  }

  const isReady = () => ready;

  /* Ein frischer Datensatz ist {} – ohne diese Grundform greifen Zähler wie
     state.log[heute] ins Leere. Die Form gehört der App, deshalb steht sie hier
     und nicht in der Datenbank. */
  function defaultState() {
    return {
      dailyGoal: 20,
      direction: "es-de",
      streak: 0,
      lastActiveDay: null,
      newCapOverrideDay: null,
      log: {},
      newIntroducedOn: {},
      conjCards: {},
      conjLog: {},
      grammarCards: {},
      grammarLog: {},
      packCards: {},
      packLog: {},
      conjTenses: ["presente", "indefinido"],
      conjVerbSet: "irregular",
      grammarCategories: null,
    };
  }

  const loadState = async () => ({ ...defaultState(), ...(snapshot.state || {}) });
  const saveState = (state) => call("PUT", "state", state);

  const loadCards = async () => snapshot.cards || {};
  const saveCard = (card) => call("PATCH", "cards", { [card.id]: card });

  async function appendEvent(event) {
    const { seqs } = await call("POST", "events", { t: Date.now(), ...event });
    return seqs[0];
  }
  const allEvents = () => call("GET", "events");

  const allPacks = async () => (await call("GET", "packs")).packs;
  const savePack = (raw) => call("POST", "packs", { raw });
  const deletePack = (id) => call("DELETE", `packs/${encodeURIComponent(id)}`);

  const weaknesses = () => call("GET", "weaknesses");
  const briefing = () => call("GET", "briefing");

  /* Der Server meldet über Server-Sent-Events, wenn ein Agent eine Übung
     angelegt hat. Ohne das bräuchte es wieder einen „Neu laden“-Knopf. */
  function onExercisesChanged(handler) {
    if (typeof EventSource !== "function") return () => {};
    let source = null;
    let closed = false;
    const connect = () => {
      if (closed) return;
      source = new EventSource("/api/stream");
      source.addEventListener("exercises", () => handler());
      source.onerror = () => { source.close(); if (!closed) setTimeout(connect, 3000); };
    };
    connect();
    return () => { closed = true; if (source) source.close(); };
  }

  return {
    init, isReady, defaultState,
    loadState, saveState, loadCards, saveCard,
    appendEvent, allEvents,
    allPacks, savePack, deletePack,
    weaknesses, briefing, onExercisesChanged,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = STORE;
