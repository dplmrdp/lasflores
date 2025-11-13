// scripts/generate_index.js (versión corregida)
const fs = require("fs");
const path = require("path");

const OUTPUT_HTML = "index.html";
const CALENDAR_DIR = "calendarios";
const ICON_DIR = path.join(CALENDAR_DIR, "icons");

// orden deseado de categorías (mayúsculas)
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

function normalizeKey(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toUpperCase();
}

function loadIconsOnce() {
  const map = {};
  if (!fs.existsSync(ICON_DIR)) return map;
  const files = fs.readdirSync(ICON_DIR);
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (![".svg", ".png", ".jpg", ".jpeg", ".webp"].includes(ext)) continue;
    const name = path.basename(f, ext);
    const key = normalizeKey(name);
    map[key] = path.posix.join("calendarios", "icons", f);
  }
  return map;
}

function collectCalendars() {
  const iconsMap = loadIconsOnce();
  const defaultIcon = iconsMap["LAS FLORES"] || path.posix.join("calendarios","icons","flores.svg");
  const data = {};

  if (!fs.existsSync(CALENDAR_DIR)) return data;
  const files = fs.readdirSync(CALENDAR_DIR).filter(f => f.toLowerCase().endsWith(".ics"));

  for (const file of files) {
    const lower = file.toLowerCase();

    // Competición: por prefijo del fichero
    let competition = "FEDERADO";
    if (/^imd[_\-]/i.test(file) || /_imd_/i.test(file) || lower.startsWith("imd_")) competition = "IMD";
    if (/^federado[_\-]/i.test(file) || lower.startsWith("federado_")) competition = "FEDERADO";

    // Intentamos extraer categoría por patrón: prefix_category_rest (ej. federado_alevin_....ics)
    let category = null;
    const catMatch = file.match(/^(?:imd|federado)[_\-]([a-záéíóúüñ]+)[_\-]/i);
    if (catMatch) {
      category = catMatch[1].toUpperCase();
      category = category.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } else {
      // fallback: buscar tokens conocidos dentro del nombre
      const tryCat = file.match(/_(benjamin|alevin|infantil|cadete|juvenil|junior|senior)[_\.\-]/i);
      category = tryCat ? tryCat[1].toUpperCase() : "OTROS";
    }

    // Equipo: heurística: tomar todo lo que quede tras el token categoria y posibles sufijos
    // ejemplo: federado_alevin_c.d._las_flores_sevilla_amarillo.ics
    // quitamos prefijos conocidos
    let rest = file.replace(/^(?:imd|federado)[_\-]/i, "");
    // remove leading category token if present
    rest = rest.replace(new RegExp(`^${category}`, "i"), "");
    // remove common tags
    rest = rest.replace(/(femenino|masculino|cd|evb|_?\.?ics)/gi, " ");
    rest = rest.replace(/[_\-\.\s]+/g, " ").trim();

    // Map to team name: buscar el token 'FLORES' y color
    const restKey = normalizeKey(rest);
    let teamName = null;
    if (restKey.includes("FLORES")) {
      if (restKey.includes("MORADO")) teamName = "LAS FLORES MORADO";
      else if (restKey.includes("AMARILLO")) teamName = "LAS FLORES AMARILLO";
      else if (restKey.includes("PURPURA") || restKey.includes("PURPÚRA")) teamName = "LAS FLORES PÚRPURA";
      else if (restKey.includes("ALBERO")) teamName = "LAS FLORES ALBERO";
      else teamName = "LAS FLORES";
    } else {
      // fallback: usar fragmento legible
      teamName = rest.replace(/\b(femenino|masculino)\b/gi, "").trim() || file;
    }

    if (!data[category]) data[category] = { FEDERADO: [], IMD: [] };

    // elegir icono por teamName (normalizado)
    const iconForTeam = iconsMap[normalizeKey(teamName)] || defaultIcon;

    data[category][competition].push({
      originalFile: file,
      team: teamName,
      href: path.posix.join(CALENDAR_DIR, file),
      icon: iconForTeam,
    });
  }

  // ordenar categorías: mantener todas del orden definido (añadir vacías si no existen)
  for (const cat of Object.keys(data)) {
    for (const comp of ["FEDERADO","IMD"]) {
      data[cat][comp].sort((a,b) => {
        const ai = TEAM_ORDER.indexOf(a.team);
        const bi = TEAM_ORDER.indexOf(b.team);
        if (ai === -1 && bi === -1) return a.team.localeCompare(b.team);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }
  }

  // ensure all categories in order exist (even empty)
  const full = {};
  for (const cat of CATEGORIES_ORDER) {
    full[cat] = data[cat] || { FEDERADO: [], IMD: [] };
  }
  // include any other categories found
  for (const cat of Object.keys(data)) {
    if (!full[cat]) full[cat] = data[cat];
  }

  return full;
}

function generateHTML(calendars) {
  let html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Calendarios - C.D. Las Flores</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="container">
<h1>Calendarios C.D. Las Flores</h1>
`;

  for (const cat of Object.keys(calendars)) {
    const catData = calendars[cat];
    html += `<section class="category-block"><h2 class="category-title">${cat}</h2>`;

    for (const comp of ["FEDERADO","IMD"]) {
      const teams = catData[comp] || [];
      html += `<div class="competition"><h3 class="competition-title">${comp}</h3>`;
      if (!teams.length) {
        html += `<p class="empty">— sin calendarios —</p>`;
      } else {
        html += `<ul class="team-list">`;
        for (const t of teams) {
          const iconPath = t.icon || path.posix.join("calendarios","icons","flores.svg");
          html += `<li class="team-item">
  <img class="team-icon" src="${iconPath}" alt="${t.team}" />
  <a class="team-link" href="${t.href}">${t.team}</a>
</li>`;
        }
        html += `</ul>`;
      }
      html += `</div>`;
    }

    html += `</section>`;
  }

  html += `</div></body></html>`;

  fs.writeFileSync(OUTPUT_HTML, html, "utf-8");
  console.log("✅ index.html generado");
}

function main() {
  try {
    const calendars = collectCalendars();
    generateHTML(calendars);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
}

main();
