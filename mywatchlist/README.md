# Watchlist de Linerol

La watchlist privée de Linerol : ses animes, mangas, séries et films, ce qu'il regarde, ce qu'il a fini et ce qui attend son tour.
Le site est réservé à quelques invités. Chacun a un rôle et un pseudo, peut suggérer des titres, et Linerol valide.

- **En ligne :** <https://linerol.github.io/mywatchlist/> (non référencé par les moteurs de recherche)
- **Technique :** HTML, CSS et JavaScript (modules ES) servis tels quels par GitHub Pages, sans étape de compilation
- **Données :** Firebase (Authentication et Firestore), offre gratuite Spark
- **Installable :** l'app s'ajoute à l'écran d'accueil du téléphone (PWA) et s'ouvre hors connexion

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Rôles et droits](#rôles-et-droits)
3. [Organisation du code](#organisation-du-code)
4. [Sources de données externes](#sources-de-données-externes)
5. [Modèle de données Firestore](#modèle-de-données-firestore)
6. [Sécurité](#sécurité)
7. [Installation et configuration](#installation-et-configuration)
8. [Développer en local](#développer-en-local)
9. [Mettre en ligne](#mettre-en-ligne)
10. [Charte graphique](#charte-graphique)
11. [Règles d'interface](#règles-dinterface)
12. [Limites connues](#limites-connues)
13. [Crédits](#crédits)

---

## Fonctionnalités

### La liste
- **Quatre sections :** Animes, Mangas, Séries, Films.
- **Statuts :** En cours, À voir, En pause, Abandonné, Terminé. Un film n'en a que trois : À voir, Vu, Abandonné.
- **Affiches automatiques :** elles sont cherchées chez Kitsu, TMDB ou AniList (voir plus bas), avec un squelette de chargement et un fondu.
- **Filtres et tri :** recherche, filtre par genre (11 familles de couleurs), tri A → Z, par genre, par statut ou par activité.
- **Nouveaux épisodes de la semaine :** la liste des animes en cours qui sortent un épisode dans les 7 jours, à l'heure de Paris.
- **Tirage au sort « Je regarde quoi ce soir ? » :** un titre au hasard parmi les « À voir ». Le même titre ne sort jamais deux fois de suite, un compteur affiche le nombre de tirages, et il y a deux boutons : *Effacer* et *Je le commence*.
- **Temps restant :** affiché sur les cartes en cours, par exemple « ≈ 8 h restantes ».
- **Coups de cœur et activité :** une rangée de coups de cœur et une liste des derniers changements.
- **Changements en direct :** une carte modifiée par quelqu'un d'autre s'allume brièvement.

### La fiche d'un titre
- **Progression :** statut, saison, épisode ou chapitre, avec des boutons + et −. La fiche indique aussi le reste à voir : « Reste 20 épisodes · ≈ 8 h ».
- **Avis :** une note sur 10, un avis écrit, les dates de début et de fin, le genre et la couleur.
- **Type du titre :** on peut passer par exemple d'anime à manga. La progression est convertie (épisodes ↔ chapitres) et une nouvelle affiche est proposée.
- **Où le regarder en France :** les plateformes légales (abonnement, location, achat), via TMDB et JustWatch.
- **Corriger l'affiche :** on cherche le bon titre dans les sources et on choisit le résultat.
- **Côté membres :** « Je l'ai vu aussi » avec sa propre note, et « Me prévenir quand ça avance ».
- **Corbeille :** un titre supprimé y reste 30 jours, restaurable, puis il est effacé.

### Ajouter et suggérer
- **Recherche dans plusieurs sources, avec bascule automatique :** si une source ne répond pas, la suivante prend le relais.
- **Création à la main** si le titre est introuvable ou si toutes les sources sont en panne : titre, genre, couleur, total, année et image (facultative), avec un aperçu de l'affiche.
- **Suggestions des membres :** les membres votent pour les suggestions des autres, et Linerol les valide dans « À valider ».

### Pour Linerol (admin)
- **À valider :** les suggestions, les modifications proposées par les éditeurs et les demandes d'accès.
- **Membres :** inviter un email, choisir son rôle, copier un message d'invitation, retirer quelqu'un.
- **Stats :** temps passé devant l'écran, temps restant, répartition par genre et par statut, titres terminés par année, historique complet, export de toutes les données en JSON.
- **Où regarder :** la liste des sites de streaming, que Linerol remplit lui-même, et des conseils de bloqueurs de pub pour ordinateur et téléphone.

### Confort
- **Hors connexion :** la liste s'ouvre sans réseau. Les changements faits hors ligne partent tout seuls au retour de la connexion, et un bandeau prévient quand on est hors ligne.
- **Mises à jour :** un bandeau « Nouvelle version disponible » propose de recharger. Dans l'app installée, on peut aussi tirer vers le bas pour rafraîchir.
- **Pseudos :** uniques, choisis dans « Mon profil ». Les membres ne voient jamais l'email des autres.

---

## Rôles et droits

| Ce qu'on peut faire | Lecteur | Éditeur | Admin |
|---|:-:|:-:|:-:|
| Voir la liste, les fiches, les avis, les stats | ✓ | ✓ | ✓ |
| « Je l'ai vu aussi », sa note, « Me prévenir » | ✓ | ✓ | — |
| Suggérer un titre, voter | ✓ | ✓ | ✓ |
| Changer un statut, un épisode, une note | — | proposition à valider | ✓ |
| Valider, gérer les membres, la corbeille, les sites | — | — | ✓ |

**Comment on devient membre :** l'admin ajoute l'email dans « Membres ». La personne crée son mot de passe à sa première visite, puis clique sur le lien de vérification reçu par email. Un compte non invité peut demander l'accès depuis l'écran « Accès réservé ».

---

## Organisation du code

```
mywatchlist/
├── index.html             Page unique : charge les polices, la feuille de style et js/app.js
├── manifest.webmanifest   Installation sur l'écran d'accueil
├── sw.js                  Service worker : cache de l'app et du SDK Firebase, mises à jour
├── firestore.rules        Règles de sécurité à coller dans la console Firebase
├── css/style.css          Toute la mise en forme (jetons, composants, écrans, téléphone)
├── js/
│   ├── app.js             État, routage, écrans, actions, écoutes Firestore
│   ├── config.js          Configuration Firebase, nom du propriétaire, clé TMDB
│   ├── data.js            Familles de genres, statuts, types, liste de départ
│   ├── external.js        Recherche et métadonnées (Kitsu, TMDB, AniList, TVmaze)
│   └── firebase.js        Point d'entrée unique vers le SDK Firebase (CDN officiel)
├── img/
│   ├── logo-tampon.png    Logo de l'en-tête et des icônes
│   ├── logo-signe.png     Logo de l'écran de connexion
│   ├── logo-grave.png     Logo des chargements et des pages vides
│   └── pictos/*.svg       Pictogrammes des statuts, des sections et des actions
└── icons/                 Icônes d'app et favicons
```

### Fonctionnement de `app.js`
- **État :** un seul objet `S` contient tout (utilisateur, rôle, titres, demandes, interface).
- **Rendu :** `render()` reconstruit la page à partir de l'état, en gardant le focus et la position du curseur dans les champs.
- **Routage par ancre :** `#/animes`, `#/mangas`, `#/series`, `#/films`, `#/titre/<id>`, `#/ajouter`, `#/valider`, `#/membres`, `#/stats`, `#/avis`, `#/aide`, `#/profil`, `#/ou-regarder`, `#/corbeille`.
- **Événements délégués :** les éléments portent `data-act` (clic), `data-in` (saisie) ou `data-submit` (formulaire). Chacun renvoie à une fonction des objets `ACT`, `INPUT` et `SUBMIT`.
- **Écritures :** elles passent par `sent()`, qui ne bloque pas l'écran hors connexion. Le cache local applique le changement tout de suite et l'envoie au retour du réseau.

### Stockage dans le navigateur (par appareil)
| Clé | Contenu |
|---|---|
| `mw:welcome:<email>` | Carte de bienvenue fermée |
| `mw:decisions:<email>` | Dernière lecture des réponses aux demandes |
| `mw:meta3:<id>` | Affiche et infos trouvées pour un titre |
| `mw:prov:<type>:<id>` | Plateformes de streaming, gardées 24 h |

Le cache Firestore (IndexedDB) garde en plus une copie de la base pour le mode hors connexion.

---

## Sources de données externes

Chaque type essaie plusieurs sources dans l'ordre, et la première qui répond gagne. Une recherche tapée à la main abandonne une source au bout de quelques secondes. La recherche automatique des affiches est plus patiente.

| Type | 1ʳᵉ source | 2ᵉ | 3ᵉ |
|---|---|---|---|
| Animes | Kitsu | TMDB | AniList |
| Mangas | Kitsu | AniList | — |
| Films | TMDB | Kitsu | AniList |
| Séries | TVmaze | TMDB | — |

- **Kitsu** (`kitsu.app/api/edge`) : sans clé. Il fournit l'identifiant MyAnimeList, qui sert à trouver les prochains épisodes.
- **TMDB** (`api.themoviedb.org/3`) : nécessite une clé API v3 dans `js/config.js`. Il fournit les titres en français, les affiches et les plateformes de streaming en France (données JustWatch).
- **AniList** (`graphql.anilist.co`) : sans clé. Il sert de secours pour la recherche et donne la date du prochain épisode. Son API est limitée à 30 requêtes par minute en ce moment, donc toutes les requêtes passent par une file espacée de 2,1 s.
- **TVmaze** (`api.tvmaze.com`) : sans clé, pour les séries.

---

## Modèle de données Firestore

| Collection | Identifiant | Contenu | Qui lit | Qui écrit |
|---|---|---|---|---|
| `members` | email en minuscules | `role` (`admin`, `editor`, `reader`), `name`, `uid`, `pseudo`, `pseudoKey`, `addedAt` | admin, et chacun sa fiche | admin ; chacun peut seulement relier son compte et changer son pseudo |
| `pseudos` | clé du pseudo (`sam-le-lecteur`) | `uid`, `pseudo`, `key` : l'annuaire public, qui garantit l'unicité | membres | le propriétaire du pseudo |
| `titles` | automatique | voir ci-dessous | membres | admin |
| `titles/{id}/seen` | `uid` du membre | `name`, `rating`, `at` : « Je l'ai vu aussi » | membres | le membre concerné |
| `trash` | identifiant du titre | copie du titre et `deletedAt` | admin | admin |
| `follows` | `uid` | `titles` : l'état de chaque titre suivi | le membre | le membre |
| `requests` | automatique | `type` (`suggestion` ou `edit`), `by` (uid), `byName`, `status`, `item` ou `changes`/`before`, `note`, dates | membres | création par un membre ; décision par l'admin |
| `requests/{id}/votes` | `uid` du votant | `at` | membres | le votant |
| `history` | automatique | `at`, `by`, `byName`, `text` | membres | admin |
| `adminLog` | automatique | journal des membres et des accès | admin | admin |
| `accessRequests` | email | `email`, `note`, `at` | admin, et le demandeur | le demandeur ; suppression par l'admin |
| `settings/streaming` | `streaming` | `sites` : `{ name, url, note }` | membres | admin |

**Champs d'un titre :**

| Groupe | Champs |
|---|---|
| Identité | `title`, `altTitle`, `kind` (`anime`, `manga`, `serie`, `film`), `genre`, `fam` (famille de couleur) |
| Statut et progression | `status`, `season`, `episode`, `chapter`, `total` |
| Avis | `rating`, `review`, `startedAt`, `finishedAt`, `fav` |
| Source | `cover`, `source` (`kitsu`, `tmdb`, `anilist`, `tvmaze`, `manual`), `tmdbType`, `extId`, `malId`, `duration` (min par épisode), `year`, `lookup`, `metaTried` |
| Dates techniques | `createdAt`, `updatedAt` |

Certains anciens documents (`seen`, `follows`, `votes`, `requests.by`) sont encore rangés sous l'email. Les règles et le code acceptent les deux formats, et les nouveaux documents utilisent l'identifiant du compte.

---

## Sécurité

- **Aucun secret dans le code :** les valeurs de `config.js` (configuration Firebase, clé TMDB) sont publiques par nature. Ce sont les règles Firestore qui protègent les données.
- **Accès :** il faut un compte avec un email vérifié et présent dans `members`. Sinon, on ne lit rien.
- **Écritures :** seul l'admin modifie la liste, les membres, l'historique, la corbeille et les réglages. Un éditeur ne peut que déposer une demande « en attente », en son propre nom.
- **Emails :** les membres voient uniquement les pseudos (collection `pseudos`) ; seul l'admin lit `members`.
- **Clé API Firebase :** elle est restreinte aux sites `https://linerol.github.io/*`, `https://mywatchlist-3fe82.firebaseapp.com/*` (liens des emails) et `http://localhost/*`.
- **Discrétion :** la page porte `noindex, nofollow`.

Les règles complètes sont dans [`firestore.rules`](firestore.rules). **Après toute modification de ce fichier, il faut les recoller dans la console :** Firestore Database → Règles → Publier.

---

## Installation et configuration

Pour repartir de zéro avec un nouveau projet Firebase :

1. **Créer le projet** sur [console.firebase.google.com](https://console.firebase.google.com), sur l'offre Spark, sans Google Analytics.
2. **Enregistrer une app web**, sans Firebase Hosting, et copier l'objet `firebaseConfig` dans `js/config.js`.
3. **Authentication** :
   - activer « Adresse e-mail/Mot de passe » ;
   - ajouter `linerol.github.io` aux domaines autorisés ;
   - passer les modèles d'emails en français.
4. **Firestore Database** : créer la base en mode production, à l'emplacement `europe-west9` (Paris).
5. **Se déclarer admin** : créer le document `members/<ton email en minuscules>` avec les champs `role: "admin"` et `name: "Linerol"`.
6. **Règles** : coller le contenu de `firestore.rules`, puis Publier.
7. **Clé API** : dans Google Cloud → Identifiants, restreindre la « Browser key » aux sites listés dans [Sécurité](#sécurité).
8. **TMDB (facultatif mais recommandé)** : créer un compte sur themoviedb.org, demander une clé API v3 et la mettre dans `TMDB_KEY` (`js/config.js`). Sans cette clé, les films viennent de Kitsu et AniList (animation surtout), et les plateformes de streaming ne s'affichent pas.

**À la première connexion de l'admin :**
- le bouton « Importer mes 54 titres » charge la liste de départ (`SEED` dans `js/data.js`) ;
- les affiches arrivent ensuite automatiquement ;
- il reste à choisir son pseudo dans « Mon profil ».

---

## Développer en local

Il n'y a rien à installer : n'importe quel serveur de fichiers statiques suffit.

```bash
cd linerol.github.io
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/mywatchlist/
```

**Pour que la connexion marche en local :**
- `localhost` doit être dans les domaines autorisés d'Authentication (il y est par défaut) ;
- `http://localhost/*` doit figurer dans les restrictions de la clé API. Si tu utilises un port précis, ajoute aussi `http://localhost:8000/*`.

**Conseils :**
- Le service worker sert le réseau en priorité. Si une ancienne version reste affichée, recharge sans cache, ou désactive le service worker dans les outils du navigateur.
- Pour vérifier la syntaxe sans navigateur : `node --experimental-default-type=module --check js/app.js`.

---

## Mettre en ligne

Le site est servi par GitHub Pages depuis la branche `main` : un `git push` suffit.

**À chaque mise en ligne**, change le numéro de `CACHE` dans `sw.js` (par exemple `mywatchlist-v7` → `mywatchlist-v8`). C'est ce changement qui affiche « Nouvelle version disponible » aux personnes qui ont déjà l'app ouverte ou installée.

Si le déploiement GitHub Pages reste bloqué, pousser un commit vide sur `main` le relance.

---

## Charte graphique

Le thème s'appelle « Hanko » : papier, encre et tampons vermillon, dans l'univers du Japon traditionnel et du manga imprimé.

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| papier | `#e9ebee` | `#121419` | Fond |
| papier clair | `#f7f8fa` | `#1b1e25` | Encadrés |
| encre | `#15171c` | `#eef0f4` | Texte, bordures |
| encre douce | `#555b66` | `#a0a7b3` | Texte secondaire |
| vermillon | `#d23c2a` | `#ff6a52` | Aplats, boutons d'action, statut « En cours » |
| vermillon texte | `#b3301f` | `#ff7a66` | Petits textes rouges (liens, alertes) |

- **Polices :**
  - Dela Gothic One pour les titres ;
  - Zen Kaku Gothic New pour le texte ;
  - DotGothic16 pour les étiquettes et les chiffres ;
  - Shippori Mincho pour le sceau uniquement.
- **Logos :** Tampon dans l'en-tête et les icônes d'app, Signé sur la connexion, Gravé pour les chargements et les pages vides.
- **Pictogrammes** (`img/pictos/`) : ils sont en SVG et appliqués en masque CSS, donc ils prennent la couleur du texte. Un picto est toujours accompagné de son mot, sauf sur les affiches. Les kanji ne servent que de décor, jamais sous 18 px.
- **Mode sombre :** il suit automatiquement le réglage du téléphone ou de l'ordinateur.

---

## Règles d'interface

Ces règles sont vérifiées par un audit automatique de tous les écrans à 320, 375, 390 et 430 px, en clair et en sombre, pour les trois rôles :

- **Pas de débordement :** aucune page plus large que l'écran, aucun élément qui en sort. Les textes longs (emails, adresses, titres) passent à la ligne ou sont tronqués avec « … ».
- **Champs à 16 px minimum,** sinon iOS zoome à la saisie. Les champs date sont rendus souples, car iOS leur impose une largeur fixe.
- **Cibles tactiles d'au moins 40 à 44 px.**
- **Groupes de boutons :** les filtres tiennent sur une ligne qui défile (`.segs-scroll`), les choix occupent toute la largeur (`.segs-fill`).
- **Barre d'onglets du téléphone :** toujours sombre, avec cinq entrées (Animes, Mangas, Séries, Films, puis À valider ou Suggérer selon le rôle).
- **Mouvements réduits :** les animations s'arrêtent si l'appareil le demande.

---

## Limites connues

- **Pas de notification push :** il faudrait un serveur (Cloud Functions), donc l'offre Blaze, qui demande une carte bancaire. À la place, le site affiche ce qui a changé quand on l'ouvre.
- **Démarrage hors connexion :** il faut avoir déjà ouvert l'app une fois en ligne sur l'appareil. Les données Firebase et la session sont alors en cache.
- **Prochains épisodes :** ils dépendent d'AniList. Quand AniList ne répond pas, ce bloc reste vide sans gêner le reste.
- **Lecture directe de la base :** les anciennes demandes et l'ancien historique contiennent encore des emails. L'interface ne les montre pas aux membres, mais ils restent présents dans ces documents.

---

## Crédits

- **Données d'animes et de mangas :** [Kitsu](https://kitsu.app), [AniList](https://anilist.co), [MyAnimeList](https://myanimelist.net) (via les identifiants).
- **Séries :** [TVmaze](https://www.tvmaze.com).
- **Films et plateformes :** [TMDB](https://www.themoviedb.org). *Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.* Les plateformes de streaming proviennent de [JustWatch](https://www.justwatch.com).
- **Polices :** Google Fonts, sous licence SIL Open Font License.
- **Logos, pictogrammes et charte :** créés pour ce projet à partir de l'avatar de Linerol.
