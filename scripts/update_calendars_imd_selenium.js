const fs = require("fs");
const { Builder, By, until } = require("selenium-webdriver");
require("chromedriver");

function norm(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function loadIMD() {
  console.log("Cargando calendario IMD (tabla de equipos)…");
  const driver = await new Builder().forBrowser("chrome").build();

  try {
    // Ir a la web principal
    await driver.get("https://imd.sevilla.org/app/jjddmm_resultados/");
    await driver.manage().setTimeouts({ implicit: 10000 });

    // Inyectar la búsqueda directamente en el buscador
    console.log("➡️ Buscando equipos que contengan 'flores'…");
    await driver.executeScript('document.getElementById("busqueda").value = "flores";');
    await driver.executeScript("buscarequipo()");

    // Esperar a que aparezca la tabla
    await driver.wait(until.elementLocated(By.css("table.tt")), 10000);
    const table = await driver.findElement(By.css("table.tt"));
    const rows = await table.findElements(By.css("tbody tr"));
    console.log(`🔍 Se han encontrado ${rows.length} filas en la tabla.`);

    let clicked = false;
    for (const row of rows) {
      const cells = await row.findElements(By.css("td.cc"));
      if (cells.length < 3) continue;

      const teamName = norm(await cells[0].getText());
      const category = norm(await cells[2].getText());
      console.log(`• Fila detectada: [${teamName}] | [${category}]`);

      if (
        teamName.includes("flores") &&
        teamName.includes("morado") &&
        category.includes("cadete") &&
        category.includes("femenino")
      ) {
        console.log(`✅ Fila encontrada: ${teamName} (${category})`);
        const link = await cells[0].findElement(By.css("a[onclick^='datosequipo(']"));
        await driver.executeScript("arguments[0].click();", link);
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      console.warn("⚠️ No se encontró la fila 'CD LAS FLORES SEVILLA MORADO' (Cadete Femenino).");
      return [];
    }

    // Esperar a que aparezca el selector de jornadas
    console.log("🕐 Esperando a que se cargue el desplegable de jornadas...");
    const sel = await driver.wait(until.elementLocated(By.id("seljor")), 15000);

    // Seleccionar "Todas"
    await driver.executeScript(`
      const sel = document.getElementById("seljor");
      if (sel) {
        sel.value = "T";
        sel.dispatchEvent(new Event("change"));
      }
    `);

    console.log("✅ Seleccionada la opción 'Todas'.");

    // Esperar unos segundos a que se carguen los partidos
    await driver.sleep(5000);

    // Aquí iría el código de scraping de los partidos y exportación del .ics
    console.log("🕐 (Scraping de jornadas pendiente de implementar)");

    return []; // De momento devolvemos vacío

  } catch (err) {
    console.error("❌ Error al cargar la tabla IMD:", err.message);
    return [];
  } finally {
    await driver.quit();
  }
}

// ----------- MAIN -----------
(async () => {
  const imdEvents = await loadIMD();
  if (!imdEvents.length) {
    console.warn("⚠️ No se encontraron partidos IMD.");
  } else {
    console.log(`✅ Calendario IMD actualizado con ${imdEvents.length} partidos.`);
  }
})();
