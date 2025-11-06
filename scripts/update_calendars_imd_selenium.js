const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const IMD_URL = "https://imd.sevilla.org/app/jjddmm_resultados/";

async function waitForAllJornadas(driver, maxWait = 30000) {
  const start = Date.now();
  let lastCount = 0;
  while (Date.now() - start < maxWait) {
    const tables = await driver.findElements(By.css("table.tt"));
    if (tables.length >= 10 && tables.length === lastCount) {
      return tables;
    }
    lastCount = tables.length;
    await driver.sleep(1500);
  }
  return driver.findElements(By.css("table.tt")); // devolver lo que haya
}

async function main() {
  console.log("Cargando calendario IMD (v2.3: esperar todas las jornadas)…");

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
    console.log("🌐 Página IMD abierta: " + IMD_URL);

    const input = await driver.wait(until.elementLocated(By.id("busqueda")), 20000);
    await input.clear();
    await input.sendKeys("las flores", Key.ENTER);
    console.log("⌨️  Texto 'las flores' introducido y búsqueda lanzada con Enter");

    const table = await driver.wait(until.elementLocated(By.css("table.tt")), 20000);
    const rows = await table.findElements(By.css("tbody tr"));
    console.log(`📋 Tabla de equipos encontrada (${rows.length} filas).`);

    let equipoID = null;
    for (const row of rows) {
      const html = await row.getAttribute("innerHTML");
      const text = html.toUpperCase();
      if (text.includes("LAS FLORES SEVILLA MORADO") && text.includes("CADETE FEMENINO")) {
        const match = html.match(/datosequipo\('([^']+)'\)/);
        if (match) equipoID = match[1];
        break;
      }
    }

    if (!equipoID) {
      console.log("⚠️ No se encontró el ID del equipo CD LAS FLORES SEVILLA MORADO (CADETE FEMENINO).");
      return;
    }

    console.log(`✅ ID del equipo obtenido: ${equipoID}`);
    console.log("▶️ Ejecutando datosequipo() directamente...");

    await driver.executeScript(`datosequipo('${equipoID}')`);

    const sel = await driver.wait(until.elementLocated(By.id("seljor")), 20000);
    await driver.wait(until.elementIsVisible(sel), 20000);
    console.log("📅 Desplegable de jornadas detectado.");

    const optionTodas = await sel.findElement(By.css("option[value='']"));
    await optionTodas.click();
    console.log("📊 Seleccionada la opción 'Todas las jornadas'.");

    console.log("⏳ Esperando a que se carguen todas las jornadas...");
    const jornadas = await waitForAllJornadas(driver, 45000);
    console.log(`✅ Se han encontrado ${jornadas.length} tablas de jornadas.`);

  } catch (err) {
    console.error("❌ Error en scraping IMD v2.3:", err.message || err);
  } finally {
    try { if (driver) await driver.quit(); } catch (_) {}
    console.log("🏁 Proceso IMD v2.3 completado.");
  }
}

main();
