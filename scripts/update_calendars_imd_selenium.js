// scripts/update_calendars_imd_selenium.js
const fs = require("fs");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

async function loadIMD() {
  console.log("Cargando calendario IMD (búsqueda avanzada)...");

  let driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(
      new chrome.Options()
        .addArguments("--headless", "--no-sandbox", "--disable-gpu")
    )
    .build();

  try {
    await driver.get("https://imd.sevilla.org/app/jjddmm_resultados/");

    // Buscar "flores"
    const searchBox = await driver.findElement(By.id("busqueda"));
    await searchBox.sendKeys("flores");

    // Esperar a que la tabla cargue
    await driver.wait(until.elementLocated(By.css("table")), 10000);
    const tableHtml = await driver.findElement(By.css("table")).getAttribute("outerHTML");

    // Buscar la fila con el equipo correcto
    const match = tableHtml.match(/datosequipo\('([^']+)'\)[^<]*>CD LAS FLORES SEVILLA MORADO[\s\S]*?CADETE FEMENINO/);
    if (!match) {
      console.warn("⚠️ No se encontró el equipo Cadete Femenino Morado en el listado IMD.");
      return [];
    }

    const equipoId = match[1];
    console.log(`→ Encontrado equipo con ID ${equipoId}`);

    // Ejecutar la función datosequipo() dentro del navegador
    await driver.executeScript(`datosequipo('${equipoId}')`);

    // Esperar a que cargue el calendario
    await driver.wait(until.elementLocated(By.id("seljor")), 10000);

    // Seleccionar "Todas" en el desplegable de jornadas
    const sel = await driver.findElement(By.id("seljor"));
    await sel.findElement(By.xpath("//option[contains(text(),'Todas')]")).click();

    await driver.sleep(2000); // deja cargar todo

    const bodyHtml = await driver.findElement(By.tagName("body")).getAttribute("innerHTML");

    // Extraer jornadas, rivales y fechas
    const matches = [...bodyHtml.matchAll(/<tr[^>]*>\s*<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>/g)]
      .map(m => ({
        jornada: m[1],
        equipoA: m[2],
        equipoB: m[3],
        fecha: m[4]
      }));

    console.log(`→ ${matches.length} partidos encontrados en IMD.`);

    // Guardar como CSV
    fs.mkdirSync("calendarios", { recursive: true });
    fs.writeFileSync("calendarios/imd_partidos.csv", "Jornada,EquipoA,EquipoB,Fecha\n" +
      matches.map(m => `${m.jornada},"${m.equipoA}","${m.equipoB}","${m.fecha}"`).join("\n")
    );

    console.log("✅ Archivo IMD generado: calendarios/imd_partidos.csv");
    return matches;

  } catch (err) {
    console.error("❌ Error en scraping IMD:", err.message);
    return [];
  } finally {
    try { await driver.quit(); } catch {}
  }
}

(async () => {
  const imdMatches = await loadIMD();
  if (!imdMatches.length) console.warn("⚠️ No se encontraron partidos IMD.");
})();
