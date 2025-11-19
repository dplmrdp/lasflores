// scripts/generate_index_html.js
const fs = require("fs");
const path = require("path");
const { normalizeTeamDisplay } = require("./team_name_utils");

const OUTPUT_HTML = "index.html";
const CALENDAR_DIR = "calendarios";

// orden de categorías en el HTML
const CATEGORIES_ORDER = [
  "BENJAMÍN",
  "ALEVÍN",
  "INFANTIL",
  "CADETE",
  "JUVENIL",
  "JUNIOR",
  "SENIOR",
];

// iconos correctos por color
const TEAM_ICONS = {
  "LAS FLORES": "calendarios/icons/flores.svg",
  "LAS FLORES MORADO": "calendarios/icons/flores-morado.svg",
  "LAS FLORES AMARILLO": "calendarios/icons/flores-amarillo.svg",
  "LAS FLORES PÚRPURA": "calendarios/icons/flores-purpura.svg",
  "LAS FLORES ALBERO": "calendarios/icons/flores-albero.svg",

  "EVB LAS FLORES": "calendarios/icons/flores.svg",
  "EVB LAS FLORES MORADO": "calendarios/icons/flores-morado.svg",
  "EVB LAS FLORES AMARILLO": "calendarios/icons/flores-amarillo.svg",
  "EVB LAS FLORES PÚRPURA": "calendarios/icons/flores-purpura.svg",
  "EVB LAS FLORES ALBERO": "calendarios/icons/flores-albero.svg",
};

function detectCategoryFromFilename(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes("benjamin")) return "BENJAMÍN";
  if (lower.includes("alevin")) return "ALEVÍN";
  if (lower.includes("infantil")) return "INFANTIL";
  if (lower.includes("cadete")) return "CADETE";
  if (lower.includes("juvenil")) return "JUVENIL";
  if (lower.includes("junior")) return "JUNIOR";
  if (lower.includes("senior")) return "SENIOR";
  return "OTROS";
}

// -------------------------
// Detectar color de un nombre ya normalizado
// -------------------------
function detectColorNorm(name) {
  if (name.includes("MORADO")) return "MORADO";
  if (name.includes("AMARILLO")) return "AMARILLO";
  if (name.includes("PÚRPURA") || name.includes("PURPURA")) return "PÚRPURA";
  if (name.includes("ALBERO")) return "ALBERO";
  return ""; // sin color
}

// -------------------------
// Ordenar equipos según tus reglas:
// 1) Sin EVB primero, luego EVB
// 2) Colores: "", MORADO, AMARILLO, PÚRPURA, ALBERO
// -------------------------
function sortTeams(a, b) {
  const nameA = a.team;
  const nameB = b.team;

  const aIsEVB = nameA.startsWith("EVB");
  const bIsEVB = nameB.startsWith("EVB");

  if (aIsEVB !== bIsEVB) return aIsEVB ? 1 : -1; // EVB al final

  const colorOrder = ["", "MORADO", "AMARILLO", "PÚRPURA", "ALBERO"];

  const colA = detectColorNorm(nameA);
  const colB = detectColorNorm(nameB);

  const idxA = colorOrder.indexOf(colA);
  const idxB = colorOrder.indexOf(colB);

  if (idxA !== idxB) return idxA - idxB;

  return nameA.localeCompare(nameB, "es", { sensitivity: "base" });
}

// -------------------------
// Recopilar ficheros .ics
// -------------------------
function collectCalendars() {
  const allFiles = fs.readdirSync(CALENDAR_DIR).filter(f => f.endsWith(".ics"));
  const data = {};

  for (const file of allFiles) {
    const competition = file.startsWith("federado_") ? "FEDERADO" : "IMD";

    const clean = file
      .replace(/^federado_/, "")
      .replace(/^imd_/, "")
      .replace(/\.ics$/, "")
      .replace(/_/g, " ")
      .toUpperCase();

    const parts = clean.split(" ");
    const category = detectCategoryFromFilename(file);


    const rawName = clean.replace(category, "").trim();
    const pretty = normalizeTeamDisplay(rawName);

    if (!data[category]) data[category] = { FEDERADO: [], IMD: [] };

    data[category][competition].push({
      team: pretty,
      path: path.join(CALENDAR_DIR, file),
    });
  }

  return data;
}

// -------------------------
// Generar HTML final
// -------------------------
function generateHTML(calendars) {
  let html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Calendarios C.D. Las Flores</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="container">
<h1>Calendarios C.D. Las Flores</h1>
`;

  for (const category of CATEGORIES_ORDER) {
    if (!calendars[category]) continue;

    html += `<section class="category-block"><h2 class="category-title">${category}</h2>`;

    for (const competition of ["FEDERADO", "IMD"]) {
      const teams = calendars[category][competition];
      if (!teams || !teams.length) continue;

      html += `<div class="competition"><h3 class="competition-title">${competition}</h3><ul class="team-list">`;

      teams.sort(sortTeams);

      for (const { team, path: filePath } of teams) {
        const iconKey =
          Object.keys(TEAM_ICONS).find(k => team.includes(k)) || "LAS FLORES";
        const icon = TEAM_ICONS[iconKey];

        html += `
<li class="team-item">
  <img class="team-icon" src="${icon}" alt="${team}" />
  <a class="team-link" href="${filePath}">${team}</a>
</li>`;
      }

      html += `</ul></div>`;
    }

    html += `</section>`;
  }

  html += `
</div>
</body>
</html>
`;

  fs.writeFileSync(OUTPUT_HTML, html, "utf-8");
  console.log(`✅ index.html generado correctamente.`);
}

// -------------------------
// Main
// -------------------------
(function main() {
  console.log("📋 Generando index.html con nombres normalizados...");
  const calendars = collectCalendars();
  generateHTML(calendars);
})();
