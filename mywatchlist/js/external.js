// Recherche et métadonnées publiques : AniList (animes, mangas, films d'animation), TVmaze (séries)
// et TMDB (films, plateformes de streaming en France) quand une clé est configurée.
import { TMDB_KEY } from './config.js';

const ANILIST = 'https://graphql.anilist.co';
const TVMAZE = 'https://api.tvmaze.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// AniList limite le nombre de requêtes par minute : tout passe par une file espacée.
let chain = Promise.resolve();
function queued(fn, gap = 700) {
  const run = chain.then(fn);
  chain = run.catch(() => {}).then(() => sleep(gap));
  return run;
}

async function anilist(query, variables, tries = 3) {
  return queued(async () => {
    for (let i = 0; i < tries; i++) {
      let res;
      try {
        res = await fetch(ANILIST, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables })
        });
      } catch (e) {
        if (i === tries - 1) throw new Error('AniList injoignable (réseau ou bloqueur de pub).');
        await sleep(1500 * (i + 1));
        continue;
      }
      if (res.status === 429) {
        const wait = (+res.headers.get('Retry-After') || 5) * 1000;
        await sleep(wait);
        continue;
      }
      if (res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.errors) throw new Error('AniList : ' + ((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + res.status));
      return j.data;
    }
    throw new Error('AniList ne répond pas pour le moment. Réessaie dans une minute.');
  });
}

async function fetchJson(url, name = 'TVmaze', tries = 3) {
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url); }
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
function tmdb(path, params = {}) {
  const q = new URLSearchParams({ api_key: TMDB_KEY, language: 'fr-FR', ...params });
  return fetchJson(`${TMDB}${path}?${q}`, 'TMDB');
}
let movieGenreNames = null;
async function movieGenres() {
  if (!movieGenreNames) {
    const j = await tmdb('/genre/movie/list');
    movieGenreNames = Object.fromEntries((j.genres || []).map(g => [g.id, g.name]));
  }
  return movieGenreNames;
}
function mapMovie(m, G) {
  return {
    kind: 'film', source: 'tmdb', extId: m.id, malId: null,
    title: m.title, altTitle: m.original_title && m.original_title !== m.title ? m.original_title : '',
    cover: m.poster_path ? TMDB_IMG + 'w500' + m.poster_path : null,
    total: null, duration: null, year: m.release_date ? +m.release_date.slice(0, 4) : null,
    genres: (m.genre_ids || []).map(id => G[id]).filter(Boolean)
  };
}

/** Plateformes où regarder un titre en France (abonnement, gratuit, location, achat), mises en cache 24 h. */
export async function watchProviders(t) {
  if (!TMDB_KEY || t.kind === 'manga') return null;
  const type = t.kind === 'film' ? 'movie' : 'tv';
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

/** Recherche un titre. `popular` met les titres les plus suivis en tête (utile pour retrouver une œuvre automatiquement). */
export async function searchTitles(kind, q, { popular = false, limit = 8 } = {}) {
  const term = q.trim();
  if (!term) return [];
  if (kind === 'serie') {
    const j = await fetchJson(`${TVMAZE}/search/shows?q=${encodeURIComponent(term)}`);
    return (j || []).slice(0, limit).map(x => mapShow(x.show));
  }
  if (kind === 'film' && TMDB_KEY) {
    const [j, G] = await Promise.all([tmdb('/search/movie', { query: term, include_adult: 'false' }), movieGenres()]);
    return (j.results || []).slice(0, limit).map(m => mapMovie(m, G));
  }
  const film = kind === 'film';
  const data = await anilist(SEARCH_Q, {
    search: term, type: kind === 'manga' ? 'MANGA' : 'ANIME', perPage: limit,
    sort: popular ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : ['SEARCH_MATCH'],
    formats: film ? ['MOVIE'] : null
  });
  return ((data && data.Page && data.Page.media) || []).map(m => mapMedia(m, film));
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
