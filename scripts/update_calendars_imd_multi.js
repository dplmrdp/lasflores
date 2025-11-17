// scripts/update_calendars_imd_multi.js
// IMD multi-equipos (versión B)
// - Normalización EVB / color via team_name_utils
// - Fix extraer rival correctamente
// - Flags anti-bot, waits robustos, snapshots debug
// - Mantiene nombres de fichero: imd_<categoria>_<teamSlug>.ics

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

// Importar utilidades de nombres (reglas EVB / color / limpieza)
const { normalizeTeamDisplay, normalizeTeamSlug } = require("./team_name_utils");

const IMD_URL = "https://imd.sevilla.org/app/jjddmm_resultados/";
const SEARCH_TERM = "las flores";
const OUTPUT_DIR = path.join("calendarios");
const DEBUG_DIR = path.join(OUTPUT_DIR, "debug");
const LOG_DIR = path.join(OUTPUT_DIR, "logs");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = path.join(LOG_DIR, `imd_multi_${RUN_STAMP}.log`);
const ICS_TZID = "Europe/Madrid";

// Toggle debug via env DEBUG_IMD=1
const DEBUG = process.env.DEBUG_IMD === "1" || process.env.DEBUG_IMD === "true";

function log(...args) {
  const line = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`); } catch(e) {}
}

function snapshot(name, html) {
  if (!DEBUG) return;
  try {
    const p = path.join(DEBUG_DIR, `${RUN_STAMP}_${name}.html`);
    fs.writeFileSync(p, html, "utf8");
    log(`🧩 Snapshot guardado: ${p}`);
  } catch (e) {
    log("⚠️ Error guardando snapshot:", e);
  }
}

function normalize(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLasFloresTeam(name) {
  if (!name) return false;
  return normalize(name).toUpperCase().includes("LAS FLORES");
}

// -------------------- ICS helpers --------------------
function pad(n){ return String(n).padStart(2,"0"); }
function fmtICSDateTimeTZID(dt) {
  // dt is a JS Date (local server time). We want YYYYMMDDTHHMMSS in Europe/Madrid local components.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ICS_TZID,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(dt);

  const y = parts.find(p => p.type === "year").value;
  const mo = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  const H = parts.find(p => p.type === "hour").value;
  const M = parts.find(p => p.type === "minute").value;
  const S = parts.find(p => p.type === "second").value;
  return `${y}${mo}${d}T${H}${M}${S}`;
}

function fmtICSDate(d) {
  // d: JS Date (UTC day considered). Return YYYYMMDD using UTC to avoid TZ shifts for all-day.
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`;
}

function writeICS(fileName, events) {
  let ics = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//Las Flores//Calendarios IMD//ES
`;
  for (const evt of events) {
    if (evt.type === "timed") {
      // evt.start is JS Date
      const dt = fmtICSDateTimeTZID(evt.start);
      ics += `BEGIN:VEVENT
SUMMARY:${escapeICSText(evt.summary)}
LOCATION:${escapeICSText(evt.location || "")}
DTSTART;TZID=${ICS_TZID}:${dt}
DESCRIPTION:${escapeICSText(evt.description || "")}
END:VEVENT
`;
    } else {
      // allday: evt.startDate and evt.endDate are JS Date (UTC midnight)
      const ds = fmtICSDate(evt.startDate);
      // DTEND is exclusive -> add 1 day
      const endPlus = new Date(evt.endDate.getTime());
      endPlus.setUTCDate(endPlus.getUTCDate() + 1);
      const de = fmtICSDate(endPlus);
      ics += `BEGIN:VEVENT
SUMMARY:${escapeICSText(evt.summary)}
LOCATION:${escapeICSText(evt.location || "")}
DTSTART;VALUE=DATE:${ds}
DTEND;VALUE=DATE:${de}
DESCRIPTION:${escapeICSText(evt.description || "")}
END:VEVENT
`;
    }
  }
  ics += "END:VCALENDAR\n";
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), ics);
  log(`✅ ${fileName} (${events.length} eventos)`);
}

function escapeICSText(s) {
  if (!s) return "";
  return String(s).replace(/\r\n/g,'\\n').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}

// -------------------- Robust helpers --------------------
async function waitForElement(driver, locator, timeoutMs = 15000) {
  try {
    return await driver.wait(until.elementLocated(locator), timeoutMs);
  } catch (e) {
    return null;
  }
}

async function safeGetText(el) {
  try { return (await el.getText()).trim(); } catch(e) { return ""; }
}

// -------------------- Main scraping logic --------------------
(async () => {
  log("🌼 Iniciando generación de calendarios IMD para equipos LAS FLORES (versión B)...");

  // Chrome options optimized to reduce bot detection and to run in GitHub Actions
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-imd-"));
  const options = new chrome.Options()
    .addArguments(
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--lang=es-ES",
      "--window-size=1280,1024",
      "--disable-blink-features=AutomationControlled",
      `--user-data-dir=${tmpDir}`
    )
    // set a common real user-agent
    .addArguments("--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");

  let driver;
  try {
    driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();

    await driver.get(IMD_URL);
    log(`🌐 Página abierta: ${IMD_URL}`);

    // Wait for search input
    const input = await waitForElement(driver, By.id("busqueda"), 10000);
    if (!input) throw new Error("search input #busqueda no encontrado");

    // initial search: buscar por "las flores" para listar equipos y capturar sus filas
    await input.clear();
    await input.sendKeys(SEARCH_TERM, Key.ENTER);
    log(`🔎 Buscando '${SEARCH_TERM}'...`);

    // Wait for results table; selector robust (varios gestores IMD usan id #resultado_equipos)
    const resultadoSelector = By.css("#resultado_equipos tbody tr, .tab-content table tbody tr");
    await driver.wait(until.elementsLocated(resultadoSelector), 12000).catch(() => {});

    // Prefer #resultado_equipos if exists
    let rows = [];
    try {
      rows = await driver.findElements(By.css("#resultado_equipos tbody tr"));
    } catch {}
    if (!rows.length) {
      // fallback: pick rows from main tab table
      try { rows = await driver.findElements(By.css(".tab-content table tbody tr")); } catch {}
    }

    log(`📋 ${rows.length} filas encontradas en tabla de equipos (búsqueda inicial).`);

    const teams = [];

    for (const r of rows) {
      try {
        const tds = await r.findElements(By.css("td"));
        if (tds.length < 2) {
          // sometimes rows are folded; skip
          continue;
        }
        // get visible texts: prefer first td for name, third for category if present
        const name = (await safeGetText(tds[0])).toUpperCase();
        const category = tds[2] ? (await safeGetText(tds[2])).toUpperCase() : "SIN_CATEGORIA";
        // ensure it's a Las Flores team row
        if (name.includes("LAS FLORES")) {
          // try to get an identifying id from row HTML (old pattern: datosequipo('ID'))
          let id = null;
          try {
            const outer = await r.getAttribute("outerHTML");
            const m = outer && outer.match(/datosequipo\(['"]([A-F0-9-]+)['"]\)/i);
            if (m) id = m[1];
          } catch (e) {}
          teams.push({ name: name.trim(), category: category.trim(), id });
        }
      } catch (e) {
        // ignore row parsing errors but log in debug
        if (DEBUG) log("⚠️ error leyendo fila equipos:", e);
      }
    }

    log(`🌸 ${teams.length} equipos LAS FLORES detectados.`);

    // If no teams found, try alternate strategy: search for "LAS FLORES" uppercase using different selector
    if (!teams.length) {
      log("⚠️ No se detectaron equipos en la tabla; intentando estrategia alternativa...");
      const altRows = await driver.findElements(By.css("table.tt tbody tr"));
      for (const r of altRows) {
        try {
          const txt = await r.getText();
          if (txt && txt.toUpperCase().includes("LAS FLORES")) {
            // crude parse: split by newline
            const lines = txt.split("\n").map(l => l.trim()).filter(Boolean);
            const name = lines[0] || "";
            const category = lines[2] || "SIN_CATEGORIA";
            teams.push({ name: name.toUpperCase(), category: category.toUpperCase(), id: null });
          }
        } catch {}
      }
      log(`🌸 (alternativa) ${teams.length} equipos LAS FLORES detectados.`);
    }

    // For each team: query their calendar and extract matches
    for (const team of teams) {
      log(`\n➡️ Procesando ${team.name} (${team.category})...`);

      // perform search by exact name to bring up the team tab (some IMD pages require exact)
      const searchInput = await waitForElement(driver, By.css("#busqueda"), 8000);
      if (!searchInput) {
        log("⚠️ no se encontró input de búsqueda antes de procesar equipo, continuando con siguiente.");
        continue;
      }

      try {
        await searchInput.clear();
        // send the raw team.name as visible on table - keep accents/case as in page for better match
        await searchInput.sendKeys(team.name, Key.ENTER);
      } catch (e) {
        // fallback: set value via script
        try {
          await driver.executeScript(`document.querySelector('#busqueda').value = ${JSON.stringify(team.name)};`);
          await driver.executeScript(`document.querySelector('button[title="Buscar"], button[type="submit"], button').click();`);
        } catch (ee) { log("⚠️ fallo al forzar búsqueda:", ee); }
      }

      // Wait for tab content with tables to appear
      await driver.sleep(800); // short pause
      await driver.wait(until.elementsLocated(By.css(".tab-content table")), 10000).catch(() => {});

      // Collect tables inside tab-content (each competition / temporada)
      let tables = [];
      try { tables = await driver.findElements(By.css(".tab-content table")); } catch(e){ tables = []; }
      log(`📑 ${tables.length} tablas detectadas para ${team.name}`);

      // If none found, try another selector (older markup)
      if (!tables.length) {
        try { tables = await driver.findElements(By.css("table.tt")); } catch(e) { tables = []; }
        log(`📑 (fallback) ${tables.length} tablas detectadas para ${team.name}`);
      }

      // If still none, save page HTML for debugging and continue
      if (!tables.length) {
        try {
          const html = await driver.getPageSource();
          snapshot(`no_tables_${slugifyForDebug(team.name)}`, html);
        } catch (e) {}
        log(`⚠️ No se encontraron tablas de calendario para ${team.name} — saltando.`);
        continue;
      }

      // collect events
      const events = [];

      // iterate tables and rows
      for (const table of tables) {
        let trs = [];
        try { trs = await table.findElements(By.css("tbody tr")); } catch(e) { trs = []; }
        if (!trs.length) {
          // table might be structured differently
          try { trs = await table.findElements(By.css("tr")); } catch(e) { trs = []; }
        }
        for (const tr of trs) {
          try {
            const tds = await tr.findElements(By.css("td"));
            // many IMD tables have >=4 columns: fecha,hora,local,visitante,...
            if (tds.length < 3) continue;

            const fechaRaw = await safeGetText(tds[0]);
            const horaRaw = tds[1] ? await safeGetText(tds[1]) : "";
            // IMPORTANT: robust extraction of local/visitante
            // Some pages nest spans or links; extract text from cell but also try to find .ellipsis/span content first.
            const local = await extractTeamCellText(tds[2]);
            const visitante = tds[3] ? await extractTeamCellText(tds[3]) : "";

            // If local or visitante are empty, try alternative positions (some tables shift)
            let l = local || "";
            let v = visitante || "";
            if (!v && tds.length >= 5) {
              // maybe visitante in td[4]
              v = await extractTeamCellText(tds[4]);
            }
            if (!l && tds.length >= 2) {
              l = await extractTeamCellText(tds[1]) || l;
            }

            if (!l && !v) continue;

            // Parse date/time
            const dParts = parseDate(fechaRaw);
            const tParts = parseTime(horaRaw);

            // Build display names:
            // - If the side is a Las Flores team -> use normalizeTeamDisplay(local)
            // - Otherwise keep opponent raw text (trimmed)
            const displayLocal = isLasFloresTeam(l) ? normalizeTeamDisplay(l) : cleanOpponentName(l);
            const displayVisit = isLasFloresTeam(v) ? normalizeTeamDisplay(v) : cleanOpponentName(v);

            // Fix: if both sides are detected as Las Flores (rare), we attempt to disambiguate:
            // The row may contain full club+category strings, try to prefer the one that matches `team.name` as original
            if (isLasFloresTeam(l) && isLasFloresTeam(v)) {
              // attempt to decide which one is "this" team by comparing to team.name
              const normalizedQuery = normalize(team.name).toUpperCase();
              // if local contains the team.name (or color), keep displayLocal as team; else swap
              if (normalize(l).toUpperCase().includes(normalizedQuery)) {
                // ok
              } else if (normalize(v).toUpperCase().includes(normalizedQuery)) {
                // swap roles so displayLocal shows the specific one
                const tmp = displayLocal;
                displayLocal = displayVisit;
                displayVisit = tmp;
              } else {
                // fallback: append raw category info to both to reduce ambiguity
                displayLocal = `${displayLocal}`;
                displayVisit = `${displayVisit}`;
              }
            }

            const summary = `${displayLocal} vs ${displayVisit} (IMD)`;
            const description = "";

            if (dParts && tParts) {
              // Create a Date object that represents the local Europe/Madrid time accurately.
              // We create a Date by constructing an ISO string with +00:00 and then using Intl to map to TZ.
              // Simpler and robust approach: create a Date using yyyy-mm-ddThh:mm:00 in local (server) time,
              // then convert to correct Europe/Madrid display when writing ICS via fmtICSDateTimeTZID.
              const iso = `${dParts.yyyy}-${dParts.MM}-${dParts.dd}T${tParts.HH}:${tParts.mm}:00`;
              const start = new Date(iso);
              events.push({
                type: "timed",
                summary,
                location: "",
                description,
                start
              });
            } else if (dParts) {
              // all-day event: set UTC midnight dates for start/end
              const startDate = new Date(Date.UTC(parseInt(dParts.yyyy,10), parseInt(dParts.MM,10)-1, parseInt(dParts.dd,10), 0, 0, 0));
              const endDate = new Date(startDate.getTime()); // same-day
              events.push({
                type: "allday",
                summary,
                location: "",
                description,
                startDate,
                endDate
              });
            }
          } catch (errRow) {
            if (DEBUG) log("⚠️ Error procesando fila tabla:", errRow);
            continue;
          }
        }
      } // end for tables

      // sort events: allday first then timed by timestamp
      events.sort((a,b) => {
        if (a.type === "allday" && b.type !== "allday") return -1;
        if (b.type === "allday" && a.type !== "allday") return 1;
        // compare times as ISO strings (timed) or dates
        const as = a.type === "timed" ? a.start.toISOString() : a.startDate.toISOString();
        const bs = b.type === "timed" ? b.start.toISOString() : b.startDate.toISOString();
        return as.localeCompare(bs);
      });

      // filename uses same structure: imd_<categoria>_<teamSlug>.ics
      const catSlug = (team.category || "sin_categoria")
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^\w_]/g, "");
      const teamSlug = normalizeTeamSlug(team.name);
      const filename = `imd_${catSlug}_${teamSlug}.ics`;

      // write ICS using writeICS wrapper
      // adapt events to writer expected shape: transform timed -> {type:'timed', start:Date}
      const writerEvents = events.map(e => {
        if (e.type === "timed") return { type: "timed", start: e.start, summary: e.summary, location: e.location, description: e.description };
        return { type: "allday", startDate: e.startDate, endDate: e.endDate, summary: e.summary, location: e.location, description: e.description };
      });

      writeICS(filename, writerEvents);
      log(`✅ ${team.name} (${team.category}): ${events.length} partidos.`);
    } // end for each team

    log("🧱 Calendarios IMD generados correctamente.");
  } catch (err) {
    log("❌ ERROR IMD:");
    log(err && (err.stack || err));
    if (driver && DEBUG) {
      try {
        const html = await driver.getPageSource();
        snapshot("error_page", html);
      } catch (e) {}
    }
  } finally {
    if (driver) {
      try { await driver.quit(); } catch(e) {}
    }
    log("🧹 Chrome cerrado");
  }
})();

// -------------------- Helpers local --------------------

function parseDate(s) {
  if (!s) return null;
  const m = (s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return { dd: m[1], MM: m[2], yyyy: m[3] };
}
function parseTime(s) {
  if (!s) return null;
  const m = (s || "").match(/(\d{2}):(\d{2})/);
  if (!m) return null;
  return { HH: m[1], mm: m[2] };
}

async function extractTeamCellText(tdElement) {
  // Try common patterns: .ellipsis span, <a>, plain text
  try {
    // prefer visible span.ellipsis
    const ellipses = await tdElement.findElements(By.css(".ellipsis, span, a"));
    for (const el of ellipses) {
      const txt = (await el.getText()).trim();
      if (txt) return txt;
    }
    // fallback to element text
    const full = (await tdElement.getText()).trim();
    return full;
  } catch (e) {
    try {
      return (await tdElement.getText()).trim();
    } catch (ee) {
      return "";
    }
  }
}

function cleanOpponentName(raw) {
  if (!raw) return "";
  // keep diacritics removed, trim, and remove repeated club suffixes like "C.D." etc.
  let n = normalize(raw);
  // remove common noise but keep club name (we DO NOT remove color or EVB here)
  n = n.replace(/\bC\.?D\.?\b/ig, "").replace(/\bCLUB\b/ig, "").replace(/\bVOLEIBOL\b/ig, "").replace(/\s+/g," ").trim();
  return n;
}

function slugifyForDebug(s) {
  return (s || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}
