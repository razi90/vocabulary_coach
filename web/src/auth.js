/* Login and registration.

   Both go through fetch: the server answers with a status code instead of a
   redirect, and expects the CSRF token from the XSRF-TOKEN cookie as the
   X-XSRF-TOKEN header. The cookie arrives with any response, so one GET
   (the config request below) is enough before the first form is sent. */
(() => {
  const el = (id) => document.getElementById(id);
  const loginForm = el("loginForm");
  const registerForm = el("registerForm");
  let registrationOpen = false;

  function csrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function showError(text) {
    el("authError").textContent = text;
    el("authError").hidden = !text;
  }

  function showMode() {
    const register = registrationOpen && location.hash === "#registrieren";
    loginForm.hidden = register;
    registerForm.hidden = !register;
    el("toRegister").hidden = register || !registrationOpen;
    el("toLogin").hidden = !register;
    el("authSubtitle").textContent = register ? "Neues Konto anlegen" : "Anmelden, um weiterzulernen";
    showError("");
    // Not when the learner is already typing in this form: showMode runs again once
    // the server's config arrives, and stealing focus then sends the password into
    // the email field.
    const form = register ? registerForm : loginForm;
    if (!form.contains(document.activeElement)) form.querySelector("input").focus();
  }

  async function busy(form, fn) {
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try { await fn(); } finally { button.disabled = false; }
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(loginForm, async () => {
      showError("");
      const data = new FormData(loginForm);
      try {
        const res = await fetch("/login", {
          method: "POST",
          headers: { "X-XSRF-TOKEN": csrfToken() },
          body: new URLSearchParams({ email: data.get("email"), password: data.get("password") }),
        });
        if (res.ok) { location.href = "/"; return; }
        let message = "Anmeldung fehlgeschlagen.";
        try { message = (await res.json()).error || message; } catch (err) { /* Status reicht */ }
        showError(message);
      } catch (err) {
        showError("Der Server ist nicht erreichbar.");
      }
    });
  });

  registerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(registerForm, async () => {
      showError("");
      const data = Object.fromEntries(new FormData(registerForm));
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrfToken() },
          body: JSON.stringify(data),
        });
        if (res.ok) { location.href = "/"; return; }
        let message = "Registrierung fehlgeschlagen.";
        try { message = (await res.json()).error || message; } catch (err) { /* Status reicht */ }
        showError(message);
      } catch (err) {
        showError("Der Server ist nicht erreichbar.");
      }
    });
  });

  window.addEventListener("hashchange", showMode);

  const params = new URLSearchParams(location.search);
  if (params.has("logout")) {
    el("authNote").textContent = "Du bist abgemeldet.";
    el("authNote").hidden = false;
  }

  fetch("/api/auth/config")
    .then((res) => res.json())
    .then((config) => {
      registrationOpen = !!config.registrationOpen;
      el("passwordHelp").textContent = `Mindestens ${config.minPassword} Zeichen.`;
      el("registerCourse").innerHTML = (config.courses || [])
        .map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      showMode();
    })
    .catch(() => showError("Der Server ist nicht erreichbar."));
})();
