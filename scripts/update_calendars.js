// scripts/update_calendars.js
// Requiere node-fetch@2 (workflow ya lo instala)
// Ejecutar: node scripts/update_calendars.js

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // v2

const TEAM_NAME = "C.D. LAS FLORES SEVILLA MORADO"; // identificación exacta
const OUTPUT_DIR = "calendarios";
const FAVOLEY_GRAPHQL = "https://favoley.es/graphql";
const FAV_TOURNAMENT = "1321417";
const FAV_CATEGORY = "3652130";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function normalize(s = "") {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

function writeICS(filename, events, prodid) {
  let ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:${prodid}\n`;
  for (const ev of events) {
    if (ev.type === "timed") {
      const start = ev.date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const end = new Date(ev.date.getTime() + 2 * 60 * 60 * 1000).toISOString()
        .replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      ics += `BEGIN:VEVENT\nDTSTART:${start}\nDTEND:${end}\nSUMMARY:${ev.summary}\nLOCATION:${ev.location}\nEND:VEVENT\n`;
    } else if (ev.type === "weekend") {
      const start = ev.start.toISOString().slice(0, 10).replace(/-/g, "");
      // DTEND is exclusive, so +1 day to include the Sunday
      const end = new Date(ev.end.getTime() + 24*60*60*1000).toISOString().slice(0,10).replace(/-/g, "");
      ics += `BEGIN:VEVENT\nDTSTART;VALUE=DATE:${start}\nDTEND;VALUE=DATE:${end}\nSUMMARY:${ev.summary}\nLOCATION:${ev.location}\nEND:VEVENT\n`;
    }
  }
  ics += "END:VCALENDAR\n";
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), ics, "utf8");
}

/* ---------------------- FAVOLEY (GraphQL) ---------------------- */

async function loadFederadoByGraphQL() {
  const query = `
    query Matches($tournament: ID!, $category: ID!) {
      tournament(id: $tournament) {
        id
        calendar(categoryId: $category) {
          matches {
            id
            date
            time
            timezone
            homeTeam { name shortName }
            awayTeam { name shortName }
            facility { name }
          }
        }
      }
    }
  `;

  const body = {
    query,
    variables: { tournament: FAV_TOURNAMENT, category: FAV_CATEGORY }
  };

  const res = await fetch(FAVOLEY_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (compatible; CalendarioBot/1.0)",
      "Origin": "https://favoley.es",
      "Referer": "https://favoley.es/"
    },
    body: JSON.stringify(body),
    timeout: 30000
  });

  const text = await res.text();
  // If HTML returned, throw (caller will report)
  if (text.trim().startsWith("<")) {
    throw new Error("FAVoley respondió HTML en GraphQL (posible bloqueo).");
  }

  const json = JSON.parse(text);
  if (!json || !json.data || !json.data.tournament || !json.data.tournament.calendar) {
    throw new Error("Respuesta GraphQL inesperada: estructura no encontrada.");
  }
  const matches = json.data.tournament.calendar.matches || [];
  const events = [];

  for (const m of matches) {
    const homeName = m.homeTeam?.name || "";
    const awayName = m.awayTeam?.name || "";
    const homeNorm = normalize(homeName);
    const awayNorm = normalize(awayName);

    // strict match: either home or away equals exact TEAM_NAME
    if (!(homeNorm === normalize(TEAM_NAME) || awayNorm === normalize(TEAM_NAME))) continue;

    const homeShort = m.homeTeam?.shortName || homeName;
    const awayShort = m.awayTeam?.shortName || awayName;
    const location = m.facility?.name || "Por confirmar";

    // If GraphQL provides date & time -> create timed event
    // GraphQL fields may provide date (YYYY-MM-DD) and time (HH:MM) and timezone (e.g. "GMT+1")
    if (m.date && m.time) {
      // try to detect timezone offset if provided; fallback to +01:00 (Spain)
      let dateISO;
      if (m.timezone && /[+-]\d{1,2}/.test(m.timezone)) {
        // e.g. GMT+1 -> convert to +01:00
        const tzMatch = m.timezone.match(/([+-]\d{1,2})/);
        const off = tzMatch ? tzMatch[1] : "+1";
        const offPad = off.includes(":") ? off : (off.length===2 ? off + ":00" : (off[0]+ "0"+off.slice(1)+":00"));
        dateISO = `${m.date}T${m.time}:00${offPad}`;
      } else {
        // default to Europe/Madrid offset +01:00 (works in ICS as UTC offset)
        dateISO = `${m.date}T${m.time}:00+01:00`;
      }
      const dt = new Date(dateISO);
      events.push({
        type: "timed",
        date: dt,
        summary: `${homeShort} vs ${awayShort} (FEDERADO)`.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO"),
        location
      });
    } else {
      // no exact time -> weekend block.
      // Some matches include a single date or a 'round' date. We'll use date if present, else fallback to calendar week.
      let baseDate = m.date ? new Date(m.date) : new Date();
      // compute Friday of that week (we want Fri-Sun block containing the base date)
      // JS: 0 Sun .. 6 Sat. Target Friday = 5.
      const day = baseDate.getUTCDay(); // use UTC day to avoid TZ shifts
      // find the Friday of that week (UTC)
      const diffToFriday = (5 - day);
      const friday = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()));
      friday.setUTCDate(friday.getUTCDate() + diffToFriday);
      const sunday = new Date(friday);
      sunday.setUTCDate(friday.getUTCDate() + 2);
      events.push({
        type: "weekend",
        start: new Date(friday.getUTCFullYear(), friday.getUTCMonth(), friday.getUTCDate()),
        end: new Date(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate()),
        summary: `${homeShort} vs ${awayShort} (FEDERADO)`.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO"),
        location
      });
    }
  }

  return events;
}

/* ---------------------- IMD (fallback lightweight fetch+parse) ---------------------- */

async function loadIMD() {
  try {
    const res = await fetch("https://imd.sevilla.org/app/jjddmm_resultados/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CalendarioBot/1.0)" },
      timeout: 20000
    });
    const text = await res.text();
    // get body text
    const body = text.replace(/<[^>]+>/g, "\n"); // rough strip tags
    const lines = body.split("\n").map(l => l.trim()).filter(Boolean);

    const events = [];
    // Regex to find lines with date dd/mm/yyyy and time HH:MM and two team names around a dash
    const pattern = /(\d{1,2}\/\d{1,2}\/\d{4}).*?(\d{1,2}:\d{2}).*?(.{2,80}?)\\s[-–]\\s(.{2,80}?)/i;
    for (const l of lines) {
      if (!/FLORES MORADO|CD LAS FLORES SEVILLA MORADO/i.test(l)) continue;
      const m = l.match(pattern);
      if (m) {
        const dateStr = m[1];
        const timeStr = m[2];
        const home = m[3].trim().replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");
        const away = m[4].trim().replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");
        // parse date/time dd/mm/yyyy HH:MM (assume Europe/Madrid +01)
        const [d, M, y] = dateStr.split("/").map(Number);
        const [hh, mm] = timeStr.split(":").map(Number);
        const dt = new Date(Date.UTC(y, M - 1, d, hh - 1 /* convert CET to UTC: -1 */, mm, 0)); // simple UTC adjust
        events.push({
          type: "timed",
          date: dt,
          summary: `${home} vs ${away} (IMD)`,
          location: "Por confirmar"
        });
      }
    }
    return events;
  } catch (e) {
    console.warn("Warning: IMD fetch/parse failed:", e.message || e);
    return []; // avoid failing the entire job
  }
}

/* ---------------------- MAIN ---------------------- */

(async () => {
  try {
    console.log("Loading Federado (GraphQL) from favoley...");
    const fed = await loadFederadoByGraphQL();
    console.log(`Federado matches extracted: ${fed.length}`);

    console.log("Loading IMD (fallback fetch/parse)...");
    const imd = await loadIMD();
    console.log(`IMD matches extracted: ${imd.length}`);

    writeICS("federado.ics", fed, "-//FLORES MORADO//FEDERADO//ES");
    writeICS("imd.ics", imd, "-//FLORES MORADO//IMD//ES");

    console.log("✅ Calendarios escritos: calendarios/federado.ics, calendarios/imd.ics");
  } catch (err) {
    console.error("ERROR in update script:", err && err.message ? err.message : err);
    process.exit(1);
  }
})();
