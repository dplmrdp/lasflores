const fs = require("fs");
const { Builder, By, until } = require("selenium-webdriver");
require("chromedriver");

// 🏐 Configuración base
const IMD_URL = "[https://imd.sevilla.org/app/jjddmm_resultados/](https://imd.sevilla.org/app/jjddmm_resultados/)";
const TEAM_NAME = "CD LAS FLORES SEVILLA MORADO";
const TEAM_COLOR = "#bfd0d9"; // color que usa IMD para marcar al equipo seleccionado

// Utilidades básicas
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

// 🧩 Función principal
async function loadIMD() {
console.log("Cargando calendario IMD (tabla de equipos)…");

let driver = await new Builder().forBrowser("chrome").build();
const events = [];

try {
console.log("✅ Navegador Chrome iniciado correctamente");
await driver.get(IMD_URL);
console.log(`🌐 Página IMD abierta: ${IMD_URL}`);

```
// Buscar el cuadro de búsqueda
const input = await driver.wait(until.elementLocated(By.id("busqueda")), 15000);
console.log("🔎 Cuadro de búsqueda encontrado");

// Escribir "las flores" y lanzar búsqueda (Enter)
await input.sendKeys("las flores");
console.log("⌨️  Texto 'las flores' introducido y búsqueda lanzada con Enter");

// Esperar a que aparezca la tabla de equipos
const table = await driver.wait(until.elementLocated(By.css("table.tt")), 15000);
console.log("📋 Tabla de equipos encontrada y cargada");

// Buscar filas de la tabla
const rows = await table.findElements(By.css("tbody tr"));
console.log(`🔍 Se han encontrado ${rows.length} filas en la tabla.`);

// Buscar el equipo CD LAS FLORES SEVILLA MORADO (Cadete Femenino)
let targetRow = null;
for (const row of rows) {
  const text = (await row.getText()).toUpperCase();
  if (text.includes("LAS FLORES SEVILLA MORADO") && text.includes("CADETE FEMENINO")) {
    targetRow = row;
    break;
  }
}

if (!targetRow) {
  console.warn(`⚠️ No se encontró la fila '${TEAM_NAME}' (Cadete Femenino).`);
  return [];
}

console.log(`✅ Fila encontrada: ${TEAM_NAME} (Cadete Femenino)`);

// Pu
```
