/* Persistence of the app.

   The truth lives in Postgres behind the HTTP API; this module is only the
   way in. IndexedDB and localStorage are deliberately gone - two sources of
   truth without conflict resolution was the worse option, and without a
   running server the app should not pretend to work at all. */
const STORE = (() => {
  let snapshot = null;
  let ready = false;

  /* Writes carry the CSRF token: the server sets it in the XSRF-TOKEN cookie
     and accepts it back only as a header, which another site cannot send. */
  function csrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  async function call(method, route, body) {
    /* The course this page was loaded for. The server uses it instead of the
       account's current course, so a tab left open after switching courses
       elsewhere keeps writing into the course it shows. */
    const headers = typeof COURSE !== "undefined" ? { "X-Course": COURSE.id } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["X-XSRF-TOKEN"] = csrfToken();
    const res = await fetch(`/api/${route}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Session expired or logged out in another tab: back to the login page.
    if (res.status === 401) {
      location.href = "/login.html";
      throw new Error("nicht angemeldet");
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch (e) { /* egal */ }
      throw new Error(detail || `${method} ${route}: ${res.status}`);
    }
    const type = res.headers.get("content-type") || "";
    return type.includes("application/json") ? res.json() : res.text();
  }

  async function logout() {
    await fetch("/logout", { method: "POST", headers: { "X-XSRF-TOKEN": csrfToken() }, credentials: "same-origin" });
    location.href = "/login.html?logout";
  }

  async function init() {
    snapshot = await call("GET", "snapshot");
    ready = true;
  }

  const isReady = () => ready;

  /* A fresh record is {} - without this base shape, counters such as
     state.log[today] reach into nothing. The shape belongs to the app, which
     is why it sits here and not in the database. */
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
      conjTenses: [...COURSE.defaultTenses],
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

  /* The server reports via server-sent events when the coach (or anything
     else) has changed exercises, lessons or coach runs. One connection for
     all event kinds; listeners subscribe by name. */
  const listeners = { exercises: [], lessons: [], runs: [] };
  let source = null;
  function ensureStream() {
    if (source || typeof EventSource !== "function") return;
    const connect = () => {
      source = new EventSource("/api/stream");
      Object.keys(listeners).forEach((name) =>
        source.addEventListener(name, () => listeners[name].forEach((fn) => fn())));
      // Development only (DEV_RELOAD): a file under web/ changed. Production never sends it.
      source.addEventListener("reload", () => location.reload());
      source.onerror = () => { source.close(); source = null; setTimeout(() => { if (!source) connect(); }, 3000); };
    };
    connect();
  }
  const onExercisesChanged = (fn) => { listeners.exercises.push(fn); ensureStream(); };
  const onLessonsChanged = (fn) => { listeners.lessons.push(fn); ensureStream(); };
  const onRunsChanged = (fn) => { listeners.runs.push(fn); ensureStream(); };

  return {
    init, isReady, defaultState,
    loadState, saveState, loadCards, saveCard,
    appendEvent, allEvents,
    allPacks, savePack, deletePack,
    weaknesses, briefing, onExercisesChanged, onLessonsChanged, onRunsChanged,
    call, logout,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = STORE;
