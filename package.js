const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ANTHROPIC_API_KEY: KEY, ADMIN_PASSWORD, MODEL = 'claude-sonnet-5-5', PORT = 3000 } = process.env;
if (!KEY || !ADMIN_PASSWORD) { console.error('Définis ANTHROPIC_API_KEY et ADMIN_PASSWORD'); process.exit(1); }

const DATA = path.join(__dirname, 'data.json');
const defaults = {
  enabled: true,
  publicPrompt: "Tu es un assistant d’aide aux devoirs pour des élèves. Explique clairement, étape par étape, en français. Refuse poliment tout sujet hors scolaire, violent, sexuel ou dangereux.",
  adminPrompt: "Tu es l’assistant personnel de l’administrateur du site. Réponds de façon directe et complète sur tous les sujets, sans les limites de sujet du mode public.",
  blockedWords: [],
  logs: []
};
let db = { ...defaults };
try { db = { ...defaults, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
const save = () => { try { fs.writeFileSync(DATA, JSON.stringify(db, null, 2)); } catch {} };

async function askClaude(system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Erreur API');
  return j.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

const clean = m => Array.isArray(m)
  ? m.slice(-20).filter(x => ['user', 'assistant'].includes(x?.role) && typeof x.content === 'string')
      .map(x => ({ role: x.role, content: x.content.slice(0, 2000) }))
  : [];

const sessions = new Map();
const sha = s => crypto.createHash('sha256').update(s).digest();
const getToken = req => (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('sid='))?.slice(4);
const isAdmin = req => { const t = getToken(req); const e = t && sessions.get(t); return e && e > Date.now(); };
const needAdmin = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'Non autorisé' });

const hits = new Map();
const limit = (max, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < ms);
  if (arr.length >= max) return res.status(429).json({ error: 'Trop de requêtes, réessaie dans une minute.' });
  arr.push(now); hits.set(k, arr); next();
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', limit(15, 60000), async (req, res) => {
  if (!db.enabled) return res.status(503).json({ error: 'Le bot est désactivé pour le moment.' });
  const messages = clean(req.body.messages);
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return res.status(400).json({ error: 'Message invalide' });
  const low = last.content.toLowerCase();
  if (db.blockedWords.some(w => w && low.includes(w.toLowerCase())))
    return res.status(400).json({ error: 'Ce message contient un mot interdit.' });
  try {
    const reply = await askClaude(db.publicPrompt, messages);
    db.logs.push({ t: new Date().toISOString(), q: last.content, a: reply });
    db.logs = db.logs.slice(-200); save();
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/login', limit(5, 60000), (req, res) => {
  const ok = crypto.timingSafeEqual(sha(String(req.body.password || '')), sha(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, Date.now() + 12 * 3600 * 1000);
  res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { sessions.delete(getToken(req)); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ admin: !!isAdmin(req) }));
app.post('/api/admin/chat', needAdmin, async (req, res) => {
  const messages = clean(req.body.messages);
  if (!messages.length) return res.status(400).json({ error: 'Message invalide' });
  try { res.json({ reply: await askClaude(db.adminPrompt, messages) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/settings', needAdmin, (req, res) => {
  const { enabled, publicPrompt, adminPrompt, blockedWords } = db;
  res.json({ enabled, publicPrompt, adminPrompt, blockedWords });
});
app.post('/api/admin/settings', needAdmin, (req, res) => {
  const b = req.body;
  if (typeof b.enabled === 'boolean') db.enabled = b.enabled;
  if (typeof b.publicPrompt === 'string') db.publicPrompt = b.publicPrompt.slice(0, 5000);
  if (typeof b.adminPrompt === 'string') db.adminPrompt = b.adminPrompt.slice(0, 5000);
  if (Array.isArray(b.blockedWords)) db.blockedWords = b.blockedWords.map(String).map(s => s.trim()).filter(Boolean).slice(0, 500);
  save(); res.json({ ok: true });
});
app.get('/api/admin/logs', needAdmin, (req, res) => res.json(db.logs.slice().reverse()));

app.listen(PORT, () => console.log('Serveur lancé sur le port ' + PORT));
