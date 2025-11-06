const fs = require("fs");
const { Builder, By, until } = require("selenium-webdriver");
require("chromedriver");

const IMD_URL = "[https://imd.sevilla.org/app/jjddmm_resultados/](https://imd.sevilla.org/app/jjddmm_resultados/)";
const TEAM_NAME = "CD LAS FLORES SEVILLA MORADO";
const TEAM_COLOR = "#bfd0d9";

function fmtICSDateTime(dt) {
return dt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function writeICS(filename, events) {
let ics = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
PRODID:-//Las Flores Morado//Calendario IMD//ES
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
fs.writeFileSync(`calendarios/${filename}`, ics);
}

async function loadIMD() {
console.log("Cargando calendario IMD (tabla de equipos)...");

let driver = await new Builder().forBrowser("chrome").build();
const events = [];

try {
console.log("Navegador Chrome iniciado correctamente");
await driver.get(IMD_URL);
console.log(`Página IMD abierta: ${IMD_URL}`);

```
const input = await driver.wait(until.elementLocated(By.id("busqueda")), 15000);
console.log("Cuadro de búsqueda encontrado");

await input.sendKeys("las flores");
console.log("Texto 'las flores' introducido y búsqueda lanzada");

const table = await driver.wait(until.elementLocated(By.css("table.tt")), 15000);
console.log("Tabla de equipos encontrada y cargada");

const rows = await table.findElements(By.css("tbody tr"));
console.log(`Se han encontrado ${rows.length} filas en la tabla.`);

let targetRow = null;
for (const row of rows) {
  const text = (await row.getText()).toUpperCase();
  if (text.includes("LAS FLORES SEVILLA MORADO") && text.includes("CADETE FEMENINO")) {
    targetRow = row;
    break;
  }
}

if (!targetRow) {
  console.warn(`No se encontró la fila '${TEAM_NAME}' (Cadete Femenino).`);
  return [];
}

console.log(`Fila encontrada: ${TEAM_NAME} (Cadete Femenino)`);

const link = await targetRow.findElement(By.css("a"));
await link.click();

const sel = await driver.wait(until.elementLocated(By.id("seljor")), 15000);
await sel.sendKeys("Todas");
console.log("Desplegable de jornadas ajustado a 'Todas'");

await driver.wait(until.elementsLocated(By.css("table.tt")), 20000);
const tables = await driver.findElements(By.css("table.tt"));
console.log(`Se han detectado ${tables.length} tablas de jornada.`);

for (const table of tables) {
  const rows = await table.findElements(By.css("tbody tr"));

  for (let i = 1; i < rows.length; i++) {
    const tds = await rows[i].findElements(By.css("td"));
    if (tds.length < 6) continue;

    const bgColors = await Promise.all(tds.map(td => td.getAttribute("bgcolor")));
    const isMoradoRow = bgColors.some(c => c && c.toLowerCase() === TEAM_COLOR);

    if (!isMoradoRow) continue;

    const fecha = (await tds[0].getText()).trim();
    const hora = (await tds[1].getText()).trim();
    const local = (await tds[2].getText()).trim();
    const visitante = (await tds[3].getText()).trim();
    const lugar = (await tds[5].getText()).trim();

    const [d, m, y] = fecha.split("/");
    const [hh, mm] = hora.split(":");
    const date = new Date(`${y}-${m}-${d}T${hh}:${mm}:00+01:00`);

    const summary = `${local} vs ${visitante}`;

    events.push({
      summary,
      location: lugar || "Por confirmar",
      start: date
    });
  }
}

console.log(`Se han encontrado ${events.length} partidos del ${TEAM_NAME}`);
return events;
```

} catch (e) {
console.error("Error en scraping IMD:", e.message);
return [];
} finally {
await driver.quit();
console.log(`Proceso IMD completado con ${events.length} partidos.`);
}
}

(async () => {
const imd = await loadIMD();
if (imd.length > 0) {
writeICS("imd.ics", imd);
console.log("Calendario IMD guardado en calendarios/imd.ics");
} else {
console.warn("No se encontraron partidos IMD.");
}
})();
