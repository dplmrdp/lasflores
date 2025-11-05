// scripts/update_calendars_imd_selenium.js
//
// Requisitos en el workflow (añade estos pasos ANTES de ejecutar este script):
//  - uses: actions/setup-node@v4  (ya lo tienes)
//  - uses: browser-actions/setup-chrome@v1
//  - uses: nanasess/setup-chromedriver@v2
//  - npm install selenium-webdriver
//
// Pasos que realiza:
// 1) Abre https://imd.sevilla.org/app/jjddmm_resultados/
// 2) Escribe "las flores" en #busqueda y ejecuta la búsqueda.
// 3) De los equipos listados, hace click en el que contenga: "cadete", "femenino" y "morado" (insensible a acentos/caso).
// 4) En #seljor selecciona "Todas".
// 5) Extrae todas las filas de la tabla resultante, filtrando por el equipo Las Flores (cualquier lado del emparejamiento).
// 6) Si hay fecha/hora exactas -> evento con hora. Si no, intenta encontrar el rango literal de la jornada y crea evento de fin de semana (all-day).
// 7) Genera calendarios/imd.ics

const fs = require("fs");
const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

const IMD_URL = "https://imd.sevilla.org/app/jjddmm_resultados/";
const TEAM_KEYWORDS = ["las", "flores", "morado"]; // para el nombre del equipo
const CATEGORY_KEYWORDS = ["cadete", "femenino"]; // para la categoría

// ---------- utilidades ----------
function normalize(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function hasAll(haystack, words) {
  const H = normalize(haystack);
  return words.every((w) => H.includes(normalize(w)));
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
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function parseDateTime(text) {
  // dd/mm/yyyy hh:mm
  const m = (text || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [_, d, M, Y, h, min] = m;
  return new Date(`${Y}-${M}-${d}T${h}:${min}:00+01:00`);
}

function parseDdmmyyyy(s) {
  const m = (s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [_, d, M, Y] = m;
  return new Date(`${Y}-${M}-${d}T00:00:00+01:00`);
}

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
      // DTEND no inclusivo
      ics += `BEGIN:VEVENT
SUMMARY:${evt.summary}
LOCATION:${evt.location}
DTSTART;VALUE=DATE:${fmtICSDate(evt.start)}
DTEND;VALUE=DATE:${fmtICSDate(addDays(evt.end, 1))}
END:VEVENT
`;
    }
  }

  ics += "END:VCALENDAR\n";

  fs.mkdirSync("calendarios", { recursive: true });
  fs.writeFileSync(`calendarios/${filename}`, ics);
}

// ---------- scraping principal con Selenium ----------
async function loadIMDWithSelenium() {
  console.log("Cargando calendario IMD (Selenium)...");
  const options = new chrome.Options()
    .addArguments("--headless=new")
    .addArguments("--disable-gpu")
    .addArguments("--no-sandbox")
    .addArguments("--disable-dev-shm-usage")
    .addArguments("--window-size=1280,2000");

  const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();

  try {
    await driver.get(IMD_URL);

    // 1) Buscar "las flores" en #busqueda
    const search = await driver.wait(until.elementLocated(By.css("#busqueda")), 15000);
    await search.clear();
    await search.sendKeys("las flores", Key.ENTER);

    // A veces hay botón de buscar; intentamos pulsarlo si existe
    setTimeout(async () => {
      try {
        const btn = await driver.findElement(By.css("button, #button"));
        await btn.click();
      } catch {}
    }, 300);

    // 2) Esperar a que se liste el bloque de equipos (cualquier elemento clicable con texto)
    // Intentaremos capturar enlaces/botones de equipos
    await driver.wait(async () => {
      const links = await driver.findElements(By.css("a, button, .equipo, .team, .list-group-item"));
      return links.length > 0;
    }, 15000);

    // Buscar el equipo exacto: nombre con "las flores" y "morado", en categoría "cadete femenino"
    const candidates = await driver.findElements(By.css("a, button, .equipo, .team, .list-group-item"));
    let chosen = null;

    for (const el of candidates) {
      const txt = normalize(await el.getText());
      if (hasAll(txt, TEAM_KEYWORDS) && hasAll(txt, CATEGORY_KEYWORDS)) {
        chosen = el;
        break;
      }
    }

    if (!chosen) {
      console.warn("⚠️ No se encontró el equipo Cadete Femenino MORADO en el listado.");
      return [];
    }

    await chosen.click();

    // 3) Seleccionar "Todas" en #seljor
    const sel = await driver.wait(until.elementLocated(By.css("#seljor")), 15000);
    // Las opciones podrían tardar en poblarse
    await driver.wait(until.elementTextContains(sel, "Todas"), 10000).catch(() => {});
    // Selección por valor o por texto visible
    await driver.executeScript(`
      const s = document.querySelector('#seljor');
      if (!s) return;
      let idx = -1;
      for (let i=0; i<s.options.length; i++){
        const t = (s.options[i].textContent || '').trim().toLowerCase();
        if (t === 'todas') { idx = i; break; }
      }
      if (idx >= 0) { s.selectedIndex = idx; s.dispatchEvent(new Event('change', {bubbles:true})); }
    `);

    // Esperar a que carguen todas las filas de todas las jornadas
    await driver.sleep(1500);

    // 4) Extraer bloques por jornada (si existen encabezados), y filas de partidos
    // Intentaremos localizar secciones que contengan "Jornada" y una tabla posterior
    const html = await driver.getPageSource();

    // Partiremos en "Jornada" para intentar extraer RANGO de cada jornada si aparece
    const sections = html.split(/<h2[^>]*>[\s\S]*?Jornada[\s\S]*?<\/h2>/i); // split no conserva el h2
    // Para no perder el h2, mejor capturamos todas las parejas h2 + bloque siguiente
    const jourMatches = [...html.matchAll(/(<h2[^>]*>[\s\S]*?Jornada[\s\S]*?<\/h2>)([\s\S]*?)(?=<h2[^>]*>|\Z)/gi)];

    const events = [];

    for (const jm of jourMatches) {
      const h2 = jm[1];
      const block = jm[2];

      // Buscar rango literal de jornada: (dd/mm/yy – dd/mm/yy) o (dd/mm/yyyy – dd/mm/yyyy)
      const range = h2.match(/\((\d{2}\/\d{2}\/\d{2,4})[^)]*?(\d{2}\/\d{2}\/\d{2,4})\)/);
      let rangeStart = null;
      let rangeEnd = null;
      if (range) {
        const startStr = range[1];
        const endStr = range[2];
        // normalizamos a dd/mm/yyyy
        const toYYYY = (s) =>
          s.replace(/\/(\d{2})$/, (m, yy) => `/${Number(yy) >= 70 ? "19" + yy : "20" + yy}`);
        rangeStart = parseDdmmyyyy(startStr.length === 8 ? toYYYY(startStr) : startStr);
        rangeEnd = parseDdmmyyyy(endStr.length === 8 ? toYYYY(endStr) : endStr);
      }

      // Tomar la primera tabla del bloque (si existe)
      const tableMatch = block.match(/<table[\s\S]*?<\/table>/i);
      if (!tableMatch) continue;

      const rows = tableMatch[0].split(/<tr[^>]*>/i).slice(1);
      for (const row of rows) {
        // Extraer columnas de forma genérica, limpiando HTML
        const cols = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
          (m[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        );
        if (cols.length < 5) continue;

        // Heurística IMD (suele ser): Fecha | Hora | Equipo Local | Equipo Visitante | Lugar | ...
        const [fechaCol, horaCol, localCol, visitCol, lugarCol] = cols;

        // Filtrar por equipo Las Flores MORADO
        const enPartido =
          hasAll(localCol, ["flores"]) || hasAll(visitCol, ["flores"]);
        const morado =
          hasAll(localCol, ["morado"]) || hasAll(visitCol, ["morado"]);
        const cadFemEnAlgunaParte =
          hasAll(localCol + " " + visitCol, CATEGORY_KEYWORDS) ||
          hasAll(h2, CATEGORY_KEYWORDS); // a veces la categoría está en el encabezado

        if (!enPartido || !morado || !cadFemEnAlgunaParte) continue;

        const lugar = lugarCol || "Por confirmar";
        const summary = `${localCol} vs ${visitCol}`;

        // Si hay fecha y hora, evento con hora
        const fechaTexto = `${fechaCol || ""} ${horaCol || ""}`.trim();
        const dt = parseDateTime(fechaTexto);

        if (dt) {
          events.push({ type: "timed", summary, location: lugar, start: dt });
        } else if (rangeStart && rangeEnd) {
          // Sin hora -> usamos el rango literal de esa jornada (all-day)
          events.push({
            type: "allday",
            summary,
            location: lugar,
            start: rangeStart,
            end: rangeEnd,
          });
        } else {
          // Si no hay rango visible, ignoramos para no inventar fechas
          continue;
        }
      }
    }

    console.log(`→ ${events.length} partidos encontrados en IMD (Selenium)`);
    return events;
  } finally {
    await driver.quit();
  }
}

// ---------- main ----------
(async () => {
  try {
    const events = await loadIMDWithSelenium();
    if (!events.length) {
      console.warn("⚠️ No se encontraron partidos del equipo en IMD.");
      process.exit(0);
      return;
    }
    writeICS("imd.ics", events);
    console.log(`✅ Calendario IMD actualizado con ${events.length} partidos.`);
  } catch (err) {
    console.warn("⚠️ ERROR no crítico en IMD (se mantiene el .ics anterior):", err.message || err);
    process.exit(0);
  }
})();
