# Livre photo de voyage

Concepteur de livres photo en ligne : on importe ses photos (depuis l'ordinateur ou un album
[Immich](https://immich.app)), le site **retrace le voyage** à partir des dates et des positions GPS,
propose des **cartes** (vue d'ensemble + une carte par étape), met les photos en page
automatiquement, puis exporte un **PDF prêt à imprimer**.

- Serveur : PHP 8.3 (sans framework ni dépendance Composer), SQLite, GD.
- Navigateur : JavaScript sans étape de build, [Leaflet](https://leafletjs.com) et [Cropper.js](https://github.com/fengyuanchen/cropperjs).
- PDF : Chromium via [Gotenberg](https://gotenberg.dev) (ou un Chromium local).
- Cartes : tuiles OpenStreetMap (ou tout fournisseur XYZ), noms de lieux via Nominatim.

Tout est libre.

## Démarrage rapide (Docker)

```sh
cp .env.example .env      # puis renseigner CONTACT_EMAIL, et Immich si besoin
docker compose up -d --build
```

Ouvrir <http://localhost:8080>.

## Sans Docker

Il faut PHP ≥ 8.1 avec les extensions `gd` (JPEG/WebP/FreeType), `exif`, `pdo_sqlite` et `curl`, plus
un Chromium pour le PDF (de préférence `chrome-headless-shell`), ou une instance Gotenberg.

```sh
cp .env.example .env      # mettre GOTENBERG_URL= (vide) et CHROMIUM_BIN=/chemin/vers/chrome-headless-shell
bin/serve                 # http://127.0.0.1:8080
```

Sur Apache, faire pointer le `DocumentRoot` sur `public/` (voir `docker/apache.conf`).

## Utilisation

1. **Photos** : glisser-déposer des JPEG/PNG/WebP, ou « Importer depuis Immich » (choix d'un album,
   puis des photos). Le site lit la date de prise de vue, la position GPS, l'orientation et l'appareil.
2. **Voyage** : les photos sont regroupées en étapes, affichées sur une carte interactive.
   - Le curseur **Cartes / étapes** règle la finesse du découpage (vers « Plus » = découpe plus fine).
   - Les étapes sont nommées automatiquement (ville fournie par Immich, sinon Nominatim) ; chaque nom est modifiable.
   - Réglages : distance D et écart de temps T, et décalage d'horloge par appareil (photo + téléphone).
   - **Créer le livre** : couverture, carte globale, une carte par étape, et 1 à 6 photos par page.
3. **Livre** : format (A3, A4, A5, carré 20 ou 30 cm ; portrait ou paysage), fond perdu, marges,
   espacement. 11 dispositions de page, glisser-déposer des photos, **recadrage** et
   **luminosité / contraste**, légendes. Le site signale les photos de résolution insuffisante (< 150 dpi).
4. **Exporter en PDF** : photos recadrées à 300 dpi, cartes rendues à 240 dpi, fond perdu inclus.

## Le regroupement en étapes

Fichier `public/js/clustering.js` (tests : `node --test tests/*.test.mjs`).

1. Les photos sont triées par heure, corrigée du décalage de chaque appareil.
2. Une photo sans GPS prend une position interpolée entre ses voisines, si elles sont à moins de 6 h.
3. **Regroupement hiérarchique contraint dans le temps** : on part d'une photo par groupe, puis on
   fusionne à chaque pas les deux groupes *consécutifs* les plus proches selon
   `coût = √((distance entre centres / D)² + (écart de temps / T)²)`.
   Seuls des groupes voisins dans le temps peuvent fusionner : l'ordre du voyage est conservé, et
   un retour au même endroit plus tard forme une nouvelle étape.
4. L'historique complet des fusions est conservé. Obtenir *k* étapes revient à rejouer les *n − k*
   premières fusions : le curseur réagit donc instantanément.
5. Nombre d'étapes suggéré : on garde séparés les groupes dont le coût de fusion dépasse 1, c'est-à-dire
   plus éloignés que D (20 km par défaut) ou séparés de plus de T (48 h par défaut). Plusieurs jours dans
   la même ville forment donc une seule étape ; un cran de plus sur le curseur la découpe par journée.

Sur la carte globale, les étapes sont numérotées et reliées dans l'ordre. Un trajet de plus de
300 km est tracé en arc pointillé (vol).

## Configuration (`.env`)

| Variable | Rôle |
|---|---|
| `GOTENBERG_URL` | URL de Gotenberg (`http://gotenberg:3000` avec Docker Compose). Vide = Chromium local. |
| `CHROMIUM_BIN` | Chemin de Chromium / `chrome-headless-shell` si Gotenberg n'est pas utilisé. |
| `TILE_URL` | Modèle d'URL des tuiles (`{z}`, `{x}`, `{y}`, `{s}`, `{r}` pour le suffixe `@2x`). |
| `TILE_RETINA` | `1` si le fournisseur sert des tuiles `@2x` (cartes plus nettes à l'impression). |
| `TILE_ATTRIBUTION` | Mention imprimée sur les cartes (obligatoire pour OpenStreetMap). |
| `NOMINATIM_URL` | Service de géocodage inverse (1 requête par seconde au maximum, mise en cache). |
| `CONTACT_EMAIL` | Contact placé dans le User-Agent, exigé par les règles d'usage d'OSM. |
| `IMMICH_URL`, `IMMICH_API_KEY` | Serveur Immich et clé API. La clé reste côté serveur. |
| `DATA_DIR` | Dossier des données (par défaut `data/`). |

**Fonds de carte** : le serveur `tile.openstreetmap.org` tolère un usage léger. Les tuiles sont
gardées en cache dans `data/tiles`. Pour un usage régulier, prendre une clé gratuite chez
MapTiler, Stadia ou Thunderforest, ou servir ses propres tuiles. Par exemple :
`TILE_URL=https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}{r}.png?key=VOTRE_CLE` avec
`TILE_RETINA=1`.

## Architecture

```
public/index.php        API REST + routage (sert app.html pour le reste)
public/js/              interface : app, photos-view, trip-view, book-view, photo-editor
public/js/clustering.js regroupement spatio-temporel (pur, testé)
public/js/book.js       géométrie des pages et mise en page automatique (pur, testé)
src/Photos.php, Exif.php     import, métadonnées, aperçus
src/ImageProcessor.php       orientation, recadrage, luminosité/contraste (GD)
src/StaticMap.php            cartes statiques : tuiles + tracé + repères
src/BookRenderer.php         projet → HTML imprimable + images
src/PdfEngine.php            HTML → PDF (Gotenberg ou Chromium)
src/Immich.php, Geocoder.php services externes
src/layouts.json             dispositions de page (partagées entre le PHP et le JS)
```

L'aperçu de l'éditeur et le PDF utilisent les mêmes calculs : `book.js` reproduit
`Format::slotRect()` et `ImageProcessor::coverRegion()`, le filtre SVG de l'aperçu reproduit les
filtres GD, et les cartes de l'aperçu sont rendues par le serveur comme celles du PDF.

## Limites actuelles et pistes

- HEIC / RAW : GD ne les lit pas. Depuis Immich, le site se rabat sur l'aperçu JPEG (moins défini).
  Ajouter Imagick permettrait de lire les originaux.
- Pas encore de comptes utilisateurs : à déployer derrière une authentification (proxy, Authelia…).
- Pistes : trajets routiers réels (OSRM), éviter le chevauchement des noms de villes sur la carte,
  pages de texte libre, thèmes et polices, export pour un imprimeur (profil CMJN, PDF/X).

## Version d'essai sans serveur

`demo/livre-photo-essai.html` est une version autonome qui tourne entièrement dans le navigateur.
Elle a été écrite pour l'essayer depuis un téléphone. On y retrouve le même découpage en étapes et
les mêmes dispositions de page. Le fond de carte (Natural Earth 1:50m) est intégré au fichier, et le PDF
est produit dans le navigateur avec jsPDF. Les photos ne quittent pas l'appareil et ne sont pas enregistrées.
