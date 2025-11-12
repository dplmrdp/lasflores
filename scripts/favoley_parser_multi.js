const fs = require("fs");
const https = require("https");

const TEAM_NEEDLE = "C.D. LAS FLORES SEVILLA"; // se buscarán todos los equipos Las Flores
const BASE_URL = "https://favoley.es/es/tournament"; // base general

// -------------------- utilidades --------------------
async function fetchHtml(url, retries = 3, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        }).on("error", reject);
      });
    } catch (err) {
      console.warn(`⚠️ Error (${i}/${retries}): ${err.message}`);
      if (i < retries) await new Promise(r => setTimeout(r, delayMs));
      else throw err;
    }
  }
}

function normalize(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normLower(s) {
  return normalize(s).toLowerCase();
}

function parseDateTime(fechaTd) {
  const m = fechaTd.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const [_, dd, MM, yyyy, HH, mm] = m;
  return new Date(`${yyyy}-${MM}-${dd}T${HH}:${mm}:00+01:00`);
}

function fmtICSDateTime(dt) {
  return dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function fmtICSDate(d) {
  const Y = d.getUTCFullYear();
  const M = String(d.getUTCMonth() + 1).padStart(2, "0");
  const D = String(d.getUTCDate()).padStart(2, "0");
  return `${Y}${M}${D}`;
}

function writeICS(team, events) {
  const filename = `calendarios/federado_${team.replace(/\s+/g, "_").toLowerCase()}.ics`;
  let ics = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//Las Flores//Calendarios Federado//ES
`;

  for (const evt of events) {
    ics += `BEGIN:VEVENT
SUMMARY:${evt.summary}
LOCATION:${evt.location}
DTSTART:${fmtICSDateTime(evt.start)}
END:VEVENT
`;
  }

  ics += "END:VCALENDAR\n";
  fs.mkdirSync("calendarios", { recursive: true });
  fs.writeFileSync(filename, ics);
  console.log(`✅ ${filename} (${events.length} eventos)`);
}

// -------------------- parser principal --------------------
async function parseFavoleyCalendar(url) {
  console.log(`Cargando calendario completo desde ${url} ...`);
  const html = await fetchHtml(url);
  const eventsByTeam = new Map();

  // dividir por jornadas
  const jornadas = html.split(/<h2[^>]*>[^<]*Jornada/i).slice(1);
  for (const jornada of jornadas) {
    const tableMatch = jornada.match(/<table[\s\S]*?<\/table>/);
    if (!tableMatch) continue;
    const rows = tableMatch[0].split(/<tr[^>]*>/).slice(1);

    for (const row of rows) {
      const equipoTd = row.match(/<td class="colstyle-equipo">([\s\S]*?)<\/td>/);
      if (!equipoTd) continue;

      const equipos = [...equipoTd[1].matchAll(/<span class="ellipsis"[^>]*>(.*?)<\/span>/g)]
        .map((m) => normalize(m[1]));
      if (equipos.length < 2) continue;

      const [teamA, teamB] = equipos;
      const fechaTd = row.match(/<td class="colstyle-fecha">([\s\S]*?)<\/td>/);
      if (!fechaTd) continue;

      const date = parseDateTime(fechaTd[1]);
      const lugarM = fechaTd[1].match(/<span class="ellipsis"[^>]*>(.*?)<\/span>/);
      const lugar = lugarM ? normalize(lugarM[1]) : "Por confirmar";

      // detectar si hay algún equipo Las Flores
      const localN = normLower(teamA);
      const visitN = normLower(teamB);
      const involve = localN.includes(normLower(TEAM_NEEDLE)) || visitN.includes(normLower(TEAM_NEEDLE));
      if (!involve) continue;

      const equiposInvolucrados = [];
      if (localN.includes(normLower(TEAM_NEEDLE))) equiposInvolucrados.push(teamA);
      if (visitN.includes(normLower(TEAM_NEEDLE))) equiposInvolucrados.push(teamB);

      const summary = `${teamA} vs ${teamB}`;
      const evt = { summary, location: lugar, start: date };

      for (const team of equiposInvolucrados) {
        if (!eventsByTeam.has(team)) eventsByTeam.set(team, []);
        eventsByTeam.get(team).push(evt);
      }
    }
  }

  // guardar un .ics por equipo
  for (const [team, events] of eventsByTeam.entries()) {
    events.sort((a, b) => a.start - b.start);
    writeICS(team, events);
  }

  console.log(`✔️ ${eventsByTeam.size} equipos detectados de Las Flores`);
}

// -------------------- main --------------------
(async () => {
  // ejemplo: Infantil femenino grupo 3652130 (ajusta según necesites)
  const url = "https://favoley.es/es/tournament/1321417/calendar/3652130/all";
  await parseFavoleyCalendar(url);
})();
