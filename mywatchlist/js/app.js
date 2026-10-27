import * as F from './firebase.js';
import { FAMILIES, STATUSES, STATUS_ORDER, KINDS, SEED, STATUS_PIC, FILM_STATUSES, statusLabel, familyFromGenres } from './data.js';
import { searchTitles, upcomingEpisodes, watchProviders, hasTmdb } from './external.js';
import { SITE_URL, OWNER } from './config.js';

/* ------------------------------------------------------------------ état */

const $app = document.getElementById('app');

const S = {
  phase: 'loading',            // loading | login | verify | denied | app | error
  user: null, uid: '', email: '', member: null, role: null, error: '',
  names: {},                   // uid -> pseudo (annuaire public des membres)
  pseudoKeys: {},              // uid -> clé de pseudo réservée
  profile: { pseudo: '', msg: '', err: '', busy: false },
  prov: {},                    // titleId -> plateformes (TMDB)
  streaming: null,             // liens « Où regarder » choisis par l'admin
  newSite: { name: '', url: '', note: '' },
  flash: {}, lastUpdated: {},  // cartes qui viennent de changer
  update: false,               // nouvelle version du site prête
  titles: [], titlesReady: false,
  requests: [], votes: {},
  members: [], access: [], history: [],
  myAccess: false,
  localMeta: {},               // affiches trouvées pour les non-admins
  airing: [],
  login: { mode: 'login', msg: '', err: '', busy: false, email: '' },
  ui: { section: 'anime', status: 'all', fam: null, q: '', sort: 0, sheet: null, pick: null, rolls: 0, vfilter: 'all', confirm: null },
  draft: null,                 // brouillon de la fiche ouverte
  add: { kind: 'anime', q: '', results: [], busy: false, err: '', chosen: null, note: '', status: 'voir' },
  fix: { open: false, q: '', results: [], busy: false },
  newMember: { email: '', role: 'reader', msg: '', invite: '' },
  adminLog: [],
  seen: {},                    // titleId -> [{ id: email, name, rating }]
  follows: null,               // { titles: { id: { status, season, episode, chapter } } }
  welcomeOpen: false,
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

/** Pictogramme recolorable (masque CSS sur un SVG de img/pictos). */
// Adresse complète : une url() dans une variable CSS se lit depuis la feuille de style, pas depuis la page
const PICTOS = new URL('img/pictos/', document.baseURI).href;
const pic = (name, cls = '') => `<i class="pic ${cls}" style="--p:url(${PICTOS}${name}.svg)" aria-hidden="true"></i>`;
const statusPic = s => pic(STATUS_PIC[s] || STATUS_PIC.voir);
const kindHash = k => (KINDS[k] && KINDS[k].hash) || '#/';
const isEmail = v => /@/.test(v || '');

/** Nom affiché d'un membre : son pseudo, jamais son email (sauf pour l'admin, qui voit les deux). */
function memberByUid(uid) { return S.members.find(m => m.uid === uid); }
function displayName(uid, fallback) {
  if (uid && S.names[uid]) return S.names[uid];
  if (uid && uid === S.uid) return myName();
  const m = isAdmin() && memberByUid(uid);
  if (m) return m.pseudo || m.name || m.id;
  return fallback && !isEmail(fallback) ? fallback : 'Un membre';
}
function myName() {
  // Sans pseudo, un membre reste « Un membre » : le nom par défaut vient de son email
  if (!S.member) return 'Moi';
  return S.member.pseudo || (isAdmin() ? S.member.name || OWNER : 'Un membre');
}
/** Pour l'admin : « pseudo · email » ; pour les autres : le pseudo seul. */
function whoLabel(uid, fallback) {
  const name = displayName(uid, fallback);
  if (!isAdmin()) return name;
  const m = memberByUid(uid) || (isEmail(uid) && S.members.find(x => x.id === uid));
  return m ? `${m.pseudo || name} · ${m.id}` : name;
}
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
  if (name === 'films') return { name: 'list', section: 'film' };
  if (name === 'titre' && id) return { name: 'title', id: decodeURIComponent(id) };
  if (['ajouter', 'valider', 'membres', 'stats', 'avis', 'aide', 'profil', 'ou-regarder'].includes(name)) return { name };
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
  if (S.phase === 'loading') return `<div class="solo solo-center"><div class="solo-in center-in"><img class="logo-load" src="img/logo-grave.png" alt="" width="120" height="120"><p class="muted">Chargement…</p></div></div>`;
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
  else if (r.name === 'avis') main = viewReviews();
  else if (r.name === 'aide') main = viewHelp();
  else if (r.name === 'profil') main = viewProfile();
  else if (r.name === 'ou-regarder') main = viewWhere();
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
          ${create ? `<span class="hint">8 caractères minimum. Ton email doit avoir été invité par ${OWNER}.</span>` : ''}
        </div>
        <button class="btn ${create ? 'btn-accent' : 'btn-ink'} btn-lg" ${L.busy ? 'disabled' : ''}>${create ? 'Créer mon mot de passe' : 'Entrer'}</button>
        ${create ? '' : '<button type="button" class="link" data-act="loginMode" data-mode="forgot">Mot de passe oublié ?</button>'}
      </form>`;
  }
  return `
  <div class="solo"><div class="solo-in">
    <img class="logo-signe" src="img/logo-signe.png" alt="Avatar de ${OWNER} avec son sceau" width="200" height="200">
    <span class="mono muted">LA WATCHLIST DE ${OWNER.toUpperCase()}</span>
    <h1 class="display">Watchlist<br>de ${OWNER}</h1>
    <p class="muted">Les animes, mangas, séries et films de ${OWNER}. C’est un espace privé : on y entre sur invitation, avec l’email que ${OWNER} a autorisé.</p>
    ${L.err ? `<p class="alert" role="alert">${esc(L.err)}</p>` : ''}
    ${L.msg ? `<p class="note" role="status">${esc(L.msg)}</p>` : ''}
    ${body}
  </div></div>`;
}

function viewVerify() {
  const L = S.login;
  return `
  <div class="solo"><div class="solo-in">
    <img class="logo-mid" src="img/logo-tampon.png" alt="" width="96" height="96">
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
    <img class="logo-mid" src="img/logo-grave.png" alt="" width="110" height="110">
    <p class="mono muted">CONNECTÉ EN TANT QUE ${esc(S.email)}</p>
    <h1 class="display-sm">Accès réservé</h1>
    <p>Cette page est la watchlist personnelle de ${OWNER}. On y entre sur invitation, et ton email n’est pas encore sur la liste.</p>
    <p class="muted">Laisse-lui un mot : il recevra ta demande et pourra t’ouvrir l’accès.</p>
    ${S.myAccess ? `
      <div class="panel"><b>Demande envoyée.</b><br><span class="muted">Reviens plus tard : la page s’ouvrira dès que ta demande sera acceptée.</span></div>
      <button class="btn btn-ghost" data-act="retryMember">Vérifier à nouveau</button>` : `
      <form class="stack" data-submit="requestAccess">
        <div class="field"><label for="anote">Un mot pour te présenter (facultatif)</label><textarea id="anote" name="note" rows="3" maxlength="400" placeholder="Salut, c’est…"></textarea></div>
        <button class="btn btn-accent btn-lg">Demander l’accès</button>
      </form>`}
    <button class="link" data-act="logout">Se déconnecter</button>
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
  const me = myName();
  const initial = esc(me.charAt(0).toUpperCase());
  const roleLabel = { admin: 'Admin', editor: 'Éditeur', reader: 'Lecteur' }[S.role] || '';

  // Barre du bas (téléphone) : les quatre sections + l'action principale du rôle
  const tabs = Object.keys(KINDS).map(k =>
    `<a href="${KINDS[k].hash}" class="${isList && S.ui.section === k ? 'on' : ''}" ${isList && S.ui.section === k ? 'aria-current="page"' : ''}>${pic(KINDS[k].pic)}<span>${KINDS[k].label}</span></a>`).join('')
    + (admin
      ? `<a href="#/valider" class="${r.name === 'valider' ? 'on' : ''}"><span class="tk">${pic('action-valider')}${n ? `<span class="dot-badge">${n}</span>` : ''}</span><span>À valider</span></a>`
      : `<a href="#/ajouter" class="${r.name === 'ajouter' ? 'on' : ''}">${pic('action-suggerer')}<span>Suggérer</span></a>`);

  const sheet = S.ui.sheet === 'menu' ? `
    <div class="sheet-bg" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-label="Menu">
      <div class="row-between"><b class="wrap-any">${esc(me)}</b><span class="mono muted">${roleLabel.toUpperCase()}</span></div>
      <nav class="sheet-nav">
        <a href="#/" data-act="closeSheet">Liste</a>
        <a href="#/avis" data-act="closeSheet">Les avis de ${OWNER}</a>
        <a href="#/ajouter" data-act="closeSheet">${addLabel}</a>
        ${admin ? `<a href="#/valider" data-act="closeSheet">À valider ${n ? `<span class="badge">${n}</span>` : ''}</a><a href="#/membres" data-act="closeSheet">Membres</a>` : ''}
        <a href="#/ou-regarder" data-act="closeSheet">Où regarder</a>
        <a href="#/stats" data-act="closeSheet">Stats et historique</a>
        <a href="#/profil" data-act="closeSheet">Mon profil</a>
        <a href="#/aide" data-act="closeSheet">Comment ça marche</a>
      </nav>
      <button class="btn btn-ghost" data-act="logout">Se déconnecter</button>
    </div>` : '';

  return `
  <header class="top">
    <div class="wrap top-in">
      <a href="#/" class="brand"><img class="brand-logo" src="img/logo-tampon.png" alt="" width="38" height="38"><span>Watchlist <span class="brand-of">de ${OWNER}</span></span></a>
      <nav class="nav-desk" aria-label="Navigation">
        ${link('#/', 'Liste', isList)}
        ${link('#/avis', 'Avis', r.name === 'avis')}
        ${link('#/ajouter', addLabel, r.name === 'ajouter')}
        ${admin ? link('#/valider', 'À valider', r.name === 'valider', n) : ''}
        ${admin ? link('#/membres', 'Membres', r.name === 'membres') : ''}
        ${link('#/ou-regarder', 'Où regarder', r.name === 'ou-regarder')}
        ${link('#/stats', 'Stats', r.name === 'stats')}
      </nav>
      ${admin ? '' : `<a href="#/aide" class="role-chip" title="Ce que ton rôle permet">${roleLabel}<span class="role-more"> · ce que je peux faire</span><span class="role-q" aria-hidden="true">?</span></a>`}
      <button class="who" data-act="openMenu" aria-label="Menu du compte">
        <span class="avatar">${initial}</span><span class="who-name">${esc(me)}</span><span class="mono muted who-role">${roleLabel.toUpperCase()}</span>
      </button>
    </div>
  </header>
  <div class="ptr" aria-hidden="true"><img src="img/logo-tampon.png" alt="" width="40" height="40"></div>
  <main class="wrap main">${main}${footer()}</main>
  <nav class="tabbar" aria-label="Sections">${tabs}</nav>
  ${sheet}
  ${S.update ? `<div class="update-bar" role="status"><span>Nouvelle version disponible</span><button class="btn btn-accent" data-act="applyUpdate">Mettre à jour</button></div>` : ''}
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
  if (!S.titlesReady) return skeleton();
  if (S.titles.length === 0) {
    return `
    <section class="empty-big">
      <img class="logo-mid" src="img/logo-grave.png" alt="" width="96" height="96">
      <h1 class="display-sm">La liste est vide</h1>
      ${isAdmin()
        ? `<p>Importe tes ${SEED.length} titres de départ (animes, mangas et séries de ta note). Les affiches se chargeront ensuite toutes seules.</p>
           <button class="btn btn-accent btn-lg" data-act="seed">Importer mes ${SEED.length} titres</button>`
        : `<p>${OWNER} n’a encore rien ajouté. Tu peux déjà lui suggérer un titre.</p><a class="btn btn-ink" href="#/ajouter">Suggérer un titre</a>`}
    </section>`;
  }

  const { inSec, base, list } = filtered();
  const count = s => S.titles.filter(t => t.status === s).length;
  const stamps = `
    <div class="stamps">
      <div class="stamp-col"><span class="stamp-big st-cours"><b>${count('cours')}</b>${statusPic('cours')}</span><span class="mono muted">EN COURS</span></div>
      <div class="stamp-col"><span class="stamp-big st-voir"><b>${count('voir')}</b>${statusPic('voir')}</span><span class="mono muted">À VOIR</span></div>
      <div class="stamp-col"><span class="stamp-big st-fini"><b>${count('fini')}</b>${statusPic('fini')}</span><span class="mono muted">TERMINÉS</span></div>
    </div>`;

  const sections = Object.keys(KINDS).map(k => {
    const n = S.titles.filter(t => t.kind === k).length;
    return `<a href="${KINDS[k].hash}" class="sec ${U.section === k ? 'on' : ''}" ${U.section === k ? 'aria-current="page"' : ''}>${pic(KINDS[k].pic)}${KINDS[k].label} <span class="mono">${n}</span></a>`;
  }).join('');

  // genres de la section
  const famCounts = Object.keys(FAMILIES).map(k => ({ k, n: inSec.filter(t => t.fam === k).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
  const spectrum = famCounts.length ? `
    <div class="spectrum-wrap">
      <div class="row-between mono muted small"><span>${own('MON SPECTRE', 'SON SPECTRE')} · clique un genre pour filtrer</span><span>Genre n°1 : ${esc(FAMILIES[famCounts[0].k].name)}</span></div>
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
        <span class="mono muted small">NOUVEAUX ÉPISODES CETTE SEMAINE · heure de Paris</span>
        <div class="chips">${air.length ? air.map(a => `<a class="chip-air" href="#/titre/${encodeURIComponent(a.id)}"><b>${esc(a.title)}</b><span class="muted">${esc(a.when)}</span></a>`).join('') : `<span class="muted small">${S.airingDone ? own('Aucun de tes animes en cours n’est diffusé cette semaine.', `Aucun des animes que ${OWNER} suit n’est diffusé cette semaine.`) : 'Recherche des horaires de diffusion…'}</span>`}</div>
      </div>
      ${pickBox()}
    </div>` : `<div class="band">${pickBox()}</div>`;

  const order = U.section === 'film' ? FILM_STATUSES : STATUS_ORDER;
  const statusTabs = ['all', ...order].map(s => {
    const n = s === 'all' ? base.length : base.filter(t => t.status === s).length;
    const label = s === 'all' ? 'Tous' : statusLabel(s, U.section, true);
    return `<button class="seg ${U.status === s ? 'on' : ''}" data-act="status" data-status="${s}" aria-pressed="${U.status === s}">${s === 'all' ? '' : statusPic(s)}${label} <span class="mono">${n}</span></button>`;
  }).join('');

  const hasFilter = U.status !== 'all' || U.fam || U.q.trim();
  const cards = list.map(card).join('');

  return `
  ${welcomeCard()}
  ${pseudoPrompt()}
  ${noticesBanner()}
  <section class="hero">
    <div class="vert" aria-hidden="true">視聴リスト</div>
    <div class="hero-text">
      <span class="mono muted">LA WATCHLIST DE ${OWNER.toUpperCase()}</span>
      <h1 class="display">Watchlist<br>de ${OWNER}</h1>
      <p class="muted lead">${own('Les animes, mangas, séries et films que tu regardes, que tu as finis, et ceux qui attendent leur tour.', `Les animes, mangas, séries et films que ${OWNER} regarde, qu’il a finis, et ceux qui attendent leur tour.`)} ${plural(S.titles.length, 'titre', 'titres')} au compteur.</p>
    </div>
    ${stamps}
  </section>
  <nav class="sections" aria-label="Sections">${sections}</nav>
  ${coverBanner()}
  ${favRow()}
  ${band}
  ${activityBox()}
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
    <div class="empty"><img src="img/logo-grave.png" alt="" width="72" height="72"><p>${list.length || base.length || hasFilter ? 'Aucun titre ne correspond.' : `Aucun titre dans ${KINDS[U.section].label.toLowerCase()} pour l’instant.`}</p>${hasFilter ? `<button class="btn btn-ghost" data-act="resetFilters">Effacer les filtres</button>` : ''}</div>`}
  ${S.ui.sheet === 'filters' ? filtersSheet(famCounts) : ''}
  ${statusLegend()}`;
}

function statusLegend() {
  return `<p class="legend-status small muted">${STATUS_ORDER.map(s => `<span>${statusPic(s)}${statusLabel(s)}</span>`).join('')}</p>`;
}

function skeleton() {
  return `
  <div class="skel" aria-busy="true" aria-label="Chargement de la liste">
    <span class="skel-line skel-title"></span><span class="skel-line"></span>
    <div class="grid">${Array.from({ length: 12 }, () => `<div class="card"><span class="poster skel-box"></span><span class="skel-line"></span><span class="skel-line short"></span></div>`).join('')}</div>
  </div>`;
}

function pseudoPrompt() {
  if (!S.member || S.member.pseudo) return '';
  return `
    <div class="note row-between" role="status">
      <span>Choisis ton pseudo : c’est lui que les autres membres verront${isAdmin() ? '' : ', jamais ton email'}.</span>
      <a class="btn btn-ink" href="#/profil">Choisir mon pseudo</a>
    </div>`;
}

const own = (mine, theirs) => isAdmin() ? mine : theirs;

/* Ce que chaque rôle peut faire : repris par la carte de bienvenue et la page d'aide. */
const ROLE_CAN = {
  reader: {
    label: 'Lecteur',
    can: [`Parcourir les animes, mangas, séries et films de ${OWNER}`, 'Voir où il en est, ses notes et ses avis', 'Dire que tu as vu un titre et lui donner ta note', 'Suivre un titre pour être prévenu quand il avance', `Suggérer un titre à ${OWNER}`, 'Voter pour les suggestions des autres membres'],
    cannot: [`Modifier la liste de ${OWNER}`]
  },
  editor: {
    label: 'Éditeur',
    can: ['Tout ce que fait un lecteur', 'Proposer des modifications : un épisode vu, un statut, une note…'],
    cannot: [`Modifier la liste directement : ${OWNER} valide chaque proposition avant qu’elle s’applique`]
  },
  admin: {
    label: 'Admin',
    can: ['Tout modifier', 'Valider les suggestions et les propositions', 'Inviter des membres et choisir leur rôle'],
    cannot: []
  }
};

function welcomeCard() {
  if (isAdmin() || !S.welcomeOpen) return '';
  const R = ROLE_CAN[S.role] || ROLE_CAN.reader;
  const first = esc((S.member && S.member.pseudo) || '');
  return `
    <section class="welcome" aria-label="Bienvenue">
      <div class="row-between"><b class="h3">Bienvenue${first ? ' ' + first : ''} !</b><button class="link" data-act="closeWelcome">Fermer</button></div>
      <p>Tu es <b>${R.label.toLowerCase()}</b> sur la watchlist de ${OWNER}.</p>
      <div class="two">
        <div><span class="label">TU PEUX</span><ul class="ticks">${R.can.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        ${R.cannot.length ? `<div><span class="label">TU NE PEUX PAS</span><ul class="crosses">${R.cannot.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>
      <a class="link" href="#/aide">Tout savoir dans « Comment ça marche »</a>
    </section>`;
}

/* Décisions sur mes demandes + nouveautés des titres suivis, depuis ma dernière visite. */
function myDecisions() {
  const since = lsGet('mw:decisions:' + S.email, 0);
  return S.requests.filter(r => (r.by === S.uid || r.by === S.email) && r.status !== 'pending' && tsMillis(r.decidedAt) > since);
}
function followChanges() {
  const F2 = S.follows && S.follows.titles;
  if (!F2 || isAdmin()) return [];
  const out = [];
  for (const id of Object.keys(F2)) {
    const t = S.titles.find(x => x.id === id), old = F2[id];
    if (!t) continue;
    const parts = [];
    if (old.status !== t.status) parts.push(`${STATUSES[old.status]?.label || '—'} → ${STATUSES[t.status]?.label || '—'}`);
    if (t.kind === 'manga' ? (old.chapter || 0) !== (t.chapter || 0) : ((old.season || 1) !== (t.season || 1) || (old.episode || 0) !== (t.episode || 0))) parts.push(progressText(t));
    if (t.status === 'fini' && t.rating && old.rating !== t.rating) parts.push(`noté ${t.rating}/10`);
    if (parts.length) out.push({ t, text: parts.join(', ') });
  }
  return out;
}
function noticesBanner() {
  if (isAdmin()) return '';
  const dec = myDecisions(), fol = followChanges();
  if (!dec.length && !fol.length) return '';
  const name = r => r.type === 'edit' ? `ta modification de ${r.titleName}` : `ta suggestion ${r.item?.title || ''}`;
  return `
    <section class="notices" aria-label="Nouveautés">
      <b class="h3">Du nouveau depuis ta dernière visite</b>
      <ul class="plain">
        ${dec.map(r => `<li>${r.status === 'accepted' ? '✓' : '✗'} ${OWNER} a ${r.status === 'accepted' ? 'accepté' : 'refusé'} ${esc(name(r))}${r.status === 'accepted' && r.type === 'suggestion' ? ' : elle est dans sa liste « À voir »' : ''}.</li>`).join('')}
        ${fol.map(x => `<li>◎ <a href="#/titre/${encodeURIComponent(x.t.id)}"><b>${esc(x.t.title)}</b></a> : ${esc(x.text)}</li>`).join('')}
      </ul>
      <button class="btn btn-ghost" data-act="ackNotices">C’est noté</button>
    </section>`;
}

function favRow() {
  const favs = S.titles.filter(t => t.fav).sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (!favs.length) return '';
  return `
    <section class="favs" aria-label="Coups de cœur">
      <span class="mono muted small">${own('TES COUPS DE CŒUR', `LES COUPS DE CŒUR DE ${OWNER.toUpperCase()}`)}</span>
      <div class="fav-row">${favs.map(t => `<a class="fav" href="#/titre/${encodeURIComponent(t.id)}">${poster(t, 'poster-sm')}<span class="small"><b>${esc(t.title)}</b>${t.rating ? ' · ' + t.rating + '/10' : ''}</span></a>`).join('')}</div>
    </section>`;
}

function activityBox() {
  const recent = S.history.filter(h => Date.now() - tsMillis(h.at) < 14 * 86400e3 && !/^Import/.test(h.text || '')).slice(0, 5);
  if (!recent.length) return '';
  return `
    <section class="activity" aria-label="Activité récente">
      <span class="mono muted small">RÉCEMMENT CHEZ ${OWNER.toUpperCase()}</span>
      <ul class="plain">${recent.map(h => `<li class="row-between"><span>${esc(h.text)}</span><span class="mono muted small nowrap">${fmtAgo(h.at)}</span></li>`).join('')}</ul>
      <a class="link" href="#/stats">Tout l’historique</a>
    </section>`;
}

function footer() {
  const last = Math.max(0, ...S.history.map(h => tsMillis(h.at)), ...S.titles.map(t => tsMillis(t.updatedAt)));
  return `<footer class="site-foot mono muted small"><span>Watchlist de ${OWNER}</span>${last ? `<span>Mise à jour le ${new Date(last).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}</footer>`;
}

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }

/* ------------------------------------------------------------------ pages d'aide et d'avis */

function viewHelp() {
  const row = (label, r, e, a) => `<tr><td>${label}</td><td class="center">${r}</td><td class="center">${e}</td><td class="center">${a}</td></tr>`;
  const Y = '<span class="yes">✓</span>', N = '<span class="no">—</span>', V = '<span class="small">avec validation</span>';
  const R = ROLE_CAN[S.role] || ROLE_CAN.reader;
  return `
  <section class="page narrow">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">案内</span><h1 class="display-sm">Comment ça marche</h1></div>
    <p class="lead">Ce site est la watchlist personnelle de ${OWNER} : ses animes, mangas, séries et films. Il y invite quelques personnes, chacune avec un rôle et un pseudo.</p>
    <div class="panel"><b>Ton rôle : ${R.label}.</b> ${R.can.length ? 'Tu peux ' + esc(R.can.map(x => x.charAt(0).toLowerCase() + x.slice(1)).join(', ')) + '.' : ''}</div>
    <div class="table-wrap"><table class="table table-fit">
      <thead><tr><th>CE QU’ON PEUT FAIRE</th><th class="center">LECT.</th><th class="center">ÉDIT.</th><th class="center">${OWNER.toUpperCase()}</th></tr></thead>
      <tbody>
        ${row('Voir la liste, les fiches, les avis et les stats', Y, Y, Y)}
        ${row('Dire « je l’ai vu aussi » et donner sa note', Y, Y, N)}
        ${row('Suivre un titre (« Me prévenir »)', Y, Y, N)}
        ${row('Suggérer un titre', Y, Y, Y)}
        ${row('Voter pour une suggestion', Y, Y, Y)}
        ${row('Changer un statut, un épisode, une note', N, V, Y)}
        ${row('Valider les suggestions et propositions', N, N, Y)}
        ${row('Inviter des membres', N, N, Y)}
      </tbody>
    </table></div>
    <h2 class="h3">Le trajet d’une suggestion</h2>
    <ol class="steps">
      <li><b>Tu proposes</b> un titre depuis « Suggérer », avec un mot pour dire pourquoi.</li>
      <li><b>Les autres membres votent</b> pour les suggestions qu’ils soutiennent.</li>
      <li><b>${OWNER} décide.</b> Acceptée, la suggestion entre dans sa liste « À voir ».</li>
      <li><b>Tu es prévenu</b> à ta prochaine visite, en haut de la liste.</li>
    </ol>
    <h2 class="h3">Les petits signes</h2>
    <p>Chaque affiche porte un tampon de statut :</p>
    ${statusLegend()}
    <h2 class="h3">Ton pseudo</h2>
    <p>Les autres membres ne voient que ton pseudo, jamais ton email. Tu le choisis et tu le changes dans <a class="link" href="#/profil">Mon profil</a> ; deux membres ne peuvent pas avoir le même.</p>
    <p>Pour changer de rôle, demande-le directement à ${OWNER}.</p>
  </section>`;
}

function viewReviews() {
  const k = S.ui.rkind || 'all';
  const items = S.titles.filter(t => (t.rating || (t.review || '').trim()) && (k === 'all' || t.kind === k))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || (a.title || '').localeCompare(b.title || '', 'fr'));
  const tabs = [['all', 'Tout'], ...Object.keys(KINDS).map(x => [x, KINDS[x].label])]
    .map(([v, l]) => `<button class="seg ${k === v ? 'on' : ''}" data-act="rkind" data-k="${v}">${l}</button>`).join('');
  return `
  <section class="page">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">評価</span><h1 class="display-sm">${own('Mes avis', `Les avis de ${OWNER}`)}</h1><span class="mono muted">${plural(items.length, 'titre noté ou commenté', 'titres notés ou commentés')}</span></div>
    <div class="segs" role="group" aria-label="Type">${tabs}</div>
    ${items.length ? `<div class="reviews">${items.map(t => `
      <a class="review" href="#/titre/${encodeURIComponent(t.id)}">
        <span class="review-poster">${poster(t, 'poster-sm')}</span>
        <span class="review-text"><b class="h3">${esc(t.title)}</b><span class="muted small">${esc(KINDS[t.kind]?.one || '')} · ${esc(t.genre || famOf(t).name)}</span>${(t.review || '').trim() ? `<span>« ${esc(t.review.trim())} »</span>` : ''}</span>
        <span class="review-score">${t.rating ? `<b>${t.rating}</b><small>/10</small>` : '<small>pas de note</small>'}</span>
      </a>`).join('')}</div>`
      : `<div class="empty"><span class="kanji-big" aria-hidden="true">無</span><p>${own('Tu n’as encore noté aucun titre. Note-les depuis leur fiche.', `${OWNER} n’a encore noté aucun titre ici.`)}</p></div>`}
  </section>`;
}

function coverBanner() {
  const missing = S.titles.filter(t => !coverOf(t));
  if (S.meta.busy) {
    return `<p class="note" role="status">Recherche des affiches… ${S.meta.done} / ${S.meta.todo}${S.meta.err ? ` · nouvelle tentative (${esc(S.meta.err)})` : ''}</p>`;
  }
  if (!missing.length) return '';
  if (!isAdmin()) return S.meta.err ? `<p class="alert" role="alert">Affiches indisponibles : ${esc(S.meta.err)}</p>` : '';
  return `
    <div class="${S.meta.err ? 'alert' : 'note'} row-between" role="status">
      <span>${S.meta.err ? `La recherche des affiches a échoué : ${esc(S.meta.err)}` : `${plural(missing.length, 'titre n’a pas encore d’affiche', 'titres n’ont pas encore d’affiche')}.`}</span>
      <button class="btn btn-ink" data-act="retryCovers">Rechercher les affiches</button>
    </div>`;
}

function pickBox() {
  const p = S.ui.pick && S.titles.find(t => t.id === S.ui.pick);
  const canStart = p && isEditor();
  return `
    <div class="band-pick">
      <div class="row-between"><span class="mono muted small">${own('JE REGARDE QUOI CE SOIR ?', 'UNE IDÉE POUR CE SOIR ?')}</span>${S.ui.rolls > 1 ? `<span class="mono muted small">${S.ui.rolls}e tirage</span>` : ''}</div>
      ${p ? `<a class="pick-title" href="#/titre/${encodeURIComponent(p.id)}">${esc(p.title)}</a><span class="muted small">${esc(p.genre || famOf(p).name)} · tiré parmi ${own('tes', 'ses')} À voir</span>` : `<span class="muted small">Un titre au hasard parmi ${own('tes', `les`)} « À voir »${own('', ` de ${OWNER}`)}${S.ui.fam ? ', dans le genre choisi' : ''}.</span>`}
      <div class="chips">
        <button class="btn btn-ink" data-act="roll">${p ? 'Relancer' : 'Tirer au sort'}</button>
        ${p ? `<button class="btn btn-ghost" data-act="clearPick">Effacer</button>` : ''}
        ${canStart ? `<button class="btn btn-accent" data-act="startPick" data-id="${esc(p.id)}">${isAdmin() ? 'Je le commence' : 'Proposer de le commencer'}</button>` : ''}
      </div>
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

// Affiches déjà affichées : pas de nouveau fondu quand la page se redessine
const IMG_SEEN = new Set();
window.__imgIn = img => { IMG_SEEN.add(img.getAttribute('src')); img.classList.add('in'); };

function poster(t, cls = '') {
  const f = famOf(t), cover = coverOf(t), st = STATUSES[t.status] || STATUSES.voir;
  return `
    <span class="poster tone ${cls}" style="background-color:${f.color};color:${f.ink}">
      <span class="poster-fam">${esc(f.name.toUpperCase())}</span>
      <span class="poster-title">${esc(t.title)}</span>
      ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="${IMG_SEEN.has(cover) ? 'in' : ''}" onload="window.__imgIn(this)" onerror="this.remove()">` : ''}
      <span class="stamp st-${t.status}" aria-hidden="true">${statusPic(t.status)}</span>
    </span>`;
}

function card(t) {
  const st = STATUSES[t.status] || STATUSES.voir;
  const canPlus = isEditor() && t.status === 'cours' && t.kind !== 'film';
  const pct = progressPct(t);
  let foot;
  if (t.status === 'cours') {
    foot = `
      ${pct !== null ? `<span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>` : ''}
      <span class="prog-row"><span class="mono">${esc(progressText(t))}</span>
      ${canPlus ? `<button class="plus" data-act="plus" data-id="${esc(t.id)}" aria-label="${isAdmin() ? 'Ajouter' : 'Proposer à ' + OWNER + ' d’ajouter'} un ${t.kind === 'manga' ? 'chapitre' : 'épisode'} à ${esc(t.title)}">${isAdmin() ? '+1' : 'Proposer +1'}</button>` : ''}</span>`;
  } else if (t.status === 'fini') {
    foot = `<span class="mono">${t.kind === 'film' ? 'VU · ' : ''}${t.rating ? t.rating + ' / 10' : '— / 10'}</span>`;
  } else {
    foot = `<span class="mono muted">${statusLabel(t.status, t.kind).toUpperCase()}</span>`;
  }
  const flash = S.flash[t.id] && Date.now() - S.flash[t.id] < 1600;
  return `
    <article class="card ${flash ? 'flash' : ''}">
      <a class="card-link" href="#/titre/${encodeURIComponent(t.id)}" aria-label="${esc(t.title)}, ${statusLabel(t.status, t.kind)}">${poster(t)}</a>
      <div class="card-meta">
        <span class="card-title">${t.fav ? '<span class="fav-star" title="Coup de cœur">★</span> ' : ''}${esc(t.title)}</span>
        <span class="muted small">${esc(t.genre || famOf(t).name)}</span>
        ${foot}
      </div>
    </article>`;
}

/* ------------------------------------------------------------------ fiche */

const EDIT_FIELDS = ['kind', 'status', 'season', 'episode', 'chapter', 'total', 'rating', 'review', 'startedAt', 'finishedAt', 'genre', 'fam'];

function ensureDraft(t) {
  if (!S.draft || S.draft.id !== t.id) {
    S.draft = { id: t.id };
    for (const k of EDIT_FIELDS) S.draft[k] = t[k] ?? (['season'].includes(k) ? 1 : ['episode', 'chapter'].includes(k) ? 0 : (k === 'rating' || k === 'total') ? null : '');
    S.fix = { open: false, q: t.lookup || t.title, results: [], busy: false };
    S.ui.confirm = null;
    if (S.fixAfter === t.id) {
      S.fixAfter = null;
      S.fix.open = true; S.fix.q = t.altTitle || t.title;
      setTimeout(() => SUBMIT.fixSearch().then(render), 0);
    }
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
  const kind = d.kind || t.kind;
  const manga = kind === 'manga', film = kind === 'film';
  const tot = d.total || (kind === t.kind ? totalOf(t) : null);
  const cur = manga ? (d.chapter || 0) : (d.episode || 0);
  const pct = tot ? Math.min(100, cur / tot * 100) : null;
  const backHref = kindHash(t.kind);

  const statusBtns = (film ? FILM_STATUSES : STATUS_ORDER).map(s => `
    <button class="st-btn ${d.status === s ? 'on' : ''}" data-act="dStatus" data-status="${s}" ${ro ? 'disabled' : ''} aria-pressed="${d.status === s}">
      ${statusPic(s)}<span>${statusLabel(s, kind)}</span></button>`).join('');
  const kindBtns = Object.keys(KINDS).map(k => `<button class="seg ${kind === k ? 'on' : ''}" data-act="dKind" data-kind="${k}" aria-pressed="${kind === k}">${pic(KINDS[k].pic)}${KINDS[k].one}</button>`).join('');

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
  const saveHint = isAdmin() ? 'Le changement s’applique tout de suite.' : isEditor() ? `${OWNER} valide avant que ça change.` : '';

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
          ${m.source === 'anilist' && m.extId ? `<a class="small ext" href="https://anilist.co/${t.kind === 'manga' ? 'manga' : 'anime'}/${esc(m.extId)}" target="_blank" rel="noopener">Voir sur AniList ↗</a>` : ''}
          ${m.source === 'tmdb' && m.extId ? `<a class="small ext" href="https://www.themoviedb.org/movie/${esc(m.extId)}" target="_blank" rel="noopener">Voir sur TMDB ↗</a>` : ''}
          ${(m.source === 'mal' ? m.extId : m.malId) ? `<a class="small ext" href="https://myanimelist.net/${t.kind === 'manga' ? 'manga' : 'anime'}/${esc(m.source === 'mal' ? m.extId : m.malId)}" target="_blank" rel="noopener">Voir sur MyAnimeList ↗</a>` : ''}
          ${m.source === 'tvmaze' && m.extId ? `<a class="small ext" href="https://www.tvmaze.com/shows/${esc(m.extId)}" target="_blank" rel="noopener">Voir sur TVmaze ↗</a>` : ''}
        </div>
      </div>
      ${air ? `<div class="air"><i></i>Prochain épisode ${esc(air.when)}</div>` : ''}
    </div>

    <div class="fiche-body">
      ${ro ? `<p class="note">Fiche de ${OWNER}, en lecture seule. Plus bas, tu peux dire si tu l’as vu aussi, lui donner ta note, ou le suivre.</p>` : ''}
      ${isEditor() && !isAdmin() ? `<p class="note">Tes changements ici sont des propositions : ${OWNER} les valide avant qu’ils s’appliquent.</p>` : ''}
      ${mine.length ? `<p class="note">${plural(mine.length, 'modification proposée', 'modifications proposées')} en attente de validation.</p>` : ''}
      ${isEditor() ? `
      <div class="block">
        <span class="label">TYPE</span>
        <div class="segs" role="group" aria-label="Type du titre">${kindBtns}</div>
        ${kind !== t.kind ? `<p class="small muted">${KINDS[t.kind].one} → ${KINDS[kind].one}. ${film ? 'La progression ne s’applique plus à un film.' : 'La progression est convertie.'} ${isAdmin() ? 'Après l’enregistrement, tu pourras choisir la bonne affiche.' : ''}</p>` : ''}
      </div>` : ''}
      <div class="block">
        <span class="label">STATUT</span>
        <div class="st-grid ${film ? 'st-grid-3' : ''}">${statusBtns}</div>
      </div>

      ${film ? '' : `<div class="block">
        <span class="label">${own('OÙ J’EN SUIS', `OÙ EN EST ${OWNER.toUpperCase()}`)}</span>
        <div class="steppers">
          ${manga ? stepper('chapter', 'Chapitre', 0) : stepper('season', 'Saison', 1) + stepper('episode', 'Épisode', 0)}
        </div>
        ${pct !== null ? `<span class="bar bar-lg"><i style="width:${pct.toFixed(1)}%"></i></span>` : ''}
        <div class="row-between small">
          <span class="mono muted">${manga ? 'Chap. ' + cur : 'S' + (d.season || 1) + ' · ép. ' + cur}${tot ? ' / ' + tot : ''}</span>
          ${isEditor() ? `<label class="inline-field muted" for="d-total">${manga ? 'Chapitres' : 'Épisodes'} au total <input id="d-total" type="number" min="0" inputmode="numeric" value="${esc(d.total ?? '')}" placeholder="${esc(totalOf(t) || '?')}" data-in="draftNum" data-field="total"></label>` : ''}
        </div>
      </div>`}

      ${providersBlock(t)}

      <div class="block">
        <span class="label">${own('MA NOTE', `NOTE DE ${OWNER.toUpperCase()}`)} · ${d.rating ? d.rating + ' / 10' : 'pas encore notée'}</span>
        <div class="notes">${notes}</div>
      </div>

      <div class="block">
        <label class="label" for="d-review">${own('MON AVIS', `AVIS DE ${OWNER.toUpperCase()}`)}</label>
        <textarea id="d-review" rows="3" maxlength="1000" placeholder="${ro ? 'Pas encore d’avis.' : 'Deux lignes pour toi-même dans six mois…'}" data-in="draft" data-field="review" ${ro ? 'readonly' : ''}>${esc(d.review)}</textarea>
      </div>

      ${ro && !d.startedAt && !d.finishedAt ? '' : `<div class="two">
        <div class="field"><label class="label" for="d-startedAt">COMMENCÉ</label><input id="d-startedAt" type="date" value="${esc(d.startedAt)}" data-in="draft" data-field="startedAt" ${ro ? 'readonly' : ''}></div>
        <div class="field"><label class="label" for="d-finishedAt">TERMINÉ</label><input id="d-finishedAt" type="date" value="${esc(d.finishedAt)}" data-in="draft" data-field="finishedAt" ${ro ? 'readonly' : ''}></div>
      </div>`}

      ${isEditor() ? `
      <div class="two">
        <div class="field"><label class="label" for="d-genre">GENRE</label><input id="d-genre" type="text" maxlength="60" value="${esc(d.genre)}" data-in="draft" data-field="genre"></div>
        <div class="field"><label class="label" for="d-fam">COULEUR (FAMILLE)</label>
          <select id="d-fam" data-in="draft" data-field="fam">${Object.entries(FAMILIES).map(([k, v]) => `<option value="${k}" ${d.fam === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      </div>` : ''}

      ${saveLabel ? `<button class="btn btn-ink btn-lg" data-act="saveTitle" data-id="${esc(t.id)}" ${dirty ? '' : 'disabled'}>${saveLabel}</button>` : ''}
      <p class="muted small center">${dirty || !saveLabel ? saveHint : 'Aucun changement à enregistrer.'}</p>

      ${membersBlock(t)}

      ${isAdmin() ? `
      <div class="block admin-zone">
        <span class="label">ADMIN</span>
        <div class="chips">
          <button class="btn ${t.fav ? 'btn-accent' : 'btn-ghost'}" data-act="toggleFav" data-id="${esc(t.id)}" aria-pressed="${!!t.fav}">${t.fav ? '★ Coup de cœur' : '☆ Marquer comme coup de cœur'}</button>
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

/* « Je l'ai vu aussi », notes des membres et suivi d'un titre. */
function membersBlock(t) {
  if (S.seen[t.id] === undefined) loadSeen(t.id);
  const list = S.seen[t.id] || [];
  const rated = list.filter(x => x.rating);
  const avg = rated.length ? (rated.reduce((a, x) => a + x.rating, 0) / rated.length).toFixed(1).replace('.', ',') : null;
  const summary = list.length
    ? `Vu aussi par ${plural(list.length, 'membre', 'membres')}${avg ? ` · ${avg}/10 en moyenne` : ''} : ${list.map(x => esc(isEmail(x.id) ? displayName(null, x.name) : displayName(x.id, x.name)) + (x.rating ? ` (${x.rating})` : '')).join(', ')}.`
    : 'Aucun membre ne l’a encore marqué comme vu.';
  if (isAdmin()) {
    return `<div class="block member-zone"><span class="label">LES MEMBRES</span><p class="small">${summary}</p></div>`;
  }
  const me = list.find(x => x.id === S.uid || x.id === S.email);
  const following = !!(S.follows && S.follows.titles && S.follows.titles[t.id]);
  const notes = Array.from({ length: 10 }, (_, i) => i + 1).map(v =>
    `<button class="note-btn ${me && me.rating >= v ? 'on' : ''}" data-act="seenRate" data-id="${esc(t.id)}" data-v="${v}" aria-label="Ma note : ${v} sur 10">${v}</button>`).join('');
  return `
    <div class="block member-zone">
      <span class="label">ET TOI ?</span>
      <p class="small muted">${summary}</p>
      <div class="chips">
        <button class="btn ${me ? 'btn-accent' : 'btn-ghost'}" data-act="toggleSeen" data-id="${esc(t.id)}" aria-pressed="${!!me}">${me ? '✓ Je l’ai vu' : 'Je l’ai vu aussi'}</button>
        <button class="btn ${following ? 'btn-ink' : 'btn-ghost'}" data-act="toggleFollow" data-id="${esc(t.id)}" aria-pressed="${following}">${following ? '◎ Tu suis ce titre' : 'Me prévenir quand ça avance'}</button>
      </div>
      ${me ? `<span class="label">MA NOTE</span><div class="notes">${notes}</div>` : ''}
      ${following ? `<p class="small muted">Tu verras en haut de la liste quand ${OWNER} change son statut, sa progression ou sa note.</p>` : ''}
    </div>`;
}

async function loadSeen(id) {
  S.seen[id] = S.seen[id] || null; // évite de lancer deux chargements
  try {
    const snap = await F.getDocs(F.collection(F.db, 'titles', id, 'seen'));
    S.seen[id] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { S.seen[id] = []; }
  scheduleRender();
}

/* Plateformes légales en France, via TMDB (données JustWatch). */
function providersBlock(t) {
  if (!hasTmdb() || t.kind === 'manga') return '';
  if (S.prov[t.id] === undefined) loadProviders(t);
  const P = S.prov[t.id];
  const row = (label, list) => list && list.length ? `<div class="prov-row"><span class="muted small">${label}</span><div class="prov-list">${list.map(p => `<span class="prov">${p.logo ? `<img src="${esc(p.logo)}" alt="" width="28" height="28" loading="lazy">` : ''}${esc(p.name)}</span>`).join('')}</div></div>` : '';
  let body;
  if (P === null || P === undefined) body = `<p class="small muted">Recherche des plateformes…</p>`;
  else if (P.err) body = `<p class="small muted">Plateformes indisponibles pour le moment.</p>`;
  else if (P.none) body = `<p class="small muted">Aucune plateforme française connue pour ce titre.</p>`;
  else body = row('En streaming', P.stream) + row('En location', P.rent) + row('À l’achat', P.buy)
    + `<p class="small muted">Source : JustWatch, via TMDB.${P.link ? ` <a class="link" href="${esc(P.link)}" target="_blank" rel="noopener">Voir toutes les offres ↗</a>` : ''}</p>`;
  return `<div class="block"><span class="label">OÙ LE REGARDER EN FRANCE</span>${body}</div>`;
}

async function loadProviders(t) {
  S.prov[t.id] = null;
  try { S.prov[t.id] = (await watchProviders(metaOf(t))) || { none: true }; }
  catch (e) { S.prov[t.id] = { err: true }; }
  scheduleRender();
}

function followSnapshot(t) {
  return { status: t.status || '', season: t.season || 1, episode: t.episode || 0, chapter: t.chapter || 0, rating: t.rating || null };
}

function fixPanel(t) {
  const F2 = S.fix;
  return `
    <form class="stack" data-submit="fixSearch">
      <label class="search" for="fixq"><input id="fixq" type="search" value="${esc(F2.q)}" data-in="fixq" placeholder="Titre à chercher"></label>
      <button class="btn btn-ink" ${F2.busy ? 'disabled' : ''}>${F2.busy ? 'Recherche…' : 'Chercher sur ' + (t.kind === 'serie' ? 'TVmaze' : 'AniList')}</button>
    </form>
    <div class="results">${F2.results.map((r, i) => resultRow(r, i, 'fixPick', false)).join('')}</div>`;
}

function resultRow(r, i, act, chosen) {
  return `
    <button class="result-row ${chosen ? 'on' : ''}" data-act="${act}" data-i="${i}">
      ${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="thumb-ph"></span>`}
      <span class="result-text"><b>${esc(r.title)}</b><span class="muted small">${[KINDS[r.kind].one, r.year, r.total && r.kind !== 'film' ? r.total + (r.kind === 'manga' ? ' chap.' : ' ép.') : '', r.altTitle && r.altTitle !== r.title ? r.altTitle : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
      ${chosen ? '<span class="mono small">CHOISI</span>' : ''}
    </button>`;
}

/* ------------------------------------------------------------------ ajouter / suggérer */

function viewAdd() {
  const A = S.add, admin = isAdmin();
  const types = Object.keys(KINDS).map(k => `<button class="seg ${A.kind === k ? 'on' : ''}" data-act="addKind" data-kind="${k}" aria-pressed="${A.kind === k}">${pic(KINDS[k].pic)}${KINDS[k].one}</button>`).join('');
  const source = A.kind === 'serie' ? 'TVMAZE' : A.kind === 'film' && hasTmdb() ? 'TMDB' : 'ANILIST';
  const chosen = A.chosen !== null ? A.results[A.chosen] : null;
  const dup = chosen && findDuplicate(chosen);

  const pendingSugg = S.requests.filter(r => r.type === 'suggestion' && r.status === 'pending')
    .sort((a, b) => (S.votes[b.id]?.count || 0) - (S.votes[a.id]?.count || 0));
  const mine = S.requests.filter(r => r.by === S.uid || r.by === S.email).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt)).slice(0, 12);
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
            <input id="addq" type="search" placeholder="Chercher ${{ serie: 'une série', manga: 'un manga', film: 'un film', anime: 'un anime' }[A.kind]}" value="${esc(A.q)}" data-in="addq" autocomplete="off">
          </label>
        </form>
        <span class="mono muted small">${A.busy ? 'RECHERCHE…' : A.err ? esc(A.err) : A.results.length ? 'RÉSULTATS ' + source : A.kind === 'film' && !hasTmdb() ? 'Films d’animation uniquement pour l’instant. Tape au moins 2 lettres.' : 'Tape au moins 2 lettres.'}</span>
        <div class="results">${A.results.map((r, i) => resultRow(r, i, 'addPick', A.chosen === i)).join('')}</div>
        ${chosen ? `
          ${dup ? `<p class="note">« ${esc(dup.title)} » est déjà dans la liste (${esc(STATUSES[dup.status]?.label || '')}).</p>` : ''}
          ${admin ? `
            <div class="segs" role="group" aria-label="Statut de départ">${(A.kind === 'film' ? ['voir', 'fini'] : ['voir', 'cours', 'fini']).map(s => `<button class="seg ${A.status === s ? 'on' : ''}" data-act="addStatus" data-status="${s}">${statusPic(s)}${statusLabel(s, A.kind)}</button>`).join('')}</div>
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
            <div class="sugg-text"><b>${esc(r.item?.title)}</b><span class="muted small">${esc(KINDS[r.item?.kind]?.one || '')} · proposé par ${esc(displayName(r.by, r.byName))}</span>${r.note ? `<span class="small">« ${esc(r.note)} »</span>` : ''}</div>
            <button class="vote ${v.mine ? 'on' : ''}" data-act="vote" data-id="${esc(r.id)}" aria-pressed="${v.mine}" aria-label="${v.mine ? 'Retirer mon vote' : 'Voter'} pour ${esc(r.item?.title)}">▲ ${v.count}</button>
          </div>`;
        }).join('') : `<p class="muted small">Aucune suggestion en attente.</p>`}
        ${admin ? `<a class="link" href="#/valider">Les valider dans « À valider » →</a>` : `
        <h2 class="h3">Mes demandes</h2>
        ${mine.length ? `<ul class="plain">${mine.map(r => `<li class="row-between"><span class="wrap-any">${esc(r.type === 'edit' ? r.titleName + ' (modification)' : r.item?.title)}</span><span class="pill pill-${r.status}">${stateLabel(r)}</span></li>`).join('')}</ul>` : `<p class="muted small">Tu n’as encore rien proposé.</p>`}`}
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

  const label = { kind: 'Type', status: 'Statut', season: 'Saison', episode: 'Épisode', chapter: 'Chapitre', total: 'Total', rating: 'Note', review: 'Avis', startedAt: 'Début', finishedAt: 'Fin', genre: 'Genre', fam: 'Couleur' };
  const show = (k, v) => v === null || v === undefined || v === '' ? '—' : k === 'status' ? (STATUSES[v]?.label || v) : k === 'kind' ? (KINDS[v]?.one || v) : k === 'fam' ? (FAMILIES[v]?.name || v) : k === 'rating' ? v + '/10' : String(v);

  const rows = items.map(x => {
    if (x.kind === 'access') {
      const a = x.a;
      return `
      <article class="req">
        <div class="row-between"><span><span class="tag tag-access">Demande d’accès</span> <span class="muted small">${fmtAgo(a.at)}</span></span></div>
        <div class="req-body"><div class="req-text"><b class="h3 wrap-any">${esc(a.email)}</b>${a.note ? `<p>« ${esc(a.note)} »</p>` : ''}</div>
        <div class="req-actions"><button class="btn btn-ghost" data-act="refuseAccess" data-id="${esc(a.id)}">Refuser</button><button class="btn btn-ink" data-act="acceptAccess" data-id="${esc(a.id)}">Ajouter comme lecteur</button></div></div>
      </article>`;
    }
    const r = x.r;
    if (r.type === 'suggestion') {
      const it = r.item || {}, dup = findDuplicate(it);
      return `
      <article class="req">
        <div class="row-between"><span class="wrap-any"><span class="tag tag-sugg">Suggestion</span> <span class="muted small">${esc(whoLabel(r.by, r.byName))} · ${fmtAgo(r.createdAt)}</span></span><span class="mono">▲ ${x.votes} ${x.votes > 1 ? 'votes' : 'vote'}</span></div>
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
        <div class="row-between"><span class="wrap-any"><span class="tag tag-edit">Modification</span> <span class="muted small">${esc(whoLabel(r.by, r.byName))} · ${fmtAgo(r.createdAt)}</span></span></div>
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
    <div class="stack">${rows || `<div class="empty"><img src="img/logo-grave.png" alt="" width="72" height="72"><p>Rien à valider. Tout est à jour.</p></div>`}</div>
    <p class="muted small">Une suggestion acceptée entre dans ta liste en « À voir ». Une modification acceptée s’applique au titre et part dans l’historique. La personne voit la décision dans « Mes demandes ».</p>
  </section>`;
}

/* ------------------------------------------------------------------ membres */

function viewMembers() {
  const N = S.newMember;
  const rows = S.members.slice().sort((a, b) => (a.role === 'admin' ? -1 : b.role === 'admin' ? 1 : a.id.localeCompare(b.id))).map(m => {
    const self = m.id === S.email;
    const roleCell = m.role === 'admin' ? `<span class="admin-chip"><img src="img/logo-tampon.png" alt="" width="28" height="28">Admin</span>` : `
      <div class="segs tight" role="group" aria-label="Rôle de ${esc(m.id)}">
        <button class="seg ${m.role === 'reader' ? 'on' : ''}" data-act="setRole" data-id="${esc(m.id)}" data-role="reader">Lecteur</button>
        <button class="seg ${m.role === 'editor' ? 'on' : ''}" data-act="setRole" data-id="${esc(m.id)}" data-role="editor">Éditeur</button>
      </div>`;
    const action = self || m.role === 'admin' ? '' : S.ui.confirm === 'rm:' + m.id
      ? `<button class="btn btn-danger" data-act="removeMember" data-id="${esc(m.id)}">Confirmer</button> <button class="link" data-act="cancelConfirm">Annuler</button>`
      : `<button class="link danger-text" data-act="askConfirm" data-key="rm:${esc(m.id)}">Retirer</button>`;
    const invite = self || m.role === 'admin' ? '' : `<button class="link" data-act="showInvite" data-id="${esc(m.id)}">Invitation</button> `;
    return `<tr><td class="wrap-any"><b>${esc(m.pseudo || '—')}</b><br><span class="muted small">${esc(m.id)}</span>${m.uid ? '' : '<br><span class="muted small">pas encore connecté</span>'}</td><td>${roleCell}</td><td class="muted small">${m.addedAt ? 'Ajouté le ' + new Date(tsMillis(m.addedAt)).toLocaleDateString('fr-FR') : ''}</td><td class="right nowrap">${invite}${action}</td></tr>`;
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
    ${N.invite ? `
    <div class="panel stack invite">
      <div class="row-between"><b>Message d’invitation pour ${esc(N.invite)}</b><button class="link" data-act="hideInvite">Fermer</button></div>
      <textarea id="invite-text" rows="9" readonly>${esc(inviteText(N.invite))}</textarea>
      <div class="chips"><button class="btn btn-ink" data-act="copyInvite">Copier le message</button><span class="muted small">Colle-le dans WhatsApp, un SMS ou un email : le site n’envoie rien tout seul.</span></div>
    </div>` : ''}
    <div class="table-wrap"><table class="table">
      <thead><tr><th>PSEUDO · EMAIL</th><th>RÔLE</th><th>AJOUT</th><th class="right">ACTION</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="two muted small">
      <p><b>Lecteur</b> : voit la liste, marque ce qu’il a vu, suit des titres, suggère et vote.</p>
      <p><b>Éditeur</b> : tout ce que fait un lecteur, et propose des modifications que tu valides.</p>
    </div>
    ${S.adminLog.length ? `
    <h2 class="h3">Journal des membres</h2>
    <ul class="plain small">${S.adminLog.slice(0, 20).map(l => `<li class="row-between"><span>${esc(l.text)}</span><span class="mono muted nowrap">${fmtWhen(l.at)}</span></li>`).join('')}</ul>` : ''}
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
      <div class="tile"><span class="mono muted small">TITRES SUIVIS</span><b class="tile-num">${T.length}</b><span class="muted small">${byKind[0]} animes · ${byKind[1]} mangas · ${byKind[2]} séries · ${byKind[3]} films</span></div>
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
        <div class="legend">${st.map(x => `<span>${statusPic(x.s)}${STATUSES[x.s].plural} ${x.n}</span>`).join('')}</div>
        <h2 class="h3">Terminés par année</h2>
        ${yKeys.length ? `<div class="years">${yKeys.map(y => `<div class="year"><span class="mono small">${years[y]}</span><i style="height:${(years[y] / yMax * 100).toFixed(1)}%"></i><span class="mono small">${y}</span></div>`).join('')}</div>`
          : `<p class="muted small panel-dash">Le graphique se remplit dès que tu renseignes les dates de fin dans les fiches.</p>`}
      </div>
    </div>
    <div class="stack">
      <h2 class="h3">Historique</h2>
      ${S.history.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>QUAND</th><th>QUI</th><th>CHANGEMENT</th></tr></thead>
        <tbody>${S.history.map(h => `<tr><td class="mono muted nowrap">${fmtWhen(h.at)}</td><td class="nowrap">${esc(isEmail(h.byName) ? OWNER : (h.byName || OWNER))}</td><td class="wrap-any">${esc(h.text)}</td></tr>`).join('')}</tbody>
      </table></div>` : `<p class="muted small">Aucun changement enregistré pour l’instant.</p>`}
      ${isAdmin() ? `<button class="btn btn-ghost" data-act="exportJson">Télécharger mes données (JSON)</button>` : ''}
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ profil */

/** Clé unique d'un pseudo : minuscules, sans accents, espaces remplacés par des tirets. */
function pseudoKey(p) {
  return (p || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '-');
}

function viewProfile() {
  const P = S.profile, current = S.member && S.member.pseudo;
  const roleLabel = { admin: 'Admin', editor: 'Éditeur', reader: 'Lecteur' }[S.role] || '';
  return `
  <section class="page narrow">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">名前</span><h1 class="display-sm">Mon profil</h1></div>
    <div class="panel stack">
      <div class="kv"><span class="label">PSEUDO</span><b>${esc(current || 'pas encore choisi')}</b></div>
      <div class="kv"><span class="label">EMAIL</span><span class="wrap-any">${esc(S.email)}</span></div>
      <div class="kv"><span class="label">RÔLE</span><span>${roleLabel} · <a class="link" href="#/aide">ce que je peux faire</a></span></div>
      <p class="small muted">${isAdmin() ? 'Tu es le seul à voir les emails des membres. Eux ne voient que les pseudos.' : `Ton email reste privé : seul ${OWNER} le voit. Les autres membres ne voient que ton pseudo.`}</p>
    </div>
    <form class="panel stack" data-submit="savePseudo">
      <div class="field">
        <label for="pseudo">${current ? 'Nouveau pseudo' : 'Choisis ton pseudo'}</label>
        <input id="pseudo" name="pseudo" type="text" minlength="2" maxlength="20" value="${esc(P.pseudo)}" data-in="pseudo" autocomplete="nickname" required>
        <span class="hint">2 à 20 caractères : lettres, chiffres, espaces, - et _. Deux membres ne peuvent pas avoir le même.</span>
      </div>
      ${P.err ? `<p class="alert" role="alert">${esc(P.err)}</p>` : ''}
      ${P.msg ? `<p class="note" role="status">${esc(P.msg)}</p>` : ''}
      <button class="btn btn-accent btn-lg" ${P.busy ? 'disabled' : ''}>${current ? 'Changer mon pseudo' : 'Choisir ce pseudo'}</button>
    </form>
  </section>`;
}

/* ------------------------------------------------------------------ où regarder */

function viewWhere() {
  const sites = (S.streaming && S.streaming.sites) || [];
  const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } };
  const N = S.newSite;
  return `
  <section class="page narrow">
    <div class="page-head"><span class="kanji-red" aria-hidden="true">配信</span><h1 class="display-sm">Où regarder</h1></div>
    <p class="lead">${own('Tes sites pour regarder animes, séries et films, et de quoi bloquer les pubs.', `Les sites que ${OWNER} utilise pour regarder, et de quoi bloquer les pubs.`)}</p>
    <h2 class="h3">${own('Tes sites', `Les sites de ${OWNER}`)}</h2>
    ${sites.length ? `<div class="sites">${sites.map((x, i) => `
      <div class="site">
        <div class="site-main">
          <a class="site-name" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)} ↗</a>
          <span class="mono muted small wrap-any">${esc(host(x.url))}</span>
          ${x.note ? `<p class="small">${esc(x.note)}</p>` : ''}
        </div>
        ${isAdmin() ? (S.ui.confirm === 'site:' + i
          ? `<div class="chips"><button class="btn btn-danger" data-act="removeSite" data-i="${i}">Retirer</button><button class="link" data-act="cancelConfirm">Annuler</button></div>`
          : `<button class="link danger-text" data-act="askConfirm" data-key="site:${i}">Retirer</button>`) : ''}
      </div>`).join('')}</div>`
      : `<p class="muted">${own('Aucun site pour l’instant. Ajoute le premier ci-dessous.', `${OWNER} n’a encore ajouté aucun site.`)}</p>`}
    ${isAdmin() ? `
    <form class="panel stack" data-submit="addSite">
      <b>Ajouter un site</b>
      <div class="two">
        <div class="field"><label for="site-name">Nom</label><input id="site-name" type="text" maxlength="40" value="${esc(N.name)}" data-in="siteName" required></div>
        <div class="field"><label for="site-url">Adresse</label><input id="site-url" type="url" placeholder="https://…" value="${esc(N.url)}" data-in="siteUrl" required></div>
      </div>
      <div class="field"><label for="site-note">Un mot (facultatif)</label><input id="site-note" type="text" maxlength="120" placeholder="Ex. : le plus complet pour les animes en VOSTFR" value="${esc(N.note)}" data-in="siteNote"></div>
      <button class="btn btn-ink">Ajouter</button>
    </form>` : ''}
    ${hasTmdb() ? `<p class="note">Sur chaque fiche, la rubrique « Où le regarder en France » donne aussi les plateformes officielles (Netflix, Crunchyroll, ADN…).</p>` : ''}
    <h2 class="h3">Bloquer les pubs</h2>
    <div class="two adblock">
      <div class="panel stack">
        <span class="label">SUR ORDINATEUR</span>
        <b>uBlock Origin</b>
        <p class="small">Extension gratuite, la plus efficace. Sur Firefox : uBlock Origin. Sur Chrome et Edge : uBlock Origin Lite.</p>
        <a class="link" href="https://ublockorigin.com/" target="_blank" rel="noopener">ublockorigin.com ↗</a>
      </div>
      <div class="panel stack">
        <span class="label">SUR TÉLÉPHONE</span>
        <b>Brave</b>
        <p class="small">Navigateur gratuit pour iPhone et Android, avec un bloqueur intégré : rien à régler.</p>
        <a class="link" href="https://brave.com/fr/" target="_blank" rel="noopener">brave.com ↗</a>
        <b>AdGuard</b>
        <p class="small">Pour garder Safari sur iPhone : installe AdGuard, puis active-le dans Réglages › Safari › Extensions.</p>
        <a class="link" href="https://adguard.com/fr/" target="_blank" rel="noopener">adguard.com ↗</a>
      </div>
    </div>
    <p class="small muted">Certaines fenêtres s’ouvrent quand même au clic sur la vidéo : ferme l’onglet ouvert et reviens sur la vidéo.</p>
  </section>`;
}

/* ------------------------------------------------------------------ authentification */

F.onAuthStateChanged(F.auth, async user => {
  stopListeners();
  S.user = user; S.member = null; S.role = null; S.titles = []; S.titlesReady = false;
  S.requests = []; S.members = []; S.access = []; S.history = []; S.airing = []; S.airingDone = false;
  S.adminLog = []; S.seen = {}; S.follows = null; S.welcomeOpen = false;
  S.names = {}; S.pseudoKeys = {}; S.prov = {}; S.streaming = null; S.flash = {}; S.lastUpdated = {};
  S.login.err = ''; S.login.busy = false;
  if (!user) { S.phase = 'login'; return render(); }
  S.email = (user.email || '').toLowerCase();
  S.uid = user.uid;
  if (!user.emailVerified) { S.phase = 'verify'; return render(); }
  await loadMember();
});

async function loadMember() {
  S.phase = 'loading'; render();
  try {
    const snap = await F.getDoc(F.doc(F.db, 'members', S.email));
    if (snap.exists()) {
      S.member = snap.data(); S.role = S.member.role; S.phase = 'app';
      S.welcomeOpen = S.role !== 'admin' && !lsGet('mw:welcome:' + S.email, false);
      S.profile = { pseudo: S.member.pseudo || '', msg: '', err: '', busy: false };
      // Relie l'email autorisé au compte : sert à afficher les pseudos sans exposer les emails
      if (S.member.uid !== S.uid) {
        F.updateDoc(F.doc(F.db, 'members', S.email), { uid: S.uid }).then(() => { S.member.uid = S.uid; }).catch(() => {});
      }
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
    const now = Date.now(), first = !S.titlesReady;
    S.titles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (const t of S.titles) {
      const u = tsMillis(t.updatedAt);
      if (!first && u && S.lastUpdated[t.id] && u !== S.lastUpdated[t.id]) S.flash[t.id] = now;
      S.lastUpdated[t.id] = u;
    }
    if (!first) setTimeout(scheduleRender, 1700);
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
  S.unsub.push(F.onSnapshot(F.collection(F.db, 'pseudos'), snap => {
    S.names = {}; S.pseudoKeys = {};
    for (const d of snap.docs) { const v = d.data(); if (v.uid) { S.names[v.uid] = v.pseudo; S.pseudoKeys[v.uid] = d.id; } }
    render();
  }, onListenErr));
  S.unsub.push(F.onSnapshot(F.doc(F.db, 'settings', 'streaming'), d => {
    S.streaming = d.exists() ? d.data() : { sites: [] };
    render();
  }, () => { S.streaming = { sites: [] }; }));
  if (isAdmin()) {
    S.unsub.push(F.onSnapshot(F.collection(F.db, 'members'), snap => {
      S.members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, onListenErr));
    S.unsub.push(F.onSnapshot(F.collection(F.db, 'accessRequests'), snap => {
      S.access = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, onListenErr));
    S.unsub.push(F.onSnapshot(F.query(F.collection(F.db, 'adminLog'), F.orderBy('at', 'desc'), F.limit(50)), snap => {
      S.adminLog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, onListenErr));
  } else {
    // Suivis : rangés sous l'identifiant du compte (anciennement sous l'email)
    (async () => {
      try {
        let d = await F.getDoc(F.doc(F.db, 'follows', S.uid));
        if (!d.exists()) d = await F.getDoc(F.doc(F.db, 'follows', S.email));
        S.follows = d.exists() ? d.data() : { titles: {} };
      } catch (e) { S.follows = { titles: {} }; }
      render();
    })();
  }
}

/* ------------------------------------------------------------------ données externes en arrière-plan */

const META_KEYS = ['cover', 'source', 'extId', 'malId', 'total', 'duration', 'year', 'altTitle'];
function metaFrom(r) { const o = {}; for (const k of META_KEYS) if (r[k] !== null && r[k] !== undefined && r[k] !== '') o[k] = r[k]; return o; }
const META_CACHE = 'mw:meta2:';

// Recherche des affiches en arrière-plan. S.meta = état affiché à l'admin.
S.meta = { busy: false, done: 0, todo: 0, err: '' };
async function resolveMeta() {
  if (S.meta.busy) return;
  const pending = () => S.titles.filter(x => !x.cover && !x.metaTried && !S.localMeta[x.id]);
  if (!pending().length) return;
  S.meta = { busy: true, done: 0, todo: pending().length, err: '' };
  render();
  let failures = 0;
  try {
    for (;;) {
      const t = pending()[0];
      if (!t) break;
      let found = null;
      try { found = JSON.parse(localStorage.getItem(META_CACHE + t.id) || 'null'); } catch (e) { /* ignore */ }
      if (!found) {
        try {
          const res = await searchTitles(t.kind, t.lookup || t.title, { popular: true, limit: 3 });
          found = res[0] ? metaFrom(res[0]) : { none: true };
          failures = 0;
        } catch (e) {
          failures++;
          S.meta.err = e.message || String(e);
          render();
          if (failures >= 3) break;          // le service est en panne : on s'arrête, le bouton permet de relancer
          await new Promise(r => setTimeout(r, 3000 * failures));
          continue;
        }
        try { localStorage.setItem(META_CACHE + t.id, JSON.stringify(found)); } catch (e) { /* ignore */ }
      }
      S.localMeta[t.id] = found;
      S.meta.done++;
      if (isAdmin()) {
        const patch = { metaTried: true };
        if (!found.none) for (const k of META_KEYS) if (found[k] !== undefined && (t[k] === undefined || t[k] === null || t[k] === '')) patch[k] = found[k];
        try { await F.updateDoc(F.doc(F.db, 'titles', t.id), patch); } catch (e) { /* titre supprimé entre-temps */ }
      } else {
        scheduleRender();
      }
    }
    if (failures < 3) S.meta.err = '';
  } finally {
    S.meta.busy = false;
    render();
    loadAiring();
  }
}

let renderTimer = null;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 250); }

let airingBusy = false;
async function loadAiring() {
  if (airingBusy) return;
  const targets = S.titles.filter(t => t.kind === 'anime' && t.status === 'cours' && metaOf(t).extId && ['anilist', 'mal'].includes(metaOf(t).source));
  const key = targets.map(t => t.id + ':' + metaOf(t).extId).sort().join(',');
  if (key === loadAiring.key) return;
  loadAiring.key = key;
  airingBusy = true;
  try {
    const ids = [], malIds = [];
    for (const t of targets) {
      const m = metaOf(t);
      if (m.source === 'anilist') ids.push(+m.extId); else malIds.push(+m.extId);
    }
    const next = await upcomingEpisodes(ids, malIds);
    const week = Date.now() + 7 * 86400e3;
    const out = [];
    for (const t of targets) {
      const m = metaOf(t);
      const n = next[(m.source === 'anilist' ? 'al:' : 'mal:') + m.extId];
      if (!n || n.airingAt * 1000 > week) continue;
      const d = new Date(n.airingAt * 1000);
      out.push({ id: t.id, title: t.title, at: d.getTime(), when: `ép. ${n.episode} · ` + d.toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) });
    }
    S.airing = out.sort((a, b) => a.at - b.at);
  } catch (e) { /* AniList indisponible : le bandeau reste vide */ }
  S.airingDone = true;
  airingBusy = false;
  render();
  loadAiring(); // relance si d'autres animes ont reçu leur identifiant entre-temps
}

let votesTimer = null;
function refreshVotes() {
  clearTimeout(votesTimer);
  votesTimer = setTimeout(async () => {
    const pend = S.requests.filter(r => r.type === 'suggestion' && r.status === 'pending');
    await Promise.all(pend.map(async r => {
      try {
        const snap = await F.getDocs(F.collection(F.db, 'requests', r.id, 'votes'));
        S.votes[r.id] = { count: snap.size, mine: snap.docs.some(d => d.id === S.uid || d.id === S.email) };
      } catch (e) { /* ignore */ }
    }));
    render();
  }, 200);
}

/* ------------------------------------------------------------------ écritures */

// Journal réservé à l'admin (membres, accès) : jamais montré aux autres membres.
function adminLogEntry(batch, text) {
  batch.set(F.doc(F.collection(F.db, 'adminLog')), { at: F.serverTimestamp(), by: S.email, text });
}

function inviteText(email) {
  return `Salut ! Je t’ai ouvert l’accès à ma watchlist (animes, mangas, séries et films).

1. Va sur ${SITE_URL}
2. Choisis « Première visite » et utilise cet email : ${email}
3. Crée ton mot de passe, puis clique sur le lien de vérification reçu par email.

Tu pourras voir ma liste, noter ce que tu as vu aussi et me suggérer des titres.
${OWNER}`;
}

function historyEntry(batch, text) {
  batch.set(F.doc(F.collection(F.db, 'history')), {
    at: F.serverTimestamp(), by: S.uid, byName: myName(), text
  });
}

function titleFromItem(item, status) {
  const today = todayISO();
  return {
    title: item.title, altTitle: item.altTitle || '', kind: item.kind, status,
    genre: (item.genres || []).slice(0, 2).join(' · '), fam: familyFromGenres(item.genres || []),
    cover: item.cover || null, source: item.source, extId: item.extId, malId: item.malId || null,
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
    if (k === 'status') parts.push(`${statusLabel(a, changes.kind || before.kind)} → ${statusLabel(b, changes.kind || before.kind)}`);
    else if (k === 'kind') parts.push(`type ${KINDS[a]?.one || '—'} → ${KINDS[b]?.one || '—'}`);
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
    S.ui.pick = p.id; S.ui.rolls++; render();
  },
  clearPick: () => { S.ui.pick = null; S.ui.rolls = 0; render(); },
  startPick: async el => {
    const t = S.titles.find(x => x.id === el.dataset.id);
    if (!t) return;
    el.disabled = true;
    const changes = { status: 'cours' }, before = { status: t.status };
    if (t.kind === 'film') { changes.status = 'fini'; changes.finishedAt = todayISO(); before.finishedAt = t.finishedAt || null; }
    if (!t.startedAt) { changes.startedAt = todayISO(); before.startedAt = null; }
    try {
      if (isAdmin()) {
        const b = F.writeBatch(F.db);
        b.update(F.doc(F.db, 'titles', t.id), { ...changes, updatedAt: F.serverTimestamp() });
        historyEntry(b, describeChanges(t.title, changes, before) + ' (tirage au sort)');
        await b.commit();
        toast(t.kind === 'film' ? `${t.title} passe en Vu. Bon film !` : `${t.title} passe en En cours. Bon visionnage !`);
      } else {
        await F.addDoc(F.collection(F.db, 'requests'), {
          type: 'edit', by: S.uid, byName: myName(), status: 'pending', createdAt: F.serverTimestamp(),
          titleId: t.id, titleName: t.title, changes, before
        });
        toast(`Proposé à ${OWNER} : commencer ${t.title}.`);
      }
      S.ui.pick = null; S.ui.rolls = 0; render();
    } catch (e) { el.disabled = false; toast(errText(e)); }
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
          type: 'edit', by: S.uid, byName: myName(), status: 'pending', createdAt: F.serverTimestamp(),
          titleId: t.id, titleName: t.title, changes: { [field]: after }, before: { [field]: before }
        });
        toast(`Proposé à ${OWNER} : ${t.title} ${field === 'chapter' ? 'chap.' : 'ép.'} ${after}`);
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

  retryCovers: async el => {
    el.disabled = true;
    const missing = S.titles.filter(t => !coverOf(t));
    for (const t of missing) {
      delete S.localMeta[t.id];
      try { localStorage.removeItem(META_CACHE + t.id); } catch (e) { /* ignore */ }
    }
    S.meta.err = '';
    try {
      const b = F.writeBatch(F.db);
      for (const t of missing) if (t.metaTried) b.update(F.doc(F.db, 'titles', t.id), { metaTried: false });
      await b.commit();
    } catch (e) { toast(errText(e)); }
    resolveMeta();
  },

  closeWelcome: () => { S.welcomeOpen = false; lsSet('mw:welcome:' + S.email, true); render(); },
  ackNotices: async () => {
    lsSet('mw:decisions:' + S.email, Date.now());
    if (S.follows && S.follows.titles && followChanges().length) {
      const titles = {};
      for (const id of Object.keys(S.follows.titles)) {
        const t = S.titles.find(x => x.id === id);
        if (t) titles[id] = followSnapshot(t);
      }
      S.follows = { titles };
      try { await F.setDoc(F.doc(F.db, 'follows', S.uid), S.follows); } catch (e) { toast(errText(e)); }
    }
    render();
  },
  rkind: el => { S.ui.rkind = el.dataset.k; render(); },
  toggleFav: async el => {
    const t = S.titles.find(x => x.id === el.dataset.id);
    if (!t) return;
    try {
      const b = F.writeBatch(F.db);
      b.update(F.doc(F.db, 'titles', t.id), { fav: !t.fav });
      if (!t.fav) historyEntry(b, `${t.title} rejoint les coups de cœur`);
      await b.commit();
    } catch (e) { toast(errText(e)); }
  },
  toggleSeen: async el => {
    const id = el.dataset.id, list = S.seen[id] || [];
    const me = list.find(x => x.id === S.uid || x.id === S.email);
    try {
      if (me) { await F.deleteDoc(F.doc(F.db, 'titles', id, 'seen', me.id)); S.seen[id] = list.filter(x => x !== me); }
      else {
        const row = { name: myName(), rating: null, at: F.serverTimestamp() };
        await F.setDoc(F.doc(F.db, 'titles', id, 'seen', S.uid), row);
        S.seen[id] = list.concat([{ id: S.uid, ...row }]);
      }
      render();
    } catch (e) { toast(errText(e)); }
  },
  seenRate: async el => {
    const id = el.dataset.id, v = +el.dataset.v, list = S.seen[id] || [];
    const me = list.find(x => x.id === S.uid || x.id === S.email);
    if (!me) return;
    const rating = me.rating === v ? null : v;
    try {
      await F.setDoc(F.doc(F.db, 'titles', id, 'seen', me.id), { name: myName(), rating, at: F.serverTimestamp() });
      me.rating = rating; render();
    } catch (e) { toast(errText(e)); }
  },
  toggleFollow: async el => {
    const id = el.dataset.id, t = S.titles.find(x => x.id === id);
    if (!t) return;
    const titles = Object.assign({}, (S.follows && S.follows.titles) || {});
    if (titles[id]) delete titles[id]; else titles[id] = followSnapshot(t);
    const before = S.follows;
    S.follows = { titles };
    render();
    try { await F.setDoc(F.doc(F.db, 'follows', S.uid), S.follows); toast(titles[id] ? `Tu seras prévenu quand ${t.title} avance.` : `Tu ne suis plus ${t.title}.`); }
    catch (e) { S.follows = before; render(); toast(errText(e)); }
  },
  showInvite: el => { S.newMember.invite = el.dataset.id; S.newMember.msg = ''; render(); },
  hideInvite: () => { S.newMember.invite = ''; render(); },
  copyInvite: async () => {
    const text = inviteText(S.newMember.invite);
    try { await navigator.clipboard.writeText(text); toast('Message copié.'); }
    catch (e) { const ta = document.getElementById('invite-text'); if (ta) { ta.focus(); ta.select(); } toast('Sélectionné : fais Copier.'); }
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
  dKind: el => {
    const k = el.dataset.kind, d = S.draft, t = S.titles.find(x => x.id === d.id);
    if (!t || d.kind === k) return;
    const from = d.kind;
    d.kind = k;
    // La progression suit : épisodes ↔ chapitres ; un film n'a pas de progression
    if (k === 'manga' && from !== 'manga') d.chapter = d.chapter || d.episode || 0;
    if (k !== 'manga' && from === 'manga') d.episode = d.episode || d.chapter || 0;
    if (k === 'film' && !FILM_STATUSES.includes(d.status)) d.status = 'voir';
    // Le total dépend du type : il sera repris avec la nouvelle affiche
    d.total = k === t.kind ? (t.total ?? null) : null;
    render();
  },
  saveTitle: async el => {
    const t = S.titles.find(x => x.id === el.dataset.id);
    if (!t) return;
    const { changes, before } = diffDraft(t);
    if (!Object.keys(changes).length) return;
    el.disabled = true;
    try {
      if (isAdmin()) {
        const kindChanged = 'kind' in changes;
        const b = F.writeBatch(F.db);
        b.update(F.doc(F.db, 'titles', t.id), { ...changes, ...(kindChanged ? { total: changes.total ?? null } : {}), updatedAt: F.serverTimestamp() });
        historyEntry(b, describeChanges(t.title, changes, before));
        await b.commit();
        S.draft = null;
        if (kindChanged) {
          // Nouveau type : on propose tout de suite une affiche et des infos qui vont avec
          S.fixAfter = t.id;
          toast(`${t.title} est maintenant un ${KINDS[changes.kind].one.toLowerCase()}. Choisis la bonne affiche ci-dessous.`);
        } else toast('Enregistré.');
      } else {
        await F.addDoc(F.collection(F.db, 'requests'), {
          type: 'edit', by: S.uid, byName: myName(), status: 'pending', createdAt: F.serverTimestamp(),
          titleId: t.id, titleName: t.title, changes, before
        });
        S.draft = null;
        toast(`Modification envoyée à ${OWNER}.`);
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
      location.hash = kindHash(t.kind);
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
      try { localStorage.removeItem(META_CACHE + t.id); } catch (e) { /* ignore */ }
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
      const clean = { title: item.title, altTitle: item.altTitle || '', kind: item.kind, cover: item.cover || null, source: item.source, extId: item.extId, malId: item.malId || null, total: item.total || null, duration: item.duration || null, year: item.year || null, genres: (item.genres || []).slice(0, 6) };
      await F.addDoc(F.collection(F.db, 'requests'), {
        type: 'suggestion', by: S.uid, byName: myName(), status: 'pending',
        createdAt: F.serverTimestamp(), item: clean, note: S.add.note.trim()
      });
      toast(`${item.title} envoyé à ${OWNER}.`);
      Object.assign(S.add, { q: '', results: [], chosen: null, note: '' });
      render();
    } catch (e) { el.disabled = false; toast(errText(e)); }
  },
  vote: async el => {
    const id = el.dataset.id, v = S.votes[id] || { count: 0, mine: false };
    const ref = F.doc(F.db, 'requests', id, 'votes', S.uid);
    S.votes[id] = { count: v.count + (v.mine ? -1 : 1), mine: !v.mine };
    render();
    try {
      if (v.mine) { await F.deleteDoc(ref); await F.deleteDoc(F.doc(F.db, 'requests', id, 'votes', S.email)).catch(() => {}); }
      else await F.setDoc(ref, { at: F.serverTimestamp() });
    }
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
      historyEntry(b, `Suggestion de ${displayName(r.by, r.byName)} acceptée : ${r.item.title} ajouté en À voir`);
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
      const kindChanged = r.changes && 'kind' in r.changes;
      b.update(F.doc(F.db, 'titles', t.id), { ...r.changes, ...(kindChanged ? { total: r.changes.total ?? null } : {}), updatedAt: F.serverTimestamp() });
      b.update(F.doc(F.db, 'requests', r.id), { status: 'accepted', decidedAt: F.serverTimestamp() });
      historyEntry(b, describeChanges(t.title, r.changes, r.before || {}) + ` (proposé par ${displayName(r.by, r.byName)})`);
      await b.commit();
      if (kindChanged) { S.fixAfter = t.id; S.draft = null; location.hash = '#/titre/' + encodeURIComponent(t.id); toast('Type changé. Choisis la nouvelle affiche dans la fiche.'); }
      else toast('Modification appliquée.');
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
      adminLogEntry(b, `${a.id} ajouté comme lecteur`);
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
      adminLogEntry(b, `${id} passe ${role === 'editor' ? 'éditeur' : 'lecteur'}`);
      await b.commit();
    } catch (e) { toast(errText(e)); }
  },
  removeMember: async el => {
    const id = el.dataset.id;
    try {
      const b = F.writeBatch(F.db);
      b.delete(F.doc(F.db, 'members', id));
      adminLogEntry(b, `${id} retiré des membres`);
      await b.commit();
      S.ui.confirm = null;
      toast(`${id} n’a plus accès.`);
    } catch (e) { toast(errText(e)); }
  },

  applyUpdate: () => applyUpdate(),
  removeSite: async el => {
    const i = +el.dataset.i, sites = ((S.streaming && S.streaming.sites) || []).filter((_, j) => j !== i);
    try { await F.setDoc(F.doc(F.db, 'settings', 'streaming'), { sites }); S.ui.confirm = null; toast('Site retiré.'); }
    catch (e) { toast(errText(e)); }
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
  savePseudo: async () => {
    const P = S.profile, pseudo = P.pseudo.trim().replace(/\s+/g, ' '), key = pseudoKey(pseudo);
    P.err = ''; P.msg = '';
    if (!/^[\p{L}\p{N} _-]{2,20}$/u.test(pseudo) || !/^[a-z0-9_-]{2,20}$/.test(key)) {
      P.err = 'Entre 2 et 20 caractères : lettres, chiffres, espaces, - ou _.'; return;
    }
    const oldKey = S.member.pseudoKey || S.pseudoKeys[S.uid];
    if (S.member.pseudo === pseudo) { P.msg = 'C’est déjà ton pseudo.'; return; }
    const owner = Object.keys(S.pseudoKeys).find(u => S.pseudoKeys[u] === key);
    if (owner && owner !== S.uid) { P.err = 'Ce pseudo est déjà pris. Essaie une variante.'; return; }
    P.busy = true; render();
    try {
      const b = F.writeBatch(F.db);
      b.set(F.doc(F.db, 'pseudos', key), { uid: S.uid, pseudo, key });
      if (oldKey && oldKey !== key) b.delete(F.doc(F.db, 'pseudos', oldKey));
      b.update(F.doc(F.db, 'members', S.email), { pseudo, pseudoKey: key, uid: S.uid });
      await b.commit();
      Object.assign(S.member, { pseudo, pseudoKey: key, uid: S.uid });
      P.msg = `C’est noté : les membres te voient maintenant comme « ${pseudo} ».`;
    } catch (e) {
      P.err = e && e.code === 'permission-denied' ? 'Ce pseudo est déjà pris. Essaie une variante.' : errText(e);
    }
    P.busy = false;
  },
  addSite: async () => {
    const N = S.newSite, name = N.name.trim(), url = N.url.trim(), note = N.note.trim();
    let ok = false;
    try { ok = ['http:', 'https:'].includes(new URL(url).protocol); } catch (e) { /* adresse invalide */ }
    if (!name || !ok) { toast('Il faut un nom et une adresse qui commence par https://'); return; }
    const sites = ((S.streaming && S.streaming.sites) || []).concat([{ name: name.slice(0, 40), url, note: note.slice(0, 120) }]);
    await F.setDoc(F.doc(F.db, 'settings', 'streaming'), { sites });
    S.newSite = { name: '', url: '', note: '' };
    toast(`${name} ajouté.`);
  },
  addMember: async () => {
    const email = S.newMember.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { S.newMember.msg = 'Cet email n’est pas valide : il faut un @ et un domaine.'; return; }
    if (S.members.some(m => m.id === email)) { S.newMember.msg = `${email} est déjà membre.`; return; }
    const b = F.writeBatch(F.db);
    b.set(F.doc(F.db, 'members', email), { role: S.newMember.role, name: email.split('@')[0], addedAt: F.serverTimestamp() });
    if (S.access.some(a => a.id === email)) b.delete(F.doc(F.db, 'accessRequests', email));
    adminLogEntry(b, `${email} ajouté comme ${S.newMember.role === 'editor' ? 'éditeur' : 'lecteur'}`);
    await b.commit();
    S.newMember = { email: '', role: S.newMember.role, msg: `${email} a accès. Envoie-lui le message ci-dessous pour le prévenir.`, invite: email };
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
  pseudo: el => { S.profile.pseudo = el.value; },
  siteName: el => { S.newSite.name = el.value; },
  siteUrl: el => { S.newSite.url = el.value; },
  siteNote: el => { S.newSite.note = el.value; },
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

/* ------------------------------------------------------------------ mises à jour du site */

let waitingWorker = null, updateAsked = false;
function applyUpdate() {
  if (waitingWorker) { updateAsked = true; waitingWorker.postMessage('skip'); }
  else location.reload();
}
if ('serviceWorker' in navigator) {
  // Recharge seulement quand on a demandé la mise à jour (pas à la toute première installation)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateAsked) return;
    updateAsked = false; location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const offer = w => { waitingWorker = w; S.update = true; render(); };
      // Une version déjà téléchargée attend : on propose de l'appliquer
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      // Vérifie s'il y a du neuf à chaque retour sur l'app
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch (e) { /* pas de mode hors ligne, le site marche quand même */ }
  });
}

/* ------------------------------------------------------------------ tirer pour rafraîchir (app installée) */

const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
if (standalone) {
  let y0 = null, dy = 0;
  const ptr = () => document.querySelector('.ptr');
  const setPull = v => {
    const el = ptr();
    if (!el) return;
    el.style.setProperty('--pull', Math.min(v, 110) + 'px');
    el.classList.toggle('ready', v > 70);
    el.classList.toggle('show', v > 8);
  };
  window.addEventListener('touchstart', e => {
    y0 = window.scrollY <= 0 && !S.ui.sheet && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = (e.touches[0].clientY - y0) * 0.55;
    if (dy < 0 || window.scrollY > 0) { y0 = null; setPull(0); return; }
    setPull(dy);
  }, { passive: true });
  window.addEventListener('touchend', () => {
    if (y0 === null) return;
    const go = dy > 70;
    y0 = null;
    if (go) { const el = ptr(); if (el) el.classList.add('loading'); applyUpdate(); }
    else setPull(0);
  });
}
