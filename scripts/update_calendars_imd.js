const fs = require("fs");
const https = require("https");

// Ajusta estos valores según el equipo exacto IMD (por ejemplo, Cadete Morado)
const TEAM_NAME_IMD = "LAS FLORES MORA"; // puede ajustarse según cómo aparezca en la web
const IMD_URL = "https://imd.sevilla.org/app/jjddmm_resultados/";

// ========= DESCARGA ROBUSTA =========
const AGENT = new https.Agent({ keepAlive: true });

function fetchHtml(url, attempt = 1) {
  const MAX_ATTEMPTS = 5;
  const BACKOFF_MS = 1000 * Math.pow(2, attempt - 1);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        agent: AGENT,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-ES,es;q=0.9",
          Connection: "keep-alive",
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          if (attempt < MAX_ATTEMPTS) {
            console.warn(`Reintentando IMD (${attempt}/${MAX_ATTEMPTS})...`);
            setTimeout(() => {
              fetchHtml(url, attempt + 1).then(resolve).catch(reject);
            }, BACKOFF_MS);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => {
      const transient = ["ECONNRESET", "EAI_AGAIN", "ETIMEDOUT"].includes(err.code || "");
      if (transient && attempt < MAX_ATTEMPTS) {
        setTimeout(() => {
          fetchHtml(url, attempt + 1).then(resolve).catch(reject);
        }, BACKOFF_MS);
      } else reject(err);
    });
    req.end();
  });
}

// ========= UTILIDADES =========
function normalize(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function parseDateTime(text) {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const [_, d, M, Y, h, min] = m;
  return new Date(`${Y}-${M}-${d}T${h}:${min}:00+01:00`);
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

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ========= ESCRITURA ICS =========
function writeICS(filename, events) {
  let ics = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//Las Flores Morado//Calendario IMD//ES
`;

  for (const evt of events) {
    if (evt.type === "timed") {
      ics += `BEGIN:VEVENT
SUMMARY:${evt.summary}
LOCATION:${evt.location}
DTSTART:${fmtICSDateTime(evt.start)}
END:VEVENT
`;
    } else if (evt.type === "allday") {
      const start = evt.start;
      const end = addDays(evt.end, 1);
      ics += `BEGIN:VEVENT
SUMMARY:${evt.summary}
LOCATION:${evt.location}
DTSTART;VALUE=DATE:${fmtICSDate(start)}
DTEND;VALUE=DATE:${fmtICSDate(end)}
END:VEVENT
`;
    }
  }

  ics += "END:VCALENDAR\n";

  fs.mkdirSync("calendarios", { recursive: true });
  fs.writeFileSync(`calendarios/${filename}`, ics);
}

// ========= PARSER PRINCIPAL (IMD Sevilla) =========
//
// En el IMD, los datos suelen cargarse por JavaScript dinámico.
// Por simplicidad, aquí asumimos que ya tienes una forma de obtener
// el HTML completo de la tabla de resultados de un equipo concreto.
//
async function loadIMD() {
  console.log("Cargando calendario IMD...");
  const html = await fetchHtml(IMD_URL);

  // Buscamos las filas del equipo “Las Flores”
  const rows = html.split(/<tr[^>]*>/).slice(1);
  const events = [];

  for (const row of rows) {
    if (!normalize(row).includes(normalize("flores"))) continue;

    // Equipos
    const equipos = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim()
    );
    if (equipos.length < 4) continue;

    const [fechaRaw, horaRaw, equipoA, equipoB, lugarRaw] = equipos;
    const lugar = lugarRaw || "Por confirmar";

    const fechaTexto = `${fechaRaw} ${horaRaw}`.trim();
    const fecha = parseDateTime(fechaTexto);

    const summary = `${equipoA} vs ${equipoB}`;

    if (fecha) {
      events.push({ type: "timed", summary, location: lugar, start: fecha });
    } else {
      // Si no hay fecha exacta, ignoramos
      continue;
    }
  }

  console.log(`→ ${events.length} partidos encontrados en IMD (${TEAM_NAME_IMD})`);
  return events;
}

// ========= MAIN =========
(async () => {
  try {
    const imd = await loadIMD();
    if (!imd.length) {
      console.warn("⚠️ No se encontraron partidos del equipo en IMD.");
      process.exit(0);
      return;
    }

    writeICS("imd.ics", imd);
    console.log(`✅ Calendario IMD actualizado con ${imd.length} partidos.`);
  } catch (err) {
    console.warn("⚠️ ERROR no crítico (se mantiene el .ics anterior):", err.message || err);
    process.exit(0);
  }
})();
