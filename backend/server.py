#!/usr/bin/env python3
"""Backend Cover : API + (en local) sert les deux sites. Aucune dépendance : Python 3.8+."""
import calendar, hashlib, json, mimetypes, os, re, secrets, sqlite3, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, 'data.db')
PORT = int(os.environ.get('PORT', 8000))
SITES = {'/admin': os.path.join(BASE, '..', 'admin-cover'), '': os.path.join(BASE, '..', 'video-cover')}
FAILS = {}

def now(): return int(time.time())

def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    return salt + '$' + hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 100000).hex()

def check_pw(pw, stored):
    return secrets.compare_digest(hash_pw(pw, stored.split('$')[0]), stored)

def init():
    c = db()
    c.execute('pragma journal_mode=wal')
    c.executescript('''
    create table if not exists devices(id text primary key, first_seen int, last_seen int);
    create table if not exists events(id integer primary key, ts int, device text, type text, ad_id int);
    create index if not exists ev_ts on events(ts);
    create table if not exists ads(id integer primary key, title text, image text, link text, active int default 1, ends int, created int);
    create table if not exists settings(k text primary key, v text);
    create table if not exists sessions(token text primary key, exp int);
    ''')
    if not c.execute("select 1 from settings where k='pw'").fetchone():
        c.execute("insert into settings values('pw',?)", (hash_pw(os.environ.get('ADMIN_PASSWORD', 'admin1234')),))
    c.commit()

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass

    def out(self, code, data, ctype='application/json', headers=()):
        b = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(code)
        for k, v in [('Content-Type', ctype), ('Content-Length', str(len(b))), ('Access-Control-Allow-Origin', '*'),
                     ('Access-Control-Allow-Headers', 'Content-Type, X-Token'),
                     ('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')] + list(headers):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def go(self, m):
        p = urlparse(self.path).path
        try:
            if m == 'OPTIONS': return self.out(204, b'')
            if p.startswith('/api/'): return self.api(m, p[5:])
            if m == 'GET': return self.static(p)
            self.out(405, {'error': 'Méthode refusée'})
        except (ValueError, KeyError, TypeError) as e:
            self.out(400, {'error': str(e) or 'Requête invalide'})
        except Exception:
            self.out(500, {'error': 'Erreur serveur'})
    def do_GET(self): self.go('GET')
    def do_POST(self): self.go('POST')
    def do_DELETE(self): self.go('DELETE')
    def do_OPTIONS(self): self.go('OPTIONS')

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 1_500_000: raise ValueError('Requête trop lourde')
        return json.loads(self.rfile.read(n) or b'{}')

    def api(self, m, p):
        c = db()
        j = self.body() if m in ('POST', 'DELETE') else {}
        t = now()
        # ---------- public ----------
        if m == 'GET' and p == 'ads':
            rows = c.execute("select id,title,image,link from ads where active=1 and (ends is null or ends>?) order by id desc limit 5", (t,))
            return self.out(200, [dict(r) for r in rows])
        if m == 'POST' and p == 'event':
            dev = str(j.get('device', ''))
            if not re.fullmatch(r'[\w-]{8,64}', dev): raise ValueError('Appareil invalide')
            c.execute('insert into devices values(?,?,?) on conflict(id) do update set last_seen=?', (dev, t, t, t))
            for e in list(j.get('events', []))[:200]:
                if e.get('type') not in ('open', 'convert', 'ad_view', 'ad_click'): continue
                ts = max(t - 30 * 86400, min(int(e.get('ts') or t), t))
                ad = int(e['ad_id']) if e.get('ad_id') else None
                c.execute('insert into events(ts,device,type,ad_id) values(?,?,?,?)', (ts, dev, e['type'], ad))
            c.commit()
            return self.out(200, {'ok': True})
        if m == 'POST' and p == 'admin/login':
            ip = self.client_address[0]
            FAILS[ip] = [x for x in FAILS.get(ip, []) if x > t - 300]
            if len(FAILS[ip]) >= 5: return self.out(429, {'error': 'Trop d’essais, réessaie dans 5 minutes'})
            if not check_pw(str(j.get('password', '')), c.execute("select v from settings where k='pw'").fetchone()[0]):
                FAILS[ip].append(t)
                return self.out(401, {'error': 'Mot de passe incorrect'})
            c.execute('delete from sessions where exp<?', (t,))
            tok = secrets.token_urlsafe(32)
            c.execute('insert into sessions values(?,?)', (tok, t + 12 * 3600))
            c.commit()
            return self.out(200, {'token': tok})
        # ---------- admin ----------
        if not c.execute('select 1 from sessions where token=? and exp>?', (self.headers.get('X-Token', ''), t)).fetchone():
            return self.out(401, {'error': 'Non autorisé'})
        if m == 'GET' and p == 'admin/stats':
            q = lambda sql, *a: c.execute(sql, a).fetchone()[0]
            n = lambda ty: q('select count(*) from events where type=?', ty)
            day = t - t % 86400
            series = []
            for i in range(6, -1, -1):
                s = day - i * 86400
                r = c.execute("select sum(type='open'),sum(type='convert'),sum(type='ad_click') from events where ts>=? and ts<?", (s, s + 86400)).fetchone()
                series.append({'d': time.strftime('%d/%m', time.gmtime(s)), 'opens': r[0] or 0, 'converts': r[1] or 0, 'clicks': r[2] or 0})
            v, k = n('ad_view'), n('ad_click')
            return self.out(200, {'users': q('select count(*) from devices'), 'today': q('select count(*) from devices where last_seen>=?', day),
                                  'opens': n('open'), 'converts': n('convert'), 'views': v, 'clicks': k,
                                  'ctr': round(100 * k / v, 1) if v else 0, 'series': series})
        if m == 'GET' and p == 'admin/ads':
            rows = c.execute("select a.*,(select count(*) from events where ad_id=a.id and type='ad_view') views,"
                             "(select count(*) from events where ad_id=a.id and type='ad_click') clicks from ads a order by id desc")
            return self.out(200, [dict(r) for r in rows])
        if m == 'POST' and p == 'admin/ads':
            title, link, img = str(j.get('title', '')).strip()[:80], str(j.get('link', '')).strip(), str(j.get('image', ''))
            if not title: raise ValueError('Titre requis')
            if not re.match(r'https?://[^\s]+$', link): raise ValueError('Le lien doit commencer par http:// ou https://')
            if not img.startswith('data:image/') or len(img) > 700_000: raise ValueError('Image invalide ou trop lourde')
            ends = calendar.timegm(time.strptime(j['ends'], '%Y-%m-%d')) + 86399 if j.get('ends') else None
            c.execute('insert into ads(title,image,link,active,ends,created) values(?,?,?,1,?,?)', (title, img, link, ends, t))
            c.commit()
            return self.out(200, {'ok': True})
        mm = re.fullmatch(r'admin/ads/(\d+)', p)
        if mm and m == 'POST':
            if 'active' in j: c.execute('update ads set active=? where id=?', (1 if j['active'] else 0, mm[1]))
            if 'link' in j:
                if not re.match(r'https?://[^\s]+$', str(j['link'])): raise ValueError('Lien invalide')
                c.execute('update ads set link=? where id=?', (j['link'], mm[1]))
            c.commit()
            return self.out(200, {'ok': True})
        if mm and m == 'DELETE':
            c.execute('delete from ads where id=?', (mm[1],)); c.commit()
            return self.out(200, {'ok': True})
        if m == 'POST' and p == 'admin/password':
            if not check_pw(str(j.get('old', '')), c.execute("select v from settings where k='pw'").fetchone()[0]):
                raise ValueError('Ancien mot de passe incorrect')
            if len(str(j.get('new', ''))) < 8: raise ValueError('Minimum 8 caractères')
            c.execute("update settings set v=? where k='pw'", (hash_pw(j['new']),))
            c.execute('delete from sessions'); c.commit()
            return self.out(200, {'ok': True})
        if m == 'POST' and p == 'admin/reset':
            c.execute('delete from events'); c.execute('delete from devices'); c.commit()
            return self.out(200, {'ok': True})
        self.out(404, {'error': 'Introuvable'})

    def static(self, p):
        if p == '/admin': return self.out(301, b'', headers=[('Location', '/admin/')])
        for pre, root in SITES.items():
            if pre and not p.startswith(pre + '/'): continue
            rel = p[len(pre):].lstrip('/') or 'index.html'
            if rel.endswith('/'): rel += 'index.html'
            root = os.path.realpath(root)
            f = os.path.realpath(os.path.join(root, rel))
            if not f.startswith(root + os.sep) or not os.path.isfile(f): break
            ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
            return self.out(200, open(f, 'rb').read(), ctype, [('Cache-Control', 'no-cache')])
        self.out(404, {'error': 'Introuvable'})

if __name__ == '__main__':
    init()
    print(f'Cover prêt : utilisateurs http://127.0.0.1:{PORT}/  |  admin http://127.0.0.1:{PORT}/admin/')
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
