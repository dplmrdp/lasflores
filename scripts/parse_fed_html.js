// scripts/parse_fed_html.js
const fs = require("fs");

const TEAM_NEEDLE = "C.D. LAS FLORES SEVILLA";

function normalize(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function normLower(s) {
  return normalize(s).toLowerCase();
}

// 🧩 Soporta dd/mm/yyyy hh:mm, ISO y solo fecha
function parseDateTime(text) {
  if (!text) return null;

  let m = text.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (m) {
    const [_, dd, MM, yyyy, HH, mm] = m;
    return new Date(`${yyyy}-${MM}-${dd}T${HH}:${mm}:00+01:00`);
  }

  m = text.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [_, yyyy, MM, dd, HH, mm, ss] = m;
    return new Date(`${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}+01:00`);
  }

  m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    const [_, dd, MM, yyyy] = m;
    return new Date(`${yyyy}-${MM}-${dd}T00:00:00+01:00`);
  }

  return null;
}

// 🧠 Nuevas funciones para rango de jornada
function parseDdmmyy(ddmmyy) {
  const m = (ddmmyy || "").match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const [_, d, M, yy] = m;
  const Y = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
  return new Date(`${Y}-${M}-${d}T00:00:00+01:00`);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days); // use UTC to avoid timezone local shifts
  return d;
}

// --- Helpers para formatear en TZ Europe/Madrid ---
const ICS_TZ = "Europe/Madrid";

function pad(n) { return String(n).padStart(2, "0"); }

// formatea instante Date -> YYYYMMDDTHHMMSS usando timezone Europe/Madrid
function fmtICSDateTimeTZID(dt) {
  if (!(dt instanceof Date) || isNaN(dt)) return "19700101T000000";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ICS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(dt);

  const y = parts.find(p => p.type === "year").value;
  const mo = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  const H = parts.find(p => p.type === "hour").value;
  const M = parts.find(p => p.type === "minute").value;
  const S = parts.find(p => p.type === "second").value;

  return `${y}${mo}${d}T${H}${M}${S}`;
}

// formatea Date -> YYYYMMDD para VALUE=DATE, usando timezone Europe/Madrid
function fmtICSDateFromDate(dt) {
  if (!(dt instanceof Date) || isNaN(dt)) {
    return "19700101";
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ICS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(dt);
  const y = parts.find(p => p.type === "year").value;
  const mo = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}${mo}${d}`;
}

function escapeICSText(s) {
  if (!s) return "";
  return String(s).replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}

// --- formato ICS (timed con TZ y allday con DTEND = end+1) ---
function writeICS(team, category, events) {
  const safeCat = (category || "sin_categoria").toLowerCase().replace(/\s+/g, "_");
  const safeTeam = (team || "equipo").replace(/\s+/g, "_").toLowerCase();
  const filename = `calendarios/federado_${safeCat}_${safeTeam}.ics`;

  let ics = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//Las Flores//Calendarios Federado//ES
`;

  for (const evt of events) {
    if (!evt) continue;
    if (evt.type === "timed") {
      const dtStr = fmtICSDateTimeTZID(evt.start);
      ics += `BEGIN:VEVENT
SUMMARY:${escapeICSText(evt.summary)}
LOCATION:${escapeICSText(evt.location || "")}
DTSTART;TZID=${ICS_TZ}:${dtStr}
DESCRIPTION:${escapeICSText(evt.description || "")}
END:VEVENT
`;
    } else if (evt.type === "allday") {
      // DTSTART: fecha tal cual; DTEND: end + 1 day (ICS exclusive)
      const dtStart = fmtICSDateFromDate(evt.start);
      const dtEndDate = addDays(evt.end, 1); // end + 1
      const dtEnd = fmtICSDateFromDate(dtEndDate);
      ics += `BEGIN:VEVENT
SUMMARY:${escapeICSText(evt.summary)}
LOCATION:${escapeICSText(evt.location || "")}
DTSTART;VALUE=DATE:${dtStart}
DTEND;VALUE=DATE:${dtEnd}
DESCRIPTION:${escapeICSText(evt.description || "")}
END:VEVENT
`;
    }
  }

  ics += "END:VCALENDAR\n";
  fs.mkdirSync("calendarios", { recursive: true });
  fs.writeFileSync(filename, ics);
  console.log(`✅ ${filename} (${events.filter(e => e).length} eventos)`);
}

// ---------------- parseFederadoHTML ----------------
function parseFederadoHTML(html, meta) {
  const eventsByTeam = new Map();
  const jornadas = html.split(/<h2[^>]*>[^<]*Jornada/i).slice(1);

  if (!jornadas.length) {
    console.log(`⚠️ No se encontraron jornadas en ${meta.tournamentId}/${meta.groupId}`);
  }

  for (const jornada of jornadas) {
    // 🟢 Detectar rango de jornada (ej: 17/10/25 – 19/10/25)
    let weekendStart = null, weekendEnd = null;
    const range = jornada.match(/\((\d{2}\/\d{2}\/(?:\d{2}|\d{4}))\D+(\d{2}\/\d{2}\/(?:\d{2}|\d{4}))\)/);

    if (range) {
      weekendStart = parseDdmmyy(range[1]);
      weekendEnd = parseDdmmyy(range[2]);
      if (!weekendStart || isNaN(weekendStart)) weekendStart = new Date("1970-01-01");
      if (!weekendEnd || isNaN(weekendEnd)) weekendEnd = addDays(weekendStart, 2);
    } else {
      console.log("⚠️ No se detectó rango de jornada en:", jornada.slice(0, 80));
    }

    const tableMatch = jornada.match(/<table[\s\S]*?<\/table>/);
    if (!tableMatch) continue;
    const rows = tableMatch[0].split(/<tr[^>]*>/).slice(1);

    for (const row of rows) {
      try {
        const equipoTd = row.match(/<td class="colstyle-equipo">([\s\S]*?)<\/td>/);
        if (!equipoTd) continue;

        const equipos = [...equipoTd[1].matchAll(/<span class="ellipsis"[^>]*>(.*?)<\/span>/g)]
          .map((m) => normalize(m[1]))
          .filter((t) => t);
        if (equipos.length < 2) continue;
        const [teamA, teamB] = equipos;

        const fechaTd = row.match(/<td class="colstyle-fecha">([\s\S]*?)<\/td>/);
        const fechaHtml = fechaTd ? fechaTd[1] : "";
        const date = parseDateTime(fechaHtml);
        const lugarM = fechaHtml.match(/<span class="ellipsis"[^>]*>(.*?)<\/span>/);
        const lugar = lugarM ? normalize(lugarM[1]) : "Por confirmar";

        const localN = normLower(teamA);
        const visitN = normLower(teamB);
        const involve = localN.includes(normLower(TEAM_NEEDLE)) || visitN.includes(normLower(TEAM_NEEDLE));
        if (!involve) continue;

        const equiposInvolucrados = [];
        if (localN.includes(normLower(TEAM_NEEDLE))) equiposInvolucrados.push(teamA);
        if (visitN.includes(normLower(TEAM_NEEDLE))) equiposInvolucrados.push(teamB);

        let evt = null;
        if (date instanceof Date && !isNaN(date)) {
          // <-- CORRECCIÓN: NO sumar +1h. date ya contiene el offset +01:00 (o +02 en verano).
          evt = {
            type: "timed",
            start: date,
            summary: `${teamA} vs ${teamB}`,
            location: lugar,
            description: ""
          };
        } else if (weekendStart instanceof Date && weekendEnd instanceof Date) {
          // <-- CORRECCIÓN: usar exactamente el rango detectado.
          // Para ICS almacenamos start = weekendStart, end = weekendEnd (DTEND se hará +1 día en writeICS)
          evt = {
            type: "allday",
            start: weekendStart,
            end: weekendEnd,
            summary: `${teamA} vs ${teamB}`,
            location: lugar,
            description: ""
          };
          console.log(`📅 Sin hora: jornada ${fmtICSDateFromDate(weekendStart)}–${fmtICSDateFromDate(weekendEnd)} para ${teamA} vs ${teamB}`);
        } else {
          // no date & no jornada range -> skip (or create minimal allday of unknown day? decide skip)
          // we'll skip to avoid wrong guesses
          continue;
        }

        for (const t of equiposInvolucrados) {
          if (!eventsByTeam.has(t)) eventsByTeam.set(t, []);
          eventsByTeam.get(t).push(evt);
        }
      } catch (err) {
        console.log("⚠️ Error procesando fila:", err);
      }
    }
  }

  for (const [team, evs] of eventsByTeam.entries()) {
    evs.sort((a, b) => {
      if (a.type === "allday" && b.type !== "allday") return -1;
      if (b.type === "allday" && a.type !== "allday") return 1;
      if (a.type === "timed" && b.type === "timed") return a.start - b.start;
      return 0;
    });
    writeICS(team, meta.category || "sin_categoria", evs);
  }

  console.log(`📦 Generados ${eventsByTeam.size} calendarios para t=${meta.tournamentId} g=${meta.groupId}`);
}

module.exports = { parseFederadoHTML };
