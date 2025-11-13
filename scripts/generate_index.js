const fs = require("fs");
const path = require("path");

const OUTPUT_HTML = "index.html";
const CALENDAR_DIR = "calendarios";

const CATEGORIES_ORDER = [
  "BENJAMÍN",
  "ALEVÍN",
  "INFANTIL",
  "CADETE",
  "JUVENIL",
  "JUNIOR",
  "SENIOR",
];

const TEAM_ORDER = [
  "LAS FLORES",
  "LAS FLORES MORADO",
  "LAS FLORES AMARILLO",
  "LAS FLORES PÚRPURA",
  "LAS FLORES ALBERO",
];

// ✅ tus iconos SVG
const TEAM_ICONS = {
  "LAS FLORES": "icons/flores.svg",
  "LAS FLORES MORADO": "icons/flores morado.svg",
  "LAS FLORES AMARILLO": "icons/flores amarillo.svg",
  "LAS FLORES PÚRPURA": "icons/flores purpura.svg",
  "LAS FLORES ALBERO": "icons/flores albero.svg",
};

// --- Recopilar los ficheros .ics ---
function collectCalendars() {
  const allFiles = fs.readdirSync(CALENDAR_DIR).filter(f => f.endsWith(".ics"));
  const data = {};

  for (const file of allFiles) {
    // Detectar si es IMD o FEDERADO (aunque no empiece con ese texto)
    const competition = file.toLowerCase().includes("imd") ? "IMD" : "FEDERADO";

    // Buscar categoría en el nombre del archivo (INFANTIL, CADETE, etc.)
    const upperName = file.toUpperCase();
    const category =
      CATEGORIES_ORDER.find(cat => upperName.includes(cat)) || "OTROS";

    // Extraer el nombre del equipo
    const teamNameRaw = file
      .replace(/_/g, " ")
      .replace(".ics", "")
      .replace(/FEDERADO|IMD/gi, "")
      .replace(/\.ICS/gi, "")
      .trim();

    const teamName = teamNameRaw.toUpperCase();

    if (!data[category]) data[category] = { FEDERADO: [], IMD: [] };

    data[category][competition].push({
      team: teamName,
      path: path.join(CALENDAR_DIR, file),
    });
  }

  return data;
}

// --- Generar HTML con link al CSS externo ---
function generateHTML(calendars) {
  let html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Calendarios C.D. Las Flores</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<h1>🏐 Calendarios C.D. Las Flores</h1>
`;

  for (const category of CATEGORIES_ORDER) {
    if (!calendars[category]) continue;
    html += `<h2 class="category">${category}</h2>\n`;

    for (const competition of ["FEDERADO", "IMD"]) {
      const teams = calendars[category][competition];
      if (!teams || !teams.length) continue;

      html += `<h3 class="${competition.toLowerCase()}">${competition}</h3>\n<ul class="team-list">\n`;

      teams.sort((a, b) => {
        const ai = TEAM_ORDER.findIndex(t => a.team.includes(t)) ?? 999;
        const bi = TEAM_ORDER.findIndex(t => b.team.includes(t)) ?? 999;
        return ai - bi;
      });

      for (const { team, path: filePath } of teams) {
        const matchedKey = Object.keys(TEAM_ICONS).find(k => team.includes(k));
        const icon = matchedKey ? TEAM_ICONS[matchedKey] : TEAM_ICONS["LAS FLORES"];
        const label = team.replace(/C\.D\./i, "").trim();
        html += `<li><img src="${icon}" alt="${team}" class="icon"><a href="${filePath}">${label}</a></li>\n`;
      }

      html += `</ul>\n`;
    }
  }

  html += `
</body>
</html>
`;
  fs.writeFileSync(OUTPUT_HTML, html, "utf-8");
  console.log(`✅ Archivo HTML generado: ${OUTPUT_HTML}`);
}

// --- Main ---
(function main() {
  console.log("📋 Generando index.html agrupado por categoría...");
  const calendars = collectCalendars();
  generateHTML(calendars);
})();
