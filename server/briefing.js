/* Formatiert die Auswertung als Text für einen Agenten.

   Die Zahlen kommen aus den SQL-Views – hier wird nichts mehr berechnet,
   nur formuliert. Damit können App, HTTP-API und MCP nicht auseinanderlaufen. */

function pluralTage(n) { return n === 1 ? "Tag" : "Tage"; }

function toMarkdown(w, { schema, itemTypes }) {
  const L = [];
  const s = w.summary;
  const date = new Date(w.generatedAt).toLocaleDateString("de-DE",
    { day: "2-digit", month: "2-digit", year: "numeric" });

  L.push(`# Lernstand — ${date}`, "");
  L.push(`${s.deck_size} Vokabeln · ${s.learned} gelernt · ${s.mature} reif · ` +
         `${s.due_now} fällig · Serie ${s.streak} ${pluralTage(s.streak)} · ` +
         `${s.total_answers} Antworten insgesamt`);
  L.push(s.accuracy_30d == null
    ? "Noch keine Antworten in den letzten 30 Tagen."
    : `Genauigkeit der letzten ${w.windowDays} Tage: **${s.accuracy_30d} %**`);
  L.push("");

  if (w.vocab.length) {
    L.push("## Hartnäckige Vokabeln", "");
    w.vocab.forEach((v) => {
      const bits = [`**${v.es}** (${v.de_primary}, ${v.topic}) — ${v.wrong}× falsch bei ${v.attempts} Versuchen`];
      if (v.confused_with_es) bits.push(`zuletzt „${v.last_typed}“ → verwechselt mit ${v.confused_with_es} (${v.confused_with_de})`);
      else if (v.last_typed) bits.push(`zuletzt „${v.last_typed}“`);
      L.push("- " + bits.join(", "));
    });
    L.push("");
  }

  const c = w.conjugation;
  if (c.forms.length || c.byTense.length) {
    L.push("## Konjugation", "");
    c.forms.slice(0, 6).forEach((f) => {
      const typed = f.last_typed ? ` (zuletzt „${f.last_typed}“ statt „${f.expected}“)` : "";
      L.push(`- ${f.verb}, ${f.tense_label || f.tense}, ${f.person_label || f.person} — ${f.wrong}× falsch${typed}`);
    });
    if (c.byTense.length) L.push("", "Nach Zeit: " + c.byTense.map((t) => `${t.label} ${t.accuracy}% (${t.attempts})`).join(" · "));
    if (c.byPerson.length) L.push("Nach Person: " + c.byPerson.map((p) => `${p.label} ${p.accuracy}% (${p.attempts})`).join(" · "));
    L.push("");
  }

  if (w.grammar.length) {
    L.push("## Grammatik", "");
    w.grammar.forEach((g) => L.push(
      `- ${g.label}: ${g.accuracy} % richtig bei ${g.attempts} ${g.attempts === 1 ? "Aufgabe" : "Aufgaben"}`));
    L.push("");
  }

  if (w.exercises.length) {
    L.push("## Übungssätze", "");
    w.exercises.forEach((p) => L.push(`- ${p.title} (\`${p.id}\`, ${p.status}): ${p.item_count} Aufgaben, ` +
      (Number(p.attempts) ? `${p.attempts} Antworten, ${p.accuracy} % richtig` : "noch nicht geübt")));
    L.push("");
  }

  L.push("## Auftrag", "");
  jobs(w).forEach((j) => L.push(`- ${j}`));
  L.push("");
  L.push(`Neue Übungen über \`create_exercise\` anlegen (Schema \`${schema}\`, ` +
         `Aufgabentypen: ${itemTypes.join(", ")}).`);
  return L.join("\n");
}

/** Konkrete Aufträge – zwei Schwerpunkte sind brauchbarer als eine Mängelliste. */
function jobs(w) {
  const out = [];
  const weakGrammar = w.grammar.filter((g) => g.accuracy != null && g.accuracy < 80).slice(0, 2);
  weakGrammar.forEach((g) => out.push(`10 Lückensätze zu „${g.label}“ (aktuell ${g.accuracy} %)`));

  const verbs = [...new Set(w.conjugation.forms.map((f) => f.verb))].slice(0, 4);
  if (verbs.length) {
    const person = w.conjugation.byPerson[0];
    out.push(`8 Sätze, die ${verbs.join(", ")} ` +
      (person ? `in der Form „${person.label}“ ` : "") + "erzwingen");
  }

  const confused = w.vocab.filter((v) => v.confused_with_es).slice(0, 5);
  if (confused.length) {
    out.push("Minimalpaare zu den verwechselten Vokabeln: " +
      confused.map((v) => `${v.es} vs. ${v.confused_with_es}`).join("; "));
  }
  if (!out.length) out.push("Keine auffälligen Schwächen — gemischte Wiederholung zu den zuletzt gelernten Themen.");
  return out;
}

module.exports = { toMarkdown, jobs };
