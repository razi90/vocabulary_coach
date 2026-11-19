/* The coach tab: settings (provider, model, API key), orders, run history,
   account.

   A run happens on the server. This page only starts it and shows its steps;
   every change to a run arrives as a "runs" server-sent event, so the
   history updates live while the coach works. */
const COACH = (() => {
  const el = (id) => document.getElementById(id);
  const esc = TEXT.esc;

  const TASK_LABELS = {
    exercises: "Neue Übungen", lesson: "Tageslektion", feedback: "Feedback zu Abgaben", custom: "Eigener Auftrag",
  };
  const STATUS_LABELS = { running: "läuft", done: "fertig", failed: "fehlgeschlagen" };

  let settings = null;
  let runs = [];
  let me = null;
  let hooks = { isVisible: () => false, alert: () => {}, openSettings: () => {} };
  let loadedModelsFor = null;

  // ---------- Loading ----------
  async function loadSettings() { settings = await STORE.call("GET", "coach/settings"); }
  async function loadRuns() { runs = await STORE.call("GET", "coach/runs?limit=10"); }

  async function init(options) {
    hooks = { ...hooks, ...options };
    el("coachSetup").addEventListener("click", () => hooks.openSettings());
    wire();
    try {
      [me] = await Promise.all([STORE.call("GET", "auth/me"), loadSettings(), loadRuns()]);
    } catch (e) {
      console.error("Coach konnte nicht geladen werden", e);
    }
    render();

    STORE.onRunsChanged(async () => {
      const before = new Map(runs.map((r) => [r.id, r.status]));
      await loadRuns();
      const finished = runs.some((r) => before.get(r.id) === "running" && r.status !== "running");
      if (finished && !hooks.isVisible()) hooks.alert();
      renderRuns();
      renderOrder();
    });
  }

  // ---------- Rendering ----------
  function render() {
    if (!settings) return;
    renderOrder();
    renderRuns();
    renderSettings();
    el("accountEmail").textContent = me ? `Angemeldet als ${me.email}` : "";
  }

  const ready = () => settings && settings.hasKey && settings.model && settings.provider;
  const running = () => runs.some((r) => r.status === "running");

  function providerLabel(id) {
    const p = settings.providers.find((x) => x.id === id);
    return p ? p.label : id;
  }

  function renderOrder() {
    const info = el("coachReady");
    el("coachSetup").hidden = !!ready();
    document.querySelector("#coachOrder .coach-actions").hidden = !ready();
    el("coachNoteField").hidden = !ready();
    if (!ready()) {
      info.innerHTML = "Der Coach braucht einen Anbieter, ein Modell und deinen API-Schlüssel. Das dauert eine Minute.";
    } else if (running()) {
      info.innerHTML = "Der Coach arbeitet gerade. Ergebnisse erscheinen unten im Verlauf.";
    } else {
      info.innerHTML = `Modell <strong>${esc(settings.model)}</strong> über ${esc(providerLabel(settings.provider))}.`;
    }
    document.querySelectorAll("#coachOrder [data-task]").forEach((b) => { b.disabled = !ready() || running(); });
  }

  function renderRuns() {
    const box = el("coachRuns");
    if (!runs.length) {
      box.innerHTML = '<p class="coach-setup-summary">Noch keine Aufträge.</p>';
      return;
    }
    box.innerHTML = runs.map(renderRun).join("");
  }

  function renderRun(r) {
    const when = new Date(r.started_at).toLocaleString("de-DE",
      { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const tokens = r.prompt_tokens + r.completion_tokens;
    const meta = [when, r.model, tokens ? `${tokens.toLocaleString("de-DE")} Tokens` : ""].filter(Boolean).join(" · ");
    const steps = (r.steps || []).map(renderStep).join("");
    return `<div class="coach-run">
      <div class="coach-run-head">
        <span class="coach-status ${esc(r.status)}">${esc(STATUS_LABELS[r.status] || r.status)}</span>
        ${esc(TASK_LABELS[r.task] || r.task)}
        <span class="coach-run-meta">${esc(meta)}</span>
      </div>
      ${r.note ? `<p class="coach-run-meta" style="margin:6px 0 0;">Hinweis: ${esc(r.note)}</p>` : ""}
      ${r.summary ? `<p class="coach-summary">${esc(r.summary)}</p>` : ""}
      ${r.error ? `<p class="coach-error">${esc(r.error)}</p>` : ""}
      ${steps ? `<details ${r.status === "running" ? "open" : ""}><summary class="coach-run-meta" style="cursor:pointer; margin-top:8px;">
        ${r.steps.length} ${r.steps.length === 1 ? "Schritt" : "Schritte"}</summary><ul class="coach-steps">${steps}</ul></details>` : ""}
    </div>`;
  }

  function renderStep(s) {
    if (s.kind === "message") return `<li>💬 ${esc(s.text)}</li>`;
    const mark = s.ok ? "✓" : "✗";
    return `<li class="${s.ok ? "" : "step-bad"}"><details><summary>${mark}
      <span class="step-tool">${esc(s.tool)}</span></summary>
      ${s.args ? `<pre>${esc(s.args)}</pre>` : ""}<pre>${esc(s.text)}</pre></details></li>`;
  }

  function renderSettings() {
    const select = el("coachProvider");
    if (!select.options.length) {
      select.innerHTML = settings.providers.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
    }
    select.value = settings.provider || settings.providers[0].id;
    if (document.activeElement !== el("coachModel")) el("coachModel").value = settings.model || "";
    el("coachKey").value = "";
    el("coachKey").placeholder = settings.hasKey ? `gespeichert (${settings.keyHint || "…"}) – leer lassen, um ihn zu behalten` : "sk-…";
    el("coachDeleteKey").hidden = !settings.hasKey;
    if (!settings.encryptionAvailable) {
      showSettingsError("Der Server hat keinen APP_ENCRYPTION_KEY gesetzt und kann keine API-Schlüssel speichern.");
    }
    renderProviderHelp();
    loadModels(select.value);
  }

  function renderProviderHelp() {
    const p = settings.providers.find((x) => x.id === el("coachProvider").value);
    el("coachKeysLink").innerHTML = p
      ? `Schlüssel bekommst du unter <a href="${esc(p.keysPage)}" target="_blank" rel="noopener">${esc(p.keysPage)}</a>.`
      : "";
    el("coachKeyHelp").textContent = settings.hasKey && settings.provider === el("coachProvider").value
      ? "Ein neuer Schlüssel ersetzt den gespeicherten."
      : "Wird beim Speichern beim Anbieter geprüft, wo das möglich ist.";
  }

  async function loadModels(provider) {
    if (loadedModelsFor === provider) return;
    loadedModelsFor = provider;
    const list = el("coachModelList");
    list.innerHTML = "";
    el("coachModelHelp").textContent = "Modelle werden geladen …";
    try {
      const models = await STORE.call("GET", `coach/models?provider=${encodeURIComponent(provider)}`);
      if (loadedModelsFor !== provider) return;
      list.innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
      el("coachModelHelp").textContent = `${models.length} Modelle verfügbar. Tippen zum Suchen.`;
    } catch (e) {
      loadedModelsFor = null;
      el("coachModelHelp").textContent = "Modellliste nicht verfügbar – die Modell-ID lässt sich auch direkt eintragen.";
    }
  }

  // ---------- Actions ----------
  function showSettingsError(text) {
    el("coachSettingsError").textContent = text;
    el("coachSettingsError").hidden = !text;
  }

  function flash(id, text) {
    const box = el(id);
    box.textContent = text;
    box.hidden = false;
    setTimeout(() => { box.hidden = true; }, 4000);
  }

  function wire() {
    document.querySelectorAll("#coachOrder [data-task]").forEach((button) => {
      button.addEventListener("click", async () => {
        const task = button.dataset.task;
        const note = el("coachNote").value.trim();
        const error = el("coachRunError");
        error.hidden = true;
        if (task === "custom" && !note) {
          error.textContent = "Schreib in das Hinweisfeld, was der Coach tun soll.";
          error.hidden = false;
          el("coachNote").focus();
          return;
        }
        button.disabled = true;
        try {
          const run = await STORE.call("POST", "coach/runs", { task, note });
          runs = [run, ...runs.filter((r) => r.id !== run.id)];
          el("coachNote").value = "";
          renderRuns();
          renderOrder();
        } catch (e) {
          error.textContent = e.message;
          error.hidden = false;
          renderOrder();
        }
      });
    });

    el("coachProvider").addEventListener("change", () => {
      renderProviderHelp();
      el("coachModel").value = "";
      loadModels(el("coachProvider").value);
    });

    el("coachSettingsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      showSettingsError("");
      const submit = e.target.querySelector("button[type=submit]");
      submit.disabled = true;
      try {
        settings = await STORE.call("PUT", "coach/settings", {
          provider: el("coachProvider").value,
          model: el("coachModel").value.trim(),
          apiKey: el("coachKey").value.trim() || null,
        });
        render();
        flash("coachSettingsNote", "Gespeichert.");
      } catch (err) {
        showSettingsError(err.message);
      } finally {
        submit.disabled = false;
      }
    });

    el("coachDeleteKey").addEventListener("click", async () => {
      if (!confirm("Den gespeicherten API-Schlüssel löschen? Der Coach funktioniert dann erst wieder mit einem neuen.")) return;
      try {
        settings = await STORE.call("DELETE", "coach/settings/key");
        render();
      } catch (err) {
        showSettingsError(err.message);
      }
    });

    el("logoutBtn").addEventListener("click", () => STORE.logout());


    el("passwordForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form));
      el("passwordError").hidden = true;
      try {
        await STORE.call("POST", "auth/password", data);
        form.reset();
        flash("passwordNote", "Passwort geändert.");
      } catch (err) {
        el("passwordError").textContent = err.message;
        el("passwordError").hidden = false;
      }
    });
  }

  return { init, render };
})();
