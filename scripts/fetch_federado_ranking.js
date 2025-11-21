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
    html = await res.text();
  } catch (err) {
    console.error("❌ Error al descargar ranking:", err);
    return null;
  }

  const $ = cheerio.load(html);
  const rows = $("table tbody tr");

  if (!rows.length) {
    console.warn("⚠️ No se encontraron filas de clasificación");
    return null;
  }

  const result = [];

  rows.each((i, tr) => {
    const teamName = $(tr).find(".colstyle-nombre").text().trim();
    const pts = $(tr).find(".colstyle-puntos span").text().trim();
    const pj = $(tr).find(".colstyle-partidos-jugados span").text().trim();
    const pg = $(tr).find(".colstyle-partidos-ganados span").text().trim();
    const pp = $(tr).find(".colstyle-partidos-perdidos span").text().trim();
    const sg = $(tr).find(".colstyle-valor span").text().trim();
    const sp = $(tr).find(".colstyle-contravalor span").text().trim();

    if (teamName) {
      result.push({
        team: teamName,
        pts,
        pj,
        pg,
        pp,
        sg,
        sp
      });
    }
  });

  return result;
}

module.exports = { fetchFederadoRanking };
