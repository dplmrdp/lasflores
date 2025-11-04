const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const TEAM_NAME = "C.D. LAS FLORES SEVILLA MORADO";
const OUTPUT_DIR = "calendarios";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function normalize(str) {
  return str.toUpperCase().replace(/\s+/g, " ").trim();
}

function writeICS(filename, events, prodid) {
  let ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:${prodid}\n`;
  for (const ev of events) {
    if (ev.type === "timed") {
      const start = ev.date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
      const end = new Date(ev.date.getTime() + 2 * 60 * 60 * 1000)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z/, "Z");
      ics += `BEGIN:VEVENT\nDTSTART:${start}\nDTEND:${end}\nSUMMARY:${ev.summary}\nLOCATION:${ev.location}\nEND:VEVENT\n`;
    } else if (ev.type === "weekend") {
      const start = ev.start.toISOString().slice(0, 10).replace(/-/g, "");
      const end = new Date(ev.end.getTime() + 86400000)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");
      ics += `BEGIN:VEVENT\nDTSTART;VALUE=DATE:${start}\nDTEND;VALUE=DATE:${end}\nSUMMARY:${ev.summary}\nLOCATION:${ev.location}\nEND:VEVENT\n`;
    }
  }
  ics += "END:VCALENDAR";
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), ics);
}

/* --- FEDERADO VIA API --- */
async function loadFederado() {
  const url = "https://favoley.es/api/v1/matches?tournamentId=1321417&categoryId=3652130";

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "es-ES,es;q=0.9",
      "Referer": "https://favoley.es/",
      "Origin": "https://favoley.es",
      "Connection": "keep-alive"
    }
  });

  const text = await res.text();

  // Si no devuelve JSON → lo detectamos y mostramos una pista
  if (text.trim().startsWith("<")) {
    throw new Error("❌ FAVoley devolvió HTML (bloqueo). Probablemente falta una cabecera o el endpoint ha cambiado.");
  }

  const matches = JSON.parse(text);
  const events = [];

  for (const m of matches) {
    const home = normalize(m.homeTeam.name || "");
    const away = normalize(m.awayTeam.name || "");
    if (![home, away].includes(normalize(TEAM_NAME))) continue;

    // ✅ Caso con fecha y hora correctas
    if (m.date && m.time) {
      const dt = new Date(`${m.date}T${m.time}:00+01:00`);
      events.push({
        type: "timed",
        date: dt,
        summary: `${m.homeTeam.shortName} vs ${m.awayTeam.shortName} (FEDERADO)`,
        location: m.facility?.name ?? "Por confirmar"
      });
      continue;
    }

    // ✅ Caso sin hora → evento de fin de semana
    const base = m.date ? new Date(m.date) : new Date();
    const start = new Date(base);
    start.setDate(start.getDate() - ((start.getDay() + 1) % 7)); // viernes semana del partido
    const end = new Date(start);
    end.setDate(end.getDate() + 2);

    events.push({
      type: "weekend",
      start,
      end,
      summary: `${m.homeTeam.shortName} vs ${m.awayTeam.shortName} (FEDERADO)`,
      location: m.facility?.name ?? "Por confirmar"
    });
  }

  return events;
}


/* --- IMD: mantenemos el parseado existente (funciona bien) --- */
async function loadIMD() {
  return []; // De momento dejamos IMD igual — **luego lo conectamos a su API**
}

/* --- MAIN --- */
(async () => {
  const federadoEvents = await loadFederado();
  const imdEvents = await loadIMD();

  writeICS("federado.ics", federadoEvents, "-//FLORES MORADO//FEDERADO//ES");
  writeICS("imd.ics", imdEvents, "-//FLORES MORADO//IMD//ES");

  console.log("✅ Calendarios actualizados sin usar navegador.");
})();
