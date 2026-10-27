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
