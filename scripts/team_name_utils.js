function normalizeBase(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Detecta colores
function detectColor(n) {
  if (n.includes("AMARILLO")) return "AMARILLO";
  if (n.includes("ALBERO")) return "ALBERO";
  if (n.includes("MORADO")) return "MORADO";
  if (n.includes("PURPURA") || n.includes("PÚRPURA")) return "PÚRPURA";
  return null;
}

function normalizeTeamDisplay(raw) {
  let n = normalizeBase(raw);

  // limpiar ruido común
  n = n.replace(/\bC\.?D\.?\b/g, " ");
  n = n.replace(/\bCLUB\b/g, " ");
  n = n.replace(/\bVOLEIBOL\b/g, " ");
  n = n.replace(/\bSEVILLA\b/g, " ");
  n = n.replace(/\bJUVENIL\b/g, " ");
  n = n.replace(/\bCADETE\b/g, " ");
  n = n.replace(/\bINFANTIL\b/g, " ");
  n = n.replace(/\bALEVIN\b/g, " ");
  n = n.replace(/\bALEV[IÍ]N\b/g, " ");
  n = n.replace(/\bSENIOR\b/g, " ");

  n = n.replace(/\s+/g, " ").trim();

  // detectar color
  const color = detectColor(n);

  // detectar si es EVB
  const isEVB = n.includes("EVB");

  // construir nombre final
  if (isEVB) {
    return color ? `EVB LAS FLORES ${color}` : `EVB LAS FLORES`;
  }

  // si no es EVB pero es LAS FLORES
  if (n.includes("LAS FLORES")) {
    return color ? `LAS FLORES ${color}` : `LAS FLORES`;
  }

  // si no es de Las Flores, devolver limpio
  return n;
}

function normalizeTeamSlug(raw) {
  const disp = normalizeTeamDisplay(raw).toLowerCase();

  return disp
    .replace(/ /g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

module.exports = {
  normalizeTeamDisplay,
  normalizeTeamSlug
};
