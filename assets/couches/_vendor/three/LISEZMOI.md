# Three.js r184 (0.184.0) — copie auto-hébergée

Source : paquet npm officiel `three@0.184.0` (empreintes SHA-256 vérifiées le 02/10/2026 contre le tarball du registre).
Licence MIT (fichier `LICENSE`). Fichiers repris tels quels : `three.module.min.js`, `three.core.min.js`.
`RoomEnvironment.js` (examples/jsm/environments) : seule modification, l'import `'three'` réécrit en
`'./three.module.min.js'` (pas de carte d'import : elle serait un script en ligne, refusé par la CSP `script-src 'self'`).
`materialiser.mjs` copie ce dossier dans le site quand une couche déclare `"dependances": ["three"]`.
