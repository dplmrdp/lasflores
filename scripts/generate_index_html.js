// scripts/generate_index_html.js
const TEMPLATE_DIR = "templates";
const fs = require("fs");
const path = require("path");
const { normalizeTeamDisplay } = require("./team_name_utils");

const OUTPUT_HTML = "index.html";
const CALENDAR_DIR = "calendarios";
const EQUIPOS_DIR = "equipos";
const BASE_WEBCAL_HOST = "dplmrdp.github.io";
const BASE_REPO_PATH = "lasflores";

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

// ===========================
//  Detectar color normalizado
// ===========================
function detectColorNorm(name) {
  if (!name) return "";
  const up = name.toUpperCase();
  if (up.includes("MORADO")) return "MORADO";
  if (up.includes("AMARILLO")) return "AMARILLO";
  if (up.includes("PÚRPURA") || up.includes("PURPURA")) return "PÚRPURA";
  if (up.includes("ALBERO")) return "ALBERO";
  return "";
}

// ===========================
//  Iconos
// ===========================
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

// ===========================
function getIconForTeam(team) {
  const up = (team || "").toUpperCase();
  const isEVB = up.startsWith("EVB");
  const color = detectColorNorm(up);

  const keyExact = (isEVB ? "EVB " : "") + "LAS FLORES" + (color ? ` ${color}` : "");
  if (TEAM_ICONS[keyExact]) return TEAM_ICONS[keyExact];

  const keyBase = "LAS FLORES" + (color ? ` ${color}` : "");
  if (TEAM_ICONS[keyBase]) return TEAM_ICONS[keyBase];

  return TEAM_ICONS["LAS FLORES"];
}

// ===========================
//  Categoría por filename
// ===========================
function detectCategoryFromFilename(filename) {
  const f = filename.toLowerCase();
  if (f.includes("benjamin")) return "BENJAMÍN";
  if (f.includes("alevin")) return "ALEVÍN";
  if (f.includes("infantil")) return "INFANTIL";
  if (f.includes("cadete")) return "CADETE";
  if (f.includes("juvenil")) return "JUVENIL";
  if (f.includes("junior")) return "JUNIOR";
  if (f.includes("senior")) return "SENIOR";
  return "OTROS";
}

// ===========================
//  Orden de equipos
// ===========================
function sortTeams(a, b) {
  const A = a.team.toUpperCase();
  const B = b.team.toUpperCase();

  const aIsEVB = A.startsWith("EVB");
  const bIsEVB = B.startsWith("EVB");
  if (aIsEVB !== bIsEVB) return aIsEVB ? 1 : -1;

  const order = ["", "MORADO", "AMARILLO", "PÚRPURA", "ALBERO"];
  const colA = detectColorNorm(A);
  const colB = detectColorNorm(B);

  const idxA = order.indexOf(colA);
  const idxB = order.indexOf(colB);
  if (idxA !== idxB) return idxA - idxB;

  return A.localeCompare(B, "es");
}

// ===========================
function toPosix(p) {
  return p.split(path.sep).join("/");
}

// ===========================
//  Recopilar archivos .ics
// ===========================
function collectCalendars() {
  if (!fs.existsSync(CALENDAR_DIR)) return {};
  const all = fs.readdirSync(CALENDAR_DIR).filter(f => f.endsWith(".ics"));
  const data = {};

  for (const file of all) {
    const competition = file.startsWith("federado_") ? "FEDERADO" : "IMD";
    const category = detectCategoryFromFilename(file);

    const clean = file
      .replace(/^federado_/, "")
      .replace(/^imd_/, "")
      .replace(/\.ics$/i, "")
      .replace(/_/g, " ")
      .toUpperCase();

    const rawName = clean.replace(category.toUpperCase(), "").trim();
    const pretty = normalizeTeamDisplay(rawName);

    const filePath = path.join(CALENDAR_DIR, file);
    const fileUrlPath = toPosix(filePath);
    const slug = file.replace(/\.ics$/i, "");

    if (!data[category]) data[category] = { FEDERADO: [], IMD: [] };

    data[category][competition].push({
      team: pretty,
      filename: file,
      path: filePath,
      urlPath: fileUrlPath,
      slug
    });
  }

  return data;
}

// =======================================================
//  PLACEHOLDERS DE CLASIFICACIÓN
// =======================================================
function buildPlaceholderClasificacion(team) {
  const rows = [
    { team: team, pts: 12, j: 6, g: 4, p: 2 },
    { team: "EVB LAS FLORES", pts: 9, j: 6, g: 3, p: 3 },
    { team: "Rival 1", pts: 7, j: 6, g: 2, p: 4 },
  ];

  return rows
    .map(
      r => `
<div class="fila">
  <span class="equipo">${escapeHtml(r.team)}</span>
  <span class="datos">${r.pts} pts · J${r.j} · G${r.g} · P${r.p}</span>
</div>`
    )
    .join("\n");
}

// =======================================================
//  PLACEHOLDERS DE PRÓXIMOS PARTIDOS
// =======================================================
function buildPlaceholderProximos(team) {
  return `
<div class="partido">
  <div class="fecha">Sáb 18 — 12:00</div>
  <div class="vs">${escapeHtml(team)} vs Rival X</div>
</div>
<div class="partido">
  <div class="fecha">Dom 19 — 10:00</div>
  <div class="vs">Rival Y vs ${escapeHtml(team)}</div>
</div>`;
}

// =======================================================
//  GENERAR PÁGINA INDIVIDUAL
// =======================================================
function generateTeamPage({ team, category, competition, urlPath, slug, iconPath }) {
  const title = `${team} – ${category} (${competition})`;
  const webcalUrl = `webcal://${BASE_WEBCAL_HOST}/${BASE_REPO_PATH}/${encodeURI(urlPath)}`;

  const templatePath = path.join(TEMPLATE_DIR, "equipo.html");
  let tpl = fs.readFileSync(templatePath, "utf8");

  // insertar datos reales
  tpl = tpl
    .replace(/{{title}}/g, escapeHtml(title))
    .replace(/{{team}}/g, escapeHtml(team))
    .replace(/{{category}}/g, escapeHtml(category))
    .replace(/{{competition}}/g, escapeHtml(competition))
    .replace(/{{icon}}/g, iconPath)
    .replace(/{{webcal}}/g, webcalUrl)
    .replace(/{{clasificacion}}/g, buildPlaceholderClasificacion(team))
    .replace(/{{proximosPartidos}}/g, buildPlaceholderProximos(team));

  const outDir = EQUIPOS_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, `${slug}.html`), tpl, "utf8");
}

// =======================================================
//  ESCAPAR HTML
// =======================================================
function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =======================================================
//  GENERAR INDEX PRINCIPAL
// =======================================================
function generateHTML(calendars) {
  if (!fs.existsSync(EQUIPOS_DIR)) fs.mkdirSync(EQUIPOS_DIR, { recursive: true });

  let html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Calendarios C.D. Las Flores</title>
<link rel="stylesheet" href="style.css">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body>
<div class="container">
<h1>Calendarios C.D. Las Flores</h1>
`;

  for (const category of CATEGORIES_ORDER) {
    if (!calendars[category]) continue;

    html += `<section class="category-block"><h2 class="category-title">${category}</h2>`;

    for (const comp of ["FEDERADO", "IMD"]) {
      const teams = calendars[category][comp];
      if (!teams || !teams.length) continue;

      html += `<div class="competition"><h3 class="competition-title">${comp}</h3><ul class="team-list">`;
      teams.sort(sortTeams);

      for (const t of teams) {
        const icon = getIconForTeam(t.team);
        const page = `equipos/${t.slug}.html`;

        generateTeamPage({
          team: t.team,
          category,
          competition: comp,
          urlPath: t.urlPath,
          slug: t.slug,
          iconPath: icon,
        });

        html += `
<li class="team-item">
  <img class="team-icon" src="${icon}" alt="${escapeHtml(t.team)}" />
  <a class="team-link" href="${page}">${escapeHtml(t.team)}</a>
</li>`;
      }

      html += `</ul></div>`;
    }

    html += `</section>`;
  }

  html += `
</div>
</body>
</html>`;

  fs.writeFileSync(OUTPUT_HTML, html, "utf8");
  console.log("✅ index.html generado correctamente.");
}

// =======================================================
(function main() {
  try {
    console.log("📋 Generando index.html con plantilla y páginas /equipos/ estilo app…");
    const calendars = collectCalendars();
    generateHTML(calendars);
  } catch (err) {
    console.error("❌ ERROR GENERAL:", err);
    process.exit(1);
  }
})();
