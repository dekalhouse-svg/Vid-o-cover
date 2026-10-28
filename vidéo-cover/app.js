const $ = id => document.getElementById(id);
const S = { pick: $('s-pick'), ready: $('s-ready'), busy: $('s-busy'), done: $('s-done') };
const LAME = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';
let file, fmt = 'mp3', url, tu;

const show = k => { for (const x in S) S[x].hidden = x !== k; $('err').hidden = true; };
const note = m => { $('err').textContent = m; $('err').hidden = false; };
const prog = (p, t) => { $('bar').style.width = p + '%'; if (t) $('msg').textContent = t; };
const tick = () => new Promise(r => setTimeout(r));
const mo = n => (n / 1048576).toFixed(1) + ' Mo';

function reset() {
  if (url) URL.revokeObjectURL(url);
  url = null; $('player').removeAttribute('src'); $('file').value = '';
  if (tu) URL.revokeObjectURL(tu);
  tu = null; $('thumb').removeAttribute('src'); show('pick');
}

function pick(f) {
  file = f;
  if (tu) URL.revokeObjectURL(tu);
  tu = URL.createObjectURL(f);
  $('thumb').src = tu + '#t=0.5';
  $('name').textContent = f.name; $('size').textContent = mo(f.size); show('ready');
}
$('thumb').onloadedmetadata = () => {
  const d = Math.round($('thumb').duration);
  if (isFinite(d)) $('size').textContent = mo(file.size) + ' · ' + Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0');
};
$('file').onchange = e => { if (e.target.files[0]) pick(e.target.files[0]); };

const dz = $('drop');
['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => dz.addEventListener(t, () => dz.classList.remove('over')));
dz.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) pick(f);
});
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
  fmt = b.dataset.f;
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
});
$('back').onclick = $('again').onclick = reset;
$('go').onclick = convert;

const loadLame = () => window.lamejs ? Promise.resolve() : new Promise((ok, ko) => {
  const s = document.createElement('script');
  s.src = LAME; s.onload = ok; s.onerror = ko; document.head.append(s);
});

async function convert() {
  show('busy'); prog(8, 'Lecture de la vidéo…');
  try {
    const buf = await file.arrayBuffer();
    prog(25, 'Extraction du son…');
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(buf);
    ctx.close();

    let ext = fmt, msg = '';
    if (ext === 'mp3') { try { await loadLame(); } catch { ext = 'wav'; msg = 'MP3 indisponible sans connexion : fichier WAV créé.'; } }
    prog(45, 'Création de l’audio…');
    const blob = ext === 'mp3' ? await toMp3(audio) : toWav(audio);

    url = URL.createObjectURL(blob);
    $('player').src = url;
    $('dl').href = url;
    $('dl').download = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
    prog(100); show('done'); if (msg) note(msg); track('convert');
  } catch (e) {
    show('ready'); note('Impossible d’extraire le son : vidéo sans audio, trop lourde ou format non pris en charge.');
  }
}

const pcm = f => {
  const o = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 32768 : s * 32767; }
  return o;
};

async function toMp3(a) {
  const ch = Math.min(a.numberOfChannels, 2), n = a.length, step = 1152 * 20;
  const enc = new lamejs.Mp3Encoder(ch, a.sampleRate, 128), out = [];
  const L = a.getChannelData(0), R = ch > 1 ? a.getChannelData(1) : null;
  for (let i = 0, k = 0; i < n; i += step, k++) {
    const l = pcm(L.subarray(i, i + step));
    const d = R ? enc.encodeBuffer(l, pcm(R.subarray(i, i + step))) : enc.encodeBuffer(l);
    if (d.length) out.push(d);
    if (k % 5 === 0) { prog(45 + 53 * i / n); await tick(); }
  }
  out.push(enc.flush());
  return new Blob(out, { type: 'audio/mpeg' });
}

function toWav(a) {
  const ch = Math.min(a.numberOfChannels, 2), n = a.length, sr = a.sampleRate, len = n * ch * 2;
  const v = new DataView(new ArrayBuffer(44 + len));
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len, true);
  const d = Array.from({ length: ch }, (_, c) => a.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, d[c][i])); v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2;
  }
  return new Blob([v], { type: 'audio/wav' });
}

// PWA : installation + mode hors ligne
let ev;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); ev = e; $('install').hidden = false; });
$('install').onclick = async () => { ev.prompt(); await ev.userChoice; $('install').hidden = true; };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js'));

// ---- Statistiques anonymes + publicités (fonctionne hors ligne) ----
const API = (window.API_URL || '').replace(/\/$/, '');
const dev = localStorage.dev || (localStorage.dev = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)));
const queue = () => { try { return JSON.parse(localStorage.q || '[]'); } catch { return []; } };
let sending = false, ads = [], ai = 0, cur;
try { ads = JSON.parse(localStorage.ads || '[]'); } catch {}

function track(type, ad) {
  localStorage.q = JSON.stringify(queue().concat({ type, ad_id: ad || null, ts: Math.floor(Date.now() / 1000) }).slice(-500));
  flush();
}
async function flush() {
  const l = queue();
  if (sending || !l.length || !navigator.onLine) return;
  sending = true;
  try {
    const r = await fetch(API + '/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: dev, events: l }) });
    if (r.ok) localStorage.q = JSON.stringify(queue().slice(l.length));
  } catch {}
  sending = false;
}
function showAd() {
  if (!ads.length) { $('ad').hidden = true; return; }
  cur = ads[ai++ % ads.length];
  $('adimg').src = cur.image; $('adimg').alt = cur.title; $('ad').href = cur.link; $('ad').hidden = false;
  track('ad_view', cur.id);
}
async function loadAds() {
  try {
    const r = await fetch(API + '/api/ads');
    if (r.ok) { ads = await r.json(); try { localStorage.ads = JSON.stringify(ads); } catch {} }
  } catch {}
  showAd();
}
$('ad').onclick = e => {
  e.preventDefault();
  if (!navigator.onLine) return note('Pas de connexion : le lien s’ouvrira avec internet.');
  track('ad_click', cur.id); window.open(cur.link, '_blank', 'noopener');
};
setInterval(() => { if (ads.length > 1) showAd(); }, 20000);
addEventListener('online', () => { flush(); loadAds(); });
track('open'); loadAds();
