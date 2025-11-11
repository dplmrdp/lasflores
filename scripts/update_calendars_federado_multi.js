// scripts/update_calendars_federado_multi.js
// Scraper federado multi (FAVOLE) → genera 1 ICS por cada equipo "LAS FLORES"
// en cada grupo de cada torneo femenino Sevilla (temporada 2025/26).
//
// Estrategia sólida:
// 1) Lista de torneos (URL con filtros) → leemos la tabla server-side.
// 2) Para cada torneo, abrimos /es/tournament/{id} y leemos <select name="group">.
// 3) Para cada groupId, abrimos /calendar/{groupId}/all y parseamos filas.
// 4) Por cada equipo que contenga "LAS FLORES" generamos un ICS con sus partidos.
//
// Debug:
// - Guarda snapshots HTML en calendarios/debug.
// - Guarda log en calendarios/logs.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

// --- Config ---
const BASE_LIST_URL = "https://favoley.es/es/tournaments?season=8565&category=&sex=2&sport=&tournament_status=&delegation=1630";
const OUTPUT_DIR = path.join("calendarios");
const DEBUG_DIR = path.join(OUTPUT_DIR, "debug");
const LOG_DIR = path.join(OUTPUT_DIR, "logs");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = path.join(LOG_DIR, `federado_${RUN_STAMP}.log`);

const TEAM_NEEDLE = "las flores";
const ICS_TZID = "Europe/Madrid";

// --- Utilidades ---
function log(line) {
  const msg = typeof line === "string" ? line : JSON.stringify(line);
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
function onError(err, ctx = "UNSPECIFIED") {
  log(`❌ ERROR (${ctx}): ${err && err.stack ? err.stack : err}`);
}
function normalize(s) {
  return (s || "").toString().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normLower(s) { return normalize(s).toLowerCase(); }
function slug(s) {
  return normalize(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
function parseDateDDMMYYYY(s) {
  const m = (s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, MM, yyyy] = m;
  return { yyyy, MM, dd };
}
function parseTimeHHMM(s) {
  const m = (s || "").match(/(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, HH, mm] = m;
  return { HH, mm };
}
function toLocalDate({ yyyy, MM, dd }, timeOrNull) {
  // Usamos la hora tal cual (local) con TZID en ICS (sin Z)
  const h = timeOrNull ? `${timeOrNull.HH}:${timeOrNull.mm}` : "00:00";
  return new Date(`${yyyy}-${MM}-${dd}T${h}:00`);
}
function fmtICSDateTimeTZID(dt) {
  const pad = n => String(n).padStart(2, "0");
  return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
}
function fmtICSDateUTC(d) {
  const Y = d.getUTCFullYear(), M = String(d.getUTCMonth()+1).padStart(2,"0"), D = String(d.getUTCDate()).padStart(2,"0");
  return `${Y}${M}${D}`;
}
function writeICS(filename, events) {
  let ics = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//Las Flores//Calendarios Federado//ES
`;
  for (const evt of events) {
    if (evt.type === "timed") {
      ics += `BEGIN:VEVENT
SUMMARY:${evt.summary}
LOCATION:${evt.location || ""}
DTSTART;TZID=${ICS_TZID}:${fmtICSDateTimeTZID(evt.start)}
DESCRIPTION:${evt.description || ""}
END:VEVENT
`;
    } else {
      ics += `BEGIN:VEVENT
SUMMARY:${evt.summary}
LOCATION:${evt.location || ""}
DTSTART;VALUE=DATE:${fmtICSDateUTC(evt.start)}
DTEND;VALUE=DATE:${fmtICSDateUTC(evt.end)}
DESCRIPTION:${evt.description || ""}
END:VEVENT
`;
    }
  }
  ics += "END:VCALENDAR\n";
  const out = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(out, ics);
  log(`✅ ICS escrito: ${out} (${events.length} eventos)`);
}

// --- Descubrir torneos desde la tabla (server-side) ---
async function discoverTournamentIds(driver) {
  log(`🌐 Página base: ${BASE_LIST_URL}`);
  await driver.get(BASE_LIST_URL);

  // Guarda snapshot SIEMPRE para depurar si algo cambia
  const html0 = await driver.getPageSource();
  const listSnap = path.join(DEBUG_DIR, `fed_list_debug_${RUN_STAMP}.html`);
  fs.writeFileSync(listSnap, html0);
  log(`📄 Snapshot lista guardado en: ${listSnap}`);

  // Espera a que exista la tabla de resultados
  await driver.wait(until.elementLocated(By.css("table.tabletype-public tbody")), 15000).catch(() => {});

  // Seleccionamos las filas visibles del listado
  let trs = [];
  try {
    trs = await driver.findElements(By.css("table.tabletype-public tbody tr"));
  } catch {}
  if (!trs || !trs.length) {
    log("⚠️ No se localizaron filas de la tabla de torneos");
  }

  const tournaments = [];
  for (const tr of trs) {
    try {
      // El link con el ID está en el primer TD (colstyle-estado) → a[href*="/tournament/{id}/summary"]
      const a = await tr.findElement(By.css('td.colstyle-estado a[href*="/tournament/"]'));
      const href = await a.getAttribute("href");
      const m = href && href.match(/\/tournament\/(\d+)\//);
      if (!m) continue;
      const id = m[1];

      // Cogemos etiqueta legible del torneo y su categoría
      const nameTd = await tr.findElement(By.css("td.colstyle-nombre"));
      const catTd  = await tr.findElement(By.css("td.colstyle-categoria"));
      const label = (await nameTd.getText()).trim() || `Torneo ${id}`;
      const category = (await catTd.getText()).trim() || "";

      tournaments.push({ id, label, category });
    } catch {
      // fila que no es de datos (cabecera, etc.)
    }
  }

  log(`🔎 Torneos detectados: ${tournaments.length}`);
  return tournaments;
}

// --- Descubrir grupos leyendo <select name="group"> ---
async function discoverGroupIds(driver, tournamentId) {
  const url = `https://favoley.es/es/tournament/${tournamentId}`;
  log(`➡️ Abriendo torneo (solo DOM): ${url}`);
  await driver.get(url);

  // ¿Existe el select de grupos?
  const selectExists = (await driver.findElements(By.css("select[name='group']"))).length > 0;

  if (selectExists) {
    const selectEl = await driver.findElement(By.css("select[name='group']"));
    const options = await selectEl.findElements(By.css("option"));
    const groups = [];
    for (const opt of options) {
      const value = await opt.getAttribute("value");
      if (value) groups.push(value);
    }
    if (groups.length) {
      log(`📌 Grupos detectados: ${groups.map(g => `→ ${g}`).join(" | ")}`);
      return groups; // array de groupId (strings)
    }
  }

  // No hay select: ¿hay calendario inline?
  const inlineRows = await driver.findElements(By.css("#custom-domain-calendar-widget table.tablestyle-e1d9 tbody tr"));
  if (inlineRows.length > 0) {
    log("📌 Calendario inline detectado (sin grupos).");
    return ["__INLINE__"];
  }

  log(`⚠️ No se encontraron grupos ni calendario inline en torneo ${tournamentId}`);
  // Snapshot de ayuda
  try {
    const html = await driver.getPageSource();
    fs.writeFileSync(path.join(DEBUG_DIR, `fed_groups_empty_${tournamentId}.html`), html);
  } catch (_){}
  return [];
}


// ------------------------------------------------------------
// PARSEAR CALENDARIO INLINE (sin grupos) — usa el HTML que me pasaste (tablestyle-e1d9)
// ------------------------------------------------------------
async function parseFederadoInlineCalendar(driver, meta) {
  const pageHTML = await driver.getPageSource();
  const fname = `fed_inline_${meta.tournamentId}.html`;
  fs.writeFileSync(path.join(DEBUG_DIR, fname), pageHTML);
  log(`🧩 Snapshot inline guardado: ${fname}`);

  // Seleccionamos filas de la tabla inline
  const rows = await driver.findElements(By.css("#custom-domain-calendar-widget table.tablestyle-e1d9 tbody tr"));
  const matches = [];

  for (const r of rows) {
    try {
      // Equipos: en la celda .colstyle-equipo hay dos spans .ellipsis (local y visitante) con el nombre
      const equiposTd = await r.findElement(By.css("td.colstyle-equipo"));
      const equipos = await equiposTd.findElements(By.css(".ellipsis"));
      if (equipos.length < 2) continue;

      const local = (await equipos[0].getText()).trim();
      const visitante = (await equipos[1].getText()).trim();

      // Fecha / hora / sede: en la celda .colstyle-fecha hay un span con texto tipo:
      // "Vie, 14/11/2025 17:30 GMT+1 PABELLON LA ESTACION"
      const fechaTd = await r.findElement(By.css("td.colstyle-fecha span"));
      const fechaTexto = (await fechaTd.getText()).trim();

      // Extraer fecha y hora
      // dd/mm/yyyy hh:mm (ignoramos el "Vie," y "GMT+1")
      const mFecha = fechaTexto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const mHora = fechaTexto.match(/(\d{2}):(\d{2})/);

      if (!mFecha) continue;
      const fecha = `${mFecha[1]}/${mFecha[2]}/${mFecha[3]}`;
      const hora = mHora ? `${mHora[1]}:${mHora[2]}` : "";

      // Sede: si hay un span.ellipsis al final, úsalo como lugar
      let lugar = "";
      try {
        const lugarSpan = await fechaTd.findElement(By.css(".ellipsis"));
        lugar = (await lugarSpan.getText()).trim();
      } catch (_) {}

      // Resultado: en esta tabla no es imprescindible; lo dejamos vacío
      matches.push({ fecha, hora, local, visitante, lugar, resultado: "" });
    } catch (_) {}
  }

  if (matches.length === 0) {
    log("⚠️ No se detectaron filas en el calendario inline. Revisa el snapshot.");
  }

  // Igual que el parser de grupos: agrupar por cada equipo LAS FLORES
  const teams = new Map();

  for (const m of matches) {
    const localN = normLower(m.local);
    const visitN = normLower(m.visitante);

    // Misma lógica que antes (needle simple). Si quieres, aquí puedes mantener EXACTO el filtro anterior.
    const involve = localN.includes(TEAM_NEEDLE) || visitN.includes(TEAM_NEEDLE);
    if (!involve) continue;

    const teamName = localN.includes(TEAM_NEEDLE) ? m.local : m.visitante;

    const d = parseDateDDMMYYYY(m.fecha);
    if (!d) continue;

    const t = parseTimeHHMM(m.hora);
    const start = toLocalDate(d, t);

    const summary = `${m.local} vs ${m.visitante} (Federado)`;
    const description = ""; // no hay resultado en esta vista

    const evt =
      t != null
        ? { type: "timed", start, summary, location: m.lugar, description }
        : {
            type: "allday",
            start,
            end: new Date(start.getTime() + 86400000),
            summary,
            location: m.lugar,
            description,
          };

    if (!teams.has(teamName)) teams.set(teamName, []);
    teams.get(teamName).push(evt);
  }

  const outFiles = [];
  for (const [teamName, events] of teams.entries()) {
    events.sort((a, b) => a.start - b.start);
    const fnameOut = `federado_${slug(teamName)}_${slug(meta.category)}_${meta.tournamentId}.ics`;
    writeICS(fnameOut, events);
    outFiles.push(fnameOut);
  }

  log(`📦 Generados ${outFiles.length} calendarios inline para torneo=${meta.tournamentId}`);
  if (outFiles.length) log(`↪ ${outFiles.join(", ")}`);
}

// --- Parsear calendario de un grupo ---
async function parseFederadoCalendarPage(driver, meta) {
  const url = `https://favoley.es/es/tournament/${meta.tournamentId}/calendar/${meta.groupId}/all`;
  log(`➡️ Abriendo calendario: ${url}`);
  await driver.get(url);

  // Espera algo tipo tabla/listado
  await driver.wait(until.elementLocated(By.css("table, .table, tbody, .row")), 15000).catch(() => {});
  const pageHTML = await driver.getPageSource();
  const snapName = `fed_${meta.tournamentId}_${meta.groupId}.html`;
  fs.writeFileSync(path.join(DEBUG_DIR, snapName), pageHTML);
  log(`🧩 Snapshot guardado: ${snapName}`);

  // Intento principal: tabla estándar con filas <tr>
  let rows = [];
  try {
    rows = await driver.findElements(By.css("table tbody tr"));
  } catch {}
  if (!rows.length) {
    rows = await driver.findElements(By.css("tr, .table-row, .row"));
  }

  const matches = [];
  for (const r of rows) {
    try {
      const tds = await r.findElements(By.css("td"));
      if (tds.length >= 4) {
        const fecha = (await tds[0].getText()).trim();
        const horaRaw = (await tds[1].getText()).trim();
        const hora = (horaRaw.match(/\d{2}:\d{2}/) || [])[0] || "";
        const local = (await tds[2].getText()).trim();
        const visitante = (await tds[3].getText()).trim();
        const resultado = tds[4] ? (await tds[4].getText()).trim() : "";
        const lugar = tds[5] ? (await tds[5].getText()).trim() : "";

        if (fecha && local && visitante) {
          matches.push({ fecha, hora, local, visitante, lugar, resultado });
        }
      } else {
        // Fallback por texto si hubiera otro formato
        const line = normalize(await r.getText());
        const mDate = line.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (!mDate) continue;
        const fecha = mDate[1];
        const hora = (line.match(/(\d{2}:\d{2})/) || [])[0] || "";
        // Heurística simple para "X vs Y"
        const mVS = line.match(/(.+?)\s+vs\s+(.+?)\s/iu);
        const local = mVS ? normalize(mVS[1]) : "";
        const visitante = mVS ? normalize(mVS[2]) : "";
        if (fecha && local && visitante) {
          matches.push({ fecha, hora, local, visitante, lugar: "", resultado: "" });
        }
      }
    } catch {}
  }

  if (!matches.length) {
    log(`⚠️ t=${meta.tournamentId} g=${meta.groupId}: sin filas detectadas; revisa snapshot.`);
  }

  // Agrupar por equipo LAS FLORES
  const teams = new Map(); // teamName → eventos
  for (const m of matches) {
    const localN = normLower(m.local);
    const visitN = normLower(m.visitante);
    if (!localN.includes(TEAM_NEEDLE) && !visitN.includes(TEAM_NEEDLE)) continue;

    // Para evitar mezclar equipos (Amarillo/Morado, etc.) guardamos por nombre exacto que aparece
    const involvedNames = [];
    if (localN.includes(TEAM_NEEDLE)) involvedNames.push(m.local);
    if (visitN.includes(TEAM_NEEDLE)) involvedNames.push(m.visitante);

    const d = parseDateDDMMYYYY(m.fecha);
    if (!d) { log(`⚠️ Fecha inválida: ${m.fecha}`); continue; }
    const t = parseTimeHHMM(m.hora);
    const start = toLocalDate(d, t);

    const summary = `${m.local} vs ${m.visitante} (Federado)`;
    const description = m.resultado && m.resultado !== "-" ? `Resultado: ${m.resultado}` : "";

    const evt = t
      ? { type: "timed", start, summary, location: m.lugar || "", description }
      : { type: "allday", start, end: new Date(start.getTime() + 86400000), summary, location: m.lugar || "", description };

    for (const teamName of involvedNames) {
      if (!teams.has(teamName)) teams.set(teamName, []);
      teams.get(teamName).push(evt);
    }
  }

  const outFiles = [];
  for (const [teamName, events] of teams.entries()) {
    events.sort((a, b) => a.start - b.start);
    const fname = `federado_${slug(teamName)}_${slug(meta.category)}_${meta.groupId}.ics`;
    writeICS(fname, events);
    outFiles.push(fname);
  }

  log(`📦 Generados ${outFiles.length} calendarios en t=${meta.tournamentId} g=${meta.groupId}`);
  if (outFiles.length) log(`↪ ${outFiles.join(", ")}`);
}

// --- MAIN ---
(async () => {
  log("🏐 Iniciando scraping FEDERADO multi-equipos LAS FLORES…");

  const tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-fed-"));
  const options = new chrome.Options()
    .addArguments("--headless=new")
    .addArguments("--disable-gpu")
    .addArguments("--no-sandbox")
    .addArguments("--disable-dev-shm-usage")
    .addArguments("--lang=es-ES")
    .addArguments("--window-size=1280,1024")
    .addArguments("--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36")
    .addArguments(`--user-data-dir=${tmpUserDir}`);

  let driver;
  try {
    driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();

    // 1) Torneos
    const tournaments = await discoverTournamentIds(driver);
    if (!tournaments.length) {
      log("⚠️ No hay torneos: revisa el snapshot de la lista y la URL de filtros.");
    }

    // 2) Por torneo → grupos → calendario
    for (const t of tournaments) {
      const category = (normalize(t.category) || normalize(t.label)).toUpperCase();
      log(`\n======= 🏷 Torneo ${t.id} :: ${t.label} (cat: ${category}) =======`);

      let groups = [];
      try {
        groups = await discoverGroupIds(driver, t.id); // [{id,label}]
      } catch (e) {
        onError(e, `discoverGroupIds t=${t.id}`);
        continue;
      }
      log(`🔹 Grupos detectados: ${groups.length}${groups.length ? " → ["+groups.join(", ")+"]" : ""}`);

     for (const g of groups) {
  if (g === "__INLINE__") {
    // ✅ Calendario directamente en la página del torneo (caso JUNIOR)
    try {
      await parseFederadoInlineCalendar(driver, {
        tournamentId: t.id,
        groupId: "inline",
        category
      });
    } catch (e) {
      onError(e, `parse inline calendar t=${t.id}`);
    }
    continue;
  }

  // ✅ Flujo normal por groupId
  const calURL = `https://favoley.es/es/tournament/${t.id}/calendar/${g}/all`;
  try {
    log(`➡️ Abriendo calendario: ${calURL}`);
    await driver.get(calURL);
    await driver.wait(until.elementLocated(By.css("table, .table, .row, tbody")), 15000);

    await parseFederadoCalendarPage(driver, {
      tournamentId: t.id,
      groupId: g,
      category,
    });
  } catch (e) {
    onError(e, `parse calendar t=${t.id} g=${g}`);
  }
       // pausa corta entre torneos para no estresar el server
      await driver.sleep(400);
}

    

    log("\n✅ Scraping federado multi-equipos completado.");
  } catch (err) {
    onError(err, "MAIN");
  } finally {
    try { if (driver) await driver.quit(); } catch {}
    log("🧹 Chrome cerrado");
  }
})();
