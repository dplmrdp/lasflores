const fs = require("fs");
const https = require("https");

const TEAM_NAME_FED = "C.D. LAS FLORES SEVILLA MORADO";
const FED_URL = "https://favoley.es/es/tournament/1321417/calendar/3652130/all";

// Utilidad mínima para obtener HTML
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// Quitar acentos y pasar a minúsculas
function normalize(str) {
  return str
    ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    : "";
}

function parseDate(text) {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!match) return null;
  const [_, d, m, y, h, min] = match;
  return new Date(`${y}-${m}-${d}T${h}:${min}:00+01:00`);
}

function writeICS(filename, events) {
  let ics = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
`;
  for (const evt of events) {
    const dt = evt.date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    ics += `BEGIN:VEVENT
DTSTART:${dt}
SUMMARY:${evt.summary}
LOCATION:${evt.location}
END:VEVENT
`;
  }
  ics += "END:VCALENDAR\n";
  fs.mkdirSync("calendarios", { recursive: true });
  fs.writeFileSync(filename, ics);
}

async function loadFederado() {
  console.log("Cargando calendario Federado (HTML simple)...");
  const html = await fetchHtml(FED_URL);

  // Extraer todas las filas <tr> donde aparezca el nombre del equipo
  const filas = html.split("<tr");
  const eventos = [];

  for (const f of filas) {
    if (!f.includes(TEAM_NAME_FED)) continue;

    // Extraer nombres de equipos
    const equipos = [...f.matchAll(/data-original-title="([^"]+)"/g)].map(
      (m) => m[1].trim()
    );

    // Extraer fecha + hora
    const fechaTxt =
      (f.match(/(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})/) || [])[1] || "";
    const date = parseDate(fechaTxt);

    // Extraer lugar
    const lugar =
      (f.match(
        /data-original-title="([^"]+)"[^>]*><\/span>\s*<\/span>\s*<\/td>/
      ) || [])[1] || "Por confirmar";

    if (date && equipos.length >= 2) {
      eventos.push({
        date,
        summary: `${equipos[0]} vs ${equipos[1]} (FEDERADO)`,
        location: lugar,
      });
    }
  }

  console.log(`→ ${eventos.length} partidos encontrados del ${TEAM_NAME_FED}`);
  return eventos;
}

(async () => {
  const fed = await loadFederado();
  if (!fed.length) {
    console.warn("⚠️ No se encontraron partidos del equipo.");
    return;
  }
  writeICS("calendarios/federado.ics", fed);
  console.log(`✅ Calendario federado actualizado con ${fed.length} partidos.`);
})();
