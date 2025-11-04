/**
 * ACTUALIZACIÓN AUTOMÁTICA CALENDARIOS
 * FLORES MORADO (Federado + IMD)
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const TEAM_NAME = "C.D. LAS FLORES SEVILLA MORADO";
const OUTPUT_DIR = "calendarios";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function normalize(name) {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
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

/* --- FEDERADO (FAVOLEY) --- */

function parseFavoleyDateTime(text) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}).*?(\d{1,2}):(\d{2}).*?GMT([+-]\d{1,2})/i);
  if (!m) return null;
  const day = +m[1], month = +m[2], year = +m[3];
  const hour = +m[4], min = +m[5], offset = +m[6];
  const utcMillis = Date.UTC(year, month - 1, day, hour - offset, min, 0);
  return new Date(utcMillis);
}

function parseFavoleyWeekendRange(text) {
  const r = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (!r) return null;
  const d1 = r[1].split("/").map(Number);
  const d2 = r[2].split("/").map(Number);
  const y1 = d1[2] < 100 ? 2000 + d1[2] : d1[2];
  const y2 = d2[2] < 100 ? 2000 + d2[2] : d2[2];
  return {
    start: new Date(y1, d1[1] - 1, d1[0]),
    end: new Date(y2, d2[1] - 1, d2[0])
  };
}

/* --- IMD --- */

function toIMDDate(dateStr, timeStr) {
  const [day, month, year] = dateStr.split("/").map(Number);
  const [h, m] = timeStr.split(":").map(Number);
  return new Date(year, month - 1, day, h, m);
}

/* --- MAIN --- */

(async () => {
  const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();

  /* FEDERADO */
  await page.goto("https://favoley.es/es/tournament/1321417/calendar/3652130/all", { waitUntil: "networkidle2" });
  await page.waitForTimeout(2000);
  const fedText = await page.evaluate(() => document.body.innerText);

  const fedEvents = [];
  fedText.split("\n").forEach((line) => {
    const n = normalize(line);
    if (!n.includes(normalize(TEAM_NAME))) return;

    const dt = parseFavoleyDateTime(line);
    if (dt) {
      const vs = line.split(/ - | – | vs | VS | v /i);
      let home = vs[0]?.trim() ?? TEAM_NAME;
      let away = vs[1]?.trim() ?? TEAM_NAME;
      home = home.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");
      away = away.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");

      fedEvents.push({
        type: "timed",
        date: dt,
        summary: `${home} vs ${away} (FEDERADO)`,
        location: "Por confirmar"
      });
      return;
    }

    const range = parseFavoleyWeekendRange(line);
    if (range) {
      const vs = line.split(/ - | – | vs | VS | v /i);
      let home = vs[0]?.trim() ?? TEAM_NAME;
      let away = vs[1]?.trim() ?? TEAM_NAME;
      home = home.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");
      away = away.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");

      fedEvents.push({
        type: "weekend",
        start: range.start,
        end: range.end,
        summary: `${home} vs ${away} (FEDERADO)`,
        location: "Por confirmar"
      });
      return;
    }
  });

  /* IMD */
  await page.goto("https://imd.sevilla.org/app/jjddmm_resultados/", { waitUntil: "networkidle2" });
  await page.waitForTimeout(2000);
  const imdText = await page.evaluate(() => document.body.innerText);

  const imdEvents = [];
  const pattern = /(\d{1,2}\/\d{1,2}\/\d{4}).*?(\d{1,2}:\d{2}).*?(.+?)\s+-\s+(.+?)\s+(COLEGIO|CD|C\.D\.)/gi;
  let match;
  while ((match = pattern.exec(imdText))) {
    const [_, d, t, homeRaw, awayRaw] = match;
    const home = normalize(homeRaw);
    const away = normalize(awayRaw);

    if (home === normalize(TEAM_NAME) || away === normalize(TEAM_NAME)) {
      const date = toIMDDate(d, t);
      const h = homeRaw.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");
      const a = awayRaw.replace(new RegExp(TEAM_NAME, "i"), "FLORES MORADO");

      imdEvents.push({
        type: "timed",
        date,
        summary: `${h} vs ${a} (IMD)`,
        location: "Por confirmar"
      });
    }
  }

  await browser.close();

  writeICS("federado.ics", fedEvents, "-//FLORES MORADO//FEDERADO//ES");
  writeICS("imd.ics", imdEvents, "-//FLORES MORADO//IMD//ES");

  console.log("✅ Calendarios actualizados automáticamente.");
})();
