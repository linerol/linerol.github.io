// Recherche et métadonnées publiques. Chaque type essaie plusieurs sources, la première qui répond gagne :
//   animes : Kitsu → TMDB → AniList        mangas : Kitsu → AniList
//   films  : TMDB → Kitsu → AniList        séries : TVmaze → TMDB
// AniList reste utilisé pour la date du prochain épisode.
import { TMDB_KEY } from './config.js';

const ANILIST = 'https://graphql.anilist.co';
const TVMAZE = 'https://api.tvmaze.com';
const KITSU = 'https://kitsu.app/api/edge';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// AniList limite le nombre de requêtes : 90 par minute en temps normal, 30 en ce moment (mode dégradé).
// Tout passe donc par une file espacée de 2,1 s, soit moins de 30 requêtes par minute.
let chain = Promise.resolve();
function queued(fn, gap = 2100) {
  const run = chain.then(fn);
  chain = run.catch(() => {}).then(() => sleep(gap));
  return run;
}

/** fetch qui abandonne au bout de `ms` millisecondes */
async function fetchT(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(timer); }
}

// `fast` : pour une recherche tapée à la main, un seul essai court, puis on passe à la source suivante
async function anilist(query, variables, tries = 4, fast = false) {
  if (fast) tries = 1;
  // Une recherche tapée à la main ne fait pas la queue derrière la recherche des affiches
  const go = fast ? (fn => fn()) : queued;
  return go(async () => {
    for (let i = 0; i < tries; i++) {
      let res;
      try {
        res = await fetchT(ANILIST, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables })
        }, fast ? 6000 : 15000);
      } catch (e) {
        // Un refus pour trop de requêtes arrive parfois sans en-têtes CORS : le navigateur le voit comme une erreur réseau
        if (i === tries - 1) throw new Error('AniList injoignable (réseau, bloqueur de pub, ou trop de requêtes).');
        await sleep(i === 0 ? 3000 : 20000 * i);
        continue;
      }
      if (res.status === 429) {
        // Le blocage dure environ une minute
        if (i === tries - 1) break;
        const wait = (+res.headers.get('Retry-After') || 61) * 1000;
        await sleep(Math.min(Math.max(wait, 5000), 65000));
        continue;
      }
      if (res.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.errors) throw new Error('AniList : ' + ((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + res.status));
      return j.data;
    }
    throw new Error('AniList ne répond pas pour le moment. Réessaie dans une minute.');
  });
}

async function fetchJson(url, name = 'TVmaze', tries = 3, ms = 8000) {
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetchT(url, {}, ms); }
    catch (e) { if (i === tries - 1) throw new Error(name + ' injoignable.'); await sleep(1500); continue; }
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    if (res.status === 401) throw new Error(name + ' : clé API refusée.');
    if (!res.ok) throw new Error(name + ' : HTTP ' + res.status);
    return res.json();
  }
  throw new Error(name + ' ne répond pas pour le moment.');
}

/* ---------- TMDB ---------- */
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
export const hasTmdb = () => !!TMDB_KEY;
function tmdb(path, params = {}, tries = 3, ms = 8000) {
  const q = new URLSearchParams({ api_key: TMDB_KEY, language: 'fr-FR', ...params });
  return fetchJson(`${TMDB}${path}?${q}`, 'TMDB', tries, ms);
}
const genreNames = {};
async function tmdbGenres(type, tries, ms) {
  if (!genreNames[type]) {
    const j = await tmdb(`/genre/${type}/list`, {}, tries, ms);
    genreNames[type] = Object.fromEntries((j.genres || []).map(g => [g.id, g.name]));
  }
  return genreNames[type];
}
function mapMovie(m, G) {
  return {
    kind: 'film', source: 'tmdb', tmdbType: 'movie', extId: m.id, malId: null,
    title: m.title, altTitle: m.original_title && m.original_title !== m.title ? m.original_title : '',
    cover: m.poster_path ? TMDB_IMG + 'w500' + m.poster_path : null,
    total: null, duration: null, year: m.release_date ? +m.release_date.slice(0, 4) : null,
    genres: (m.genre_ids || []).map(id => G[id]).filter(Boolean)
  };
}

function mapTv(m, G, kind) {
  return {
    kind, source: 'tmdb', tmdbType: 'tv', extId: m.id, malId: null,
    title: m.name, altTitle: m.original_name && m.original_name !== m.name ? m.original_name : '',
    cover: m.poster_path ? TMDB_IMG + 'w500' + m.poster_path : null,
    total: null, duration: null, year: m.first_air_date ? +m.first_air_date.slice(0, 4) : null,
    genres: (m.genre_ids || []).map(id => G[id]).filter(Boolean)
  };
}

/** Plateformes où regarder un titre en France (abonnement, gratuit, location, achat), mises en cache 24 h. */
export async function watchProviders(t) {
  if (!TMDB_KEY || t.kind === 'manga') return null;
  const type = t.source === 'tmdb' && t.tmdbType ? t.tmdbType : t.kind === 'film' ? 'movie' : 'tv';
  const key = 'mw:prov:' + type + ':' + (t.source === 'tmdb' ? t.extId : (t.title || '').toLowerCase());
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.at < 24 * 3600e3) return hit.data;
  } catch (e) { /* stockage indisponible */ }
  let id = t.source === 'tmdb' ? t.extId : null;
  for (const q of [t.title, t.altTitle].filter(Boolean)) {
    if (id) break;
    const j = await tmdb(`/search/${type}`, { query: q });
    id = j.results && j.results[0] && j.results[0].id;
  }
  let data = { none: true };
  if (id) {
    const j = await tmdb(`/${type}/${id}/watch/providers`);
    const fr = j.results && j.results.FR;
    if (fr) {
      const list = arr => {
        const seen = new Set(), out = [];
        for (const p of arr || []) if (!seen.has(p.provider_id)) { seen.add(p.provider_id); out.push({ name: p.provider_name, logo: p.logo_path ? TMDB_IMG + 'w92' + p.logo_path : null }); }
        return out;
      };
      data = { link: fr.link, stream: list([...(fr.flatrate || []), ...(fr.free || []), ...(fr.ads || [])]), rent: list(fr.rent), buy: list(fr.buy) };
      if (!data.stream.length && !data.rent.length && !data.buy.length) data = { none: true };
    }
  }
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
  return data;
}

const MEDIA_FIELDS = `id idMal type format title { romaji english } coverImage { extraLarge large }
  episodes chapters volumes duration seasonYear startDate { year } genres status
  nextAiringEpisode { airingAt episode }`;

const SEARCH_Q = `query ($search: String, $type: MediaType, $perPage: Int, $sort: [MediaSort], $formats: [MediaFormat]) {
  Page(perPage: $perPage) { media(search: $search, type: $type, sort: $sort, format_in: $formats, isAdult: false) { ${MEDIA_FIELDS} } }
}`;

function mapMedia(m, asFilm) {
  const manga = m.type === 'MANGA';
  return {
    kind: asFilm ? 'film' : manga ? 'manga' : 'anime', source: 'anilist', extId: m.id, malId: m.idMal || null,
    title: (m.title && (m.title.english || m.title.romaji)) || '', altTitle: (m.title && m.title.romaji) || '',
    cover: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || null,
    total: manga ? (m.chapters || null) : (m.episodes || null),
    volumes: m.volumes || null, duration: manga ? null : (m.duration || null),
    year: m.seasonYear || (m.startDate && m.startDate.year) || null,
    genres: m.genres || [],
    airing: m.status === 'RELEASING', nextAiring: m.nextAiringEpisode || null
  };
}

/* ---------- Kitsu ---------- */
function mapKitsu(d, included, kind) {
  const a = d.attributes || {}, T = a.titles || {};
  const inc = id => included.find(x => x.id === id.id && x.type === id.type);
  const rel = name => ((d.relationships && d.relationships[name] && d.relationships[name].data) || []).map(inc).filter(Boolean);
  const genres = rel('categories').map(c => c.attributes && c.attributes.title).filter(Boolean);
  const mal = rel('mappings').find(m => m.attributes && /^myanimelist\//.test(m.attributes.externalSite || ''));
  const manga = kind === 'manga';
  const title = T.en || a.canonicalTitle || T.en_jp || '';
  const alt = T.en_jp || a.canonicalTitle || '';
  return {
    kind, source: 'kitsu', extId: d.id, malId: mal ? +mal.attributes.externalId || null : null,
    title, altTitle: alt !== title ? alt : '',
    cover: (a.posterImage && (a.posterImage.large || a.posterImage.original || a.posterImage.medium)) || null,
    total: manga ? (a.chapterCount || null) : kind === 'film' ? null : (a.episodeCount || null),
    duration: manga ? null : (a.episodeLength || null),
    year: a.startDate ? +a.startDate.slice(0, 4) : null,
    genres
  };
}
async function kitsuSearch(kind, term, limit, ms) {
  const type = kind === 'manga' ? 'manga' : 'anime';
  const p = new URLSearchParams({
    'filter[text]': term, 'page[limit]': String(Math.min(limit, 20)),
    include: 'categories,mappings', 'fields[categories]': 'title', 'fields[mappings]': 'externalSite,externalId'
  });
  if (kind === 'film') p.set('filter[subtype]', 'movie');
  const j = await fetchJson(`${KITSU}/${type}?${p}`, 'Kitsu', 1, ms);
  return ((j && j.data) || []).map(d => mapKitsu(d, j.included || [], kind));
}

function mapShow(s) {
  return {
    kind: 'serie', source: 'tvmaze', extId: s.id, malId: null,
    title: s.name, altTitle: '',
    cover: (s.image && (s.image.original || s.image.medium)) || null,
    total: null, duration: s.averageRuntime || s.runtime || null,
    year: s.premiered ? +s.premiered.slice(0, 4) : null,
    genres: s.genres || []
  };
}

/** Recherche un titre. `popular` = recherche automatique (affiches) : plus patiente, plus populaire d'abord. */
export async function searchTitles(kind, q, { popular = false, limit = 8 } = {}) {
  const term = q.trim();
  if (!term) return [];
  const ms = popular ? 15000 : 7000;
  const anilistSearch = async () => {
    const film = kind === 'film';
    const data = await anilist(SEARCH_Q, {
      search: term, type: kind === 'manga' ? 'MANGA' : 'ANIME', perPage: limit,
      sort: popular ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : ['SEARCH_MATCH'],
      formats: film ? ['MOVIE'] : null
    }, 2, !popular);
    return ((data && data.Page && data.Page.media) || []).map(m => mapMedia(m, film));
  };
  const tmdbSearch = async () => {
    if (!TMDB_KEY) return [];
    const type = kind === 'film' ? 'movie' : 'tv';
    const tries = popular ? 2 : 1;
    const [j, G] = await Promise.all([tmdb(`/search/${type}`, { query: term, include_adult: 'false' }, tries, ms), tmdbGenres(type, tries, ms)]);
    let list = j.results || [];
    // Pour un anime, les séries d'animation passent devant
    if (kind === 'anime') list = list.filter(m => (m.genre_ids || []).includes(16)).concat(list.filter(m => !(m.genre_ids || []).includes(16)));
    return list.slice(0, limit).map(m => type === 'movie' ? mapMovie(m, G) : mapTv(m, G, kind));
  };
  const tvmaze = async () => {
    const j = await fetchJson(`${TVMAZE}/search/shows?q=${encodeURIComponent(term)}`, 'TVmaze', popular ? 3 : 1, ms);
    return (j || []).slice(0, limit).map(x => mapShow(x.show));
  };
  const kitsu = () => kitsuSearch(kind, term, limit, ms);
  const chains = {
    anime: [['Kitsu', kitsu], ['TMDB', tmdbSearch], ['AniList', anilistSearch]],
    manga: [['Kitsu', kitsu], ['AniList', anilistSearch]],
    film: [['TMDB', tmdbSearch], ['Kitsu', kitsu], ['AniList', anilistSearch]],
    serie: [['TVmaze', tvmaze], ['TMDB', tmdbSearch]]
  };
  const down = [];
  let answered = false;
  for (const [name, fn] of chains[kind] || chains.anime) {
    try {
      const res = await fn();
      answered = true;
      if (res.length) return res;
    } catch (e) { down.push(name); }
  }
  if (answered) return [];
  throw new Error(`Recherche indisponible pour le moment (${down.join(', ')} ne répondent pas). Tu peux créer le titre à la main.`);
}

/**
 * Prochains épisodes des animes en cours de diffusion, en une seule requête.
 * `ids` : identifiants AniList ; `malIds` : identifiants MyAnimeList (titres ajoutés avant le passage à AniList).
 * Renvoie { 'al:123': { airingAt, episode }, 'mal:456': {...} }.
 */
export async function upcomingEpisodes(ids, malIds) {
  const out = {};
  const run = async (field, list, prefix) => {
    if (!list.length) return;
    const q = `query ($ids: [Int]) { Page(perPage: 50) { media(${field}: $ids, type: ANIME) { id idMal nextAiringEpisode { airingAt episode } } } }`;
    const data = await anilist(q, { ids: list.slice(0, 50) });
    for (const m of (data && data.Page && data.Page.media) || []) {
      if (!m.nextAiringEpisode) continue;
      out[prefix + (prefix === 'al:' ? m.id : m.idMal)] = m.nextAiringEpisode;
    }
  };
  await run('id_in', ids, 'al:');
  await run('idMal_in', malIds, 'mal:');
  return out;
}
