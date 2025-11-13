// scripts/generate_index.js (versión corregida)
const fs = require("fs");
const path = require("path");

const OUTPUT_HTML = "index.html";
const CALENDAR_DIR = "calendarios";
const ICON_DIR = path.join(CALENDAR_DIR, "icons");

// Orden fijo de categorías
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

function getCategoryFromFilename(filename) {
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

function findIconForTeam(iconsMap, teamName) {
  // Intenta varias variantes para encontrar icono: exacto, sin "LAS ", sin "C.D."...
  const tries = [];
  tries.push(teamName);
  tries.push(teamName.replace(/^LAS\s+/i, ""));
  tries.push(teamName.replace(/^C\.?D\.?\s*/i, ""));
  tries.push(teamName.replace(/^C D\s*/i, ""));
  // nombres cortos: "flores morado" y "flores"
  tries.push(teamName.replace(/^LAS\s+FLORES\s*/i, "FLORES "));
  tries.push(teamName.replace(/^LAS\s+/i, ""));
  for (const t of tries) {
    const key = normalizeKey(t);
    if (iconsMap[key]) return iconsMap[key];
  }
  // fallback: icono que contenga "FLORES" en la key
  for (const k of Object.keys(iconsMap)) {
    if (k.includes("FLORES")) return iconsMap[k];
  }
  // último recurso: primer icono disponible
  const keys = Object.keys(iconsMap);
  return keys.length ? iconsMap[keys[0]] : path.posix.join("calendarios", "icons", "flores.svg");
}

function collectCalendars() {
  const iconsMap = loadIconsOnce();
  const data = {};

  if (!fs.existsSync(CALENDAR_DIR)) return data;
  const files = fs
    .readdirSync(CALENDAR_DIR)
    .filter((f) => f.toLowerCase().endsWith(".ics"));

  for (const file of files) {
    const lower = file.toLowerCase();

    // Competición: prefijo del fichero
    let competition = "FEDERADO";
    if (lower.startsWith("imd_")) competition = "IMD";
    else if (lower.startsWith("federado_")) competition = "FEDERADO";

    const category = getCategoryFromFilename(file);

    const rest = file
      .replace(/^(?:imd|federado)[_\-]/i, "")
      .replace(/(femenino|masculino|cd|evb|\.ics)/gi, " ")
      .replace(/[_\-\.\s]+/g, " ")
      .trim();

    const restKey = normalizeKey(rest);

    let teamName = "LAS FLORES";
    if (restKey.includes("MORADO")) teamName = "LAS FLORES MORADO";
    else if (restKey.includes("AMARILLO")) teamName = "LAS FLORES AMARILLO";
    else if (restKey.includes("PURPURA") || restKey.includes("PURPÚRA")) teamName = "LAS FLORES PÚRPURA";
    else if (restKey.includes("ALBERO")) teamName = "LAS FLORES ALBERO";
    else if (restKey.includes("LAS FLORES")) teamName = restKey; // fallback

    if (!data[category]) data[category] = { FEDERADO: [], IMD: [] };

    const iconForTeam = findIconForTeam(iconsMap, teamName);

    data[category][competition].push({
      originalFile: file,
      team: teamName,
      href: path.posix.join(CALENDAR_DIR, file),
      icon: iconForTeam,
    });
  }

  // Ordenar equipos dentro de cada categoría
  for (const cat of Object.keys(data)) {
    for (const comp of ["FEDERADO", "IMD"]) {
      data[cat][comp].sort((a, b) => {
        const ai = TEAM_ORDER.indexOf(a.team);
        const bi = TEAM_ORDER.indexOf(b.team);
        if (ai === -1 && bi === -1) return a.team.localeCompare(b.team);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }
  }

  // Crear estructura completa con categorías vacías si faltan
  const full = {};
  for (const cat of CATEGORIES_ORDER) {
    full[cat] = data[cat] || { FEDERADO: [], IMD: [] };
  }
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

  for (const cat of CATEGORIES_ORDER) {
    const catData = calendars[cat] || { FEDERADO: [], IMD: [] };
    html += `<section class="category-block"><h2 class="category-title">${cat}</h2>`;

    // SOLO RENDERIZAR competición si tiene equipos
    for (const comp of ["FEDERADO", "IMD"]) {
      const teams = catData[comp] || [];
      if (!teams.length) continue; // <-- aquí: saltar si vacío (no mostrar "— sin calendarios —")
      html += `<div class="competition"><h3 class="competition-title">${comp}</h3>`;
      html += `<ul class="team-list">`;
      for (const t of teams) {
        html += `<li class="team-item">
  <img class="team-icon" src="${t.icon}" alt="${t.team}" />
  <a class="team-link" href="${t.href}">${t.team}</a>
</li>`;
      }
      html += `</ul></div>`;
    }

    html += `</section>`;
  }

  html += `</div></body></html>`;
  fs.writeFileSync(OUTPUT_HTML, html, "utf-8");
  console.log("✅ index.html generado correctamente");
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
