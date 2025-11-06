const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

const IMD_URL = "https://imd.sevilla.org/app/jjddmm_resultados/";
const TEAM_KEYWORDS = ["LAS FLORES SEVILLA MORADO", "CADETE FEMENINO"];

async function main() {
  console.log("Cargando calendario IMD (v2: abrir equipo y seleccionar todas las jornadas)…");

  const userDataDir = "/tmp/chrome-profile-" + Date.now();
  const options = new chrome.Options()
    .addArguments("--headless=new")
    .addArguments("--no-sandbox")
    .addArguments("--disable-dev-shm-usage")
    .addArguments("--disable-gpu")
    .addArguments("--window-size=1920,1080")
    .addArguments("--user-data-dir=" + userDataDir);

  let driver;
  try {
    driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
    console.log("✅ Navegador Chrome iniciado correctamente");

    await driver.get(IMD_URL);
    console.log("🌐 Página IMD abierta:", IMD_URL);

    // Buscar el cuadro de búsqueda
    const input = await driver.wait(until.elementLocated(By.id("busqueda")), 20000);
    await input.clear();
    await input.sendKeys("las flores", Key.ENTER);
    console.log("⌨️  Texto 'las flores' introducido y búsqueda lanzada con Enter");

    // Esperar tabla
    const table = await driver.wait(until.elementLocated(By.css("table.tt")), 20000);
    const rows = await table.findElements(By.css("tbody tr"));
    console.log(`📋 Tabla de equipos encontrada (${rows.length} filas).`);

    // Buscar la fila que contiene el equipo correcto
    let foundRow = null;
    for (const row of rows) {
      const text = (await row.getText()).toUpperCase();
      if (TEAM_KEYWORDS.every(k => text.includes(k))) {
        foundRow = row;
        break;
      }
    }

    if (!foundRow) {
      console.warn(`⚠️ No se encontró la fila del equipo ${TEAM_KEYWORDS.join(" / ")}`);
      return;
    }

    console.log("✅ Fila encontrada: CD LAS FLORES SEVILLA MORADO (CADETE FEMENINO)");

    // Hacer clic en la fila
    await foundRow.findElement(By.css("a")).click();
    console.log("🖱️ Click en la fila ejecutado, cargando calendario del equipo...");

    // Esperar el desplegable de jornadas
    const sel = await driver.wait(until.elementLocated(By.id("seljor")), 15000);
    await driver.wait(until.elementIsVisible(sel), 5000);
    console.log("📅 Desplegable de jornadas detectado.");

    // Seleccionar “Todas”
    const optionsEl = await sel.findElements(By.css("option"));
    for (const opt of optionsEl) {
      const txt = (await opt.getText()).trim().toLowerCase();
      if (txt.includes("todas")) {
        await opt.click();
        console.log("✅ Seleccionada opción 'Todas las jornadas'");
        break;
      }
    }

    // Esperar que aparezcan las tablas por jornada
    const jornadaTables = await driver.wait(
      until.elementsLocated(By.css("table.tt")),
      20000
    );
    console.log(`📊 Se han detectado ${jornadaTables.length} tablas de jornadas cargadas.`);

  } catch (err) {
    console.error("❌ Error en scraping IMD v2:", err && err.message ? err.message : err);
  } finally {
    try { if (driver) await driver.quit(); } catch (_) {}
    console.log("🏁 Proceso IMD v2 completado.");
  }
}

main();
