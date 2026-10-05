/* Maquette du territoire — Bibliothèque Everywhere. Three.js r184 auto-hébergé (../_vendor/three/).
   La vraie forme d'un territoire, découpée et extrudée en maquette posée sur une table (tranche de matière, ombre douce),
   avec un relief en strates (courbes de niveau empilées comme du carton d'architecte). Deux échelles, même code :
   - data-echelle="pays"    : le tracé vient de data-trace (JSON { anneaux: [[[lon, lat], …], …] }, ex. media/france.json) ;
   - data-echelle="secteur" : le contour est l'enveloppe arrondie des lieux (communes autour d'un atelier).
   Les points d'attache (li[data-base]) et les lieux (button.mt-lieu) portent data-lat / data-lon. Choisir un lieu
   l'allume, tire un câble lumineux depuis le point d'attache le plus proche et écrit la phrase (km à vol d'oiseau,
   haversine), le chiffre comptant au rythme de l'impulsion. L'interface fonctionne sans WebGL ; Three.js n'est importé
   que si un contexte WebGL 2 existe. Rendu à la demande : aucune image n'est calculée quand rien ne bouge. */
const SEL = '.c-maquette-territoire';
const reduit = window.matchMedia('(prefers-reduced-motion: reduce)');
const ESP = ' ', FINE = ' '; // insécables : « Lyon : », « 279 km » (fine)
const RAD = Math.PI / 180, R_TERRE = 6371, KM_PAR_DEGRE = (Math.PI * R_TERRE) / 180;
const COTE = 10; // plus grande dimension de la maquette, en unités de scène
const MODELES = {
  pays: '{lieu} : nous travaillons en visio, comme partout en France. Point d’attache le plus proche : {base}, à {km} à vol d’oiseau.',
  secteur: '{lieu} : à {km} de {base} à vol d’oiseau.',
};
// Relief d'illustration de l'échelle « pays » : grands massifs (centre, demi-axes en km, orientation, hauteur relative).
// Ce n'est pas une topographie : une silhouette lisible, signalée comme telle dans la note.
const MASSIFS = [
  { lon: 6.75, lat: 45.65, sx: 42, sz: 85, ang: 22, h: 1 }, // Alpes du Nord
  { lon: 6.55, lat: 44.55, sx: 50, sz: 62, ang: -18, h: 0.86 }, // Alpes du Sud
  { lon: 5.95, lat: 44.05, sx: 55, sz: 30, ang: 0, h: 0.34 }, // Préalpes
  { lon: 0.55, lat: 42.82, sx: 165, sz: 26, ang: -4, h: 0.9 }, // Pyrénées
  { lon: 2.95, lat: 45.3, sx: 85, sz: 105, ang: 0, h: 0.56 }, // Massif central
  { lon: 3.75, lat: 44.3, sx: 48, sz: 24, ang: 32, h: 0.4 }, // Cévennes
  { lon: 6.05, lat: 46.75, sx: 24, sz: 68, ang: 36, h: 0.46 }, // Jura
  { lon: 7.0, lat: 48.1, sx: 21, sz: 52, ang: 14, h: 0.44 }, // Vosges
  { lon: 9.05, lat: 42.15, sx: 24, sz: 52, ang: 10, h: 0.72 }, // Corse
  { lon: -2.8, lat: 48.2, sx: 90, sz: 38, ang: 0, h: 0.18 }, // Massif armoricain
  { lon: 4.7, lat: 49.92, sx: 30, sz: 14, ang: 0, h: 0.2 }, // Ardennes
  { lon: 4.05, lat: 47.15, sx: 22, sz: 30, ang: 0, h: 0.22 }, // Morvan
];
// Matières : grain, variation lente, pores, strates de la tranche, rugosité, éclaircissement par palier, ombre des côtés.
const MATIERES = {
  resine: { grain: 0.035, macro: 0.05, pores: 0, strate: 0, rugosite: 0.66, palier: 0.13, cote: 0.7 },
  beton: { grain: 0.1, macro: 0.08, pores: 0.28, strate: 0, rugosite: 0.96, palier: 0.06, cote: 0.8 },
  carton: { grain: 0.05, macro: 0.035, pores: 0, strate: 0.046, rugosite: 1, palier: 0.045, cote: 0.84 },
};

// ——— Arithmétique pure ———
function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.min(1, Math.sqrt(h)));
}
function lireLieu(el) {
  const lat = parseFloat(el.dataset.lat), lon = parseFloat(el.dataset.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
const borne01 = (x) => Math.min(1, Math.max(0, x));
const lisse = (a, b, x) => { const t = borne01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const entreeSortie = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2); // easeInOutCubic : impulsion ET compteur
const sortie3 = (p) => 1 - (1 - p) ** 3;
const sortie4 = (p) => 1 - (1 - p) ** 4;
const sortieRessort = (p) => { const c = 1.4; return p >= 1 ? 1 : 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; };
const dureeEnvoi = (long) => Math.round(Math.min(1900, Math.max(850, 700 + 150 * long))); // ms, long = corde en unités

// ——— Couleurs CSS → sRGB (peintes dans un pixel : hex, rgb, oklch, color-mix…) ———
const pixel = document.createElement('canvas'); pixel.width = pixel.height = 1;
const g2d = pixel.getContext('2d', { willReadFrequently: true });
function lireSRGB(el, nom, repli) {
  const v = getComputedStyle(el).getPropertyValue(nom).trim() || repli;
  g2d.clearRect(0, 0, 1, 1); g2d.fillStyle = repli; g2d.fillStyle = v; g2d.fillRect(0, 0, 1, 1);
  const d = g2d.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}
const luminance = (s) => { const l = s.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };

// ——— Bruit de valeur 2D ———
function hache(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function bruit(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hache(xi, yi), b = hache(xi + 1, yi), c = hache(xi, yi + 1), d = hache(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, o) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * bruit(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - 0.5 ** o); };

// ——— Géométrie plane : anneaux [[x, z], …] (x vers l'est, z vers le sud) ———
// Aire signée > 0 : intérieur à gauche du sens de parcours (anneau extérieur) ; < 0 : trou.
const aire = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; };
function dansAnneau(x, z, r) {
  let dedans = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) dedans = !dedans;
  }
  return dedans;
}
function plusProcheBord(x, z, r) { // point du bord le plus proche et normale sortante du segment
  let best = { d: Infinity, x, z, nx: 0, nz: 0 };
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j], [bx, bz] = r[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = borne01(((x - ax) * dx + (z - az) * dz) / l2), px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz);
    if (d < best.d) { const l = Math.sqrt(l2); best = { d, x: px, z: pz, nx: dz / l, nz: -dx / l }; }
  }
  return best;
}
function enveloppe(pts) { // enveloppe convexe (chaîne monotone), aire > 0
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const croix = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas = [], haut = [];
  for (const q of p) { while (bas.length >= 2 && croix(bas.at(-2), bas.at(-1), q) <= 0) bas.pop(); bas.push(q); }
  for (const q of p.slice().reverse()) { while (haut.length >= 2 && croix(haut.at(-2), haut.at(-1), q) <= 0) haut.pop(); haut.push(q); }
  const h = bas.slice(0, -1).concat(haut.slice(0, -1));
  return aire(h) < 0 ? h.reverse() : h;
}
function arrondir(h, rayon, pas = 14) { // somme de Minkowski enveloppe ⊕ disque : contour en galet
  if (h.length === 1) return Array.from({ length: 48 }, (_, k) => [h[0][0] + rayon * Math.cos((k / 48) * 2 * Math.PI), h[0][1] + rayon * Math.sin((k / 48) * 2 * Math.PI)]);
  const out = [], n = h.length;
  for (let i = 0; i < n; i++) {
    const a = h[(i - 1 + n) % n], b = h[i], c = h[(i + 1) % n];
    let a1 = Math.atan2(-(b[0] - a[0]), b[1] - a[1]), a2 = Math.atan2(-(c[0] - b[0]), c[1] - b[1]); // normales sortantes (dz, −dx)
    while (a2 < a1) a2 += 2 * Math.PI;
    const k = Math.max(1, Math.ceil(((a2 - a1) / Math.PI) * pas));
    for (let s = 0; s <= k; s++) { const t = a1 + ((a2 - a1) * s) / k; out.push([b[0] + rayon * Math.cos(t), b[1] + rayon * Math.sin(t)]); }
  }
  return out;
}
function chaikin(r, n) {
  let p = r;
  for (let k = 0; k < n; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    p = q;
  }
  return p;
}
function eclaircir(r, tol) { // retire les sommets presque alignés (anneau fermé)
  if (r.length < 8) return r;
  const out = [r[0]];
  for (let i = 1; i < r.length - 1; i++) {
    const a = out.at(-1), b = r[i], c = r[i + 1], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
    if (Math.abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / l > tol) out.push(b);
  }
  out.push(r.at(-1));
  return out;
}
function flouBoite(src, nx, nz, r, passes) { // flou séparable, bords répétés
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let k = -r; k <= r; k++) s += a[j * nx + Math.min(nx - 1, Math.max(0, i + k))]; b[j * nx + i] = s / (2 * r + 1); }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let k = -r; k <= r; k++) s += b[Math.min(nz - 1, Math.max(0, j + k)) * nx + i]; a[j * nx + i] = s / (2 * r + 1); }
  }
  return a;
}

// ——— Courbes de niveau (carrés marchants), anneaux orientés : intérieur (v ≥ seuil) à gauche ———
function courbes(v, nx, nz, seuil) {
  const pt = (cle) => { // point d'une arête, interpolé ; clé paire = arête horizontale (i,j)-(i+1,j), impaire = verticale (i,j)-(i,j+1)
    const n = cle >> 1, i = n % nx, j = (n - i) / nx, a = v[n], b = cle & 1 ? v[n + nx] : v[n + 1], t = (seuil - a) / (b - a || 1e-9);
    return cle & 1 ? [i, j + t] : [i + t, j];
  };
  const suivant = new Map();
  const segment = (c1, c2, rx, rz, signe) => {
    const p = pt(c1), q = pt(c2), cr = (q[0] - p[0]) * (rz - p[1]) - (q[1] - p[1]) * (rx - p[0]);
    if (cr * signe >= 0) suivant.set(c1, c2); else suivant.set(c2, c1);
  };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const n = j * nx + i, va = v[n], vb = v[n + 1], vc = v[n + nx + 1], vd = v[n + nx];
    const A = va >= seuil, B = vb >= seuil, C = vc >= seuil, D = vd >= seuil;
    if (A === B && B === C && C === D) continue;
    const e0 = 2 * n, e1 = 2 * (n + 1) + 1, e2 = 2 * (n + nx), e3 = 2 * n + 1; // haut, droite, bas, gauche
    const coins = [[A, i, j], [B, i + 1, j], [C, i + 1, j + 1], [D, i, j + 1]];
    if (A === C && B === D) { // col : le centre décide
      const centre = (va + vb + vc + vd) / 4 >= seuil;
      const coupe = A === centre ? [[1, e0, e1], [3, e2, e3]] : [[0, e0, e3], [2, e1, e2]]; // coins isolés
      for (const [k, c1, c2] of coupe) segment(c1, c2, coins[k][1], coins[k][2], coins[k][0] ? 1 : -1);
      continue;
    }
    const aretes = [];
    if (A !== B) aretes.push(e0); if (B !== C) aretes.push(e1); if (D !== C) aretes.push(e2); if (A !== D) aretes.push(e3);
    const ref = coins.find((c) => c[0]);
    segment(aretes[0], aretes[1], ref[1], ref[2], 1);
  }
  const anneaux = [], vus = new Set();
  for (const depart of suivant.keys()) {
    if (vus.has(depart)) continue;
    const r = []; let c = depart, garde = 0;
    while (c !== undefined && !vus.has(c) && garde++ < 200000) { vus.add(c); r.push(pt(c)); c = suivant.get(c); }
    if (c === depart && r.length >= 4) anneaux.push(r);
  }
  return anneaux;
}

// ——— Contour d'un secteur : enveloppe arrondie des lieux, creusée en douceur entre les bras ———
// Champ = 0,38 dans l'enveloppe convexe (adoucie) + Σ gaussiennes autour des segments point d'attache → lieu ; on garde
// la courbe 0,5 la plus grande. Résultat : un galet qui suit les communes, jamais une dalle ni une étoile.
function contourSecteur(pts, nB, rattache) {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const etendue = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1);
  const sigma = 0.15 * etendue + 0.75, marge = 3.2 * sigma, N = 150;
  const gx0 = Math.min(...xs) - marge, gz0 = Math.min(...zs) - marge;
  const pas = (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 2 * marge) / (N - 1);
  const nx = Math.ceil((Math.max(...xs) - Math.min(...xs) + 2 * marge) / pas) + 1, nz = Math.ceil((Math.max(...zs) - Math.min(...zs) + 2 * marge) / pas) + 1;
  const h = enveloppe(pts), segs = [];
  for (let k = 0; k < nB; k++) segs.push([pts[k], pts[k]]);
  rattache.forEach((b, n) => segs.push([pts[b], pts[nB + n]]));
  const env = new Float32Array(nx * nz), v = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = gx0 + i * pas, z = gz0 + j * pas;
    env[j * nx + i] = h.length >= 3 && dansAnneau(x, z, h) ? 1 : 0;
    let s = 0;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz, t = l2 ? borne01(((x - a[0]) * dx + (z - a[1]) * dz) / l2) : 0;
      const d2 = (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2; s += Math.exp(-d2 / (2 * sigma * sigma));
    }
    v[j * nx + i] = s;
  }
  const envF = flouBoite(env, nx, nz, Math.max(1, Math.round(sigma / pas)), 2);
  for (let k = 0; k < v.length; k++) v[k] = Math.min(1.4, v[k]) + 0.38 * envF[k];
  const anneaux = courbes(v, nx, nz, 0.5).filter((r) => aire(r) > 0).sort((a, b) => aire(b) - aire(a));
  if (!anneaux.length) return arrondir(h, sigma);
  return eclaircir(chaikin(anneaux[0].map(([i, j]) => [gx0 + i * pas, gz0 + j * pas]), 2), 0.0005 * etendue);
}

// ——— Lecture du tracé : fetch, puis XHR (Chrome lancé avec --allow-file-access-from-files lit file:// ainsi) ———
function lireXHR(url) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'json';
    x.onload = () => (x.response ? ok(x.response) : ko(new Error(`réponse vide (${x.status})`)));
    x.onerror = () => ko(new Error('lecture impossible'));
    x.send();
  });
}
async function chargerTrace(url) {
  try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  catch (err) { return lireXHR(url).catch(() => { throw err; }); }
}

// ════════════════════════ Interface : liste, phrase, compteur (sans WebGL) ════════════════════════
function init(racine) {
  const echelle = racine.dataset.echelle === 'pays' || (!racine.dataset.echelle && racine.dataset.trace) ? 'pays' : 'secteur';
  const ligne = racine.querySelector('.mt-phrase'), annonce = racine.querySelector('.mt-annonce');
  const bases = [];
  racine.querySelectorAll('[data-base]').forEach((el) => {
    const l = lireLieu(el); if (!l) { console.warn('maquette-territoire : coordonnées illisibles (point d’attache)', el); return; }
    const nom = (el.dataset.nom || (el.querySelector('.mt-base-nom') || el).textContent).trim();
    const role = el.querySelector('.mt-base-role');
    bases.push({ ...l, nom, dit: (el.dataset.dit || nom).trim(), role: role ? role.textContent.trim() : '' });
  });
  if (!bases.length || !ligne) { console.warn('maquette-territoire : aucun point d’attache valide, maquette inactive'); racine.querySelectorAll('.mt-lieu').forEach((b) => { b.disabled = true; }); return; }
  const lieux = [];
  racine.querySelectorAll('.mt-lieu').forEach((el) => {
    const l = lireLieu(el);
    if (!l) { console.warn('maquette-territoire : coordonnées illisibles (lieu)', el); el.disabled = true; return; } // coordonnées illisibles : bouton inerte plutôt qu'une distance fausse
    let base = 0, km = Infinity;
    bases.forEach((b, k) => { const d = haversine(b, l); if (d < km) { km = d; base = k; } });
    lieux.push({ el, nom: (el.dataset.nom || el.textContent).trim(), ...l, base, km });
  });
  if (!lieux.length) return;

  const modele = (racine.dataset.modele || MODELES[echelle]).replace(/ ([:;!?])/g, `${ESP}$1`);
  const morceaux = modele.split(/(\{lieu\}|\{base\}|\{km\})/).filter(Boolean);
  const defaut = ligne.textContent;
  const etat = { choisie: -1, survolBouton: -1, focus: -1, survol3d: -1, active: -1 };
  let envoi = null, rafCompte = 0, minuterieAnnonce = 0, scene = null, nombre = null;
  const km = (n) => (n >= 1 ? `${n}${FINE}km` : `moins de 1${FINE}km`);
  const phrase = (c, n) => morceaux.map((m) => (m === '{lieu}' ? c.nom : m === '{base}' ? bases[c.base].dit : m === '{km}' ? km(n) : m)).join('');

  function construireLigne(c, n) {
    nombre = null;
    ligne.replaceChildren(...morceaux.map((m) => {
      if (m === '{lieu}') { const s = document.createElement('span'); s.className = 'mt-p-nom'; s.textContent = c.nom; return s; }
      if (m === '{base}') return bases[c.base].dit;
      if (m === '{km}') {
        const s = document.createElement('span'); s.className = 'mt-p-km';
        if (n < 1) { s.textContent = km(n); return s; }
        nombre = document.createElement('span'); nombre.className = 'mt-p-n'; nombre.textContent = '0';
        s.append(nombre, `${FINE}km`); return s;
      }
      return m;
    }));
  }
  function compter() {
    rafCompte = 0; if (!envoi || !nombre) return;
    const p = borne01((performance.now() - envoi.t0) / envoi.duree);
    nombre.textContent = String(Math.round(envoi.n * entreeSortie(p)));
    if (p < 1) rafCompte = requestAnimationFrame(compter);
  }
  function annoncer(texte) { // au choix seulement (pas au focus ni au survol) ; vidée d'abord pour qu'une même phrase soit redite
    clearTimeout(minuterieAnnonce);
    if (annonce) annonce.textContent = '';
    minuterieAnnonce = setTimeout(() => { if (annonce) annonce.textContent = texte; }, 250);
  }
  function recalculer(forcer, dire) {
    const a = [etat.survolBouton, etat.survol3d, etat.focus, etat.choisie].find((x) => x >= 0) ?? -1;
    if (a === etat.active && !forcer) return;
    etat.active = a;
    lieux.forEach((c, i) => c.el.classList.toggle('est-active', i === a));
    if (rafCompte) { cancelAnimationFrame(rafCompte); rafCompte = 0; }
    if (a < 0) { envoi = null; nombre = null; ligne.textContent = defaut; ligne.removeAttribute('aria-hidden'); if (scene) scene.activer(-1, null, etat.choisie); if (dire) annoncer(defaut); return; }
    const c = lieux[a], n = Math.round(c.km);
    const duree = reduit.matches || n < 1 ? 0 : scene ? scene.duree(a) : dureeEnvoi(4);
    envoi = { i: a, n, t0: performance.now(), duree };
    construireLigne(c, n); ligne.setAttribute('aria-hidden', 'true'); // le chiffre compte : la région aria-live dit la phrase finale
    if (duree && nombre) rafCompte = requestAnimationFrame(compter); else if (nombre) nombre.textContent = String(n);
    if (scene) scene.activer(a, envoi, etat.choisie);
    if (dire) annoncer(phrase(c, n));
  }
  function choisir(i) { // bouton à bascule : un second appui sur le lieu choisi le désélectionne
    etat.choisie = i === etat.choisie ? -1 : i;
    lieux.forEach((c, k) => c.el.setAttribute('aria-pressed', String(k === etat.choisie)));
    if (etat.choisie < 0 && etat.survolBouton === i) etat.survolBouton = -1;
    if (etat.choisie < 0 && etat.focus === i) etat.focus = -1;
    recalculer(true, true);
  }
  lieux.forEach((c, i) => {
    c.el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { etat.survolBouton = i; recalculer(); } });
    c.el.addEventListener('pointerleave', () => { if (etat.survolBouton === i) { etat.survolBouton = -1; recalculer(); } });
    c.el.addEventListener('focus', () => { etat.focus = i; recalculer(); });
    c.el.addEventListener('blur', () => { if (etat.focus === i) { etat.focus = -1; recalculer(); } });
    c.el.addEventListener('click', () => choisir(i));
  });

  const ui = { survoler(i) { if (etat.survol3d !== i) { etat.survol3d = i; recalculer(); } }, choisir };
  const trace = echelle === 'pays' && racine.dataset.trace ? new URL(racine.dataset.trace, document.baseURI).href : null;
  const cfg = { echelle, bases, lieux, trace, matiere: MATIERES[racine.dataset.matiere] ? racine.dataset.matiere : '', relief: racine.dataset.relief || (echelle === 'pays' ? 'massifs' : 'bruit') };
  construire3D(racine, cfg, ui).then((s) => {
    if (!s) return;
    scene = s;
    if (etat.active >= 0) scene.activer(etat.active, envoi, etat.choisie);
  }).catch((err) => { // une scène qui casse ne doit jamais emporter la liste : repli image, erreur dite en console
    console.error('maquette-territoire : scène 3D indisponible', err);
    racine.classList.remove('est-attente', 'est-3d'); racine.classList.add('est-repli');
  });
}

// ════════════════════════ La maquette 3D ════════════════════════
async function construire3D(racine, cfg, ui) {
  const boite = racine.querySelector('.mt-scene'), toile = racine.querySelector('.mt-toile');
  const calque = racine.querySelector('.mt-etiquettes'), panneau = racine.querySelector('.mt-panneau');
  if (!boite || !toile) return null;
  const versRepli = () => { racine.classList.remove('est-attente'); racine.classList.add('est-repli'); return null; };
  racine.classList.add('est-attente'); // le module tourne : le repli ne s'affiche que si WebGL manque
  const etroit = () => boite.clientWidth < 768;

  // Contexte demandé par nous : s'il manque, repli silencieux (Three.js écrirait trois erreurs en console).
  const ctx = toile.getContext('webgl2', { alpha: true, antialias: !etroit(), premultipliedAlpha: true, depth: true, stencil: false, powerPreference: 'high-performance' });
  if (!ctx) return versRepli();
  let THREE, rendu, trace = null;
  try {
    const [mod, tr] = await Promise.all([
      import('../_vendor/three/three.module.min.js'),
      cfg.trace ? chargerTrace(cfg.trace).catch((err) => { console.error('maquette-territoire : tracé illisible, contour arrondi à la place', err); return null; }) : null,
    ]);
    THREE = mod; trace = tr;
    rendu = new THREE.WebGLRenderer({ canvas: toile, context: ctx, alpha: true });
  } catch (err) { console.error('maquette-territoire : Three.js indisponible', err); return versRepli(); }
  rendu.setClearColor(0x000000, 0);
  rendu.toneMapping = THREE.NeutralToneMapping;
  rendu.shadowMap.enabled = true; rendu.shadowMap.type = THREE.VSMShadowMap; rendu.shadowMap.autoUpdate = false; // recalculée seulement quand un objet bouge (arrivée, redimensionnement)
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const C = () => new THREE.Color();
  const pays = cfg.echelle === 'pays';

  // ——— Projection : km autour du centre (nord = −z), puis maquette de COTE unités ———
  const anneauxGeo = trace && Array.isArray(trace.anneaux) ? trace.anneaux.filter((a) => Array.isArray(a) && a.length >= 3 && a.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))) : [];
  // Échelle pays sans tracé valide : l’image de repli plutôt qu’une fausse forme sous une mention de source.
  if (pays && !anneauxGeo.length) { console.error('maquette-territoire : tracé absent ou invalide, image de repli'); rendu.dispose(); return versRepli(); }
  const lieuxGeo = [...cfg.bases, ...cfg.lieux];
  const refGeo = anneauxGeo.length ? anneauxGeo.flat().map(([lon, lat]) => ({ lon, lat })) : lieuxGeo;
  const lats = refGeo.map((p) => p.lat), lons = refGeo.map((p) => p.lon);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2, lon0 = (Math.min(...lons) + Math.max(...lons)) / 2, cosLat = Math.cos(lat0 * RAD);
  const enKm = (l) => [(l.lon - lon0) * cosLat * KM_PAR_DEGRE, -(l.lat - lat0) * KM_PAR_DEGRE];
  const ptsKm = lieuxGeo.map(enKm);
  let anneauxKm;
  if (anneauxGeo.length) anneauxKm = anneauxGeo.map((a) => a.map(([lon, lat]) => enKm({ lon, lat })));
  else anneauxKm = [contourSecteur(ptsKm, cfg.bases.length, cfg.lieux.map((l) => l.base))];
  const tousX = anneauxKm.flat().map((p) => p[0]), tousZ = anneauxKm.flat().map((p) => p[1]);
  const cxKm = (Math.max(...tousX) + Math.min(...tousX)) / 2, czKm = (Math.max(...tousZ) + Math.min(...tousZ)) / 2;
  const u = COTE / Math.max(Math.max(...tousX) - Math.min(...tousX), Math.max(...tousZ) - Math.min(...tousZ));
  const versU = ([x, z]) => [(x - cxKm) * u, (z - czKm) * u];
  const anneaux = anneauxKm.map((a) => { const r = a.map(versU); return aire(r) < 0 ? r.reverse() : r; });
  const minX = Math.min(...anneaux.flat().map((p) => p[0])), maxX = Math.max(...anneaux.flat().map((p) => p[0]));
  const minZ = Math.min(...anneaux.flat().map((p) => p[1])), maxZ = Math.max(...anneaux.flat().map((p) => p[1]));
  const W = maxX - minX, D = maxZ - minZ;
  // Positions des balises : un lieu côtier hors du tracé simplifié est ramené juste à l'intérieur (la distance, elle, reste exacte).
  const positions = ptsKm.map(versU).map(([x, z]) => {
    const dedans = anneaux.some((r) => dansAnneau(x, z, r));
    let best = null; for (const r of anneaux) { const b = plusProcheBord(x, z, r); if (!best || b.d < best.d) best = b; }
    const marge = 0.09;
    if (dedans && best.d >= marge) return [x, z];
    return [best.x - best.nx * marge, best.z - best.nz * marge];
  });

  // ——— Champ de relief sur une grille, nul près des bords, aplani autour des balises ———
  const EP = 0.34, T = pays ? 0.072 : 0.075; // tranche du socle ; épaisseur d'une strate
  const PAD = 0.45, NX = pays ? 210 : 170, cell = (W + 2 * PAD) / (NX - 1), NZ = Math.ceil((D + 2 * PAD) / cell) + 1;
  const x0 = minX - PAD, z0 = minZ - PAD;
  const cm = document.createElement('canvas'); cm.width = NX; cm.height = NZ;
  const gm = cm.getContext('2d', { willReadFrequently: true });
  gm.fillStyle = '#fff'; gm.beginPath();
  for (const r of anneaux) { r.forEach(([x, z], k) => { const px = (x - x0) / cell + 0.5, pz = (z - z0) / cell + 0.5; if (k) gm.lineTo(px, pz); else gm.moveTo(px, pz); }); gm.closePath(); }
  gm.fill('evenodd');
  const img = gm.getImageData(0, 0, NX, NZ).data, dedans = new Float32Array(NX * NZ);
  for (let k = 0; k < dedans.length; k++) dedans[k] = img[k * 4 + 3] / 255;
  const loin = flouBoite(dedans, NX, NZ, pays ? 3 : 4, 2);
  const massifs = MASSIFS.map((m) => { const [x, z] = versU(enKm(m)); return { x, z, sx: m.sx * u, sz: m.sz * u, c: Math.cos(m.ang * RAD), s: Math.sin(m.ang * RAD), h: m.h }; });
  function relief(x, z) {
    if (cfg.relief === 'plat') return 0;
    if (cfg.relief === 'massifs') {
      let h = 0;
      for (const m of massifs) { const dx = x - m.x, dz = z - m.z, a = dx * m.c + dz * m.s, b = -dx * m.s + dz * m.c; h += m.h * Math.exp(-(a * a) / (2 * m.sx * m.sx) - (b * b) / (2 * m.sz * m.sz)); }
      return h * (0.7 + 0.6 * fbm(x * 0.9 + 3.1, z * 0.9 - 1.7, 4)) + 0.05 * fbm(x * 0.6 + 8, z * 0.6, 3);
    }
    return 0.8 * fbm(x * 0.2 + 7.3, z * 0.2 + 2.1, 5) + 0.2 * fbm(x * 0.6 - 4.2, z * 0.6 + 9.4, 3);
  }
  const champ = new Float32Array(NX * NZ);
  let maxi = 0;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, m = lisse(0.6, 0.97, loin[k]);
    champ[k] = m > 0 ? relief(x0 + i * cell, z0 + j * cell) * m : 0;
    if (champ[k] > maxi) maxi = champ[k];
  }
  if (maxi > 0) for (let k = 0; k < champ.length; k++) champ[k] /= maxi;
  let seuils;
  if (cfg.relief === 'plat' || maxi <= 0) seuils = [];
  else if (cfg.relief === 'massifs') seuils = [0.12, 0.3, 0.5, 0.72];
  else { // bruit : quantiles de l'intérieur → les strates couvrent 55 %, 28 %, 10 % de la surface
    const vals = []; for (let k = 0; k < champ.length; k++) if (loin[k] > 0.99) vals.push(champ[k]);
    vals.sort((a, b) => a - b);
    seuils = vals.length ? [0.45, 0.72, 0.9].map((q) => vals[Math.floor(q * (vals.length - 1))]) : [];
  }
  const echantillon = (x, z) => { // bilinéaire
    const gx = Math.min(NX - 1.001, Math.max(0, (x - x0) / cell)), gz = Math.min(NZ - 1.001, Math.max(0, (z - z0) / cell));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * NX + i;
    return champ[k] * (1 - fx) * (1 - fz) + champ[k + 1] * fx * (1 - fz) + champ[k + NX] * (1 - fx) * fz + champ[k + NX + 1] * fx * fz;
  };
  const palier = (f) => seuils.filter((s) => f >= s).length;
  // Aplanir : chaque balise repose au milieu de sa strate, aucune courbe ne passe à moins de R1.
  const R1 = pays ? 0.16 : 0.2, R2 = pays ? 0.34 : 0.42;
  const niveaux = positions.map(([x, z]) => {
    const f = echantillon(x, z), k = palier(f);
    const cible = !seuils.length ? f : k === 0 ? Math.min(f, seuils[0] * 0.5) : k === seuils.length ? Math.max(f, seuils[k - 1] + 0.05) : (seuils[k - 1] + seuils[k]) / 2;
    const i0 = Math.max(0, Math.floor((x - R2 - x0) / cell)), i1 = Math.min(NX - 1, Math.ceil((x + R2 - x0) / cell));
    const j0 = Math.max(0, Math.floor((z - R2 - z0) / cell)), j1 = Math.min(NZ - 1, Math.ceil((z + R2 - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(x0 + i * cell - x, z0 + j * cell - z);
      if (d < R2) { const kk = j * NX + i; champ[kk] += (cible - champ[kk]) * (1 - lisse(R1, R2, d)); }
    }
    return k;
  });

  // ——— Matières : MeshStandard + grain, arête claire, strates de la tranche (onBeforeCompile) ———
  const GLSL_BRUIT = `
    float mtHache(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float mtBruit(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
      return mix(mix(mtHache(i), mtHache(i + vec2(1.0, 0.0)), w.x), mix(mtHache(i + vec2(0.0, 1.0)), mtHache(i + vec2(1.0, 1.0)), w.x), w.y); }`;
  const materiaux = [];
  const flaque = { value: new THREE.Vector4(0, 0, 4, 0.2) }; // flaque de lumière de la lampe : centre x, z, rayon, profondeur
  const texChamp = { value: null }, grilleChamp = { value: new THREE.Vector4(0, 0, 1, 1) }; // champ de relief → courbes gravées
  function matTerre(cote) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    const U = { uClair: { value: C() }, uLigne: { value: C() }, uGrain: { value: 0 }, uMacro: { value: 0 }, uPores: { value: 0 }, uStrate: { value: 0 }, uBas: { value: 0 }, uArete: { value: 0.012 }, uAO: { value: 0.1 }, uFlaque: flaque, uChamp: texChamp, uGrille: grilleChamp, uTrait: { value: C() }, uForceTrait: { value: 0.12 } };
    m.userData.u = U;
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U);
      const att = cote ? 'attribute float aBord;\nvarying float vBord;\n' : '';
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${att}varying vec3 vMonde;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvMonde = transformed;${cote ? '\nvBord = aBord;' : ''}`); // repère de la maquette : le grain ne glisse pas pendant l'arrivée
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${cote ? 'varying float vBord;\n' : ''}varying vec3 vMonde;
        uniform vec3 uClair, uLigne, uTrait; uniform vec4 uFlaque, uGrille; uniform sampler2D uChamp; uniform float uForceTrait, uGrain, uMacro, uPores, uStrate, uBas, uArete, uAO;${GLSL_BRUIT}`)
        .replace('#include <color_fragment>', cote ? `#include <color_fragment>
          if (uStrate > 0.0) {
            float st = (vMonde.y - uBas) / uStrate;
            float fs = max(fwidth(st), 1e-4);
            float bande = smoothstep(0.5 - fs, 0.5 + fs, fract(st));
            diffuseColor.rgb *= mix(1.0, 0.9, bande);
            float joint = 1.0 - smoothstep(0.0, 1.0, abs(fract(st + 0.5) - 0.5) / fs);
            diffuseColor.rgb = mix(diffuseColor.rgb, uLigne, joint * 0.16);
          }
          float gr = mtBruit(vec2(vMonde.x + vMonde.z, vMonde.y) * 80.0);
          diffuseColor.rgb *= 1.0 + (gr - 0.5) * uGrain;
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, uAO, vMonde.y - uBas));
          diffuseColor.rgb *= 1.0 - uFlaque.w * smoothstep(0.35, 1.25, distance(vMonde.xz, uFlaque.xy) / uFlaque.z);
          float arete = 1.0 - smoothstep(0.0, uArete, vBord);
          diffuseColor.rgb = mix(diffuseColor.rgb, uClair, arete * 0.7);` : `#include <color_fragment>
          float fw = fwidth(vMonde.x * 60.0);
          float fin = 1.0 - smoothstep(0.35, 0.9, fw);
          float g1 = mtBruit(vMonde.xz * 60.0), g2 = mtBruit(vMonde.xz * 11.0 + 3.7), ma = mtBruit(vMonde.xz * 0.55 + 11.0);
          float pore = smoothstep(0.8, 0.9, mtBruit(vMonde.xz * 90.0 + 5.0)) * fin;
          diffuseColor.rgb *= (1.0 + (g1 - 0.5) * uGrain * fin + (g2 - 0.5) * uGrain * 0.7 + (ma - 0.5) * uMacro) * (1.0 - pore * uPores);
          diffuseColor.rgb *= 1.0 - uFlaque.w * smoothstep(0.35, 1.25, distance(vMonde.xz, uFlaque.xy) / uFlaque.z);
          float hc = texture2D(uChamp, (vMonde.xz - uGrille.xy) * uGrille.zw).r;
          float nc = hc * 26.0, fc = max(fwidth(nc), 1e-4);
          float trait = (1.0 - smoothstep(0.0, 1.0, abs(fract(nc - 0.5) - 0.5) / fc)) * (1.0 - smoothstep(0.25, 0.7, fc)) * smoothstep(0.004, 0.02, hc);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTrait, trait * uForceTrait);`);
    };
    m.customProgramCacheKey = () => (cote ? 'mt-cote' : 'mt-dessus');
    materiaux.push({ m, cote });
    return m;
  }
  // Prisme : dessus (earcut), côtés lissés (normales moyennées), fond facultatif (porte l'ombre du socle sur la table).
  function prisme(groupes, yBas, yHaut, matDessus, matCote, avecFond) {
    const formes = (signe) => groupes.map((g) => {
      const s = new THREE.Shape(g.ext.map(([x, z]) => new THREE.Vector2(x, signe * z)));
      s.holes = g.trous.map((t) => new THREE.Path(t.map(([x, z]) => new THREE.Vector2(x, signe * z))));
      return s;
    });
    const gDessus = new THREE.ShapeGeometry(formes(-1)); gDessus.rotateX(-Math.PI / 2); gDessus.translate(0, yHaut, 0);
    const P = [], N = [], B = [], I = [];
    for (const g of groupes) for (const r of [g.ext, ...g.trous]) {
      const n = r.length, o = P.length / 3;
      for (let i = 0; i < n; i++) {
        const a = r[(i - 1 + n) % n], b = r[i], c = r[(i + 1) % n];
        let n1x = b[1] - a[1], n1z = -(b[0] - a[0]); const l1 = Math.hypot(n1x, n1z) || 1; n1x /= l1; n1z /= l1;
        let n2x = c[1] - b[1], n2z = -(c[0] - b[0]); const l2 = Math.hypot(n2x, n2z) || 1; n2x /= l2; n2z /= l2;
        let nx = n1x + n2x, nz = n1z + n2z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        P.push(b[0], yBas, b[1], b[0], yHaut, b[1]); N.push(nx, 0, nz, nx, 0, nz); B.push(yHaut - yBas, 0);
      }
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, a0 = o + 2 * i, a1 = a0 + 1, b0 = o + 2 * j, b1 = b0 + 1; I.push(a0, b1, b0, a0, a1, b1); }
    }
    const gCote = new THREE.BufferGeometry();
    gCote.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); gCote.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    gCote.setAttribute('aBord', new THREE.Float32BufferAttribute(B, 1)); gCote.setIndex(I);
    const dessus = new THREE.Mesh(gDessus, matDessus), cote = new THREE.Mesh(gCote, matCote);
    dessus.receiveShadow = cote.receiveShadow = true; cote.castShadow = true;
    const g = new THREE.Group(); g.add(dessus, cote);
    if (avecFond) { const gFond = new THREE.ShapeGeometry(formes(1)); gFond.rotateX(Math.PI / 2); gFond.translate(0, yBas, 0); const f = new THREE.Mesh(gFond, matCote); f.castShadow = true; g.add(f); }
    return g;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
  const maquette = new THREE.Group(); scene.add(maquette); // tout ce qui « se pose » sur la table
  const matSocle = matTerre(false), matSocleCote = matTerre(true);
  maquette.add(prisme(anneaux.map((ext) => ({ ext, trous: [] })), -EP, 0, matSocle, matSocleCote, true));
  const strates = seuils.map((s, k) => {
    const rings = courbes(champ, NX, NZ, s).map((r) => chaikin(r.map(([gx, gz]) => [x0 + gx * cell, z0 + gz * cell]), 2)).map((r) => eclaircir(r, 0.0025)).filter((r) => Math.abs(aire(r)) > (pays ? 0.012 : 0.03));
    const ext = rings.filter((r) => aire(r) > 0).sort((a, b) => aire(a) - aire(b)), groupes = ext.map((e) => ({ ext: e, trous: [] }));
    for (const t of rings.filter((r) => aire(r) < -(pays ? 0.05 : 0.06))) { /* petits trous écartés : vus de haut, des puits noirs */ const g = groupes.find((gr) => dansAnneau(t[0][0], t[0][1], gr.ext)); if (g) g.trous.push(t); }
    if (!groupes.length) return null;
    const md = matTerre(false), mc = matTerre(true);
    const grp = prisme(groupes, k * T, (k + 1) * T, md, mc, false);
    maquette.add(grp);
    return { grp, md, mc, k };
  }).filter(Boolean);

  flaque.value.set((minX + maxX) / 2 - 0.08 * W, (minZ + maxZ) / 2 - 0.05 * D, 0.62 * Math.max(W, D), 0.3);
  { const demi = new Uint16Array(champ.length); for (let k = 0; k < champ.length; k++) demi[k] = THREE.DataUtils.toHalfFloat(champ[k]);
    const t = new THREE.DataTexture(demi, NX, NZ, THREE.RedFormat, THREE.HalfFloatType); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    texChamp.value = t; grilleChamp.value.set(x0 - 0.5 * cell, z0 - 0.5 * cell, 1 / (NX * cell), 1 / (NZ * cell)); }

  // ——— Table : ombre portée (VSM) + ombre de contact floue (canevas) ———
  const table = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.4, transparent: true, depthWrite: false }));
  table.rotation.x = -Math.PI / 2; table.position.y = -EP - 0.004; table.receiveShadow = true; table.renderOrder = -2;
  const contact = (() => {
    const m = 1.1, w = W + 2 * m, d = D + 2 * m, res = 256 / Math.max(w, d), cw = Math.ceil(w * res), ch = Math.ceil(d * res);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.beginPath();
    for (const r of anneaux) { r.forEach(([x, z], k) => { const px = (x - minX + m) * res, pz = (z - minZ + m) * res; if (k) g.lineTo(px, pz); else g.moveTo(px, pz); }); g.closePath(); }
    g.fill();
    const id = g.getImageData(0, 0, cw, ch), a = new Float32Array(cw * ch);
    for (let k = 0; k < a.length; k++) a[k] = id.data[k * 4 + 3] / 255;
    const f = flouBoite(a, cw, ch, Math.max(2, Math.round(res * 0.12)), 3);
    for (let k = 0; k < a.length; k++) { id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = 0; id.data[k * 4 + 3] = Math.round(255 * Math.min(1, f[k] * 1.15)); }
    g.putImageData(id, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, color: 0x000000 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set((minX + maxX) / 2, -EP - 0.002, (minZ + maxZ) / 2); mesh.renderOrder = -1;
    return mesh;
  })();
  scene.add(table, contact);

  // ——— Lumières : soleil rasant d'ouest-nord-ouest (longues ombres des balises), ciel doux, contre-jour ———
  const soleil = new THREE.DirectionalLight(0xffeedd, 2.6);
  soleil.position.set(-8.2, 4.4, -2.6); soleil.target.position.set(0.3, 0, 0.2);
  soleil.castShadow = true; soleil.shadow.bias = -0.0004; soleil.shadow.radius = 6; soleil.shadow.blurSamples = 16;
  const demiOmbre = Math.hypot(W, D) / 2 + 1.2;
  Object.assign(soleil.shadow.camera, { left: -demiOmbre, right: demiOmbre, top: demiOmbre, bottom: -demiOmbre, near: 0.5, far: 30 });
  const tailleOmbre = () => (etroit() ? 1024 : 2048);
  soleil.shadow.mapSize.set(tailleOmbre(), tailleOmbre());
  const ciel = new THREE.HemisphereLight(0xffffff, 0x808080, 0.8);
  const contre = new THREE.DirectionalLight(0xffffff, 0.9); contre.position.set(5, 3.2, -6.5);
  scene.add(soleil, soleil.target, ciel, contre);

  // ——— Balises lumineuses ———
  function fusionner(geos) {
    const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g)), out = new THREE.BufferGeometry();
    for (const nom of ['position', 'normal', 'uv']) {
      const arr = new Float32Array(parts.reduce((n, g) => n + g.attributes[nom].array.length, 0));
      let o = 0; for (const g of parts) { arr.set(g.attributes[nom].array, o); o += g.attributes[nom].array.length; }
      out.setAttribute(nom, new THREE.BufferAttribute(arr, parts[0].attributes[nom].itemSize));
    }
    return out;
  }
  function geoBalise(H, k) {
    const socle = new THREE.CylinderGeometry(0.03 * k, 0.04 * k, 0.016, 28); socle.translate(0, 0.008, 0);
    const mat = new THREE.CylinderGeometry(0.0068 * k, 0.011 * k, H, 12, 1); mat.translate(0, H / 2, 0);
    const collier = new THREE.CylinderGeometry(0.013 * k, 0.011 * k, 0.012, 16); collier.translate(0, H - 0.006, 0);
    return fusionner([socle, mat, collier]);
  }
  const H_BASE = pays ? 0.46 : 0.62, H_LIEU = pays ? 0.27 : 0.4;
  const geoBase = geoBalise(H_BASE, 1.35), geoLieu = geoBalise(H_LIEU, 1);
  const matMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.15 });
  const geoTete = new THREE.SphereGeometry(1, 24, 16);
  const texHalo = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.16, 'rgba(255,255,255,.75)'); r.addColorStop(0.42, 'rgba(255,255,255,.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const halos = [];
  const halo = (echelle) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo, transparent: true, depthWrite: false, toneMapped: false })); s.scale.setScalar(echelle); s.renderOrder = 4; halos.push(s); return s; };
  const lueur = (r) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ map: texHalo, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 })); m.rotation.x = -Math.PI / 2; return m; };

  // Ombre portée d'une balise : décalque au sol dans l'axe du soleil (la VSM, floue, effacerait un mât aussi fin).
  const texOmbre = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d');
    const l = g.createLinearGradient(0, 0, 112, 0); l.addColorStop(0, 'rgba(0,0,0,.95)'); l.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = l; g.beginPath(); g.moveTo(2, 12); g.lineTo(110, 14.5); g.lineTo(110, 17.5); g.lineTo(2, 20); g.closePath(); g.fill();
    const r = g.createRadialGradient(112, 16, 0, 112, 16, 13); r.addColorStop(0, 'rgba(0,0,0,.7)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(96, 0, 32, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const versSol = V(soleil.target.position.x - soleil.position.x, 0, soleil.target.position.z - soleil.position.z);
  const tanSoleil = (soleil.position.y - soleil.target.position.y) / versSol.length();
  const geoOmbre = new THREE.PlaneGeometry(1, 1); geoOmbre.rotateX(-Math.PI / 2); geoOmbre.translate(0.5, 0, 0);
  const matOmbre = new THREE.MeshBasicMaterial({ map: texOmbre, color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const angleOmbre = Math.atan2(-versSol.z, versSol.x);

  const nB = cfg.bases.length;
  const items = positions.map(([x, z], i) => { // 0…nB−1 : points d'attache ; puis les lieux
    const estBase = i < nB, H = estBase ? H_BASE : H_LIEU, y = niveaux[i] * T, k = estBase ? 1.35 : 1;
    const mat = new THREE.Mesh(estBase ? geoBase : geoLieu, matMat); mat.position.set(x, y, z); mat.castShadow = true;
    const tete = new THREE.Mesh(geoTete, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0, emissive: 0x000000 }));
    tete.scale.setScalar(0.034 * k); tete.castShadow = true;
    const h = halo(estBase ? 0.62 : 0.4), sol = lueur(estBase ? 0.5 : 0.34); sol.position.set(x, y + 0.003, z);
    const cible = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, H + 0.25, 8), new THREE.MeshBasicMaterial()); // zone de clic (le Raycaster ignore visible)
    cible.position.set(x, y + H / 2, z); cible.visible = false; cible.userData.i = estBase ? -1 : i - nB;
    const ombre = new THREE.Mesh(geoOmbre, matOmbre); ombre.position.set(x, y + 0.002, z); ombre.rotation.y = angleOmbre;
    maquette.add(mat, tete, h, sol, cible, ombre);
    return { estBase, H, k, x, y, z, mat, tete, halo: h, sol, cible, ombre, longOmbre: (H + 0.05 * k) / tanSoleil, haut: V(x, y + H + 0.05 * k, z), pied: V(x, y, z), allume: 0, rang: 0, s: 0 };
  });
  // Ordre de la vague : des points d'attache vers les lieux les plus lointains.
  items.map((it, i) => [i, it.estBase ? -1 : Math.min(...items.slice(0, nB).map((b) => Math.hypot(it.x - b.x, it.z - b.z)))]).sort((a, b) => a[1] - b[1]).forEach(([i], r) => { items[i].rang = r; });

  // ——— Câbles lumineux : arc au-dessus de la maquette, du point d'attache le plus proche vers chaque lieu ———
  class Arc extends THREE.Curve {
    constructor(a, b, h) { super(); this.a = a; this.b = b; this.h = h; }
    getPoint(t, cible = new THREE.Vector3()) { return cible.copy(this.a).lerp(this.b, t).setY(this.a.y + (this.b.y - this.a.y) * t + this.h * Math.sin(Math.PI * t)); }
  }
  const signalLin = C(), accentLin = C();
  function matCable() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 });
    m.userData.u = { uTrace: { value: 0 }, uProg: { value: 0 }, uAllume: { value: 0 }, uSignal: { value: signalLin } };
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, m.userData.u);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLong;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLong = uv.x;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLong; uniform float uTrace, uProg, uAllume; uniform vec3 uSignal;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (vLong > uTrace) discard;
          float derriere = uAllume * (1.0 - smoothstep(uProg - 0.02, uProg + 0.002, vLong));
          float tete = uAllume * exp(-pow((vLong - uProg) * 24.0, 2.0)) * (1.0 - step(0.999, uProg));
          diffuseColor.rgb = mix(diffuseColor.rgb, uSignal, derriere * 0.75);
          totalEmissiveRadiance += uSignal * (derriere * 1.1 + tete * 2.6);`);
    };
    m.customProgramCacheKey = () => 'mt-cable';
    return m;
  }
  const rayonCable = () => (etroit() ? 0.014 : 0.0085);
  const hauteurArc = (long) => (pays ? Math.min(1.05, 0.2 + 0.12 * long) : 0.12 + 0.1 * long);
  const tirer = (a, b) => { const c = new Arc(a, b, hauteurArc(Math.hypot(b.x - a.x, b.z - a.z))); c.arcLengthDivisions = 200; return c; };
  const cables = cfg.lieux.map((l, n) => {
    const it = items[nB + n], courbe = tirer(items[l.base].haut, it.haut);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(courbe, 96, rayonCable(), 6, false), matCable());
    maquette.add(mesh);
    return { courbe, mesh, allume: 0, long: courbe.getLength() };
  });
  // Entre points d'attache : un câble couleur accent (ils travaillent ensemble).
  const liens = [];
  for (let a = 0; a < nB; a++) for (let b = a + 1; b < nB; b++) {
    const courbe = tirer(items[a].haut, items[b].haut), m = matCable();
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(courbe, 120, rayonCable(), 6, false), m);
    maquette.add(mesh); liens.push({ courbe, mesh });
  }
  const geoCoeur = new THREE.SphereGeometry(1, 14, 10);
  const envoiVis = { coeur: new THREE.Mesh(geoCoeur, new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false })), halo: halo(0.5), trainee: Array.from({ length: 6 }, (_, k) => halo(0.28 - k * 0.03)) };
  envoiVis.coeur.scale.setScalar(0.03); envoiVis.coeur.renderOrder = 6; maquette.add(envoiVis.coeur, envoiVis.halo, ...envoiVis.trainee);
  const onde = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  onde.rotation.x = -Math.PI / 2; onde.visible = false; maquette.add(onde);

  // ——— Étiquettes HTML (le calque est dans la scène aria-hidden : la liste reste l'interface) ———
  const etiquettes = items.map((it, i) => {
    const el = document.createElement('span'); el.className = 'mt-etiquette' + (it.estBase ? ' est-base' : '');
    const nom = document.createElement('span'); nom.className = 'mt-e-nom'; nom.textContent = it.estBase ? cfg.bases[i].nom : cfg.lieux[i - nB].nom; el.append(nom);
    if (it.estBase && cfg.bases[i].role) { const r = document.createElement('span'); r.className = 'mt-e-role'; r.textContent = cfg.bases[i].role; el.append(r); }
    if (!it.estBase) {
      el.addEventListener('click', () => ui.choisir(i - nB));
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') ui.survoler(i - nB); });
      el.addEventListener('pointerleave', () => ui.survoler(-1));
    }
    const fil = document.createElement('span'); fil.className = 'mt-fil'; // fil de rappel quand l'étiquette s'écarte de sa balise
    if (calque) calque.append(fil, el);
    return { el, fil, base: it.estBase, active: false, w: 60, h: 22, place: 0, montre: false, filMontre: false, x: -1, y: -1 };
  });
  const mesurer = () => etiquettes.forEach((et) => { et.w = et.el.offsetWidth || et.w; et.h = et.el.offsetHeight || et.h; });

  // ——— Couleurs lues dans la couche ———
  let clair = false;
  const lin = (s) => C().setRGB(s[0], s[1], s[2], THREE.SRGBColorSpace);
  function couleurs() {
    const t = { fond: lireSRGB(racine, '--fond', '#0e0e0c'), surface: lireSRGB(racine, '--surface', '#1a1915'), encre: lireSRGB(racine, '--encre', '#f3efe6'),
      accent: lireSRGB(racine, '--accent', '#f26a3d'), signal: lireSRGB(racine, '--signal', '#ffcf87') };
    clair = luminance(t.fond) > 0.3;
    const nomMat = cfg.matiere || (clair ? 'carton' : 'resine'), M = MATIERES[nomMat];
    const fond = lin(t.fond), surface = lin(t.surface), encre = lin(t.encre), accent = lin(t.accent);
    signalLin.copy(lin(t.signal)); accentLin.copy(accent);
    // Sur fond clair, la maquette reste un ton sous le fond (sinon elle blanchit au soleil) ; sur fond sombre, un ton au-dessus.
    const dessus = clair ? fond.clone().lerp(surface, 0.4).multiplyScalar(nomMat === 'carton' ? 0.84 : 0.8) : surface.clone().lerp(encre, nomMat === 'beton' ? 0.22 : 0.19);
    if (nomMat !== 'carton') { const g = 0.2126 * dessus.r + 0.7152 * dessus.g + 0.0722 * dessus.b; dessus.lerp(C().setRGB(g, g, g), 0.7); } // résine, béton : gris neutre
    const regler = (mt, couleur, cote, bas, ao) => {
      mt.m.color.copy(couleur); mt.m.roughness = M.rugosite;
      const U = mt.m.userData.u;
      U.uGrain.value = cote ? M.grain * 1.2 : M.grain; U.uMacro.value = M.macro; U.uPores.value = M.pores;
      U.uClair.value.copy(clair ? couleur.clone().lerp(C().setRGB(1, 1, 1), 0.55) : couleur.clone().lerp(encre, 0.42));
      U.uLigne.value.copy(clair ? encre : fond);
      U.uBas.value = bas; U.uAO.value = ao;
      U.uTrait.value.copy(couleur.clone().lerp(encre, clair ? 0.35 : 0.3)); U.uForceTrait.value = clair ? 0.3 : 0.32;
    };
    const socleM = materiaux.find((x) => x.m === matSocle), socleC = materiaux.find((x) => x.m === matSocleCote);
    regler(socleM, dessus, false, -EP, 0.1);
    regler(socleC, dessus.clone().multiplyScalar(M.cote), true, -EP, 0.12); socleC.m.userData.u.uStrate.value = M.strate; socleC.m.userData.u.uArete.value = 0.014;
    for (const s of strates) {
      const c = dessus.clone().multiplyScalar(1 + M.palier * (s.k + 1));
      regler(materiaux.find((x) => x.m === s.md), c, false, s.k * T, 0.1);
      regler(materiaux.find((x) => x.m === s.mc), c.clone().multiplyScalar(M.cote + 0.08), true, s.k * T, 0.035);
      s.mc.userData.u.uStrate.value = 0; s.mc.userData.u.uArete.value = 0.01;
    }
    soleil.intensity = clair ? 2.1 : 2.9; ciel.intensity = clair ? 0.75 : 0.85;
    ciel.color.copy(C().setRGB(1, 1, 1).lerp(surface, 0.2)); ciel.groundColor.copy(fond);
    contre.color.copy(C().setRGB(1, 1, 1).lerp(accent, 0.35)); contre.intensity = clair ? 0.6 : 1.1;
    matMat.color.copy(clair ? encre.clone().lerp(surface, 0.18) : encre.clone().lerp(surface, 0.3));
    table.material.opacity = clair ? 0.2 : 0.42; matOmbre.opacity = clair ? 0.2 : 0.42;
    contact.material.opacity = clair ? 0.34 : 0.7;
    for (const c of cables) c.mesh.material.color.copy(encre.clone().lerp(fond, clair ? 0.5 : 0.6));
    for (const l of liens) { l.mesh.material.color.copy(accent); l.mesh.material.emissive.copy(accent); l.mesh.material.emissiveIntensity = clair ? 0.15 : 0.55; }
    envoiVis.coeur.material.color.copy(signalLin); envoiVis.halo.material.color.copy(signalLin); envoiVis.trainee.forEach((s) => s.material.color.copy(signalLin));
    onde.material.color.copy(signalLin);
    const fusion = clair ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const s of halos) s.material.blending = fusion;
    items.forEach((it) => {
      it.sol.material.blending = fusion;
      if (it.estBase) {
        it.tete.material.color.copy(accent); it.tete.material.emissive.copy(accent); it.tete.material.emissiveIntensity = 1.5;
        it.halo.material.color.copy(accent); it.sol.material.color.copy(accent);
      } else { it.halo.material.color.copy(signalLin); it.sol.material.color.copy(signalLin); }
    });
  }

  // ——— Caméra : vue 3/4, la maquette entière dans la partie libre du cadre ———
  const repos = { R: 14, th: -0.24, ph: 0.86, cible: V(0, 0, 0) };
  const cam = { th: repos.th, cible: V() }, but = { th: repos.th, cible: V() };
  const incl = { x: 0, y: 0, vx: 0, vy: 0 }; // inclinaison qui suit la souris (douce)
  let decal = { x: 0, y: 0 }, libre = 0, largeur = 1, hauteurPx = 1;
  function poserCamera(R, th, ph, cible) {
    camera.position.set(cible.x + R * Math.sin(th) * Math.cos(ph), cible.y + R * Math.sin(ph), cible.z + R * Math.cos(th) * Math.cos(ph));
    camera.lookAt(cible); camera.updateMatrixWorld();
  }
  function appliquerDecalage() { // décale le centre de l'image (px) sans changer l'axe de la caméra
    const sx = Math.abs(decal.x), sy = Math.abs(decal.y), pw = largeur + 2 * sx, ph = hauteurPx + 2 * sy;
    camera.aspect = pw / ph; camera.setViewOffset(pw, ph, decal.x > 0 ? 0 : 2 * sx, decal.y > 0 ? 2 * sy : 0, largeur, hauteurPx);
    camera.updateProjectionMatrix();
  }
  const coins = [];
  { const tous = anneaux.flat(), pas = Math.max(1, Math.floor(tous.length / 160));
    for (let i = 0; i < tous.length; i += pas) { coins.push(V(tous[i][0], -EP, tous[i][1]), V(tous[i][0], 0.12, tous[i][1])); }
    for (const it of items) coins.push(it.haut.clone().setY(it.haut.y + 0.08)); }
  const tmp = V();
  function cadrer() {
    largeur = Math.max(1, boite.clientWidth); hauteurPx = Math.max(1, boite.clientHeight);
    const rb = boite.getBoundingClientRect(), rp = panneau ? panneau.getBoundingClientRect() : null;
    libre = rp && rp.left < rb.right - 1 && rp.top < rb.bottom && rp.bottom > rb.top ? rb.right - rp.left + 12 : 0;
    camera.fov = etroit() ? 27 : 24;
    repos.ph = pays ? (etroit() ? 1.06 : 0.84) : (etroit() ? 0.98 : 0.78);
    repos.th = pays ? -0.2 : -0.3;
    decal = { x: 0, y: 0 };
    const dispoX = ((largeur - libre) / largeur) * 2 * (etroit() ? 0.95 : 0.88), dispoY = 2 * (etroit() ? 0.9 : 0.84);
    let R = repos.R;
    for (let k = 0; k < 7; k++) {
      appliquerDecalage(); poserCamera(R, repos.th, repos.ph, repos.cible);
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const c of coins) { tmp.copy(c).project(camera); a0 = Math.min(a0, tmp.x); a1 = Math.max(a1, tmp.x); b0 = Math.min(b0, tmp.y); b1 = Math.max(b1, tmp.y); }
      R *= Math.max((a1 - a0) / dispoX, (b1 - b0) / dispoY);
      decal.x += ((largeur - libre) / largeur - 1 - (a0 + a1) / 2) * largeur / 2;
      decal.y += (-0.02 - (b0 + b1) / 2) * hauteurPx / 2;
    }
    repos.R = R; appliquerDecalage();
  }

  // ——— Placement des étiquettes (pixels du cadre) ———
  const ecran = (v) => { tmp.copy(v).applyMatrix4(maquette.matrixWorld).project(camera); return { x: (tmp.x + 1) / 2 * largeur, y: (1 - tmp.y) / 2 * hauteurPx }; };
  function placerEtiquettes() {
    const ancres = items.map((it) => ecran(it.haut)), pieds = items.map((it) => ecran(it.pied)), poses = [];
    const lampes = ancres.map((a) => ({ x0: a.x - 5, x1: a.x + 5, y0: a.y - 5, y1: a.y + 7 }));
    const ordre = items.map((_, i) => i).sort((a, b) => {
      const pa = etiquettes[a].base ? 0 : etiquettes[a].active ? 1 : 2, pb = etiquettes[b].base ? 0 : etiquettes[b].active ? 1 : 2;
      return pa - pb || ancres[b].y - ancres[a].y;
    });
    const xMax = largeur - libre - 4;
    for (const i of ordre) {
      const et = etiquettes[i], a = ancres[i], f = pieds[i], w = et.w, h = et.h, g = 7, cote = w / 2 + 10;
      const cand = [[a.x, a.y - g], [a.x + cote, a.y + h / 2 - 2], [a.x - cote, a.y + h / 2 - 2], [f.x, f.y + h + 5],
        [a.x, a.y - g - h - 4], [a.x + w / 2 + 6, a.y - g - h / 2], [a.x - w / 2 - 6, a.y - g - h / 2],
        [f.x + cote, f.y + h + 2], [f.x - cote, f.y + h + 2], [a.x, a.y - g - 2 * (h + 4)]];
      const rect = (j) => { const x0r = Math.min(Math.max(4, cand[j][0] - w / 2), xMax - w); return { x0: x0r, x1: x0r + w, y0: cand[j][1] - h, y1: cand[j][1] }; };
      const dedansR = (r) => r.x0 >= 4 && r.x1 <= xMax + 0.5 && r.y0 >= 4 && r.y1 <= hauteurPx - 4;
      const gene = (r) => {
        let s = 0;
        for (const p of poses) s += Math.max(0, Math.min(p.x1, r.x1) - Math.max(p.x0, r.x0) + 3) * Math.max(0, Math.min(p.y1, r.y1) - Math.max(p.y0, r.y0) + 3);
        lampes.forEach((o, n) => { if (n !== i && o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0) s += 40; });
        return s;
      };
      let j = et.place < cand.length ? et.place : 0, r = rect(j), ok = true; // hystérésis : la place précédente tant qu'elle reste libre
      if (!dedansR(r) || gene(r) > 0) {
        let meilleur = -1, score = Infinity;
        for (let n = 0; n < cand.length; n++) { const q = rect(n); if (!dedansR(q)) continue; const sc = gene(q); if (sc < score) { score = sc; meilleur = n; } if (!sc) break; }
        j = meilleur < 0 ? 0 : meilleur; r = rect(j);
        if (score > 0 && !et.base && !et.active) ok = false; // aucune place libre : masquée plutôt que superposée (la liste reste)
      }
      const montre = ok && items[i].s > 0.7;
      if (montre) { poses.push(r); et.place = j; } else et.place = 0;
      if (montre !== et.montre) { et.montre = montre; et.el.classList.toggle('est-visible', montre); }
      if (ok) { const x = Math.round(r.x0), y = Math.round(r.y0); if (x !== et.x || y !== et.y) { et.x = x; et.y = y; et.el.style.transform = `translate3d(${x}px,${y}px,0)`; } }
      const o = j === 3 || j === 7 || j === 8 ? f : a, px = Math.min(r.x1, Math.max(r.x0, o.x)), py = Math.min(r.y1, Math.max(r.y0, o.y));
      const long = Math.hypot(px - o.x, py - o.y), filMontre = montre && long > 12;
      if (filMontre) et.fil.style.transform = `translate3d(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px,0) rotate(${Math.atan2(py - o.y, px - o.x).toFixed(4)}rad) scaleX(${(long - 2).toFixed(1)})`;
      if (filMontre !== et.filMontre) { et.filMontre = filMontre; et.fil.classList.toggle('est-visible', filMontre); }
    }
  }

  // ——— État et animation (rendu à la demande) ———
  let pret = false, visible = false, perdu = false, raf = 0, dernier = 0, introT0 = -1, premiere = false, ombreSale = 3; // images à venir dont la carte d'ombre doit être recalculée
  let active = -1, envoi = null, ondeT0 = -1;
  const INTRO = 1700 + 70 * items.length + 900;
  const peutTourner = () => pret && visible && !document.hidden && !perdu;

  let choisie = -1;
  function majBut() { // la caméra se tourne légèrement vers le lieu CHOISI (pas l'aperçu au survol : l'étiquette glisserait sous le curseur)
    const it = choisie >= 0 ? items[nB + choisie] : null;
    but.th = repos.th + (it ? Math.max(-1, Math.min(1, it.x / (W / 2))) * 0.05 : 0);
    but.cible.copy(repos.cible); if (it) but.cible.lerp(V(it.x, it.y, it.z), 0.1);
  }
  function activer(i, e, choix = i) {
    const ancienne = active;
    active = i; envoi = i >= 0 ? e : null; ondeT0 = -1; choisie = choix;
    majBut();
    for (const k of [ancienne, i]) if (k >= 0) { const et = etiquettes[nB + k]; et.active = k === i; et.el.classList.toggle('est-active', et.active); }
    mesurer();
    demander();
  }

  function maj(dt, now) {
    let bouge = false;
    const rm = reduit.matches;
    const e = rm || introT0 < 0 ? INTRO + 1 : now - introT0;
    if (e < INTRO) bouge = true;
    // 1. La maquette se pose (1 100 ms) ; l'ombre de contact se resserre.
    const pose = sortie4(borne01(e / 1100));
    maquette.position.y = 0.9 * (1 - pose); maquette.rotation.y = 0.1 * (1 - pose);
    maquette.updateMatrixWorld();
    contact.material.opacity = (clair ? 0.34 : 0.7) * pose * pose; contact.scale.setScalar(1.18 - 0.18 * pose);
    // 2. Les strates montent, une par une.
    for (const s of strates) s.grp.scale.y = Math.max(0.001, sortie3(borne01((e - 650 - 150 * s.k) / 520)));
    // 3. Balises : points d'attache, puis les lieux en vague ; leur lumière s'allume avec elles.
    for (const it of items) {
      const debut = it.estBase ? 1250 + 120 * it.rang : 1500 + 70 * it.rang;
      it.s = rm ? 1 : sortieRessort(borne01((e - debut) / 520));
      const s = Math.max(0.001, it.s);
      it.mat.scale.set(1, s, 1);
      it.tete.position.set(it.x, it.y + (it.H + 0.026 * it.k) * s, it.z); it.tete.visible = it.s > 0.02;
      it.halo.position.copy(it.tete.position);
      it.ombre.scale.set(it.longOmbre * s * 1.1, 1, 0.075 * it.k); it.ombre.visible = it.s > 0.02;
    }
    // 4. Les câbles se tirent depuis les points d'attache.
    liens.forEach((l) => { l.mesh.material.userData.u.uTrace.value = rm ? 1 : sortie3(borne01((e - 1350) / 1100)); });
    cables.forEach((c, n) => { c.mesh.material.userData.u.uTrace.value = rm ? 1 : sortie3(borne01((e - 1750 - 70 * items[nB + n].rang) / 850)); }); // sans ombre : à cette échelle, l'ombre d'un câble ressemble à une salissure

    // Caméra : approche d'arrivée, rotation douce vers le lieu actif, inclinaison qui suit la souris.
    const k = rm ? 1 : 1 - Math.exp(-dt * 3);
    cam.th += (but.th - cam.th) * k; cam.cible.lerp(but.cible, k);
    if (Math.abs(but.th - cam.th) > 1e-4 || cam.cible.distanceTo(but.cible) > 1e-4) bouge = true;
    const ki = rm ? 1 : 1 - Math.exp(-dt * 4.5);
    incl.x += ((rm ? 0 : incl.vx) - incl.x) * ki; incl.y += ((rm ? 0 : incl.vy) - incl.y) * ki;
    if (Math.abs(incl.vx - incl.x) > 1e-4 || Math.abs(incl.vy - incl.y) > 1e-4) bouge = !rm || bouge;
    const ka = rm ? 1 : sortie3(borne01(e / 2600));
    poserCamera(repos.R * (1 + 0.12 * (1 - ka)), cam.th - 0.1 * (1 - ka) + incl.x * 0.07, repos.ph + 0.07 * (1 - ka) - incl.y * 0.035, cam.cible);

    // Impulsion du lieu choisi : le compteur de l'interface suit la même courbe (même t0, même durée).
    let pEnvoi = 1;
    if (envoi) pEnvoi = envoi.duree ? borne01((now - envoi.t0) / envoi.duree) : 1;
    const uEnvoi = entreeSortie(pEnvoi), montreEnvoi = !!envoi && !rm && pEnvoi < 1;
    envoiVis.coeur.visible = envoiVis.halo.visible = montreEnvoi;
    envoiVis.trainee.forEach((s, j) => {
      const uj = uEnvoi - (j + 1) * 0.02; s.visible = montreEnvoi && uj > 0;
      if (s.visible) { cables[envoi.i].courbe.getPointAt(uj, s.position); s.material.opacity = (0.5 - j * 0.07) * (clair ? 0.7 : 1); }
    });
    if (montreEnvoi) { cables[envoi.i].courbe.getPointAt(uEnvoi, envoiVis.coeur.position); envoiVis.halo.position.copy(envoiVis.coeur.position); envoiVis.halo.material.opacity = clair ? 0.7 : 1; envoiVis.coeur.material.opacity = 1; bouge = true; }
    if (envoi && pEnvoi >= 1 && ondeT0 < 0 && !rm) ondeT0 = now;
    cables.forEach((c, n) => {
      const vise = active === n ? 1 : 0;
      c.allume += (vise - c.allume) * (rm ? 1 : 1 - Math.exp(-dt * 8));
      if (Math.abs(vise - c.allume) > 1e-3) bouge = true;
      const U = c.mesh.material.userData.u; U.uAllume.value = c.allume; U.uProg.value = active === n ? uEnvoi : 1;
    });
    // Lumières : points d'attache allumés ; lieux en veille douce, le lieu choisi s'allume à l'arrivée de l'impulsion.
    items.forEach((it, i) => {
      const v = borne01(it.s);
      if (it.estBase) { it.halo.material.opacity = (clair ? 0.55 : 0.85) * v; it.sol.material.opacity = (clair ? 0.3 : 0.45) * v; it.sol.scale.setScalar(Math.max(0.001, v)); return; }
      const vise = active === i - nB && pEnvoi >= 1 ? 1 : 0;
      it.allume += (vise - it.allume) * (rm ? 1 : 1 - Math.exp(-dt * 10));
      if (Math.abs(vise - it.allume) > 1e-3) bouge = true;
      const niveau = Math.max(it.allume, 0.5 * v);
      it.tete.material.color.copy(matMat.color).lerp(signalLin, Math.min(1, niveau * 1.4));
      it.tete.material.emissive.copy(signalLin); it.tete.material.emissiveIntensity = niveau * 2.2;
      it.halo.material.opacity = niveau * (clair ? 0.6 : 0.85); it.halo.visible = niveau > 0.01;
      it.halo.scale.setScalar(0.36 + 0.26 * it.allume);
      it.sol.material.opacity = it.allume * (clair ? 0.35 : 0.5); it.sol.visible = it.allume > 0.01;
    });
    if (ondeT0 >= 0 && active >= 0) {
      const p = (now - ondeT0) / 1100, it = items[nB + active];
      onde.visible = p < 1;
      if (p < 1) { onde.position.set(it.x, it.y + 0.006, it.z); onde.scale.setScalar(0.05 + 0.32 * sortie3(p)); onde.material.opacity = 0.8 * (1 - p); bouge = true; }
    } else onde.visible = false;
    return bouge;
  }
  function peindre() {
    rendu.render(scene, camera); placerEtiquettes();
    if (!premiere) { premiere = true; racine.classList.add('est-3d'); } // est-attente reste : sinon l'animation CSS du repli repartirait sous la toile transparente
  }
  function boucle(now) {
    raf = 0; if (!peutTourner()) { dernier = 0; return; }
    const dt = dernier ? Math.min(0.05, (now - dernier) / 1000) : 0; dernier = now;
    if (introT0 < 0) introT0 = now; // l'arrivée part de la première image peinte, pas de la première visibilité
    const bouge = maj(dt, now);
    if (now - introT0 < INTRO + 400 || ombreSale > 0) { rendu.shadowMap.needsUpdate = true; ombreSale = Math.max(0, ombreSale - 1); }
    peindre();
    if (bouge) raf = requestAnimationFrame(boucle); else dernier = 0;
  }
  function demander() { if (!raf && peutTourner()) raf = requestAnimationFrame(boucle); }

  // ——— Pointeur : survol, clic des balises, inclinaison ———
  const rayon = new THREE.Raycaster();
  const visables = items.filter((it) => !it.estBase).map((it) => it.cible);
  const ndc = new THREE.Vector2();
  function viser(ev) {
    const r = toile.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    rayon.setFromCamera(ndc, camera);
    const t = rayon.intersectObjects(visables, false)[0];
    return t ? t.object.userData.i : -1;
  }
  toile.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'mouse') return; const i = viser(ev); boite.classList.toggle('est-survol', i >= 0); ui.survoler(i); });
  toile.addEventListener('pointerleave', () => { boite.classList.remove('est-survol'); ui.survoler(-1); });
  // Inclinaison : sur toute la scène (étiquettes comprises), figée quand le pointeur est sur une étiquette.
  boite.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse' || reduit.matches || (ev.target.closest && ev.target.closest('.mt-etiquette'))) return;
    const r = boite.getBoundingClientRect(); incl.vx = ((ev.clientX - r.left) / r.width) * 2 - 1; incl.vy = ((ev.clientY - r.top) / r.height) * 2 - 1; demander();
  });
  boite.addEventListener('pointerleave', () => { incl.vx = incl.vy = 0; demander(); });
  toile.addEventListener('click', (ev) => { const i = viser(ev); if (i >= 0) ui.choisir(i); });

  toile.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); perdu = true; premiere = false; racine.classList.remove('est-3d'); racine.classList.add('est-repli'); });
  toile.addEventListener('webglcontextrestored', () => { perdu = false; ombreSale = 3; racine.classList.remove('est-repli'); demander(); });
  racine.addEventListener('couche:style', () => { couleurs(); demander(); });
  let etaitEtroit = etroit();
  function redimensionner() {
    rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, etroit() ? 1.5 : 2));
    rendu.setSize(Math.max(1, boite.clientWidth), Math.max(1, boite.clientHeight), false);
    if (etroit() !== etaitEtroit) {
      etaitEtroit = etroit(); soleil.shadow.mapSize.set(tailleOmbre(), tailleOmbre());
      for (const c of [...cables, ...liens]) { const seg = c.mesh.geometry.parameters.tubularSegments; c.mesh.geometry.dispose(); c.mesh.geometry = new THREE.TubeGeometry(c.courbe, seg, rayonCable(), 6, false); }
      if (soleil.shadow.map) { soleil.shadow.map.dispose(); soleil.shadow.map = null; }
    }
    ombreSale = 3; couleurs(); mesurer(); cadrer(); majBut();
    // setSize vide la toile : on repeint tout de suite (sinon une image blanche jusqu'à la prochaine trame).
    if (pret && !perdu && introT0 >= 0 && !document.hidden) { maj(0, performance.now()); rendu.shadowMap.needsUpdate = true; peindre(); }
    demander();
  }
  new ResizeObserver(redimensionner).observe(boite);
  new IntersectionObserver((ent) => { visible = ent[0].isIntersecting; demander(); }, { rootMargin: '100px' }).observe(boite);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; dernier = 0; } else demander(); });
  reduit.addEventListener('change', () => demander());
  if (document.fonts) document.fonts.ready.then(() => { mesurer(); demander(); });

  couleurs(); redimensionner();
  try { await rendu.compileAsync(scene, camera); } catch (err) { console.warn('maquette-territoire : précompilation impossible, compilation au premier rendu', err); }
  pret = true; cam.th = repos.th; cam.cible.copy(repos.cible); demander();
  return { activer, duree: (i) => dureeEnvoi(cables[i] ? cables[i].long / 1.4 : 4) };
}

document.querySelectorAll(SEL).forEach(init);
