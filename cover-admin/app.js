const $ = id => document.getElementById(id);
const API = (window.API_URL || '').replace(/\/$/, '');
let tok = sessionStorage.tok || '', img = '';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, bad) => {
  const t = $('msg'); t.textContent = m; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500);
};

async function api(path, method = 'GET', body) {
  const r = await fetch(API + '/api/' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Token': tok }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'admin/login') { logout(); throw new Error('Session expirée'); }
  if (!r.ok) throw new Error(j.error || 'Erreur');
  return j;
}
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || 'Serveur injoignable', true); } };

function logout() { tok = ''; sessionStorage.removeItem('tok'); $('lf').hidden = false; $('dash').hidden = true; $('out').hidden = true; }

async function load() {
  const [s, ads] = await Promise.all([api('admin/stats'), api('admin/ads')]);
  $('lf').hidden = true; $('dash').hidden = false; $('out').hidden = false;
  const cards = [['Utilisateurs', s.users], ['Actifs aujourd’hui', s.today], ['Ouvertures', s.opens], ['Audios convertis', s.converts], ['Vues pub', s.views], ['Clics pub', s.clicks], ['Taux de clic', s.ctr + ' %']];
  $('stats').innerHTML = cards.map(([l, v]) => `<div class="card"><b>${v}</b><small>${l}</small></div>`).join('');
  const mx = Math.max(1, ...s.series.map(d => Math.max(d.opens, d.converts)));
  $('chart').innerHTML = s.series.map(d => `<div class="day"><div class="cols"><i class="o" style="height:${d.opens / mx * 100}%" title="${d.opens} ouvertures"></i><i class="c" style="height:${d.converts / mx * 100}%" title="${d.converts} audios"></i></div><small>${d.d}</small></div>`).join('');
  const t = Date.now() / 1000;
  $('ads').innerHTML = ads.length ? ads.map(a => {
    const exp = a.ends && a.ends < t;
    return `<div class="ad-row"><img src="${esc(a.image)}" alt=""><div class="inf"><b>${esc(a.title)}</b><small>${esc(a.link)}</small>
      <small>${a.views} vues · ${a.clicks} clics${a.ends ? ' · fin ' + new Date(a.ends * 1000).toLocaleDateString('fr-FR') : ''}</small></div>
      <div class="acts"><button class="btn ${a.active && !exp ? 'on' : ''}" data-a="t" data-id="${a.id}" data-on="${a.active}">${exp ? 'Expirée' : a.active ? 'Active' : 'En pause'}</button>
      <button class="btn" data-a="l" data-id="${a.id}" data-l="${esc(a.link)}">Lien</button><button class="btn del" data-a="d" data-id="${a.id}">Supprimer</button></div></div>`;
  }).join('') : '<p class="mu">Aucune publicité pour le moment.</p>';
}

$('lf').onsubmit = run(async e => {
  e.preventDefault();
  const j = await api('admin/login', 'POST', { password: $('pw').value });
  tok = j.token; sessionStorage.tok = tok; $('pw').value = ''; await load();
});
$('out').onclick = logout;

const shrink = file => new Promise((ok, ko) => {
  const im = new Image(), u = URL.createObjectURL(file);
  im.onload = () => {
    const W = 800, H = 250, c = document.createElement('canvas'), x = c.getContext('2d');
    c.width = W; c.height = H; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const s = Math.max(W / im.width, H / im.height), w = im.width * s, h = im.height * s;
    x.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', .82));
  };
  im.onerror = () => ko(new Error('Image illisible')); im.src = u;
});
$('f').onchange = run(async e => {
  if (!e.target.files[0]) return;
  img = await shrink(e.target.files[0]); $('prev').src = img; $('prev').hidden = false; $('ph').hidden = true;
});
$('af').onsubmit = run(async e => {
  e.preventDefault();
  if (!img) throw new Error('Choisis une image');
  await api('admin/ads', 'POST', { title: $('t').value, link: $('l').value, ends: $('e').value, image: img });
  e.target.reset(); img = ''; $('prev').hidden = true; $('ph').hidden = false;
  toast('Publicité publiée'); await load();
});
$('ads').onclick = run(async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.a === 't') await api('admin/ads/' + id, 'POST', { active: b.dataset.on !== '1' });
  else if (b.dataset.a === 'l') { const l = prompt('Nouveau lien', b.dataset.l); if (!l) return; await api('admin/ads/' + id, 'POST', { link: l }); }
  else if (b.dataset.a === 'd') { if (!confirm('Supprimer cette publicité ?')) return; await api('admin/ads/' + id, 'DELETE'); }
  await load();
});
$('pf').onsubmit = run(async e => {
  e.preventDefault();
  await api('admin/password', 'POST', { old: $('po').value, new: $('pn').value });
  e.target.reset(); toast('Mot de passe changé, reconnecte-toi'); logout();
});
$('reset').onclick = run(async () => {
  if (!confirm('Effacer toutes les statistiques ?')) return;
  await api('admin/reset', 'POST', {}); toast('Statistiques remises à zéro'); await load();
});
if (tok) load().catch(logout);
