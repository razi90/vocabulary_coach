/* Startup: find out which course the learner is in, load that course's
   content (COURSE, DECK, CONJUGATE, GRAMMAR, COURSE_PATH), then the app.

   The content files define globals the app reads while it starts, so they
   have to run first and in order - hence one script after the other. */
(() => {
  const COURSES = ["es", "en"];
  const APP_SCRIPTS = ["src/srs.js", "src/packs.js", "src/drill.js", "src/lesson.js", "src/coach.js",
    "src/insights.js", "src/speech.js", "src/wordsheet.js", "src/path.js", "src/dictation.js", "src/pathui.js", "src/app.js"];

  function load(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`${src} nicht ladbar`));
      document.body.appendChild(s);
    });
  }

  /* Static text in index.html that names the language: lang attributes,
     placeholders and labels with {flag}, {name}, {nameDe}, {inDe}. */
  function applyCourse() {
    const fill = (t) => t.replace(/\{(\w+)\}/g, (m, key) => (key in COURSE ? COURSE[key] : m));
    document.querySelectorAll("[data-course-lang]").forEach((e) => { e.lang = COURSE.lang; });
    document.querySelectorAll("[data-course-text]").forEach((e) => { e.textContent = fill(e.dataset.courseText); });
    document.querySelectorAll("[data-course-placeholder]").forEach((e) => { e.placeholder = fill(e.dataset.coursePlaceholder); });
    document.title = `${COURSE.name} – Vokabeltrainer`;
    // The course colour; style.css picks the light or dark one.
    if (COURSE.accent) {
      document.documentElement.style.setProperty("--course-accent", COURSE.accent.light);
      document.documentElement.style.setProperty("--course-accent-dark", COURSE.accent.dark);
    }
    const icon = document.querySelector("link[rel=icon]");
    if (icon) icon.href = icon.href.replace(/🇪🇸|%F0%9F%87%AA%F0%9F%87%B8/, encodeURIComponent(COURSE.flag));
  }

  async function start() {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (res.status === 401) { location.href = "/login.html"; return; }
    if (!res.ok) throw new Error(`Server antwortet mit ${res.status}`);
    const me = await res.json();
    const course = COURSES.includes(me.course) ? me.course : "es";
    for (const file of ["course", "deck", "conjugate", "grammar", "path"]) await load(`src/courses/${course}/${file}.js`);
    applyCourse();
    for (const src of APP_SCRIPTS) await load(src);
  }

  start().catch((e) => {
    const box = document.getElementById("bootError");
    box.hidden = false;
    box.textContent = "Die App konnte nicht starten: " + e.message;
  });
})();
