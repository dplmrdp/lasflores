const fs = require("fs");
const https = require("https");
const cheerio = require("cheerio");

const TEAM_NAME_FED = "C.D. LAS FLORES SEVILLA MORADO";
const FED_URL = "https://favoley.es/es/tournament/1321417/calendar/3652130/all";

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseDate(text) {
  // "Sáb, 18/10/2025 10:00 GMT+1"
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!match) return null;
  const [_, d, m, y, h, min] = match;
  return new Date(`${y}-${m}-${d}T${h}:${min}:00+01:00`);
}

function normalize(str) {
  return str
    ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    : "";
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
  console.log("Cargando calendario Federado (HTML)...");
  const html = await fetchHtml(FED_URL);
  const $ = cheerio.load(html);

  const events = [];

  $("tr").each((_, tr) => {
    const equipos = $(tr)
      .find(".colstyle-equipo span.ellipsis")
      .map((i, el) => $(el).text().trim())
      .get();

    // Si no hay equipos o no está nuestro equipo, saltamos
    if (!equipos.length) return;
    if (!equipos.some(e => normalize(e).includes(normalize(TEAM_NAME_FED)))) return;

    const fechaTd = $(tr).find(".colstyle-fecha span").first();
    const fechaTxt = fechaTd.text().trim();
    const lugar = fechaTd.find(".ellipsis").attr("data-original-title") || "Por confirmar";

    const date = parseDate(fechaTxt);

    if (date) {
      events.push({
        summary: `${equipos[0]} vs ${equipos[1]} (FEDERADO)`,
        date,
        location: lugar,
      });
    }
  });

  console.log(`→ ${events.length} partidos encontrados del ${TEAM_NAME_FED}`);
  return events;
}

(async () => {
  const fed = await loadFederado();

  if (fed.length === 0) {
    console.warn("⚠️ No se encontraron partidos del equipo en el calendario federado.");
  } else {
    writeICS("calendarios/federado.ics", fed);
    console.log(`✅ Calendario federado actualizado con ${fed.length} partidos.`);
  }
})();
