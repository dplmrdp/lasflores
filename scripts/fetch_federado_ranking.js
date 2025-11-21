// scripts/fetch_federado_ranking.js
// Descarga y parsea la clasificación oficial desde favoley.es usando cheerio

const cheerio = require("cheerio");

async function fetchFederadoRanking(tournamentId, groupId) {
  const url = `https://favoley.es/es/tournament/${tournamentId}/ranking/${groupId}`;

  console.log(`   ↪ Descargando clasificación oficial: ${url}`);

  let html;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "es-ES,es;q=0.9"
      }
    });

    if (!res.ok) {
      console.error("❌ Error HTTP:", res.status, res.statusText);
      return null;
    }

    html = await res.text();

  } catch (err) {
    console.error("❌ Error al descargar ranking:", err);
    return null;
  }

  const $ = cheerio.load(html);

  // Tabla estándar
  const rows = $("table tbody tr");

  if (!rows.length) {
    console.warn("⚠️ No se encontraron filas de clasificación en la página");
    return null;
  }

  const result = [];

  rows.each((i, tr) => {
    const teamName = $(tr).find(".colstyle-nombre").text().trim();

    // Si la fila está vacía o es incorrecta, la saltamos
    if (!teamName) return;

    const pts = clean($(tr).find(".colstyle-puntos span").text());
    const pj  = clean($(tr).find(".colstyle-partidos-jugados span").text());
    const pg  = clean($(tr).find(".colstyle-partidos-ganados span").text());
    const pp  = clean($(tr).find(".colstyle-partidos-perdidos span").text());
    const sg  = clean($(tr).find(".colstyle-valor span").text());
    const sp  = clean($(tr).find(".colstyle-contravalor span").text());

    result.push({
      team: teamName,
      pts,
      pj,
      pg,
      pp,
      sg,
      sp
    });
  });

  return result;
}

// Limpia caracteres invisibles, saltos, espacios adicionales
function clean(txt) {
  return (txt || "")
    .replace(/\s+/g, " ")
    .replace(",", ".")       // por si aparece 1,35 → 1.35
    .trim();
}

module.exports = { fetchFederadoRanking };
