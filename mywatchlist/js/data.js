// Données de référence : familles de genres, statuts, et la liste de départ.

export const FAMILIES = {
  fanta:  { name: 'Fantasy & isekai',    color: '#5a3f98', ink: '#ffffff' },
  dark:   { name: 'Dark fantasy',        color: '#4a2440', ink: '#ffffff' },
  aven:   { name: 'Aventure',            color: '#1f5f8b', ink: '#ffffff' },
  shonen: { name: 'Shōnen action',       color: '#c8501f', ink: '#ffffff' },
  thril:  { name: 'Thriller & policier', color: '#33404f', ink: '#ffffff' },
  histo:  { name: 'Historique',          color: '#7a5634', ink: '#ffffff' },
  sport:  { name: 'Sport',               color: '#2c7a4b', ink: '#ffffff' },
  slice:  { name: 'Romance & quotidien', color: '#b04a72', ink: '#ffffff' },
  comed:  { name: 'Comédie',             color: '#e2b52f', ink: '#15171c' },
  medic:  { name: 'Médical',             color: '#2a8783', ink: '#ffffff' },
  scifi:  { name: 'Science-fiction',     color: '#3d6f73', ink: '#ffffff' }
};

export const STATUSES = {
  cours: { label: 'En cours',  plural: 'En cours',   kanji: '中' },
  voir:  { label: 'À voir',    plural: 'À voir',     kanji: '積' },
  pause: { label: 'En pause',  plural: 'En pause',   kanji: '休' },
  stop:  { label: 'Abandonné', plural: 'Abandonnés', kanji: '止' },
  fini:  { label: 'Terminé',   plural: 'Terminés',   kanji: '完' }
};
export const STATUS_ORDER = ['cours', 'voir', 'pause', 'stop', 'fini'];

export const KINDS = {
  anime: { label: 'Animes', one: 'Anime', pic: 'section-animes', hash: '#/animes' },
  manga: { label: 'Mangas', one: 'Manga', pic: 'section-mangas', hash: '#/mangas' },
  serie: { label: 'Séries', one: 'Série', pic: 'section-series', hash: '#/series' },
  film:  { label: 'Films',  one: 'Film',  pic: 'section-films',  hash: '#/films' }
};

// Pictogramme de chaque statut (fichiers img/pictos/*.svg)
export const STATUS_PIC = { cours: 'statut-en-cours', voir: 'statut-a-voir', pause: 'statut-en-pause', stop: 'statut-abandonne', fini: 'statut-termine' };
// Un film se voit ou pas : trois statuts seulement, « Terminé » devient « Vu »
export const FILM_STATUSES = ['voir', 'fini', 'stop'];
export function statusLabel(s, kind, plural = false) {
  if (kind === 'film' && s === 'fini') return 'Vu' + (plural ? 's' : '');
  const st = STATUSES[s];
  return st ? (plural ? st.plural : st.label) : '—';
}

// Associe les genres renvoyés par MyAnimeList ou TVmaze à une famille de couleur.
const GENRE_MAP = [
  [/sports?/i, 'sport'],
  [/medical/i, 'medic'],
  [/horror|horreur|gore|psychological|vampire/i, 'dark'],
  [/crime|thriller|suspense|mystery|myst[eè]re|detective|espionage|legal|policier/i, 'thril'],
  [/histor|samurai|war\b|guerre|military/i, 'histo'],
  [/isekai|fantasy|fantastique|magic|reincarnation|game|supernatural/i, 'fanta'],
  [/sci-?fi|science-fiction|science fiction|mecha|space/i, 'scifi'],
  [/romance|slice of life|drama|drame|family|familial|music|musique/i, 'slice'],
  [/comedy|com[eé]die|gag|parody/i, 'comed'],
  [/adventure|aventure|animation|western/i, 'aven'],
  [/action|martial|super ?power/i, 'shonen']
];
export function familyFromGenres(genres = []) {
  for (const [re, fam] of GENRE_MAP) {
    if (genres.some(g => re.test(g))) return fam;
  }
  return 'aven';
}

/* ---------- Genres ----------
   Un catalogue commun aux animes, mangas, séries et films. Chaque genre appartient à une famille,
   qui donne la couleur de l'affiche. L'admin peut en créer d'autres depuis la page Genres. */

/** Clé stable d'un nom : minuscules, sans accents ni ponctuation. « Science-fiction » → « science-fiction ». */
export function genreKey(name) {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// [nom, famille] : genres, thèmes et publics courants des animes, mangas, séries et films
export const DEFAULT_GENRES = [
  ['Action', 'shonen'], ['Arts martiaux', 'shonen'], ['Combat', 'shonen'], ['Super-pouvoirs', 'shonen'], ['Super-héros', 'shonen'],
  ['Ninja', 'shonen'], ['Shōnen', 'shonen'], ['Seinen', 'shonen'],
  ['Aventure', 'aven'], ['Animation', 'aven'], ['Pirates', 'aven'], ['Voyage', 'aven'], ['Western', 'aven'], ['Jeunesse', 'aven'], ['Documentaire', 'aven'],
  ['Fantasy', 'fanta'], ['Isekai', 'fanta'], ['Magie', 'fanta'], ['Surnaturel', 'fanta'], ['Réincarnation', 'fanta'], ['Jeu vidéo', 'fanta'], ['Mythologie', 'fanta'], ['Conte', 'fanta'],
  ['Dark fantasy', 'dark'], ['Horreur', 'dark'], ['Gore', 'dark'], ['Psychologique', 'dark'], ['Démons', 'dark'], ['Vampires', 'dark'], ['Survie', 'dark'], ['Tragédie', 'dark'],
  ['Thriller', 'thril'], ['Policier', 'thril'], ['Mystère', 'thril'], ['Enquête', 'thril'], ['Crime', 'thril'], ['Espionnage', 'thril'], ['Juridique', 'thril'], ['Suspense', 'thril'], ['Politique', 'thril'],
  ['Historique', 'histo'], ['Samouraï', 'histo'], ['Guerre', 'histo'], ['Militaire', 'histo'], ['Biographie', 'histo'],
  ['Sport', 'sport'], ['Football', 'sport'], ['Basket', 'sport'], ['Volley', 'sport'], ['Sports de combat', 'sport'], ['Course', 'sport'],
  ['Romance', 'slice'], ['Tranche de vie', 'slice'], ['Drame', 'slice'], ['Shōjo', 'slice'], ['Josei', 'slice'], ['Musique', 'slice'], ['Idols', 'slice'],
  ['École', 'slice'], ['Famille', 'slice'], ['Gastronomie', 'slice'],
  ['Comédie', 'comed'], ['Parodie', 'comed'], ['Gag', 'comed'], ['Comédie romantique', 'comed'],
  ['Médical', 'medic'],
  ['Science-fiction', 'scifi'], ['Mecha', 'scifi'], ['Cyberpunk', 'scifi'], ['Espace', 'scifi'], ['Voyage temporel', 'scifi'], ['Post-apocalyptique', 'scifi'], ['Science', 'scifi']
].map(([name, fam]) => ({ id: genreKey(name), name, fam }));

// Genres renvoyés par Kitsu, AniList, TMDB et TVmaze (souvent en anglais) → noms du catalogue
const SYN = {
  'action-adventure': ['Action', 'Aventure'], adventure: ['Aventure'], comedy: ['Comédie'], drama: ['Drame'], horror: ['Horreur'],
  mystery: ['Mystère'], psychological: ['Psychologique'], 'sci-fi': ['Science-fiction'], 'science-fiction': ['Science-fiction'],
  'sci-fi-fantasy': ['Science-fiction', 'Fantasy'], 'science-fiction-fantastique': ['Science-fiction', 'Fantasy'], fantastique: ['Fantasy'],
  'slice-of-life': ['Tranche de vie'], sports: ['Sport'], supernatural: ['Surnaturel'], music: ['Musique'], 'mahou-shoujo': ['Magie'],
  magic: ['Magie'], family: ['Famille'], familial: ['Famille'], war: ['Guerre'], 'war-politics': ['Guerre', 'Politique'], 'guerre-politique': ['Guerre', 'Politique'],
  history: ['Historique'], histoire: ['Historique'], historical: ['Historique'], documentary: ['Documentaire'], kids: ['Jeunesse'],
  medical: ['Médical'], legal: ['Juridique'], 'martial-arts': ['Arts martiaux'], military: ['Militaire'], samurai: ['Samouraï'], space: ['Espace'],
  'super-power': ['Super-pouvoirs'], superhero: ['Super-héros'], vampire: ['Vampires'], school: ['École'], shounen: ['Shōnen'], shonen: ['Shōnen'],
  shoujo: ['Shōjo'], shojo: ['Shōjo'], game: ['Jeu vidéo'], 'video-game': ['Jeu vidéo'], 'time-travel': ['Voyage temporel'], survival: ['Survie'],
  tragedy: ['Tragédie'], detective: ['Enquête'], espionage: ['Espionnage'], reincarnation: ['Réincarnation'], demons: ['Démons'], parody: ['Parodie'],
  'gag-humor': ['Gag'], gourmet: ['Gastronomie'], cooking: ['Gastronomie'], 'post-apocalyptic': ['Post-apocalyptique'], mythology: ['Mythologie'],
  'romantic-comedy': ['Comédie romantique'], romcom: ['Comédie romantique'], 'dark-fantasy': ['Dark fantasy'], politics: ['Politique'],
  basketball: ['Basket'], soccer: ['Football'], volleyball: ['Volley'], racing: ['Course'], 'combat-sports': ['Sports de combat'], fighting: ['Combat'],
  thriller: ['Thriller'], suspense: ['Suspense'], crime: ['Crime'], romance: ['Romance'], fantasy: ['Fantasy'], action: ['Action'], mecha: ['Mecha'],
  isekai: ['Isekai'], idols: ['Idols'], 'idols-female': ['Idols'], 'idols-male': ['Idols'], seinen: ['Seinen'], josei: ['Josei'], western: ['Western'],
  animation: ['Animation'], police: ['Policier'], psychologie: ['Psychologique'], jeux: ['Jeu vidéo'], surnaturelle: ['Surnaturel'], policiere: ['Policier'], cyberpunk: ['Cyberpunk'], gore: ['Gore'], ninja: ['Ninja'], pirates: ['Pirates'], science: ['Science']
};
/** Noms du catalogue correspondant à un genre venu d'une API (ou d'un ancien texte libre). */
export function genreNamesFor(raw) {
  const k = genreKey(raw);
  return SYN[k] || [];
}

// Liste de départ : [titre affiché, genre, famille, statut, type, recherche API]
export const SEED = [
  ['Blue Lock', 'Sport · football', 'sport', 'cours', 'anime', 'Blue Lock'],
  ['Boruto', 'Ninja', 'shonen', 'cours', 'anime', 'Boruto: Naruto Next Generations'],
  ['Chainsaw Man', 'Dark fantasy', 'dark', 'cours', 'anime', 'Chainsaw Man'],
  ['Dr. Stone', 'Science & aventure', 'aven', 'cours', 'anime', 'Dr. Stone'],
  ['Fire Force', 'Action surnaturelle', 'dark', 'cours', 'anime', 'Enen no Shouboutai'],
  ['Gachiakuta', 'Dark fantasy', 'dark', 'cours', 'anime', 'Gachiakuta'],
  ["Hell's Paradise", 'Dark fantasy', 'dark', 'cours', 'anime', 'Jigokuraku'],
  ['Hunter x Hunter', 'Aventure', 'aven', 'cours', 'anime', 'Hunter x Hunter (2011)'],
  ['JoJo – Steel Ball Run', 'Aventure bizarre', 'aven', 'cours', 'manga', 'Steel Ball Run'],
  ['Jujutsu Kaisen', 'Dark fantasy', 'dark', 'cours', 'anime', 'Jujutsu Kaisen'],
  ["Les Carnets de l'apothicaire", 'Mystère historique', 'histo', 'cours', 'anime', 'Kusuriya no Hitorigoto'],
  ['Moi, quand je me réincarne en Slime', 'Isekai', 'fanta', 'cours', 'anime', 'Tensei shitara Slime Datta Ken'],
  ['My Hero Academia', 'Super-héros', 'shonen', 'cours', 'anime', 'Boku no Hero Academia'],
  ['One Piece', 'Aventure · pirates', 'aven', 'cours', 'anime', 'One Piece'],
  ['Sakamoto Days', 'Action & comédie', 'shonen', 'cours', 'anime', 'Sakamoto Days'],
  ['Spy x Family', 'Comédie · espionnage', 'comed', 'cours', 'anime', 'Spy x Family'],
  ['Tokyo Revengers', 'Voyage temporel', 'thril', 'cours', 'anime', 'Tokyo Revengers'],
  ['Tower of God', 'Fantasy', 'fanta', 'cours', 'anime', 'Kami no Tou'],
  ['Wistoria', 'Fantasy · magie', 'fanta', 'cours', 'anime', 'Tsue to Tsurugi no Wistoria'],
  ['Akame ga Kill', 'Dark fantasy', 'dark', 'voir', 'anime', 'Akame ga Kill!'],
  ['Btooom!', 'Survie', 'thril', 'voir', 'anime', 'Btooom!'],
  ['Bungo Stray Dogs', 'Surnaturel · enquête', 'thril', 'voir', 'anime', 'Bungou Stray Dogs'],
  ['Devilman Crybaby', 'Horreur', 'dark', 'voir', 'anime', 'Devilman: Crybaby'],
  ['Dragon Ball', 'Arts martiaux', 'shonen', 'voir', 'anime', 'Dragon Ball'],
  ['Du mouvement de la Terre', 'Historique · science', 'histo', 'voir', 'anime', 'Chi. Chikyuu no Undou ni Tsuite'],
  ['Haikyu!!', 'Sport · volley', 'sport', 'voir', 'anime', 'Haikyuu!!'],
  ['Kingdom', 'Guerre historique', 'histo', 'voir', 'anime', 'Kingdom'],
  ['Moriarty the Patriot', 'Policier historique', 'histo', 'voir', 'anime', 'Yuukoku no Moriarty'],
  ['Overgeared', 'Jeu vidéo · fantasy', 'fanta', 'voir', 'manga', 'Overgeared'],
  ['Overlord', 'Isekai', 'fanta', 'voir', 'anime', 'Overlord'],
  ['Re:Zero', 'Isekai', 'fanta', 'voir', 'anime', 'Re:Zero kara Hajimeru Isekai Seikatsu'],
  ['Shangri-La Frontier', 'Jeu vidéo', 'fanta', 'voir', 'anime', 'Shangri-La Frontier'],
  ["The Aristocrat's Otherworldly Adventure", 'Isekai', 'fanta', 'voir', 'anime', 'Tensei Kizoku no Isekai Boukenroku'],
  ['The Rising of the Shield Hero', 'Isekai', 'fanta', 'voir', 'anime', 'Tate no Yuusha no Nariagari'],
  ['Bleach', 'Surnaturel', 'shonen', 'fini', 'anime', 'Bleach'],
  ['Code Geass', 'Mecha · stratégie', 'shonen', 'fini', 'anime', 'Code Geass: Hangyaku no Lelouch'],
  ['Devil May Cry', 'Action · démons', 'dark', 'fini', 'anime', 'Devil May Cry'],
  ['Dororo', 'Dark fantasy historique', 'dark', 'fini', 'anime', 'Dororo'],
  ['Fullmetal Alchemist', 'Fantasy · alchimie', 'aven', 'fini', 'anime', 'Fullmetal Alchemist: Brotherhood'],
  ['JoJo (Phantom Blood → Stone Ocean)', 'Aventure bizarre', 'aven', 'fini', 'anime', 'JoJo no Kimyou na Bouken (TV)'],
  ['Magi: Adventure of Sinbad', 'Aventure · fantasy', 'aven', 'fini', 'anime', 'Magi: Sinbad no Bouken (TV)'],
  ['Magi: The Labyrinth of Magic', 'Aventure · fantasy', 'aven', 'fini', 'anime', 'Magi: The Labyrinth of Magic'],
  ['Naruto', 'Ninja', 'shonen', 'fini', 'anime', 'Naruto'],
  ['No Game No Life', 'Isekai · jeux', 'fanta', 'fini', 'anime', 'No Game No Life'],
  ['Ranking of Kings', 'Fantasy · conte', 'fanta', 'fini', 'anime', 'Ousama Ranking'],
  ['Rokka: Braves of the Six Flowers', 'Fantasy · mystère', 'fanta', 'fini', 'anime', 'Rokka no Yuusha'],
  ['Solo Leveling', 'Action · donjons', 'fanta', 'fini', 'anime', 'Ore dake Level Up na Ken'],
  ['Vinland Saga', 'Historique · vikings', 'histo', 'fini', 'anime', 'Vinland Saga'],
  ['Dr House', 'Médical', 'medic', 'voir', 'serie', 'House'],
  ['Good Doctor', 'Médical', 'medic', 'voir', 'serie', 'The Good Doctor'],
  ['High Potential', 'Policier', 'thril', 'voir', 'serie', 'High Potential'],
  ['Lie to Me', 'Policier · psychologie', 'thril', 'voir', 'serie', 'Lie to Me'],
  ['The Mentalist', 'Policier', 'thril', 'voir', 'serie', 'The Mentalist'],
  ['You', 'Thriller', 'thril', 'voir', 'serie', 'You']
];
