/* Course metadata: everything the app needs to know about the language
   being learned. Loaded first; every other module reads COURSE instead of
   assuming a language. The direction codes in state ("es-de"/"de-es") mean
   "course language -> German" and back, whatever the course. */
const COURSE = {
  id: "es",
  lang: "es",             // lang attribute for course-language text
  speechLang: "es-ES",    // speech recognition in the lesson
  flag: "🇪🇸",
  name: "Español",        // the language's own name, shown in the header
  nameDe: "Spanisch",
  inDe: "auf Spanisch",   // "Schreib deinen Text auf Spanisch"
  hintExample: "Mehr zu ser und estar",   // in the coach's hint field
  praise: "¡Correcto!",
  // The one accent colour of this course (light and dark theme): main button,
  // progress, active section, focus ring.
  accent: { light: "#d9501c", dark: "#f0814f" },
  defaultTenses: ["presente", "indefinido"],
};
