// Recherche et métadonnées publiques : MyAnimeList (via l'API Jikan) et TVmaze.
// Jikan limite à ~3 requêtes/seconde : toutes ses requêtes passent par une file.

const JIKAN = 'https://api.jikan.moe/v4';
const TVMAZE = 'https://api.tvmaze.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let jikanChain = Promise.resolve();
function jikan(path) {
  const run = jikanChain.then(() => fetchJson(JIKAN + path));
  jikanChain = run.catch(() => {}).then(() => sleep(450));
  return run;
}

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    if (res.status === 429) { await sleep(1200 * (i + 1)); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  throw new Error('Service saturé, réessaie dans une minute.');
}

function parseDuration(text) {
  // "24 min per ep", "1 hr 2 min" → minutes
  if (!text) return null;
  const h = /(\d+)\s*hr/.exec(text), m = /(\d+)\s*min/.exec(text);
  const total = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
  return total || null;
}

function names(list) { return (list || []).map(g => g.name); }

function mapAnime(a) {
  return {
    kind: 'anime', source: 'mal', extId: a.mal_id,
    title: a.title_english || a.title, altTitle: a.title,
    cover: a.images?.webp?.large_image_url || a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
    total: a.episodes || null, duration: parseDuration(a.duration),
    year: a.year || a.aired?.prop?.from?.year || null,
    genres: names(a.genres).concat(names(a.themes), names(a.demographics)),
    airing: !!a.airing, broadcast: a.broadcast || null
  };
}

function mapManga(m) {
  return {
    kind: 'manga', source: 'mal', extId: m.mal_id,
    title: m.title_english || m.title, altTitle: m.title,
    cover: m.images?.webp?.large_image_url || m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || null,
    total: m.chapters || null, volumes: m.volumes || null, duration: null,
    year: m.published?.prop?.from?.year || null,
    genres: names(m.genres).concat(names(m.themes), names(m.demographics))
  };
}

function mapShow(s) {
  return {
    kind: 'serie', source: 'tvmaze', extId: s.id,
    title: s.name, altTitle: '',
    cover: s.image?.original || s.image?.medium || null,
    total: null, duration: s.averageRuntime || s.runtime || null,
    year: s.premiered ? +s.premiered.slice(0, 4) : null,
    genres: s.genres || []
  };
}

/** Recherche un titre. `popular` trie par popularité (utile pour retrouver le bon titre automatiquement). */
export async function searchTitles(kind, q, { popular = false, limit = 8 } = {}) {
  const enc = encodeURIComponent(q.trim());
  if (!enc) return [];
  const order = popular ? '&order_by=members&sort=desc' : '';
  if (kind === 'anime') {
    const j = await jikan(`/anime?q=${enc}&limit=${limit}&sfw=true${order}`);
    return (j.data || []).map(mapAnime);
  }
  if (kind === 'manga') {
    const j = await jikan(`/manga?q=${enc}&limit=${limit}&sfw=true${order}`);
    return (j.data || []).map(mapManga);
  }
  const j = await fetchJson(`${TVMAZE}/search/shows?q=${enc}`);
  return (j || []).slice(0, limit).map(x => mapShow(x.show));
}

/** Détails d'un anime (diffusion en cours, jour et heure), mis en cache 12 h dans le navigateur. */
export async function animeDetails(malId) {
  const key = 'mw:anime:' + malId;
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.at < 12 * 3600e3) return hit.data;
  } catch (e) { /* stockage indisponible */ }
  const j = await jikan(`/anime/${malId}`);
  const data = mapAnime(j.data);
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
  return data;
}

/** Prochaine diffusion à partir de l'horaire japonais renvoyé par MyAnimeList. */
export function nextAiring(broadcast) {
  if (!broadcast || !broadcast.day || !broadcast.time) return null;
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const d = days.indexOf(broadcast.day);
  if (d < 0) return null;
  const [hh, mm] = broadcast.time.split(':').map(Number);
  const JST = 9 * 3600e3;
  const now = Date.now();
  const jst = new Date(now + JST); // lu avec les getters UTC = heure de Tokyo
  const delta = (d - jst.getUTCDay() + 7) % 7;
  let t = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + delta, hh, mm) - JST;
  if (t < now - 3 * 3600e3) t += 7 * 86400e3;
  return new Date(t);
}
