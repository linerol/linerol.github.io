// Recherche et métadonnées publiques : AniList (animes et mangas) et TVmaze (séries).
// Les deux API sont gratuites, sans clé, et acceptent les appels depuis le navigateur.

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

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url); }
    catch (e) { if (i === tries - 1) throw new Error('TVmaze injoignable.'); await sleep(1500); continue; }
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    if (!res.ok) throw new Error('TVmaze : HTTP ' + res.status);
    return res.json();
  }
  throw new Error('TVmaze ne répond pas pour le moment.');
}

const MEDIA_FIELDS = `id idMal type format title { romaji english } coverImage { extraLarge large }
  episodes chapters volumes duration seasonYear startDate { year } genres status
  nextAiringEpisode { airingAt episode }`;

const SEARCH_Q = `query ($search: String, $type: MediaType, $perPage: Int, $sort: [MediaSort]) {
  Page(perPage: $perPage) { media(search: $search, type: $type, sort: $sort, isAdult: false) { ${MEDIA_FIELDS} } }
}`;

function mapMedia(m) {
  const manga = m.type === 'MANGA';
  return {
    kind: manga ? 'manga' : 'anime', source: 'anilist', extId: m.id, malId: m.idMal || null,
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
  const data = await anilist(SEARCH_Q, {
    search: term, type: kind === 'manga' ? 'MANGA' : 'ANIME', perPage: limit,
    sort: popular ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : ['SEARCH_MATCH']
  });
  return ((data && data.Page && data.Page.media) || []).map(mapMedia);
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
