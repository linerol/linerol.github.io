import * as F from './firebase.js';
import { FAMILIES, STATUSES, STATUS_ORDER, KINDS, SEED, familyFromGenres } from './data.js';
import { searchTitles, animeDetails, nextAiring } from './external.js';
import { SITE_URL } from './config.js';

/* ------------------------------------------------------------------ état */

const $app = document.getElementById('app');

const S = {
  phase: 'loading',            // loading | login | verify | denied | app | error
  user: null, email: '', member: null, role: null, error: '',
  titles: [], titlesReady: false,
  requests: [], votes: {},
  members: [], access: [], history: [],
  myAccess: false,
  localMeta: {},               // affiches trouvées pour les non-admins
  airing: [],
  login: { mode: 'login', msg: '', err: '', busy: false, email: '' },
  ui: { section: 'anime', status: 'all', fam: null, q: '', sort: 0, sheet: null, pick: null, vfilter: 'all', confirm: null },
  draft: null,                 // brouillon de la fiche ouverte
  add: { kind: 'anime', q: '', results: [], busy: false, err: '', chosen: null, note: '', status: 'voir' },
  fix: { open: false, q: '', results: [], busy: false },
  newMember: { email: '', role: 'reader', msg: '' },
  toast: null,
  unsub: []
};

const isAdmin = () => S.role === 'admin';
const isEditor = () => S.role === 'admin' || S.role === 'editor';
const SORTS = ['A → Z', 'Genre', 'Statut', 'Activité'];

/* ------------------------------------------------------------------ utilitaires */

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);
const tsMillis = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;

function fmtWhen(t) {
  const ms = tsMillis(t);
  if (!ms) return 'à l’instant';
  return new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtAgo(t) {
  const ms = tsMillis(t);
  if (!ms) return 'à l’instant';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return m <= 1 ? 'il y a 1 min' : `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}

function toast(text) {
  S.toast = text;
  render();
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { S.toast = null; render(); }, 3200);
}

function errText(e) {
  const code = e && e.code || '';
  const map = {
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
    'auth/wrong-password': 'Email ou mot de passe incorrect.',
    'auth/user-not-found': 'Email ou mot de passe incorrect.',
    'auth/invalid-email': 'Cet email n’est pas valide.',
    'auth/email-already-in-use': 'Un compte existe déjà avec cet email. Connecte-toi, ou utilise « Mot de passe oublié ».',
    'auth/weak-password': 'Mot de passe trop court : 8 caractères minimum.',
    'auth/too-many-requests': 'Trop d’essais. Réessaie dans quelques minutes.',
    'auth/network-request-failed': 'Pas de connexion internet.',
    'permission-denied': 'Action refusée : ton rôle ne le permet pas.',
    'unavailable': 'Firebase est injoignable. Vérifie ta connexion.'
  };
  return map[code] || (e && e.message) || 'Une erreur est survenue.';
}

function famOf(t) { return FAMILIES[t.fam] || FAMILIES.aven; }
function metaOf(t) { return Object.assign({}, S.localMeta[t.id] || {}, stripEmpty(t)); }
function stripEmpty(o) { const r = {}; for (const k in o) if (o[k] !== null && o[k] !== undefined && o[k] !== '') r[k] = o[k]; return r; }
function coverOf(t) { return t.cover || (S.localMeta[t.id] && S.localMeta[t.id].cover) || null; }
function totalOf(t) { return t.total || (S.localMeta[t.id] && S.localMeta[t.id].total) || null; }

function progressText(t) {
  if (t.kind === 'manga') return 'Chap. ' + (t.chapter || 0) + (totalOf(t) ? ' / ' + totalOf(t) : '');
  return 'S' + (t.season || 1) + ' · ép. ' + (t.episode || 0) + (totalOf(t) ? ' / ' + totalOf(t) : '');
}
function progressPct(t) {
  const tot = totalOf(t);
  if (!tot) return null;
  const v = t.kind === 'manga' ? (t.chapter || 0) : (t.episode || 0);
  return Math.max(0, Math.min(100, v / tot * 100));
}

/* ------------------------------------------------------------------ rendu */

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  if (name === 'animes') return { name: 'list', section: 'anime' };
  if (name === 'mangas') return { name: 'list', section: 'manga' };
  if (name === 'series') return { name: 'list', section: 'serie' };
  if (name === 'titre' && id) return { name: 'title', id: decodeURIComponent(id) };
  if (['ajouter', 'valider', 'membres', 'stats'].includes(name)) return { name };
  return { name: 'list' };
}

function render() {
  const a = document.activeElement;
  const focus = a && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  $app.innerHTML = view();
  if (focus) {
    const el = document.getElementById(focus.id);
    if (el) {
      el.focus({ preventScroll: true });
      try { if (focus.s !== null && focus.s !== undefined) el.setSelectionRange(focus.s, focus.e); } catch (e) { /* champ sans sélection */ }
    }
  }
}

function view() {
  if (S.phase === 'loading') return `<div class="solo"><div class="solo-in"><span class="stamp-xl">視聴</span><p class="muted">Chargement…</p></div></div>`;
  if (S.phase === 'error') return `<div class="solo"><div class="solo-in"><h1 class="display">Oups</h1><p>${esc(S.error)}</p><button class="btn btn-ink" data-act="reload">Réessayer</button></div></div>`;
  if (S.phase === 'login') return viewLogin();
  if (S.phase === 'verify') return viewVerify();
  if (S.phase === 'denied') return viewDenied();
  const r = route();
  if (r.section) S.ui.section = r.section;
  let main;
  if (r.name === 'title') main = viewTitle(r.id);
  else if (r.name === 'ajouter') main = viewAdd();
  else if (r.name === 'valider') main = isAdmin() ? viewValidate() : viewList();
  else if (r.name === 'membres') main = isAdmin() ? viewMembers() : viewList();
  else if (r.name === 'stats') main = viewStats();
  else main = viewList();
  return shell(r, main);
}

/* ------------------------------------------------------------------ écrans hors application */

function viewLogin() {
  const L = S.login, m = L.mode;
  const tab = (mode, label) => `<button type="button" role="tab" aria-selected="${m === mode}" class="tab ${m === mode ? 'on' : ''}" data-act="loginMode" data-mode="${mode}">${label}</button>`;
  let body;
  if (m === 'forgot') {
    body = `
      <form class="stack" data-submit="forgot">
        <p class="muted">Indique ton email : tu recevras un lien pour choisir un nouveau mot de passe.</p>
        <div class="field"><label for="lemail">Email</label><input id="lemail" name="email" type="email" autocomplete="email" value="${esc(L.email)}" data-in="loginEmail" required></div>
        <button class="btn btn-ink btn-lg" ${L.busy ? 'disabled' : ''}>Envoyer le lien</button>
        <button type="button" class="link" data-act="loginMode" data-mode="login">Retour à la connexion</button>
      </form>`;
  } else {
    const create = m === 'create';
    body = `
      <div class="tabs" role="tablist">${tab('login', 'Se connecter')}${tab('create', 'Première visite')}</div>
      <form class="stack" data-submit="${create ? 'signup' : 'signin'}">
        <div class="field"><label for="lemail">Email</label><input id="lemail" name="email" type="email" autocomplete="email" value="${esc(L.email)}" data-in="loginEmail" required></div>
        <div class="field"><label for="lpwd">${create ? 'Choisis un mot de passe' : 'Mot de passe'}</label>
          <input id="lpwd" name="password" type="password" minlength="${create ? 8 : 1}" autocomplete="${create ? 'new-password' : 'current-password'}" required>
          ${create ? '<span class="hint">8 caractères minimum. Ton email doit avoir été invité par Nerol.</span>' : ''}
        </div>
        <button class="btn ${create ? 'btn-accent' : 'btn-ink'} btn-lg" ${L.busy ? 'disabled' : ''}>${create ? 'Créer mon mot de passe' : 'Entrer'}</button>
        ${create ? '' : '<button type="button" class="link" data-act="loginMode" data-mode="forgot">Mot de passe oublié ?</button>'}
      </form>`;
  }
  return `
  <div class="solo"><div class="solo-in">
    <span class="stamp-xl" aria-hidden="true">視聴</span>
    <h1 class="display">My<br>Watchlist</h1>
    <p class="muted">Espace privé. Seuls les emails invités peuvent entrer.</p>
    ${L.err ? `<p class="alert" role="alert">${esc(L.err)}</p>` : ''}
    ${L.msg ? `<p class="note" role="status">${esc(L.msg)}</p>` : ''}
    ${body}
    <a class="foot-link" href="../">← linerol.github.io</a>
  </div></div>`;
}

function viewVerify() {
  const L = S.login;
  return `
  <div class="solo"><div class="solo-in">
    <span class="stamp-xl" aria-hidden="true">確認</span>
    <h1 class="display-sm">Vérifie ton email</h1>
    <p>On a envoyé un lien à <b>${esc(S.email)}</b>. Clique dessus, puis reviens ici.</p>
    <p class="muted">Pas reçu ? Regarde dans les spams, ou renvoie-le.</p>
    ${L.err ? `<p class="alert" role="alert">${esc(L.err)}</p>` : ''}
    ${L.msg ? `<p class="note" role="status">${esc(L.msg)}</p>` : ''}
    <button class="btn btn-ink btn-lg" data-act="checkVerified" ${L.busy ? 'disabled' : ''}>C’est fait, j’ai cliqué</button>
    <button class="btn btn-ghost" data-act="resendVerify" ${L.busy ? 'disabled' : ''}>Renvoyer l’email</button>
    <button class="link" data-act="logout">Se déconnecter</button>
  </div></div>`;
}

function viewDenied() {
  return `
  <div class="solo solo-dark"><div class="solo-in">
    <span class="stamp-ban" aria-hidden="true">禁</span>
    <p class="mono muted">CONNECTÉ EN TANT QUE ${esc(S.email)}</p>
    <h1 class="display-sm">Accès réservé</h1>
    <p>Ton email n’est pas encore sur la liste des invités. Laisse un mot à Nerol : il recevra ta demande dans son espace « À valider ».</p>
    ${S.myAccess ? `
      <div class="panel"><b>Demande envoyée.</b><br><span class="muted">Reviens plus tard : la page s’ouvrira dès que ta demande sera acceptée.</span></div>
      <button class="btn btn-ghost" data-act="retryMember">Vérifier à nouveau</button>` : `
      <form class="stack" data-submit="requestAccess">
        <div class="field"><label for="anote">Un mot pour te présenter (facultatif)</label><textarea id="anote" name="note" rows="3" maxlength="400" placeholder="Salut, c’est…"></textarea></div>
        <button class="btn btn-accent btn-lg">Demander l’accès</button>
      </form>`}
    <div class="row-between"><button class="link" data-act="logout">Se déconnecter</button><a class="link" href="../">Voir le portfolio</a></div>
  </div></div>`;
}

/* ------------------------------------------------------------------ coquille de l'application */

function pendingCount() {
  return S.requests.filter(r => r.status === 'pending').length + S.access.length;
}

function shell(r, main) {
  const admin = isAdmin();
  const n = admin ? pendingCount() : 0;
  const link = (href, label, active, badge) =>
    `<a href="${href}" class="${active ? 'on' : ''}" ${active ? 'aria-current="page"' : ''}>${label}${badge ? ` <span class="badge">${badge}</span>` : ''}</a>`;
  const isList = r.name === 'list' || r.name === 'title';
  const addLabel = admin ? 'Ajouter' : 'Suggérer';
  const initial = esc((S.member && S.member.name || S.email || '?').charAt(0).toUpperCase());
  const roleLabel = { admin: 'Admin', editor: 'Éditeur', reader: 'Lecteur' }[S.role] || '';

  const tabs = [
    ['#/animes', 'anime'], ['#/mangas', 'manga'], ['#/series', 'serie']
  ].map(([href, k]) => `<a href="${href}" class="${isList && S.ui.section === k ? 'on' : ''}"><span class="tk">${KINDS[k].kanji}</span>${KINDS[k].label}</a>`).join('')
    + (admin
      ? `<a href="#/valider" class="${r.name === 'valider' ? 'on' : ''}"><span class="tk">審${n ? `<span class="dot-badge">${n}</span>` : ''}</span>À valider</a>`
      : `<a href="#/ajouter" class="${r.name === 'ajouter' ? 'on' : ''}"><span class="tk">薦</span>Suggérer</a>`);

  const sheet = S.ui.sheet === 'menu' ? `
    <div class="sheet-bg" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-label="Menu">
      <div class="row-between"><b>${esc(S.member && S.member.name || S.email)}</b><span class="mono muted">${roleLabel.toUpperCase()}</span></div>
      <nav class="sheet-nav">
        <a href="#/" data-act="closeSheet">Liste</a>
        <a href="#/ajouter" data-act="closeSheet">${addLabel}</a>
        ${admin ? `<a href="#/valider" data-act="closeSheet">À valider ${n ? `<span class="badge">${n}</span>` : ''}</a><a href="#/membres" data-act="closeSheet">Membres</a>` : ''}
        <a href="#/stats" data-act="closeSheet">Stats et historique</a>
      </nav>
      <button class="btn btn-ghost" data-act="logout">Se déconnecter</button>
    </div>` : '';

  return `
  <header class="top">
    <div class="wrap top-in">
      <a href="#/" class="brand"><span class="brand-stamp" aria-hidden="true">視</span><span>My Watchlist</span></a>
      <nav class="nav-desk" aria-label="Navigation">
        ${link('#/', 'Liste', isList)}
        ${link('#/ajouter', addLabel, r.name === 'ajouter')}
        ${admin ? link('#/valider', 'À valider', r.name === 'valider', n) : ''}
        ${admin ? link('#/membres', 'Membres', r.name === 'membres') : ''}
        ${link('#/stats', 'Stats', r.name === 'stats')}
      </nav>
      <button class="who" data-act="openMenu" aria-label="Menu du compte">
        <span class="avatar">${initial}</span><span class="who-name">${esc(S.member && S.member.name || '')}</span><span class="mono muted who-role">${roleLabel.toUpperCase()}</span>
      </button>
    </div>
  </header>
  <main class="wrap main">${main}</main>
  <nav class="tabbar" aria-label="Sections">${tabs}</nav>
  ${sheet}
  ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ''}`;
}

/* ------------------------------------------------------------------ liste */

function filtered() {
  const U = S.ui, q = U.q.trim().toLowerCase();
  const inSec = S.titles.filter(t => t.kind === U.section);
  const byFam = t => !U.fam || t.fam === U.fam;
  const byQ = t => !q || (t.title || '').toLowerCase().includes(q) || (t.altTitle || '').toLowerCase().includes(q);
  const base = inSec.filter(t => byFam(t) && byQ(t));
  const list = base.filter(t => U.status === 'all' || t.status === U.status);
  const order = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]));
  list.sort((a, b) => {
    if (U.sort === 1 && a.fam !== b.fam) return famOf(a).name.localeCompare(famOf(b).name);
    if (U.sort === 2 && a.status !== b.status) return order[a.status] - order[b.status];
    if (U.sort === 3) return tsMillis(b.updatedAt) - tsMillis(a.updatedAt);
    return (a.title || '').localeCompare(b.title || '', 'fr');
  });
  return { inSec, base, list };
}

function viewList() {
  const U = S.ui;
  if (!S.titlesReady) return `<p class="muted pad">Chargement de la liste…</p>`;
  if (S.titles.length === 0) {
    return `
    <section class="empty-big">
      <span class="stamp-xl" aria-hidden="true">無</span>
      <h1 class="display-sm">La liste est vide</h1>
      ${isAdmin()
        ? `<p>Importe tes ${SEED.length} titres de départ (animes, mangas et séries de ta note). Les affiches se chargeront ensuite toutes seules.</p>
           <button class="btn btn-accent btn-lg" data-act="seed">Importer mes ${SEED.length} titres</button>`
        : `<p>Nerol n’a encore rien ajouté. Tu peux déjà lui suggérer un titre.</p><a class="btn btn-ink" href="#/ajouter">Suggérer un titre</a>`}
    </section>`;
  }

  const { inSec, base, list } = filtered();
  const count = s => S.titles.filter(t => t.status === s).length;
  const stamps = `
    <div class="stamps">
      <div class="stamp-col"><span class="stamp-big st-cours"><b>${count('cours')}</b><small>視聴中</small></span><span class="mono muted">EN COURS</span></div>
      <div class="stamp-col"><span class="stamp-big st-voir"><b>${count('voir')}</b><small>積み</small></span><span class="mono muted">À VOIR</span></div>
      <div class="stamp-col"><span class="stamp-big st-fini"><b>${count('fini')}</b><small>完走</small></span><span class="mono muted">TERMINÉS</span></div>
    </div>`;

  const sections = Object.keys(KINDS).map(k => {
    const n = S.titles.filter(t => t.kind === k).length;
    const href = { anime: '#/animes', manga: '#/mangas', serie: '#/series' }[k];
    return `<a href="${href}" class="sec ${U.section === k ? 'on' : ''}" ${U.section === k ? 'aria-current="page"' : ''}>${KINDS[k].label} <span class="mono">${n}</span></a>`;
  }).join('');

  // genres de la section
  const famCounts = Object.keys(FAMILIES).map(k => ({ k, n: inSec.filter(t => t.fam === k).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
  const spectrum = famCounts.length ? `
    <div class="spectrum-wrap">
      <div class="row-between mono muted small"><span>MON SPECTRE · clique un genre pour filtrer</span><span>Genre n°1 : ${esc(FAMILIES[famCounts[0].k].name)}</span></div>
      <div class="spectrum">${famCounts.map(x => {
        const f = FAMILIES[x.k], on = U.fam === x.k;
        return `<button class="spec ${on ? 'on' : ''} ${U.fam && !on ? 'dim' : ''}" style="flex:${x.n} 1 0;background:${f.color};color:${f.ink}" data-act="fam" data-fam="${x.k}" aria-pressed="${on}" title="${esc(f.name)} : ${x.n}">${x.n}</button>`;
      }).join('')}</div>
      <div class="legend">${famCounts.map(x => `<span><i style="background:${FAMILIES[x.k].color}"></i>${esc(FAMILIES[x.k].name)}</span>`).join('')}</div>
    </div>` : '';

  // diffusion de la semaine
  const air = S.airing.filter(a => S.titles.some(t => t.id === a.id && t.kind === 'anime' && t.status === 'cours'));
  const band = U.section === 'anime' ? `
    <div class="band">
      <div class="band-air">
        <span class="mono muted small">NOUVEAUX ÉPISODES CETTE SEMAINE</span>
        <div class="chips">${air.length ? air.map(a => `<a class="chip-air" href="#/titre/${encodeURIComponent(a.id)}"><b>${esc(a.title)}</b><span class="muted">${esc(a.when)}</span></a>`).join('') : `<span class="muted small">${S.airingDone ? 'Aucun de tes animes en cours n’est diffusé cette semaine.' : 'Recherche des horaires de diffusion…'}</span>`}</div>
      </div>
      ${pickBox()}
    </div>` : `<div class="band">${pickBox()}</div>`;

  const statusTabs = ['all', ...STATUS_ORDER].map(s => {
    const n = s === 'all' ? base.length : base.filter(t => t.status === s).length;
    const label = s === 'all' ? 'Tous' : STATUSES[s].plural;
    return `<button class="seg ${U.status === s ? 'on' : ''}" data-act="status" data-status="${s}" aria-pressed="${U.status === s}">${label} <span class="mono">${n}</span></button>`;
  }).join('');

  const hasFilter = U.status !== 'all' || U.fam || U.q.trim();
  const cards = list.map(card).join('');

  return `
  <section class="hero">
    <div class="vert" aria-hidden="true">視聴リスト</div>
    <div class="hero-text">
      <h1 class="display">My<br>Watchlist</h1>
      <p class="muted lead">Les animes, mangas et séries que je regarde, que j’ai finis, et ceux qui attendent leur tour. ${plural(S.titles.length, 'titre', 'titres')} au compteur.</p>
    </div>
    ${stamps}
  </section>
  <nav class="sections" aria-label="Sections">${sections}</nav>
  ${band}
  ${spectrum}
  <div class="toolbar">
    <label class="search" for="q">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="q" type="search" placeholder="Chercher un titre" value="${esc(U.q)}" data-in="q" autocomplete="off">
    </label>
    <button class="btn btn-ghost" data-act="sort">Tri : ${SORTS[U.sort]}</button>
    <button class="btn btn-ghost only-mobile" data-act="openFilters">Genres${U.fam ? ' · 1' : ''}</button>
  </div>
  <div class="segs" role="group" aria-label="Statut">${statusTabs}</div>
  <div class="row-between mono muted small result">
    <span>${plural(list.length, 'titre affiché', 'titres affichés')}${U.fam ? ' · ' + esc(FAMILIES[U.fam].name) : ''}</span>
    ${hasFilter ? `<button class="link" data-act="resetFilters">Tout réafficher</button>` : ''}
  </div>
  ${list.length ? `<div class="grid">${cards}</div>` : `
    <div class="empty"><span class="kanji-big" aria-hidden="true">無</span><p>Aucun titre ne correspond.</p>${hasFilter ? `<button class="btn btn-ghost" data-act="resetFilters">Effacer les filtres</button>` : ''}</div>`}
  ${S.ui.sheet === 'filters' ? filtersSheet(famCounts) : ''}
  <p class="legend-status mono muted small">中 en cours · 積 à voir · 休 en pause · 止 abandonné · 完 terminé</p>`;
}

function pickBox() {
  const p = S.ui.pick && S.titles.find(t => t.id === S.ui.pick);
  return `
    <div class="band-pick">
      <span class="mono muted small">JE REGARDE QUOI CE SOIR ?</span>
      ${p ? `<a class="pick-title" href="#/titre/${encodeURIComponent(p.id)}">${esc(p.title)}</a><span class="muted small">${esc(p.genre || famOf(p).name)} · tiré parmi tes À voir</span>` : `<span class="muted small">Un titre au hasard parmi tes « À voir »${S.ui.fam ? ', dans le genre choisi' : ''}.</span>`}
      <button class="btn btn-ink" data-act="roll">${p ? 'Relancer' : 'Tirer au sort'}</button>
    </div>`;
}

function filtersSheet(famCounts) {
  return `
    <div class="sheet-bg" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-label="Filtres">
      <div class="row-between"><b class="h3">Genres</b><button class="link" data-act="closeSheet">Fermer</button></div>
      <div class="chips">${famCounts.map(x => {
        const f = FAMILIES[x.k], on = S.ui.fam === x.k;
        return `<button class="fam-chip ${on ? 'on' : ''}" style="--c:${f.color};--ci:${f.ink}" data-act="fam" data-fam="${x.k}" aria-pressed="${on}">${esc(f.name)} · ${x.n}</button>`;
      }).join('')}</div>
      <b class="h3">Tri</b>
      <div class="chips">${SORTS.map((s, i) => `<button class="seg ${S.ui.sort === i ? 'on' : ''}" data-act="setSort" data-sort="${i}">${s}</button>`).join('')}</div>
    </div>`;
}

function poster(t, cls = '') {
  const f = famOf(t), cover = coverOf(t), st = STATUSES[t.status] || STATUSES.voir;
  return `
    <span class="poster tone ${cls}" style="background-color:${f.color};color:${f.ink}">
      <span class="poster-fam">${esc(f.name.toUpperCase())}</span>
      <span class="poster-title">${esc(t.title)}</span>
      ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <span class="stamp st-${t.status}" aria-hidden="true">${st.kanji}</span>
    </span>`;
}

function card(t) {
  const st = STATUSES[t.status] || STATUSES.voir;
  const canPlus = isEditor() && t.status === 'cours';
  const pct = progressPct(t);
  let foot;
  if (t.status === 'cours') {
    foot = `
      ${pct !== null ? `<span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>` : ''}
      <span class="prog-row"><span class="mono">${esc(progressText(t))}</span>
      ${canPlus ? `<button class="plus" data-act="plus" data-id="${esc(t.id)}" aria-label="Ajouter un ${t.kind === 'manga' ? 'chapitre' : 'épisode'} à ${esc(t.title)}">+1</button>` : ''}</span>`;
  } else if (t.status === 'fini') {
    foot = `<span class="mono">${t.rating ? t.rating + ' / 10' : '— / 10'}</span>`;
  } else {
    foot = `<span class="mono muted">${st.label.toUpperCase()}</span>`;
  }
  return `
    <article class="card">
      <a class="card-link" href="#/titre/${encodeURIComponent(t.id)}" aria-label="${esc(t.title)}, ${st.label}">${poster(t)}</a>
      <div class="card-meta">
        <span class="card-title">${esc(t.title)}</span>
        <span class="muted small">${esc(t.genre || famOf(t).name)}</span>
        ${foot}
      </div>
    </article>`;
}

/* ------------------------------------------------------------------ fiche */

const EDIT_FIELDS = ['status', 'season', 'episode', 'chapter', 'total', 'rating', 'review', 'startedAt', 'finishedAt', 'genre', 'fam'];

function ensureDraft(t) {
  if (!S.draft || S.draft.id !== t.id) {
    S.draft = { id: t.id };
    for (const k of EDIT_FIELDS) S.draft[k] = t[k] ?? (['season'].includes(k) ? 1 : ['episode', 'chapter'].includes(k) ? 0 : (k === 'rating' || k === 'total') ? null : '');
    S.fix = { open: false, q: t.lookup || t.title, results: [], busy: false };
    S.ui.confirm = null;
  }
  return S.draft;
}

function diffDraft(t) {
  const d = S.draft, changes = {}, before = {};
  for (const k of EDIT_FIELDS) {
    const a = t[k] ?? null, b = d[k] === '' ? null : d[k];
    if ((a ?? '') !== (b ?? '') && !(a === null && b === '')) { changes[k] = b; before[k] = a; }
  }
  return { changes, before };
}

function viewTitle(id) {
  const t = S.titles.find(x => x.id === id);
  if (!S.titlesReady) return `<p class="muted pad">Chargement…</p>`;
  if (!t) return `<div class="empty"><p>Ce titre n’existe plus.</p><a class="btn btn-ink" href="#/">Retour à la liste</a></div>`;
  const d = ensureDraft(t), f = famOf(t), m = metaOf(t);
  const ro = !isEditor();
  const air = S.airing.find(a => a.id === t.id);
  const manga = t.kind === 'manga';
  const tot = d.total || totalOf(t);
  const cur = manga ? (d.chapter || 0) : (d.episode || 0);
  const pct = tot ? Math.min(100, cur / tot * 100) : null;
  const backHref = { anime: '#/animes', manga: '#/mangas', serie: '#/series' }[t.kind] || '#/';

  const statusBtns = STATUS_ORDER.map(s => `
    <button class="st-btn ${d.status === s ? 'on' : ''}" data-act="dStatus" data-status="${s}" ${ro ? 'disabled' : ''} aria-pressed="${d.status === s}">
      <span class="k">${STATUSES[s].kanji}</span><span>${STATUSES[s].label}</span></button>`).join('');

  const stepper = (field, label, min) => `
    <div class="stepper">
      <span class="muted small">${label}</span>
      <div class="step-row">
        <button class="round" data-act="step" data-field="${field}" data-d="-1" ${ro ? 'disabled' : ''} aria-label="${label} moins un">−</button>
        <input id="d-${field}" class="step-val" type="number" inputmode="numeric" min="${min}" value="${esc(d[field])}" data-in="draftNum" data-field="${field}" ${ro ? 'readonly' : ''} aria-label="${label}">
        <button class="round round-accent" data-act="step" data-field="${field}" data-d="1" ${ro ? 'disabled' : ''} aria-label="${label} plus un">+</button>
      </div>
    </div>`;

  const notes = Array.from({ length: 10 }, (_, i) => i + 1).map(v => `
    <button class="note-btn ${d.rating >= v ? 'on' : ''}" data-act="rate" data-v="${v}" ${ro ? 'disabled' : ''} aria-label="Noter ${v} sur 10">${v}</button>`).join('');

  const { changes } = diffDraft(t);
  const dirty = Object.keys(changes).length > 0;
  const saveLabel = isAdmin() ? 'Enregistrer' : isEditor() ? 'Proposer la modification' : '';
  const saveHint = isAdmin() ? 'Le changement s’applique tout de suite.' : isEditor() ? 'Nerol valide avant que ça change.' : 'Tu peux consulter cette fiche. Pour proposer un titre, passe par « Suggérer ».';

  const mine = S.requests.filter(r => r.type === 'edit' && r.titleId === t.id && r.status === 'pending');

  return `
  <section class="fiche">
    <div class="fiche-hero tone" style="background-color:${f.color};color:${f.ink}">
      <a class="back" href="${backHref}">← ${KINDS[t.kind].label}</a>
      <div class="fiche-head">
        <div class="fiche-cover">${poster(t, 'poster-sm')}</div>
        <div class="fiche-id">
          <span class="mono small">${esc(KINDS[t.kind].one.toUpperCase())} · ${esc((t.genre || f.name).toUpperCase())}</span>
          <h1 class="fiche-title">${esc(t.title)}</h1>
          <span class="small">${[m.year, m.altTitle && m.altTitle !== t.title ? m.altTitle : '', m.duration ? m.duration + ' min / ép.' : ''].filter(Boolean).map(esc).join(' · ')}</span>
          ${m.source === 'mal' && m.extId ? `<a class="small ext" href="https://myanimelist.net/${t.kind === 'manga' ? 'manga' : 'anime'}/${esc(m.extId)}" target="_blank" rel="noopener">Voir sur MyAnimeList ↗</a>` : ''}
          ${m.source === 'tvmaze' && m.extId ? `<a class="small ext" href="https://www.tvmaze.com/shows/${esc(m.extId)}" target="_blank" rel="noopener">Voir sur TVmaze ↗</a>` : ''}
        </div>
      </div>
      ${air ? `<div class="air"><i></i>Prochain épisode ${esc(air.when)}</div>` : ''}
    </div>

    <div class="fiche-body">
      ${mine.length ? `<p class="note">${plural(mine.length, 'modification proposée', 'modifications proposées')} en attente de validation.</p>` : ''}
      <div class="block">
        <span class="label">STATUT</span>
        <div class="st-grid">${statusBtns}</div>
      </div>

      <div class="block">
        <span class="label">OÙ J’EN SUIS</span>
        <div class="steppers">
          ${manga ? stepper('chapter', 'Chapitre', 0) : stepper('season', 'Saison', 1) + stepper('episode', 'Épisode', 0)}
        </div>
        ${pct !== null ? `<span class="bar bar-lg"><i style="width:${pct.toFixed(1)}%"></i></span>` : ''}
        <div class="row-between small">
          <span class="mono muted">${manga ? 'Chap. ' + cur : 'S' + (d.season || 1) + ' · ép. ' + cur}${tot ? ' / ' + tot : ''}</span>
          ${isEditor() ? `<label class="inline-field muted" for="d-total">${manga ? 'Chapitres' : 'Épisodes'} au total <input id="d-total" type="number" min="0" inputmode="numeric" value="${esc(d.total ?? '')}" placeholder="${esc(totalOf(t) || '?')}" data-in="draftNum" data-field="total"></label>` : ''}
        </div>
      </div>

      <div class="block">
        <span class="label">MA NOTE · ${d.rating ? d.rating + ' / 10' : 'pas encore notée'}</span>
        <div class="notes">${notes}</div>
      </div>

      <div class="block">
        <label class="label" for="d-review">MON AVIS</label>
        <textarea id="d-review" rows="3" maxlength="1000" placeholder="${ro ? 'Pas encore d’avis.' : 'Deux lignes pour toi-même dans six mois…'}" data-in="draft" data-field="review" ${ro ? 'readonly' : ''}>${esc(d.review)}</textarea>
      </div>

      <div class="two">
        <div class="field"><label class="label" for="d-startedAt">COMMENCÉ</label><input id="d-startedAt" type="date" value="${esc(d.startedAt)}" data-in="draft" data-field="startedAt" ${ro ? 'readonly' : ''}></div>
        <div class="field"><label class="label" for="d-finishedAt">TERMINÉ</label><input id="d-finishedAt" type="date" value="${esc(d.finishedAt)}" data-in="draft" data-field="finishedAt" ${ro ? 'readonly' : ''}></div>
      </div>

      ${isEditor() ? `
      <div class="two">
        <div class="field"><label class="label" for="d-genre">GENRE</label><input id="d-genre" type="text" maxlength="60" value="${esc(d.genre)}" data-in="draft" data-field="genre"></div>
        <div class="field"><label class="label" for="d-fam">COULEUR (FAMILLE)</label>
          <select id="d-fam" data-in="draft" data-field="fam">${Object.entries(FAMILIES).map(([k, v]) => `<option value="${k}" ${d.fam === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      </div>` : ''}

      ${saveLabel ? `<button class="btn btn-ink btn-lg" data-act="saveTitle" data-id="${esc(t.id)}" ${dirty ? '' : 'disabled'}>${saveLabel}</button>` : ''}
      <p class="muted small center">${dirty || !saveLabel ? saveHint : 'Aucun changement à enregistrer.'}</p>

      ${isAdmin() ? `
      <div class="block admin-zone">
        <span class="label">ADMIN</span>
        <div class="chips">
          <button class="btn btn-ghost" data-act="toggleFix">${S.fix.open ? 'Fermer' : 'Corriger l’affiche et les infos'}</button>
          ${S.ui.confirm === 'del:' + t.id
            ? `<button class="btn btn-danger" data-act="deleteTitle" data-id="${esc(t.id)}">Confirmer la suppression</button><button class="link" data-act="cancelConfirm">Annuler</button>`
            : `<button class="btn btn-ghost danger-text" data-act="askConfirm" data-key="del:${esc(t.id)}">Supprimer de la liste</button>`}
        </div>
        ${S.fix.open ? fixPanel(t) : ''}
      </div>` : ''}
    </div>
  </section>`;
}

function fixPanel(t) {
  const F2 = S.fix;
  return `
    <form class="stack" data-submit="fixSearch">
      <label class="search" for="fixq"><input id="fixq" type="search" value="${esc(F2.q)}" data-in="fixq" placeholder="Titre à chercher"></label>
      <button class="btn btn-ink" ${F2.busy ? 'disabled' : ''}>${F2.busy ? 'Recherche…' : 'Chercher sur ' + (t.kind === 'serie' ? 'TVmaze' : 'MyAnimeList')}</button>
    </form>
    <div class="results">${F2.results.map((r, i) => resultRow(r, i, 'fixPick', false)).join('')}</div>`;
}

function resultRow(r, i, act, chosen) {
  return `
    <button class="result-row ${chosen ? 'on' : ''}" data-act="${act}" data-i="${i}">
      ${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="thumb-ph"></span>`}
      <span class="result-text"><b>${esc(r.title)}</b><span class="muted small">${[KINDS[r.kind].one, r.year, r.total ? r.total + (r.kind === 'manga' ? ' chap.' : ' ép.') : '', r.altTitle && r.altTitle !== r.title ? r.altTitle : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
      ${chosen ? '<span class="mono small">CHOISI</span>' : ''}
    </button>`;
}

/* ------------------------------------------------------------------ ajouter / suggérer */

function viewAdd() {
  const A = S.add, admin = isAdmin();
  const types = Object.keys(KINDS).map(k => `<button class="seg ${A.kind === k ? 'on' : ''}" data-act="addKind" data-kind="${k}" aria-pressed="${A.kind === k}">${KINDS[k].one}</button>`).join('');
  const chosen = A.chosen !== null ? A.results[A.chosen] : null;
  const dup = chosen && findDuplicate(chosen);

  const pendingSugg = S.requests.filter(r => r.type === 'suggestion' && r.status === 'pending')
    .sort((a, b) => (S.votes[b.id]?.count || 0) - (S.votes[a.id]?.count || 0));
  const mine = S.requests.filter(r => r.by === S.email).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt)).slice(0, 12);
  const stateLabel = r => ({ pending: 'En attente', accepted: 'Accepté', refused: 'Refusé' }[r.status] || r.status);

  return `
  <section class="page">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">${admin ? '追加' : '推薦'}</span><h1 class="display-sm">${admin ? 'Ajouter un titre' : 'Suggérer un titre'}</h1></div>
    <div class="add-grid">
      <div class="stack">
        <div class="segs" role="group" aria-label="Type">${types}</div>
        <form class="stack" data-submit="addSearch">
          <label class="search" for="addq">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
            <input id="addq" type="search" placeholder="Chercher ${A.kind === 'serie' ? 'une série' : A.kind === 'manga' ? 'un manga' : 'un anime'}" value="${esc(A.q)}" data-in="addq" autocomplete="off">
          </label>
        </form>
        <span class="mono muted small">${A.busy ? 'RECHERCHE…' : A.err ? esc(A.err) : A.results.length ? 'RÉSULTATS ' + (A.kind === 'serie' ? 'TVMAZE' : 'MYANIMELIST') : 'Tape au moins 2 lettres.'}</span>
        <div class="results">${A.results.map((r, i) => resultRow(r, i, 'addPick', A.chosen === i)).join('')}</div>
        ${chosen ? `
          ${dup ? `<p class="note">« ${esc(dup.title)} » est déjà dans la liste (${esc(STATUSES[dup.status]?.label || '')}).</p>` : ''}
          ${admin ? `
            <div class="segs" role="group" aria-label="Statut de départ">${['voir', 'cours', 'fini'].map(s => `<button class="seg ${A.status === s ? 'on' : ''}" data-act="addStatus" data-status="${s}">${STATUSES[s].label}</button>`).join('')}</div>
            <button class="btn btn-accent btn-lg" data-act="addTitle" ${dup ? 'disabled' : ''}>Ajouter « ${esc(chosen.title)} »</button>` : `
            <div class="field"><label for="why">Pourquoi tu me le conseilles ?</label><textarea id="why" rows="3" maxlength="400" placeholder="Une phrase suffit." data-in="addNote">${esc(A.note)}</textarea></div>
            <button class="btn btn-accent btn-lg" data-act="suggest" ${dup ? 'disabled' : ''}>Envoyer « ${esc(chosen.title)} »</button>`}
        ` : ''}
      </div>

      <div class="stack">
        <h2 class="h3">Suggestions des membres</h2>
        ${pendingSugg.length ? pendingSugg.map(r => {
          const v = S.votes[r.id] || { count: 0, mine: false };
          return `
          <div class="sugg">
            ${r.item?.cover ? `<img src="${esc(r.item.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="thumb-ph"></span>`}
            <div class="sugg-text"><b>${esc(r.item?.title)}</b><span class="muted small">${esc(KINDS[r.item?.kind]?.one || '')} · proposé par ${esc(r.byName || r.by)}</span>${r.note ? `<span class="small">« ${esc(r.note)} »</span>` : ''}</div>
            <button class="vote ${v.mine ? 'on' : ''}" data-act="vote" data-id="${esc(r.id)}" aria-pressed="${v.mine}" aria-label="${v.mine ? 'Retirer mon vote' : 'Voter'} pour ${esc(r.item?.title)}">▲ ${v.count}</button>
          </div>`;
        }).join('') : `<p class="muted small">Aucune suggestion en attente.</p>`}
        ${admin ? `<a class="link" href="#/valider">Les valider dans « À valider » →</a>` : `
        <h2 class="h3">Mes demandes</h2>
        ${mine.length ? `<ul class="plain">${mine.map(r => `<li class="row-between"><span>${esc(r.type === 'edit' ? r.titleName + ' (modification)' : r.item?.title)}</span><span class="pill pill-${r.status}">${stateLabel(r)}</span></li>`).join('')}</ul>` : `<p class="muted small">Tu n’as encore rien proposé.</p>`}`}
      </div>
    </div>
  </section>`;
}

function findDuplicate(item) {
  const name = (item.title || '').toLowerCase();
  return S.titles.find(t => (t.source === item.source && String(t.extId) === String(item.extId) && t.kind === item.kind)
    || (t.kind === item.kind && ((t.title || '').toLowerCase() === name || (t.altTitle || '').toLowerCase() === (item.altTitle || '').toLowerCase() && item.altTitle)));
}

/* ------------------------------------------------------------------ à valider */

function viewValidate() {
  const f = S.ui.vfilter;
  const reqs = S.requests.filter(r => r.status === 'pending');
  const items = [
    ...reqs.map(r => ({ kind: r.type, r, at: tsMillis(r.createdAt), votes: S.votes[r.id]?.count || 0 })),
    ...S.access.map(a => ({ kind: 'access', a, at: tsMillis(a.at), votes: 0 }))
  ].filter(x => f === 'all' || x.kind === f)
    .sort((a, b) => (b.votes - a.votes) || (b.at - a.at));
  const n = k => k === 'all' ? reqs.length + S.access.length : k === 'access' ? S.access.length : reqs.filter(r => r.type === k).length;
  const filters = [['all', 'Tout'], ['suggestion', 'Suggestions'], ['edit', 'Modifications'], ['access', 'Accès']]
    .map(([k, l]) => `<button class="seg ${f === k ? 'on' : ''}" data-act="vfilter" data-f="${k}">${l} <span class="mono">${n(k)}</span></button>`).join('');

  const label = { status: 'Statut', season: 'Saison', episode: 'Épisode', chapter: 'Chapitre', total: 'Total', rating: 'Note', review: 'Avis', startedAt: 'Début', finishedAt: 'Fin', genre: 'Genre', fam: 'Couleur' };
  const show = (k, v) => v === null || v === undefined || v === '' ? '—' : k === 'status' ? (STATUSES[v]?.label || v) : k === 'fam' ? (FAMILIES[v]?.name || v) : k === 'rating' ? v + '/10' : String(v);

  const rows = items.map(x => {
    if (x.kind === 'access') {
      const a = x.a;
      return `
      <article class="req">
        <div class="row-between"><span><span class="tag tag-access">Demande d’accès</span> <span class="muted small">${fmtAgo(a.at)}</span></span></div>
        <div class="req-body"><div class="req-text"><b class="h3">${esc(a.email)}</b>${a.note ? `<p>« ${esc(a.note)} »</p>` : ''}</div>
        <div class="req-actions"><button class="btn btn-ghost" data-act="refuseAccess" data-id="${esc(a.id)}">Refuser</button><button class="btn btn-ink" data-act="acceptAccess" data-id="${esc(a.id)}">Ajouter comme lecteur</button></div></div>
      </article>`;
    }
    const r = x.r;
    if (r.type === 'suggestion') {
      const it = r.item || {}, dup = findDuplicate(it);
      return `
      <article class="req">
        <div class="row-between"><span><span class="tag tag-sugg">Suggestion</span> <span class="muted small">${esc(r.byName || r.by)} · ${fmtAgo(r.createdAt)}</span></span><span class="mono">▲ ${x.votes} ${x.votes > 1 ? 'votes' : 'vote'}</span></div>
        <div class="req-body">
          ${it.cover ? `<img class="req-cover" src="${esc(it.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          <div class="req-text"><b class="h3">${esc(it.title)}</b><span class="muted small">${[KINDS[it.kind]?.one, it.year, it.total ? it.total + (it.kind === 'manga' ? ' chap.' : ' ép.') : ''].filter(Boolean).map(esc).join(' · ')}</span>
            ${r.note ? `<p>« ${esc(r.note)} »</p>` : ''}${dup ? `<p class="note">Déjà dans ta liste.</p>` : ''}</div>
          <div class="req-actions"><button class="btn btn-ghost" data-act="refuseReq" data-id="${esc(r.id)}">Refuser</button><button class="btn btn-ink" data-act="acceptSugg" data-id="${esc(r.id)}" ${dup ? 'disabled' : ''}>Accepter</button></div>
        </div>
      </article>`;
    }
    const keys = Object.keys(r.changes || {});
    const t = S.titles.find(z => z.id === r.titleId);
    return `
      <article class="req">
        <div class="row-between"><span><span class="tag tag-edit">Modification</span> <span class="muted small">${esc(r.byName || r.by)} · ${fmtAgo(r.createdAt)}</span></span></div>
        <div class="req-body">
          <div class="req-text"><b class="h3">${esc(r.titleName)}</b>${t ? '' : '<p class="note">Ce titre a été supprimé.</p>'}
            ${keys.map(k => `<div class="diff"><span class="muted small">${label[k] || k}</span><s>${esc(show(k, (r.before || {})[k]))}</s><span aria-hidden="true">→</span><ins>${esc(show(k, r.changes[k]))}</ins></div>`).join('')}</div>
          <div class="req-actions"><button class="btn btn-ghost" data-act="refuseReq" data-id="${esc(r.id)}">Refuser</button><button class="btn btn-ink" data-act="acceptEdit" data-id="${esc(r.id)}" ${t ? '' : 'disabled'}>Accepter</button></div>
        </div>
      </article>`;
  }).join('');

  return `
  <section class="page">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">審査</span><h1 class="display-sm">À valider</h1><span class="mono muted">${plural(n('all'), 'demande en attente', 'demandes en attente')}</span></div>
    <div class="segs" role="group" aria-label="Type de demande">${filters}</div>
    <div class="stack">${rows || `<div class="empty"><span class="kanji-big" aria-hidden="true">済</span><p>Rien à valider. Tout est à jour.</p></div>`}</div>
    <p class="muted small">Une suggestion acceptée entre dans ta liste en « À voir ». Une modification acceptée s’applique au titre et part dans l’historique. La personne voit la décision dans « Mes demandes ».</p>
  </section>`;
}

/* ------------------------------------------------------------------ membres */

function viewMembers() {
  const N = S.newMember;
  const rows = S.members.slice().sort((a, b) => (a.role === 'admin' ? -1 : b.role === 'admin' ? 1 : a.id.localeCompare(b.id))).map(m => {
    const self = m.id === S.email;
    const roleCell = m.role === 'admin' ? `<span class="admin-chip"><span class="mini-stamp">主</span>Admin</span>` : `
      <div class="segs tight" role="group" aria-label="Rôle de ${esc(m.id)}">
        <button class="seg ${m.role === 'reader' ? 'on' : ''}" data-act="setRole" data-id="${esc(m.id)}" data-role="reader">Lecteur</button>
        <button class="seg ${m.role === 'editor' ? 'on' : ''}" data-act="setRole" data-id="${esc(m.id)}" data-role="editor">Éditeur</button>
      </div>`;
    const action = self || m.role === 'admin' ? '' : S.ui.confirm === 'rm:' + m.id
      ? `<button class="btn btn-danger" data-act="removeMember" data-id="${esc(m.id)}">Confirmer</button> <button class="link" data-act="cancelConfirm">Annuler</button>`
      : `<button class="link danger-text" data-act="askConfirm" data-key="rm:${esc(m.id)}">Retirer</button>`;
    return `<tr><td><b>${esc(m.id)}</b>${m.name ? `<br><span class="muted small">${esc(m.name)}</span>` : ''}</td><td>${roleCell}</td><td class="muted small">${m.addedAt ? 'Ajouté le ' + new Date(tsMillis(m.addedAt)).toLocaleDateString('fr-FR') : ''}</td><td class="right">${action}</td></tr>`;
  }).join('');

  return `
  <section class="page">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">会員</span><h1 class="display-sm">Membres</h1><span class="mono muted">${plural(S.members.length, 'membre autorisé', 'membres autorisés')}</span></div>
    ${S.access.length ? `<a class="note" href="#/valider">${plural(S.access.length, 'demande d’accès attend', 'demandes d’accès attendent')} ta réponse →</a>` : ''}
    <form class="panel stack" data-submit="addMember">
      <label for="nm-email"><b>Autoriser un email</b></label>
      <div class="add-row">
        <input id="nm-email" type="email" placeholder="ami@exemple.fr" value="${esc(N.email)}" data-in="nmEmail" autocomplete="off" required>
        <div class="segs tight" role="group" aria-label="Rôle">
          <button type="button" class="seg ${N.role === 'reader' ? 'on' : ''}" data-act="nmRole" data-role="reader">Lecteur</button>
          <button type="button" class="seg ${N.role === 'editor' ? 'on' : ''}" data-act="nmRole" data-role="editor">Éditeur</button>
        </div>
        <button class="btn btn-accent">Ajouter</button>
      </div>
      <span class="muted small">${esc(N.msg || 'La personne crée son mot de passe à sa première visite, puis vérifie son email.')}</span>
    </form>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>EMAIL</th><th>RÔLE</th><th>AJOUT</th><th class="right">ACTION</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="two muted small">
      <p><b>Lecteur</b> : voit la liste, suggère des titres, vote pour les suggestions.</p>
      <p><b>Éditeur</b> : tout ce que fait un lecteur, et propose des modifications que tu valides.</p>
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ stats */

function viewStats() {
  const T = S.titles;
  let minutes = 0, counted = 0;
  for (const t of T) {
    const m = metaOf(t);
    if (!m.duration || t.kind === 'manga') continue;
    const eps = t.status === 'fini' ? (totalOf(t) || 0) : (t.episode || 0);
    if (eps) { minutes += eps * m.duration; counted++; }
  }
  const hours = Math.round(minutes / 60);
  const famCounts = Object.keys(FAMILIES).map(k => ({ k, n: T.filter(t => t.fam === k).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
  const max = famCounts[0]?.n || 1;
  const byKind = Object.keys(KINDS).map(k => T.filter(t => t.kind === k).length);
  const st = STATUS_ORDER.map(s => ({ s, n: T.filter(t => t.status === s).length })).filter(x => x.n);
  const years = {};
  for (const t of T) if (t.status === 'fini' && t.finishedAt) { const y = t.finishedAt.slice(0, 4); years[y] = (years[y] || 0) + 1; }
  const yKeys = Object.keys(years).sort();
  const yMax = Math.max(1, ...Object.values(years));
  const rated = T.filter(t => t.rating);
  const avg = rated.length ? (rated.reduce((a, t) => a + t.rating, 0) / rated.length).toFixed(1) : null;

  return `
  <section class="page">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">統計</span><h1 class="display-sm">Stats</h1></div>
    <div class="tiles">
      <div class="tile"><span class="mono muted small">TEMPS DEVANT L’ÉCRAN</span><b class="tile-num">${hours ? '≈ ' + hours + ' h' : '— h'}</b><span class="muted small">${counted ? 'Estimation : épisodes vus × durée, sur ' + plural(counted, 'titre', 'titres') : 'Se calcule quand les durées sont connues.'}</span></div>
      <div class="tile"><span class="mono muted small">TITRES SUIVIS</span><b class="tile-num">${T.length}</b><span class="muted small">${byKind[0]} animes · ${byKind[1]} mangas · ${byKind[2]} séries</span></div>
      <div class="tile"><span class="mono muted small">GENRE PRÉFÉRÉ</span><b class="tile-num tile-word">${famCounts[0] ? esc(FAMILIES[famCounts[0].k].name) : '—'}</b><span class="muted small">${famCounts[0] ? famCounts[0].n + ' titres sur ' + T.length : ''}${avg ? ' · note moyenne ' + avg + '/10' : ''}</span></div>
    </div>
    <div class="two-wide">
      <div class="stack">
        <h2 class="h3">Par genre</h2>
        ${famCounts.map(x => `<div class="hbar"><span>${esc(FAMILIES[x.k].name)}</span><span class="hbar-track"><i style="width:${(x.n / max * 100).toFixed(1)}%;background:${FAMILIES[x.k].color}"></i></span><span class="mono right">${x.n}</span></div>`).join('')}
      </div>
      <div class="stack">
        <h2 class="h3">Par statut</h2>
        <div class="stackbar">${st.map(x => `<span class="sb sb-${x.s}" style="flex:${x.n} 1 0" title="${STATUSES[x.s].plural} : ${x.n}">${x.n}</span>`).join('')}</div>
        <div class="legend">${st.map(x => `<span>${STATUSES[x.s].kanji} ${STATUSES[x.s].plural} ${x.n}</span>`).join('')}</div>
        <h2 class="h3">Terminés par année</h2>
        ${yKeys.length ? `<div class="years">${yKeys.map(y => `<div class="year"><span class="mono small">${years[y]}</span><i style="height:${(years[y] / yMax * 100).toFixed(1)}%"></i><span class="mono small">${y}</span></div>`).join('')}</div>`
          : `<p class="muted small panel-dash">Le graphique se remplit dès que tu renseignes les dates de fin dans les fiches.</p>`}
      </div>
    </div>
    <div class="stack">
      <h2 class="h3">Historique</h2>
      ${S.history.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>QUAND</th><th>QUI</th><th>CHANGEMENT</th></tr></thead>
        <tbody>${S.history.map(h => `<tr><td class="mono muted nowrap">${fmtWhen(h.at)}</td><td class="nowrap">${esc(h.byName || h.by)}</td><td>${esc(h.text)}</td></tr>`).join('')}</tbody>
      </table></div>` : `<p class="muted small">Aucun changement enregistré pour l’instant.</p>`}
      ${isAdmin() ? `<button class="btn btn-ghost" data-act="exportJson">Télécharger mes données (JSON)</button>` : ''}
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ authentification */

F.onAuthStateChanged(F.auth, async user => {
  stopListeners();
  S.user = user; S.member = null; S.role = null; S.titles = []; S.titlesReady = false;
  S.requests = []; S.members = []; S.access = []; S.history = []; S.airing = []; S.airingDone = false;
  S.login.err = ''; S.login.busy = false;
  if (!user) { S.phase = 'login'; return render(); }
  S.email = (user.email || '').toLowerCase();
  if (!user.emailVerified) { S.phase = 'verify'; return render(); }
  await loadMember();
});

async function loadMember() {
  S.phase = 'loading'; render();
  try {
    const snap = await F.getDoc(F.doc(F.db, 'members', S.email));
    if (snap.exists()) {
      S.member = snap.data(); S.role = S.member.role; S.phase = 'app';
      startListeners();
    } else {
      S.phase = 'denied'; await loadMyAccess();
    }
  } catch (e) {
    if (e.code === 'permission-denied') { S.phase = 'denied'; await loadMyAccess(); }
    else { S.phase = 'error'; S.error = errText(e); }
  }
  render();
}

async function loadMyAccess() {
  try { S.myAccess = (await F.getDoc(F.doc(F.db, 'accessRequests', S.email))).exists(); }
  catch (e) { S.myAccess = false; }
}

function stopListeners() { S.unsub.forEach(u => u()); S.unsub = []; }

function onListenErr(e) { console.error(e); toast(errText(e)); }

function startListeners() {
  S.unsub.push(F.onSnapshot(F.collection(F.db, 'titles'), snap => {
    S.titles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.titlesReady = true;
    render();
    resolveMeta();
    loadAiring();
  }, onListenErr));
  S.unsub.push(F.onSnapshot(F.collection(F.db, 'requests'), snap => {
    S.requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
    refreshVotes();
  }, onListenErr));
  S.unsub.push(F.onSnapshot(F.query(F.collection(F.db, 'history'), F.orderBy('at', 'desc'), F.limit(150)), snap => {
    S.history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, onListenErr));
  if (isAdmin()) {
    S.unsub.push(F.onSnapshot(F.collection(F.db, 'members'), snap => {
      S.members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, onListenErr));
    S.unsub.push(F.onSnapshot(F.collection(F.db, 'accessRequests'), snap => {
      S.access = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, onListenErr));
  }
}

/* ------------------------------------------------------------------ données externes en arrière-plan */

const META_KEYS = ['cover', 'source', 'extId', 'total', 'duration', 'year', 'altTitle'];
function metaFrom(r) { const o = {}; for (const k of META_KEYS) if (r[k] !== null && r[k] !== undefined && r[k] !== '') o[k] = r[k]; return o; }

let metaBusy = false;
async function resolveMeta() {
  if (metaBusy) return;
  metaBusy = true;
  try {
    for (;;) {
      const t = S.titles.find(x => !x.cover && !x.metaTried && !S.localMeta[x.id]);
      if (!t) break;
      let found = null;
      const key = 'mw:meta:' + t.id;
      try { found = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { /* ignore */ }
      if (!found) {
        try {
          const res = await searchTitles(t.kind, t.lookup || t.title, { popular: true, limit: 3 });
          found = res[0] ? metaFrom(res[0]) : { none: true };
        } catch (e) { break; }
        try { localStorage.setItem(key, JSON.stringify(found)); } catch (e) { /* ignore */ }
      }
      S.localMeta[t.id] = found;
      if (isAdmin()) {
        const patch = { metaTried: true };
        if (!found.none) for (const k of META_KEYS) if (found[k] !== undefined && (t[k] === undefined || t[k] === null || t[k] === '')) patch[k] = found[k];
        try { await F.updateDoc(F.doc(F.db, 'titles', t.id), patch); } catch (e) { /* titre supprimé entre-temps */ }
      } else {
        scheduleRender();
      }
    }
  } finally { metaBusy = false; }
}

let renderTimer = null;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 250); }

let airingBusy = false;
async function loadAiring() {
  if (airingBusy) return;
  const targets = S.titles.filter(t => t.kind === 'anime' && t.status === 'cours' && metaOf(t).source === 'mal' && metaOf(t).extId);
  const key = targets.map(t => t.id).sort().join(',');
  if (key === loadAiring.key) return;
  loadAiring.key = key;
  airingBusy = true;
  const out = [];
  for (const t of targets) {
    try {
      const info = await animeDetails(metaOf(t).extId);
      if (!info.airing) continue;
      const next = nextAiring(info.broadcast);
      if (!next) continue;
      out.push({ id: t.id, title: t.title, at: next.getTime(), when: next.toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) });
    } catch (e) { /* MyAnimeList indisponible */ }
  }
  S.airing = out.sort((a, b) => a.at - b.at);
  S.airingDone = true;
  airingBusy = false;
  render();
  loadAiring(); // relance si de nouveaux animes ont reçu leur identifiant pendant la recherche
}

let votesTimer = null;
function refreshVotes() {
  clearTimeout(votesTimer);
  votesTimer = setTimeout(async () => {
    const pend = S.requests.filter(r => r.type === 'suggestion' && r.status === 'pending');
    await Promise.all(pend.map(async r => {
      try {
        const snap = await F.getDocs(F.collection(F.db, 'requests', r.id, 'votes'));
        S.votes[r.id] = { count: snap.size, mine: snap.docs.some(d => d.id === S.email) };
      } catch (e) { /* ignore */ }
    }));
    render();
  }, 200);
}

/* ------------------------------------------------------------------ écritures */

function historyEntry(batch, text) {
  batch.set(F.doc(F.collection(F.db, 'history')), {
    at: F.serverTimestamp(), by: S.email, byName: (S.member && S.member.name) || S.email, text
  });
}

function titleFromItem(item, status) {
  const today = todayISO();
  return {
    title: item.title, altTitle: item.altTitle || '', kind: item.kind, status,
    genre: (item.genres || []).slice(0, 2).join(' · '), fam: familyFromGenres(item.genres || []),
    cover: item.cover || null, source: item.source, extId: item.extId,
    total: item.total || null, duration: item.duration || null, year: item.year || null,
    season: 1, episode: 0, chapter: 0, rating: null, review: '',
    startedAt: status === 'cours' || status === 'fini' ? today : '', finishedAt: status === 'fini' ? today : '',
    metaTried: true, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
  };
}

function describeChanges(name, changes, before) {
  const parts = [];
  const lbl = { season: 'saison', episode: 'ép.', chapter: 'chap.', total: 'total', genre: 'genre', fam: 'couleur', startedAt: 'début', finishedAt: 'fin' };
  for (const k of Object.keys(changes)) {
    const a = before[k], b = changes[k];
    if (k === 'status') parts.push(`${STATUSES[a]?.label || '—'} → ${STATUSES[b]?.label || '—'}`);
    else if (k === 'rating') parts.push(b ? `noté ${b}/10` : 'note retirée');
    else if (k === 'review') parts.push('avis modifié');
    else if (k === 'fam') parts.push(`couleur ${FAMILIES[b]?.name || b}`);
    else parts.push(`${lbl[k] || k} ${a ?? '—'} → ${b ?? '—'}`);
  }
  return `${name} : ${parts.join(', ')}`;
}

const ACT = {
  reload: () => location.reload(),
  loginMode: el => { S.login.mode = el.dataset.mode; S.login.err = ''; S.login.msg = ''; render(); },
  logout: async () => { S.ui.sheet = null; await F.signOut(F.auth); },
  openMenu: () => { S.ui.sheet = 'menu'; render(); },
  openFilters: () => { S.ui.sheet = 'filters'; render(); },
  closeSheet: () => { S.ui.sheet = null; render(); },

  checkVerified: async () => {
    S.login.busy = true; S.login.err = ''; render();
    try {
      await S.user.reload();
      if (F.auth.currentUser.emailVerified) {
        await F.auth.currentUser.getIdToken(true); // récupère un jeton qui contient email_verified = true
        S.login.busy = false;
        await loadMember();
      } else {
        S.login.busy = false; S.login.err = 'Ton email n’est pas encore vérifié. Clique sur le lien reçu, puis réessaie.'; render();
      }
    } catch (e) { S.login.busy = false; S.login.err = errText(e); render(); }
  },
  resendVerify: async () => {
    S.login.busy = true; render();
    try { await F.sendEmailVerification(F.auth.currentUser, { url: SITE_URL }); S.login.msg = 'Email renvoyé.'; S.login.err = ''; }
    catch (e) { S.login.err = errText(e); }
    S.login.busy = false; render();
  },
  retryMember: async () => { await F.auth.currentUser.getIdToken(true); await loadMember(); },

  status: el => { S.ui.status = el.dataset.status; render(); },
  fam: el => { S.ui.fam = S.ui.fam === el.dataset.fam ? null : el.dataset.fam; render(); },
  sort: () => { S.ui.sort = (S.ui.sort + 1) % SORTS.length; render(); },
  setSort: el => { S.ui.sort = +el.dataset.sort; render(); },
  resetFilters: () => { Object.assign(S.ui, { status: 'all', fam: null, q: '' }); render(); },
  roll: () => {
    const pool = S.titles.filter(t => t.kind === S.ui.section && t.status === 'voir' && (!S.ui.fam || t.fam === S.ui.fam));
    if (!pool.length) return toast('Aucun titre « À voir » dans cette sélection.');
    let p = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && p.id === S.ui.pick) p = pool.find(x => x.id !== S.ui.pick);
    S.ui.pick = p.id; render();
  },

  plus: async el => {
    const t = S.titles.find(x => x.id === el.dataset.id);
    if (!t) return;
    const field = t.kind === 'manga' ? 'chapter' : 'episode';
    const before = t[field] || 0, after = before + 1;
    try {
      if (isAdmin()) {
        const b = F.writeBatch(F.db);
        b.update(F.doc(F.db, 'titles', t.id), { [field]: after, updatedAt: F.serverTimestamp() });
        historyEntry(b, `${t.title} : ${field === 'chapter' ? 'chap.' : 'ép.'} ${before} → ${after}`);
        await b.commit();
        const tot = totalOf(t);
        if (tot && after >= tot) toast(`Dernier ${field === 'chapter' ? 'chapitre' : 'épisode'} de ${t.title} ! Passe-le en « Terminé » dans sa fiche.`);
      } else {
        await F.addDoc(F.collection(F.db, 'requests'), {
          type: 'edit', by: S.email, byName: (S.member && S.member.name) || S.email, status: 'pending', createdAt: F.serverTimestamp(),
          titleId: t.id, titleName: t.title, changes: { [field]: after }, before: { [field]: before }
        });
        toast(`Proposé à Nerol : ${t.title} ${field === 'chapter' ? 'chap.' : 'ép.'} ${after}`);
      }
    } catch (e) { toast(errText(e)); }
  },

  seed: async el => {
    el.disabled = true;
    try {
      const b = F.writeBatch(F.db);
      for (const [title, genre, fam, status, kind, lookup] of SEED) {
        b.set(F.doc(F.collection(F.db, 'titles')), {
          title, genre, fam, status, kind, lookup, altTitle: '',
          season: 1, episode: 0, chapter: 0, rating: null, review: '', startedAt: '', finishedAt: '',
          cover: null, total: null, duration: null, metaTried: false,
          createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
        });
      }
      historyEntry(b, `Import de la liste de départ (${SEED.length} titres)`);
      await b.commit();
      toast('Liste importée. Les affiches arrivent au fur et à mesure.');
    } catch (e) { el.disabled = false; toast(errText(e)); }
  },

  /* fiche */
  dStatus: el => {
    const s = el.dataset.status, d = S.draft;
    d.status = s;
    if ((s === 'cours' || s === 'fini') && !d.startedAt) d.startedAt = todayISO();
    if (s === 'fini' && !d.finishedAt) d.finishedAt = todayISO();
    render();
  },
  step: el => {
    const f = el.dataset.field, d = S.draft, min = f === 'season' ? 1 : 0;
    d[f] = Math.max(min, (+d[f] || 0) + (+el.dataset.d));
    if (f === 'season' && +el.dataset.d > 0) d.episode = 0;
    render();
  },
  rate: el => { const v = +el.dataset.v; S.draft.rating = S.draft.rating === v ? null : v; render(); },
  saveTitle: async el => {
    const t = S.titles.find(x => x.id === el.dataset.id);
    if (!t) return;
    const { changes, before } = diffDraft(t);
    if (!Object.keys(changes).length) return;
    el.disabled = true;
    try {
      if (isAdmin()) {
        const b = F.writeBatch(F.db);
        b.update(F.doc(F.db, 'titles', t.id), { ...changes, updatedAt: F.serverTimestamp() });
        historyEntry(b, describeChanges(t.title, changes, before));
        await b.commit();
        S.draft = null;
        toast('Enregistré.');
      } else {
        await F.addDoc(F.collection(F.db, 'requests'), {
          type: 'edit', by: S.email, byName: (S.member && S.member.name) || S.email, status: 'pending', createdAt: F.serverTimestamp(),
          titleId: t.id, titleName: t.title, changes, before
        });
        S.draft = null;
        toast('Modification envoyée à Nerol.');
      }
    } catch (e) { el.disabled = false; toast(errText(e)); }
  },
  askConfirm: el => { S.ui.confirm = el.dataset.key; render(); },
  cancelConfirm: () => { S.ui.confirm = null; render(); },
  deleteTitle: async el => {
    const t = S.titles.find(x => x.id === el.dataset.id);
    if (!t) return;
    try {
      const b = F.writeBatch(F.db);
      b.delete(F.doc(F.db, 'titles', t.id));
      historyEntry(b, `${t.title} retiré de la liste`);
      await b.commit();
      S.ui.confirm = null; S.draft = null;
      location.hash = { anime: '#/animes', manga: '#/mangas', serie: '#/series' }[t.kind] || '#/';
      toast(`${t.title} supprimé.`);
    } catch (e) { toast(errText(e)); }
  },
  toggleFix: () => { S.fix.open = !S.fix.open; render(); },
  fixPick: async el => {
    const r = S.fix.results[+el.dataset.i], t = S.titles.find(x => x.id === S.draft.id);
    if (!r || !t) return;
    try {
      const patch = { ...metaFrom(r), metaTried: true, updatedAt: F.serverTimestamp() };
      if (!patch.total) patch.total = null;
      const b = F.writeBatch(F.db);
      b.update(F.doc(F.db, 'titles', t.id), patch);
      historyEntry(b, `${t.title} : affiche et infos corrigées (${r.title})`);
      await b.commit();
      try { localStorage.removeItem('mw:meta:' + t.id); } catch (e) { /* ignore */ }
      delete S.localMeta[t.id];
      S.fix.open = false; S.draft = null;
      toast('Affiche mise à jour.');
    } catch (e) { toast(errText(e)); }
  },

  /* ajouter / suggérer */
  addKind: el => { Object.assign(S.add, { kind: el.dataset.kind, results: [], chosen: null, err: '' }); render(); if (S.add.q.trim().length >= 2) runAddSearch(); },
  addPick: el => { S.add.chosen = +el.dataset.i; render(); },
  addStatus: el => { S.add.status = el.dataset.status; render(); },
  addTitle: async el => {
    const item = S.add.results[S.add.chosen];
    if (!item) return;
    el.disabled = true;
    try {
      const b = F.writeBatch(F.db);
      b.set(F.doc(F.collection(F.db, 'titles')), titleFromItem(item, S.add.status));
      historyEntry(b, `${item.title} ajouté (${STATUSES[S.add.status].label})`);
      await b.commit();
      toast(`${item.title} ajouté à ta liste.`);
      Object.assign(S.add, { q: '', results: [], chosen: null });
      render();
    } catch (e) { el.disabled = false; toast(errText(e)); }
  },
  suggest: async el => {
    const item = S.add.results[S.add.chosen];
    if (!item) return;
    el.disabled = true;
    try {
      const clean = { title: item.title, altTitle: item.altTitle || '', kind: item.kind, cover: item.cover || null, source: item.source, extId: item.extId, total: item.total || null, duration: item.duration || null, year: item.year || null, genres: (item.genres || []).slice(0, 6) };
      await F.addDoc(F.collection(F.db, 'requests'), {
        type: 'suggestion', by: S.email, byName: (S.member && S.member.name) || S.email, status: 'pending',
        createdAt: F.serverTimestamp(), item: clean, note: S.add.note.trim()
      });
      toast(`${item.title} envoyé à Nerol.`);
      Object.assign(S.add, { q: '', results: [], chosen: null, note: '' });
      render();
    } catch (e) { el.disabled = false; toast(errText(e)); }
  },
  vote: async el => {
    const id = el.dataset.id, v = S.votes[id] || { count: 0, mine: false };
    const ref = F.doc(F.db, 'requests', id, 'votes', S.email);
    S.votes[id] = { count: v.count + (v.mine ? -1 : 1), mine: !v.mine };
    render();
    try { if (v.mine) await F.deleteDoc(ref); else await F.setDoc(ref, { at: F.serverTimestamp() }); }
    catch (e) { S.votes[id] = v; render(); toast(errText(e)); }
  },

  /* validation */
  vfilter: el => { S.ui.vfilter = el.dataset.f; render(); },
  acceptSugg: async el => {
    const r = S.requests.find(x => x.id === el.dataset.id);
    if (!r) return;
    el.disabled = true;
    try {
      const b = F.writeBatch(F.db);
      b.set(F.doc(F.collection(F.db, 'titles')), titleFromItem(r.item, 'voir'));
      b.update(F.doc(F.db, 'requests', r.id), { status: 'accepted', decidedAt: F.serverTimestamp() });
      historyEntry(b, `Suggestion de ${r.byName || r.by} acceptée : ${r.item.title} ajouté en À voir`);
      await b.commit();
      toast(`${r.item.title} ajouté en À voir.`);
    } catch (e) { el.disabled = false; toast(errText(e)); }
  },
  acceptEdit: async el => {
    const r = S.requests.find(x => x.id === el.dataset.id);
    const t = r && S.titles.find(x => x.id === r.titleId);
    if (!r || !t) return;
    el.disabled = true;
    try {
      const b = F.writeBatch(F.db);
      b.update(F.doc(F.db, 'titles', t.id), { ...r.changes, updatedAt: F.serverTimestamp() });
      b.update(F.doc(F.db, 'requests', r.id), { status: 'accepted', decidedAt: F.serverTimestamp() });
      historyEntry(b, describeChanges(t.title, r.changes, r.before || {}) + ` (proposé par ${r.byName || r.by})`);
      await b.commit();
      toast('Modification appliquée.');
    } catch (e) { el.disabled = false; toast(errText(e)); }
  },
  refuseReq: async el => {
    try { await F.updateDoc(F.doc(F.db, 'requests', el.dataset.id), { status: 'refused', decidedAt: F.serverTimestamp() }); toast('Demande refusée.'); }
    catch (e) { toast(errText(e)); }
  },
  acceptAccess: async el => {
    const a = S.access.find(x => x.id === el.dataset.id);
    if (!a) return;
    try {
      const b = F.writeBatch(F.db);
      b.set(F.doc(F.db, 'members', a.id), { role: 'reader', name: a.id.split('@')[0], addedAt: F.serverTimestamp() });
      b.delete(F.doc(F.db, 'accessRequests', a.id));
      historyEntry(b, `${a.id} ajouté comme lecteur`);
      await b.commit();
      toast(`${a.id} peut maintenant entrer.`);
    } catch (e) { toast(errText(e)); }
  },
  refuseAccess: async el => {
    try { await F.deleteDoc(F.doc(F.db, 'accessRequests', el.dataset.id)); toast('Demande d’accès refusée.'); }
    catch (e) { toast(errText(e)); }
  },

  /* membres */
  nmRole: el => { S.newMember.role = el.dataset.role; render(); },
  setRole: async el => {
    const id = el.dataset.id, role = el.dataset.role, m = S.members.find(x => x.id === id);
    if (!m || m.role === role) return;
    try {
      const b = F.writeBatch(F.db);
      b.update(F.doc(F.db, 'members', id), { role });
      historyEntry(b, `${id} passe ${role === 'editor' ? 'éditeur' : 'lecteur'}`);
      await b.commit();
    } catch (e) { toast(errText(e)); }
  },
  removeMember: async el => {
    const id = el.dataset.id;
    try {
      const b = F.writeBatch(F.db);
      b.delete(F.doc(F.db, 'members', id));
      historyEntry(b, `${id} retiré des membres`);
      await b.commit();
      S.ui.confirm = null;
      toast(`${id} n’a plus accès.`);
    } catch (e) { toast(errText(e)); }
  },

  exportJson: () => {
    const plain = list => list.map(x => JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v.toMillis === 'function') ? new Date(v.toMillis()).toISOString() : v)));
    const data = { exportedAt: new Date().toISOString(), titles: plain(S.titles), members: plain(S.members), requests: plain(S.requests), history: plain(S.history) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `mywatchlist-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
};

/* ------------------------------------------------------------------ formulaires */

const SUBMIT = {
  signin: async fd => {
    await F.signInWithEmailAndPassword(F.auth, fd.get('email').trim(), fd.get('password'));
  },
  signup: async fd => {
    const pwd = fd.get('password');
    if (pwd.length < 8) throw { code: 'auth/weak-password' };
    const cred = await F.createUserWithEmailAndPassword(F.auth, fd.get('email').trim(), pwd);
    await F.sendEmailVerification(cred.user, { url: SITE_URL });
  },
  forgot: async fd => {
    try { await F.sendPasswordResetEmail(F.auth, fd.get('email').trim(), { url: SITE_URL }); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    S.login.mode = 'login';
    S.login.msg = 'Si cet email a un compte, un lien pour choisir un nouveau mot de passe vient de partir.';
  },
  requestAccess: async fd => {
    await F.setDoc(F.doc(F.db, 'accessRequests', S.email), { email: S.email, note: (fd.get('note') || '').trim().slice(0, 400), at: F.serverTimestamp() });
    S.myAccess = true;
  },
  addSearch: async () => { await runAddSearch(); },
  fixSearch: async () => {
    const t = S.titles.find(x => x.id === S.draft.id);
    S.fix.busy = true; render();
    try { S.fix.results = await searchTitles(t.kind, S.fix.q, { limit: 8 }); }
    catch (e) { toast(errText(e)); }
    S.fix.busy = false;
  },
  addMember: async () => {
    const email = S.newMember.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { S.newMember.msg = 'Cet email n’est pas valide : il faut un @ et un domaine.'; return; }
    if (S.members.some(m => m.id === email)) { S.newMember.msg = `${email} est déjà membre.`; return; }
    const b = F.writeBatch(F.db);
    b.set(F.doc(F.db, 'members', email), { role: S.newMember.role, name: email.split('@')[0], addedAt: F.serverTimestamp() });
    if (S.access.some(a => a.id === email)) b.delete(F.doc(F.db, 'accessRequests', email));
    historyEntry(b, `${email} ajouté comme ${S.newMember.role === 'editor' ? 'éditeur' : 'lecteur'}`);
    await b.commit();
    S.newMember = { email: '', role: S.newMember.role, msg: `${email} peut maintenant créer son mot de passe sur cette page.` };
  }
};

let addTimer = null;
async function runAddSearch() {
  const A = S.add, q = A.q.trim();
  if (q.length < 2) { A.results = []; A.chosen = null; render(); return; }
  A.busy = true; A.err = ''; render();
  const stamp = (runAddSearch.n = (runAddSearch.n || 0) + 1);
  try {
    const res = await searchTitles(A.kind, q, { limit: 8 });
    if (stamp !== runAddSearch.n) return;
    A.results = res; A.chosen = null;
  } catch (e) { A.err = errText(e); }
  A.busy = false; render();
}

const INPUT = {
  loginEmail: el => { S.login.email = el.value; },
  q: el => { S.ui.q = el.value; render(); },
  addq: el => { S.add.q = el.value; clearTimeout(addTimer); addTimer = setTimeout(runAddSearch, 450); },
  addNote: el => { S.add.note = el.value; },
  fixq: el => { S.fix.q = el.value; },
  nmEmail: el => { S.newMember.email = el.value; },
  draft: el => { S.draft[el.dataset.field] = el.value; if (el.tagName === 'SELECT') render(); else scheduleRender(); },
  draftNum: el => { S.draft[el.dataset.field] = el.value === '' ? null : Math.max(0, parseInt(el.value, 10) || 0); scheduleRender(); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'A') e.preventDefault();
  fn(el, e);
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-in]');
  if (el && INPUT[el.dataset.in]) INPUT[el.dataset.in](el);
});
document.addEventListener('change', e => {
  const el = e.target.closest('select[data-in]');
  if (el && INPUT[el.dataset.in]) INPUT[el.dataset.in](el);
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-submit]');
  if (!form) return;
  e.preventDefault();
  const fn = SUBMIT[form.dataset.submit];
  if (!fn) return;
  const isAuth = ['signin', 'signup', 'forgot', 'requestAccess'].includes(form.dataset.submit);
  if (isAuth) { S.login.busy = true; S.login.err = ''; S.login.msg = ''; render(); }
  try { await fn(new FormData(form)); }
  catch (err) {
    if (isAuth) S.login.err = errText(err);
    else toast(errText(err));
  }
  if (isAuth) S.login.busy = false;
  render();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.ui.sheet) { S.ui.sheet = null; render(); }
});

window.addEventListener('hashchange', () => {
  S.ui.sheet = null;
  const r = route();
  if (r.name !== 'title') S.draft = null;
  render();
  window.scrollTo(0, 0);
});

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
