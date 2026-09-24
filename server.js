/* 简历工坊 · 动态网页服务端
 * Node 22，仅用内置模块，无第三方依赖。
 * 数据访问统一走 PostgREST（凭据由 Page 运行时以环境变量注入，绝不下发到浏览器）。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { buildDocx } from './lib/docx.js';
import { parseResumeText, docxToText, pdfToText, extractPdfText } from './lib/parse.js';
import { makeAdmin } from './lib/admin.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '0.0.0.0';

const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
const DASHSCOPE_KEY = (process.env.DASHSCOPE_API_KEY || '').trim();
const ARK_KEY = (process.env.ARK_API_KEY || '').trim();
const ARK_MODEL_RAW = (process.env.ARK_MODEL || '').trim();
// 兜底：默认用已开通的 dated 模型 id；若环境变量误留旧的 doubao-pro-32k（未开通会 404）也一并纠正
const ARK_MODEL = (!ARK_MODEL_RAW || ARK_MODEL_RAW === 'doubao-pro-32k') ? 'doubao-seed-2-1-pro-260915' : ARK_MODEL_RAW;
const SESSION_DAYS = 30;
const MAX_BODY = 10 * 1024 * 1024;

/* ------------------------------------------------------------------ 数据访问 */
/* DB_MODE: 空=Supabase(PostgREST /rest/v1)；'cloudbase'=腾讯云 CloudBase PostgreSQL 的 HTTP API(/v1/rdb/rest)。
   两者都是 PostgREST 语义（select=/eq./in.()/order/Prefer 等一致），仅 URL 前缀与密钥不同。 */
const DB_MODE = (process.env.DB_MODE || '').trim().toLowerCase();
const PG_BASE = (process.env.PG_API_BASE || '').replace(/\/+$/, '');
const PG_KEY = (process.env.PG_API_KEY || '').trim();
async function db(path, { method = 'GET', query = {}, body, prefer, wantCount = false } = {}) {
  const cb = DB_MODE === 'cloudbase';
  const url = new URL(cb ? `${PG_BASE}/v1/rdb/rest/${path}` : `${SB}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const authKey = cb ? PG_KEY : KEY;
  const headers = { apikey: authKey, Authorization: `Bearer ${authKey}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
  if (wantCount) headers.Range = '0-0'; /* 只取 1 行，总数从响应头 content-range 读 */
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) {
    const err = new Error(`db ${res.status} ${method} ${path}: ${txt.slice(0, 400)}`);
    err.status = 502;
    throw err;
  }
  if (wantCount) {
    const cr = res.headers.get('content-range') || '';
    const total = Number(cr.split('/')[1]);
    if (!Number.isFinite(total)) {
      /* 明确报错而不是静默返回 0：便于立刻看出网关不支持 Range 计数 */
      const err = new Error(`count ${path}: 网关未返回可用的 content-range（收到 "${cr}"）`);
      err.status = 502;
      throw err;
    }
    return total;
  }
  return txt ? JSON.parse(txt) : null;
}

/* ------------------------------------------------------------------ 账号 */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function sameHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function newCode(bytes = 5) {
  return crypto.randomBytes(bytes).toString('hex').toUpperCase();
}
const NAME_OK = /^[\w\u4e00-\u9fa5.-]{3,24}$/;

/* ------------------------------------------------------- 会话缓存 / 限流 */
const sessionCache = new Map(); // token -> {user, exp}
const throttle = new Map(); // key -> {n, t}
function blocked(key, limit = 12, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const cur = throttle.get(key);
  if (!cur || now - cur.t > windowMs) {
    throttle.set(key, { n: 1, t: now });
    return false;
  }
  cur.n += 1;
  return cur.n > limit;
}

async function currentUser(req) {
  const token = readToken(req);
  if (!token || token.length < 20) return null;
  const hit = sessionCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const rows = await db('sessions', { query: { select: 'owner,expires_at', token: `eq.${token}`, limit: 1 } });
  const s = rows && rows[0];
  if (!s || new Date(s.expires_at).getTime() < Date.now()) {
    sessionCache.delete(token);
    return null;
  }
  const us = await db('users', { query: { select: 'id,username,role', id: `eq.${s.owner}`, limit: 1 } });
  const user = us && us[0];
  if (!user) return null;
  sessionCache.set(token, { user, exp: Date.now() + 60 * 1000 });
  return user;
}

/* ---- 账号分级：受限档 = guest(匿名) / free(无邀请码注册)，全功能档 = user(邀请码) / admin ---- */
const GUEST_EXPORT_LIMIT = 3;
const FREE_RESUME_LIMIT = 3; /* 受限档(guest/free)最多保存的简历份数，超出引导填写邀请码解锁 */
const isGuest = (u) => !!u && u.role === 'guest';
const isLimited = (u) => !!u && (u.role === 'guest' || u.role === 'free');
const planOf = (u) => (u && (u.role === 'user' || u.role === 'admin') ? 'pro' : 'guest');
async function guestExportCount(id) {
  const rows = await db('tpl_meta', { query: { select: 'value', key: `eq.export:${id}`, limit: 1 } });
  const v = rows && rows[0] && rows[0].value;
  return Number((v && v.count) || 0);
}
async function setGuestExportCount(id, n) {
  await db('tpl_meta', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { key: `export:${id}`, value: { count: n, at: new Date().toISOString() } } });
}
async function resumeCount(uid) {
  const rows = await db('resumes', { query: { select: 'id', owner: `eq.${uid}`, archived: 'eq.false' } });
  return (rows || []).length;
}
/* 新建/复制简历前的受限档份数上限；返回 true 表示已拦截并发送响应 */
async function guardResumeLimit(user, res) {
  if (isLimited(user)) {
    const n = await resumeCount(user.id);
    if (n >= FREE_RESUME_LIMIT) { send(res, 402, { error: `免费档最多保存 ${FREE_RESUME_LIMIT} 份简历，填写邀请码解锁不限份数`, needRegister: true, plan: 'guest', resumeLimit: FREE_RESUME_LIMIT }); return true; }
  }
  return false;
}

/* ------------------------------------------------------------------ 工具 */
function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(buf);
}

/* ② 会话凭证双通道：优先 Authorization: Bearer（老客户端与离线单文件版还在用），其次 HttpOnly cookie。
   cookie 让 token 不再落 localStorage，XSS 脚本读不到；两种都接受是为了让已登录用户平滑升级不掉线。 */
const SESS_COOKIE = 'rw_sess';
function cookieToken(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESS_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    const t = h.slice(7).trim();
    if (t) return t;
  }
  return cookieToken(req);
}
function isHttps(req) {
  const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (fwd) return fwd === 'https';
  if (req.socket && req.socket.encrypted) return true;
  return /^https:/i.test(String(req.headers.referer || ''));
}
/* 登录/注册/领匿名号成功后随响应下发；Max-Age 与服务端 SESSION_DAYS 对齐 */
function authCookie(req, token) {
  return `${SESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`;
}
const CLEAR_COOKIE = () => `${SESS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const staticCache = new Map();
async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'forbidden' });
  let buf = staticCache.get(file);
  if (!buf) {
    try {
      buf = await readFile(file);
    } catch {
      return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    staticCache.set(file, buf);
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(buf);
}

/* ------------------------------------------------------------- 模板库缓存 */
let tplCache = { at: 0, data: null };
async function templates() {
  if (tplCache.data && Date.now() - tplCache.at < 60 * 1000) return tplCache.data;
  const rows = await db('tpl_professions', {
    query: { select: 'slug,title,industry,summary,sections,sample,theme,sort,updated_at', order: 'sort.asc' },
  });
  const gloss = await db('tpl_glossary', { query: { select: 'profession,kind,text,weight', order: 'weight.desc' } });
  const byProf = {};
  for (const g of gloss || []) {
    (byProf[g.profession] ||= []).push({ kind: g.kind, text: g.text });
  }
  const meta = await db('tpl_meta', { query: { select: 'key,value,updated_at' } });
  const data = {
    templates: rows || [],
    glossary: byProf,
    meta: Object.fromEntries((meta || []).map((m) => [m.key, m.value])),
    syncedAt: new Date().toISOString(),
  };
  tplCache = { at: Date.now(), data };
  return data;
}
function templatesCacheBreak() {
  tplCache = { at: 0, data: null };
}

/* --------------------------------------------------------- 简历版本快照 */
const snapAt = new Map(); // resumeId -> ts
async function snapshot(resume, reason = 'auto') {
  const now = Date.now();
  const last = snapAt.get(resume.id) || 0;
  if (reason !== 'manual' && now - last < 3 * 60 * 1000) return null;
  snapAt.set(resume.id, now);
  const created = await db('resume_versions', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      resume_id: resume.id,
      owner: resume.owner,
      version: resume.version,
      data: resume.data,
      layout: resume.layout,
      theme: resume.theme,
    },
  });
  const keep = await db('resume_versions', {
    query: { select: 'id', resume_id: `eq.${resume.id}`, order: 'version.desc', offset: 20, limit: 50 },
  });
  for (const k of keep || []) {
    await db('resume_versions', { method: 'DELETE', query: { id: `eq.${k.id}` } }).catch(() => {});
  }
  return created && created[0];
}

/* --------------------------------------------------------------- 登录注册 */
async function makeSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await db('sessions', { method: 'POST', body: { token, owner: userId, expires_at: exp } });
  return { token, expires_at: exp };
}

async function apiGuest(req, res) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  if (blocked(`guest|${ip}`, 24)) return send(res, 429, { error: '游客初始化太频繁，请稍后再试' });
  const uname = 'g_' + crypto.randomBytes(5).toString('hex');
  const created = await db('users', {
    method: 'POST', prefer: 'return=representation',
    body: { username: uname, pass_salt: '', pass_hash: '', role: 'guest' },
  });
  const u = created && created[0];
  if (!u) return send(res, 500, { error: '游客初始化失败，请稍后重试' });
  const sess = await makeSession(u.id);
  return send(res, 200, { token: sess.token, user: { id: u.id, username: u.username, role: 'guest' } }, { 'Set-Cookie': authCookie(req, sess.token) });
}

async function apiRegister(req, res, body, user) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  if (blocked(`reg|${ip}`, 8)) return send(res, 429, { error: '尝试太频繁，请稍后再试' });
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const code = String(body.code || '').trim().toUpperCase();
  if (!NAME_OK.test(username)) return send(res, 400, { error: '用户名需 3-24 位，可用中文、字母、数字、下划线' });
  if (password.length < 8) return send(res, 400, { error: '密码至少 8 位，建议字母加数字加符号' });
  if (password.length > 64) return send(res, 400, { error: '密码过长' });

  /* 邀请码选填：填了且有效→ user(全功能，名额+1)；不填→ free(免费档，不占名额) */
  let ic = null;
  let targetRole = 'free';
  if (code) {
    const codes = await db('invite_codes', { query: { select: 'code,max_uses,used,enabled', code: `eq.${code}`, limit: 1 } });
    ic = codes && codes[0];
    if (!ic || !ic.enabled) return send(res, 400, { error: '邀请码无效' });
    if (ic.used >= ic.max_uses) return send(res, 400, { error: '邀请码名额已用完' });
    targetRole = 'user';
  }

  const guestSelf = user && user.role === 'guest';
  const exist = await db('users', { query: { select: 'id', username: `eq.${username}`, limit: 1 } });
  if (exist && exist.length && !(guestSelf && exist[0].id === user.id)) return send(res, 409, { error: '该用户名已被占用' });

  const salt = crypto.randomBytes(16).toString('hex');
  const restore = newCode(6);
  const rSalt = crypto.randomBytes(16).toString('hex');
  let uid, token;
  if (guestSelf) {
    // 就地升级：把匿名账号改名为正式账号，历史数据（同一 owner）原样保留
    const upd = await db('users', {
      method: 'PATCH', prefer: 'return=representation', query: { id: `eq.${user.id}` },
      body: { username, pass_salt: salt, pass_hash: hashPassword(password, salt), restore_hash: hashPassword(restore, rSalt), restore_salt: rSalt, role: targetRole, failed_count: 0, locked_until: null },
    });
    const u2 = upd && upd[0];
    if (!u2) return send(res, 500, { error: '升级失败，请重试' });
    uid = user.id;
    token = readToken(req);
  } else {
    const created = await db('users', {
      method: 'POST', prefer: 'return=representation',
      body: { username, pass_salt: salt, pass_hash: hashPassword(password, salt), restore_hash: hashPassword(restore, rSalt), restore_salt: rSalt, role: targetRole },
    });
    const u2 = created && created[0];
    if (!u2) return send(res, 500, { error: '注册失败，请重试' });
    uid = u2.id;
    const sess = await makeSession(uid);
    token = sess.token;
  }
  if (ic) await db('invite_codes', { method: 'PATCH', query: { code: `eq.${code}` }, body: { used: ic.used + 1 } });

  const imported = [];
  const guest = body.guestData;
  if (guest && typeof guest === 'object') {
    const list = Array.isArray(guest.resumes) ? guest.resumes : [];
    for (const g of list.slice(0, 10)) {
      if (!g || !g.data) continue;
      await db('resumes', {
        method: 'POST',
        body: { owner: uid, name: g.name || '未命名简历', layout: g.layout || 'default', theme: g.theme || {}, data: g.data },
      });
      imported.push(g.name || '未命名简历');
    }
  }
  return send(res, 200, { token, user: { id: uid, username, role: targetRole }, restoreCode: restore, imported }, { 'Set-Cookie': authCookie(req, token) });
}

async function apiLogin(req, res, body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  if (blocked(`login|${ip}|${username}`, 10)) return send(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
  const rows = await db('users', { query: { select: '*', username: `eq.${username}`, limit: 1 } });
  const u = rows && rows[0];
  if (!u) return send(res, 401, { error: '用户名或密码不正确' });
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    return send(res, 423, { error: '账号已临时锁定，请稍候 15 分钟' });
  }
  if (!sameHex(hashPassword(password, u.pass_salt), u.pass_hash)) {
    const n = (u.failed_count || 0) + 1;
    const patch = { failed_count: n };
    if (n >= 8) {
      patch.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      patch.failed_count = 0;
    }
    await db('users', { method: 'PATCH', query: { id: `eq.${u.id}` }, body: patch }).catch(() => {});
    return send(res, 401, { error: '用户名或密码不正确' });
  }
  await db('users', { method: 'PATCH', query: { id: `eq.${u.id}` }, body: { failed_count: 0, locked_until: null } }).catch(() => {});
  const sess = await makeSession(u.id);
  return send(res, 200, { token: sess.token, user: { id: u.id, username: u.username, role: u.role } }, { 'Set-Cookie': authCookie(req, sess.token) });
}

async function apiReset(req, res, body) {
  const username = String(body.username || '').trim();
  const restore = String(body.restoreCode || '').trim().toUpperCase();
  const password = String(body.newPassword || '');
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  if (blocked(`reset|${ip}|${username}`, 6)) return send(res, 429, { error: '尝试次数过多，请稍后再试' });
  if (password.length < 8) return send(res, 400, { error: '新密码至少 8 位' });
  const rows = await db('users', { query: { select: '*', username: `eq.${username}`, limit: 1 } });
  const u = rows && rows[0];
  if (!u || !u.restore_hash) return send(res, 401, { error: '恢复码不正确' });
  if (!sameHex(hashPassword(restore, u.restore_salt || ''), u.restore_hash)) return send(res, 401, { error: '恢复码不正确' });
  const salt = crypto.randomBytes(16).toString('hex');
  const nRestore = newCode(6);
  const rSalt = crypto.randomBytes(16).toString('hex');
  await db('users', {
    method: 'PATCH',
    query: { id: `eq.${u.id}` },
    body: {
      pass_salt: salt,
      pass_hash: hashPassword(password, salt),
      restore_salt: rSalt,
      restore_hash: hashPassword(nRestore, rSalt),
      failed_count: 0,
      locked_until: null,
    },
  });
  await db('sessions', { method: 'DELETE', query: { owner: `eq.${u.id}` } }).catch(() => {});
  return send(res, 200, { ok: true, restoreCode: nRestore, note: '旧登录状态已全部失效，请保存新恢复码' });
}

/* -------------------------------------------------------------- 简历 CRUD */
async function ownResume(req, user, id) {
  const rows = await db('resumes', { query: { select: '*', id: `eq.${id}`, limit: 1 } });
  const r = rows && rows[0];
  if (!r || r.owner !== user.id) return null;
  return r;
}

async function apiResumes(req, res, body, user) {
  if (!user) return send(res, 401, { error: '请先登录' });
  if (await guardResumeLimit(user, res)) return;
  const name = String(body.name || '未命名简历').slice(0, 60);
  const created = await db('resumes', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner: user.id,
      name,
      layout: body.layout || 'default',
      theme: body.theme || {},
      data: body.data || {},
      score: Math.max(0, Math.min(100, Number(body.score) || 0)),
      label: String(body.label || '').slice(0, 30),
    },
  });
  return send(res, 200, { resume: created[0] });
}

async function apiSaveResume(req, res, body, user, id) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const r = await ownResume(req, user, id);
  if (!r) return send(res, 404, { error: '简历不存在或无权限' });
  await snapshot(r, body.snapshot === true ? 'manual' : 'auto');
  const patch = {
    name: body.name !== undefined ? String(body.name).slice(0, 60) : r.name,
    layout: body.layout || r.layout,
    theme: body.theme !== undefined ? body.theme : r.theme,
    data: body.data !== undefined ? body.data : r.data,
    score: body.score !== undefined ? Math.max(0, Math.min(100, Number(body.score) || 0)) : r.score,
    label: body.label !== undefined ? String(body.label).slice(0, 30) : r.label,
    version: r.version + 1,
    updated_at: new Date().toISOString(),
  };
  const out = await db('resumes', { method: 'PATCH', query: { id: `eq.${r.id}` }, prefer: 'return=representation', body: patch });
  return send(res, 200, { resume: out[0], snapshot: !!body.snapshot });
}

/* ------------------------------------------------------- 批量操作 */
async function apiBatch(req, res, body, user) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100).map((x) => String(x).slice(0, 40)) : [];
  if (!ids.length) return send(res, 400, { error: '没有选中任何简历' });
  const op = String(body.op || '');
  const mine = await db('resumes', { query: { select: 'id,name,layout,theme,data,label,score', id: `in.(${ids.join(',')})`, owner: `eq.${user.id}` } });
  if (!mine || !mine.length) return send(res, 403, { error: '选中的简历都不属于当前账号' });
  const done = [];
  const skipped = ids.length - mine.length;

  if (op === 'archive' || op === 'purge') {
    for (const r of mine) {
      if (op === 'purge') {
        await db('resume_versions', { method: 'DELETE', query: { resume_id: `eq.${r.id}` } }).catch(() => {});
        await db('resumes', { method: 'DELETE', query: { id: `eq.${r.id}` } });
      } else {
        await db('resumes', { method: 'PATCH', query: { id: `eq.${r.id}` }, body: { archived: true } });
      }
      done.push(r.id);
    }
    return send(res, 200, { ok: true, done: done.length, skipped, op });
  }
  if (op === 'duplicate') {
    if (isLimited(user)) {
      const n = await resumeCount(user.id);
      if (n + mine.length > FREE_RESUME_LIMIT) return send(res, 402, { error: `免费档最多保存 ${FREE_RESUME_LIMIT} 份简历，填写邀请码解锁不限份数`, needRegister: true, plan: 'guest', resumeLimit: FREE_RESUME_LIMIT });
    }
    for (const r of mine) {
      await db('resumes', {
        method: 'POST',
        body: { owner: user.id, name: `${r.name} 副本`.slice(0, 60), layout: r.layout, theme: r.theme, data: r.data, label: r.label, score: r.score },
      });
      done.push(r.id);
    }
    return send(res, 200, { ok: true, done: done.length, skipped, op });
  }
  if (op === 'label') {
    const label = String(body.label || '').slice(0, 30);
    for (const r of mine) {
      await db('resumes', { method: 'PATCH', query: { id: `eq.${r.id}` }, body: { label } });
      done.push(r.id);
    }
    return send(res, 200, { ok: true, done: done.length, skipped, op, label });
  }
  if (op === 'theme') {
    const patch = body.theme && typeof body.theme === 'object' ? body.theme : null;
    if (!patch) return send(res, 400, { error: '缺少主题内容' });
    for (const r of mine) {
      const theme = { ...(r.theme || {}), ...patch };
      await db('resumes', { method: 'PATCH', query: { id: `eq.${r.id}` }, body: { theme, layout: patch.layout || r.layout, updated_at: new Date().toISOString() } });
      done.push(r.id);
    }
    return send(res, 200, { ok: true, done: done.length, skipped, op });
  }
  return send(res, 400, { error: '不支持的批量操作' });
}

/* ------------------------------------------------------- 导入解析 */
/* 用大模型把简历纯文本结构化成各板块（需已配置豆包/通义千问密钥） */
async function aiStructureResume(text) {
  const t = String(text).slice(0, 12000);
  const prompt = `你是简历信息抽取引擎。把下面的简历纯文本解析成结构化 JSON，严格只返回 JSON、不要任何多余文字。字段结构：
{"base":{"name":"","intent":"","city":"","phone":"","email":"","wechat":"","qq":"","marital":"","eduLevel":"","birth":"YYYY-MM","years":"","site":"","nation":"","polity":"","home":"","salary":"","available":"","license":""},
"education":[{"school":"","major":"","degree":"","start":"YYYY-MM","end":"YYYY-MM","note":""}],
"work":[{"company":"","role":"","start":"YYYY-MM","end":"YYYY-MM","bullets":[""]}],
"projects":[{"name":"","role":"","start":"YYYY-MM","end":"YYYY-MM","desc":""}],
"campus":[{"name":"","role":"","start":"YYYY-MM","end":"YYYY-MM","desc":""}],
"skills":[{"name":"","level":60}],
"skillTags":[""],
"certs":[{"name":"","date":"YYYY-MM-DD"}],
"awards":[""],
"summary":"","hobbies":""}
规则：
1) 日期一律 YYYY-MM 或 YYYY-MM-DD；简历里没有的日期就留空字符串，绝不编造，也不要因为缺日期就丢掉这一条目。
2) 只要有学校名或专业就放进 education；有公司名或职位就放进 work；有名称就放进 projects——即使没有起止时间也要保留该条目。
3) 「校园经历/学校经历/学生会/社团/志愿服务/社会实践」这类在校期间的组织或活动经历（没有公司主体、不属于某个具体项目作品）归入 campus（name=组织或活动名，role=担任角色/职务，desc=主要职责与成果）。真正的项目/课题/作品集才归入 projects。
4) work 的 bullets 放该段工作的每条职责/成果要点；summary 放自我评价；hobbies 用顿号分隔的兴趣/特长。
5) 不确定的字段留空字符串或空数组。文本如下：\n${t}`;
  const o = await llmJSON(prompt);
  if (!o || typeof o !== 'object') return null;
  const arr = (x) => Array.isArray(x) ? x : [];
  const b = o.base || {};
  const base = {};
  for (const k of ['name','intent','city','phone','email','birth','years','site','photo','nation','polity','home','build','salary','available','license','wechat','qq','marital','eduLevel']) base[k] = String(b[k] || '');
  const education = arr(o.education).map((e) => ({ school: String(e.school || ''), major: String(e.major || ''), degree: String(e.degree || ''), start: String(e.start || ''), end: String(e.end || ''), note: String(e.note || '') })).filter((e) => e.school || e.major || e.degree);
  const work = arr(o.work).map((w) => ({ company: String(w.company || ''), role: String(w.role || ''), start: String(w.start || ''), end: String(w.end || ''), bullets: arr(w.bullets).map(String).filter(Boolean) })).filter((w) => w.company || w.role);
  const projects = arr(o.projects).map((p) => ({ name: String(p.name || ''), role: String(p.role || ''), start: String(p.start || ''), end: String(p.end || ''), desc: String(p.desc || '') })).filter((p) => p.name || p.role);
  const campus = arr(o.campus).map((c) => ({ name: String(c.name || ''), role: String(c.role || ''), start: String(c.start || ''), end: String(c.end || ''), desc: String(c.desc || '') })).filter((c) => c.name || c.role);
  const skills = arr(o.skills).map((s) => ({ name: String(s.name || ''), level: Math.max(0, Math.min(100, Number(s.level) || 60)) })).filter((s) => s.name);
  const skillTags = arr(o.skillTags).map(String).filter(Boolean);
  const certs = arr(o.certs).map((c) => ({ name: String(c.name || ''), date: String(c.date || ''), org: String(c.org || '') })).filter((c) => c.name);
  const awards = arr(o.awards).map(String).filter(Boolean);
  const summary = String(o.summary || '');
  const hobbies = String(o.hobbies || '');
  const hasAny = base.name || base.intent || education.length || work.length || projects.length || campus.length || skills.length || skillTags.length || certs.length || summary || hobbies;
  if (!hasAny) return null;
  return { data: { base, extra: [], education, work, projects, campus, skills, skillTags, certs, awards, summary, hobbies, lang: 'zh' }, notes: ['AI 已识别并归类，请核对各板块'] };
}
async function apiImportParse(req, res, body) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  if (blocked(`import|${ip}`, 30)) return send(res, 429, { error: '导入太频繁，请稍后再试' });
  try {
    let text = String(body.text || '');
    let kind = 'text';
    if (body.fileBase64) {
      const buf = Buffer.from(String(body.fileBase64).replace(/^data:[^;]*;base64,/, ''), 'base64');
      if (buf.length > 6 * 1024 * 1024) return send(res, 400, { error: '文件超过 6MB' });
      const fn = String(body.filename || '').toLowerCase();
      if (fn.endsWith('.json')) {
        const j = JSON.parse(buf.toString('utf8'));
        return send(res, 200, { kind: 'json', resumes: Array.isArray(j.resumes) ? j.resumes : [], notes: ['备份文件，走导入而非解析'] });
      }
      if (fn.endsWith('.docx')) { text = docxToText(buf); kind = 'docx'; }
      else if (fn.endsWith('.pdf')) { const pt = await extractPdfText(buf); if (!pt || pt.length < 20) return send(res, 400, { error: '这个 PDF 像是扫描件或提取不到文字，请改用「粘贴文本」' }); text = pt; kind = 'pdf'; }
      else text = buf.toString('utf8');
    }
    if (!text.trim()) return send(res, 400, { error: '没有可解析的文字内容' });
    if ((ARK_KEY || DASHSCOPE_KEY) && body.useAI !== false) {
      const ai = await aiStructureResume(text);
      if (ai) return send(res, 200, { kind, data: ai.data, notes: ai.notes, chars: text.length, source: 'ai' });
    }
    const parsed = parseResumeText(text.slice(0, 40000));
    return send(res, 200, { kind, data: parsed.data, notes: parsed.notes, chars: text.length });
  } catch (e) {
    return send(res, 400, { error: '解析失败：' + (e.message || '格式不支持') });
  }
}

async function apiDuplicate(req, res, user, id) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const r = await ownResume(req, user, id);
  if (!r) return send(res, 404, { error: '简历不存在或无权限' });
  if (await guardResumeLimit(user, res)) return;
  const out = await db('resumes', {
    method: 'POST',
    prefer: 'return=representation',
    body: { owner: user.id, name: `${r.name} 副本`.slice(0, 60), layout: r.layout, theme: r.theme, data: r.data },
  });
  return send(res, 200, { resume: out[0] });
}

async function apiRestore(req, res, body, user, id) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const r = await ownResume(req, user, id);
  if (!r) return send(res, 404, { error: '简历不存在或无权限' });
  const version = Number(body.version || 0);
  const vs = await db('resume_versions', {
    query: { select: '*', resume_id: `eq.${r.id}`, version: `eq.${version}`, limit: 1 },
  });
  const v = vs && vs[0];
  if (!v) return send(res, 404, { error: '该版本不存在' });
  await snapshot(r, 'manual');
  const out = await db('resumes', {
    method: 'PATCH',
    query: { id: `eq.${r.id}` },
    prefer: 'return=representation',
    body: { data: v.data, layout: v.layout || r.layout, theme: v.theme || r.theme, version: r.version + 1, updated_at: new Date().toISOString() },
  });
  return send(res, 200, { resume: out[0] });
}

async function apiArchiveResume(req, res, user, id, purge) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const r = await ownResume(req, user, id);
  if (!r) return send(res, 404, { error: '简历不存在或无权限' });
  if (purge === 'yes') {
    await db('resume_versions', { method: 'DELETE', query: { resume_id: `eq.${r.id}` } });
    await db('resumes', { method: 'DELETE', query: { id: `eq.${r.id}` } });
    return send(res, 200, { ok: true, purged: true });
  }
  await db('resumes', { method: 'PATCH', query: { id: `eq.${r.id}` }, body: { archived: true } });
  return send(res, 200, { ok: true });
}

/* ------------------------------------------------------------- 投递跟踪 */
async function apiApplications(req, res, body, user, id) {
  if (!user) return send(res, 401, { error: '请先登录' });
  if (req.method === 'DELETE') {
    await db('applications', { method: 'DELETE', query: { id: `eq.${id}`, owner: `eq.${user.id}` } });
    return send(res, 200, { ok: true });
  }
  const row = {
    owner: user.id,
    resume_id: body.resume_id || null,
    company: String(body.company || '').slice(0, 60),
    position: String(body.position || '').slice(0, 60) || null,
    channel: String(body.channel || '').slice(0, 30) || null,
    applied_on: /^\d{4}-\d{2}-\d{2}$/.test(body.applied_on || '') ? body.applied_on : null,
    status: String(body.status || '已投递').slice(0, 20),
    note: String(body.note || '').slice(0, 500) || null,
    updated_at: new Date().toISOString(),
  };
  if (id) {
    const own = await db('applications', { query: { select: 'id', id: `eq.${id}`, owner: `eq.${user.id}`, limit: 1 } });
    if (!own || !own.length) return send(res, 404, { error: '记录不存在或无权限' });
    const out = await db('applications', { method: 'PATCH', query: { id: `eq.${id}` }, prefer: 'return=representation', body: row });
    return send(res, 200, { item: out[0] });
  }
  const out = await db('applications', { method: 'POST', prefer: 'return=representation', body: row });
  return send(res, 200, { item: out[0] });
}

/* ------------------------------------------------------------- 在线分享链接 */
async function apiShareCreate(req, res, body, user) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const r = await ownResume(req, user, String(body.resumeId || ''));
  if (!r) return send(res, 404, { error: '简历不存在或无权限' });
  const code = newCode(5);
  const password = String(body.password || '');
  let pass_salt = null, pass_hash = null;
  if (password) { pass_salt = crypto.randomBytes(16).toString('hex'); pass_hash = hashPassword(password, pass_salt); }
  const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
  const expires_at = days > 0 ? new Date(Date.now() + days * 86400 * 1000).toISOString() : null;
  await db('shares', { method: 'POST', body: { code, owner: user.id, resume_id: r.id, pass_salt, pass_hash, expires_at } });
  return send(res, 200, { code });
}
async function apiShareMine(req, res, user) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const rows = await db('shares', { query: { select: 'code,pass_hash,expires_at,created_at', owner: `eq.${user.id}`, order: 'created_at.desc', limit: 200 } });
  const items = (rows || []).map((s) => ({ code: s.code, need_pass: !!s.pass_hash, expires: s.expires_at }));
  return send(res, 200, { items });
}
async function apiShareRevoke(req, res, body, user) {
  if (!user) return send(res, 401, { error: '请先登录' });
  const code = String(body.code || '');
  await db('shares', { method: 'DELETE', query: { code: `eq.${code}`, owner: `eq.${user.id}` } });
  return send(res, 200, { ok: true });
}
async function apiShareView(req, res, url) {
  const code = String(url.searchParams.get('code') || '');
  const pass = String(url.searchParams.get('pass') || '');
  if (!code) return send(res, 404, { error: '链接无效' });
  const rows = await db('shares', { query: { select: '*', code: `eq.${code}`, limit: 1 } });
  const s = rows && rows[0];
  if (!s) return send(res, 404, { error: '链接无效或已失效' });
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return send(res, 404, { error: '链接已过期' });
  if (s.pass_hash) {
    if (!pass || !sameHex(hashPassword(pass, s.pass_salt || ''), s.pass_hash)) return send(res, 401, { error: 'needpass' });
  }
  const rs = await db('resumes', { query: { select: 'name,layout,theme,data', id: `eq.${s.resume_id}`, limit: 1 } });
  const r = rs && rs[0];
  if (!r) return send(res, 404, { error: '简历不存在或已删除' });
  return send(res, 200, { name: r.name, layout: r.layout, theme: r.theme, data: r.data });
}

/* ------------------------------------------------------------- AI 写作助手 */
async function glossFor(profession) {
  if (!profession) return [];
  const rows = await db('tpl_glossary', { query: { select: 'kind,text,weight', profession: `eq.${profession}`, order: 'weight.desc', limit: 40 } });
  return rows || [];
}
function ruleAdvice(field, text) {
  const advice = [];
  const t = String(text || '').trim();
  if (!t) return advice;
  if (t.length < 15) advice.push({ tag: '太简短', msg: '这条太短，建议写清「做了什么 → 怎么做 → 结果」，至少 20 字。', sev: 'warn' });
  if (!/[0-9０-９%％]/.test(t)) advice.push({ tag: '缺量化', msg: '没有数字。加上规模/百分比/时长/金额更有说服力，如「提升 12%」。', sev: 'warn' });
  if (/负责|参与|协助|配合|完成|相关|一些|大量/.test(t)) advice.push({ tag: '偏笼统', msg: '用了「负责/参与」等泛词，换成动词开头的具体成果句更好。', sev: '' });
  if (t.length > 200) advice.push({ tag: '偏长', msg: '单条超过 200 字，建议拆成 2-3 条要点。', sev: '' });
  return advice;
}
function llmLabel() { return ARK_KEY ? '豆包 · 真 AI' : (DASHSCOPE_KEY ? '通义千问 · 真 AI' : ''); }
/* 统一大模型入口：优先豆包(火山方舟)，其次通义千问；返回解析后的 JSON 对象，失败返回 null */
async function llmJSON(prompt) {
  const calls = [];
  // 豆包 Seed 系列默认开启思维链，跨境调用耗时翻倍易超时；对 seed 模型显式关闭 thinking，直接出结果。
  const arkExtra = /seed/i.test(ARK_MODEL) ? { thinking: { type: 'disabled' } } : {};
  if (ARK_KEY) calls.push({ url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', key: ARK_KEY, model: ARK_MODEL, extra: arkExtra });
  if (DASHSCOPE_KEY) calls.push({ url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', key: DASHSCOPE_KEY, model: 'qwen-plus', extra: { response_format: { type: 'json_object' } } });
  for (const c of calls) {
    try {
      const r = await fetch(c.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
        body: JSON.stringify(Object.assign({ model: c.model, temperature: 0.6, messages: [{ role: 'user', content: prompt }] }, c.extra)),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      const m = String(raw).match(/\{[\s\S]*\}/);
      let o = {}; try { o = JSON.parse(m ? m[0] : (raw || '{}')); } catch { o = {}; }
      if (o && Object.keys(o).length) return o;
    } catch (e) { /* 试下一个 provider */ }
  }
  return null;
}
const FIELD_LABEL = { summary: '自我评价', hobbies: '兴趣爱好', note: '主修课程/成绩', desc: '项目说明', campus: '校园经历', bullet: '工作要点', tags: '技能标签', intent: '求职意向' };
/* 各板块的结构化填写范式（按板块 + 就业方向差异化） */
const FILL_HINT = {
  summary: '结构：从业年限/专业背景 → 2-3 项与岗位对齐的核心能力 → 一项代表性量化成果 → 求职动机。',
  desc: '结构：项目背景/难点 → 你负责的动作 → 可量化结果。',
  campus: '结构：组织或活动名称及你的角色 → 主要职责 → 一项成果或锻炼收获（参与人数 / 筹集金额 / 获奖等，尽量量化）。',
  hobbies: '只挑与岗位气质、团队协作或自律相关的兴趣，点到为止，不要堆砌。',
  bullet: '每条以动词开头，落到一个可量化结果（负责什么 → 怎么做 → 数字结果）。',
  tags: '给 6-10 个与该岗位 JD 对齐的可检索硬技能关键词。',
  intent: '写清目标岗位与方向，具体到岗职能，不要写泛词。',
};
/* 各板块的具体范例（供模型参照结构、并在无词库时作为规则兜底内容）——校园经历与项目经历刻意给不同示例 */
const FILL_EXAMPLE = {
  campus: '例：任院学生会外联部部长，统筹 3 场校园招聘，对接 20+ 家企业，筹集赞助 5 万元、覆盖 2000+ 人次，团队获“优秀社团”。',
  desc: '例：面向户外家具新品开发，主导某品类结构方案与公差设计，累计出图 120+ 张，样件一次通过率提升 30%、单件降本 8%。',
  summary: '例：结构工程本科，2 年户外家具结构设计经验，熟悉 GD&T 与注塑/钣金工艺，可独立负责从打样到量产，习惯用数据衡量改善。',
  hobbies: '例：篮球（院队成员）、半程马拉松完赛、风光摄影——体现自律与团队协作。',
  bullet: '例：负责某品类的结构方案与图纸输出，打样轮次平均减少 40%。',
  tags: '例：SolidWorks、AutoCAD、GD&T、公差分析、DFMEA、钣金/注塑工艺。',
};
function aiPrompt(mode, field, text, gloss, roleTitle) {
  const g = gloss.slice(0, 8).map((x) => x.text).join('\n');
  const fl = FIELD_LABEL[field] || field;
  const hint = FILL_HINT[field] || '';
  const ex = FILL_EXAMPLE[field] ? `参考范例（数字请替换为真实）：${FILL_EXAMPLE[field]}。` : '';
  const pos = roleTitle ? `面向「${roleTitle}」岗位` : '结合求职意向';
  if (mode === 'polish') return `你是中文简历助手。${pos}，请把下面这段润色得更专业、量化、简洁。只返回 JSON {"text":"润色结果"}：\n${text}`;
  if (mode === 'expand') return `你是中文简历助手，${pos}，字段【${fl}】。${hint} ${ex} 该字段为空，给 4-6 条可参考写法要点，动词开头、尽量量化。只返回 JSON {"suggestions":["..."]}。同类句式参考：\n${g}`;
  if (mode === 'guide') return `你是简历顾问。目标岗位「${roleTitle || '未指定'}」。给该岗位简历的填写思路。只返回 JSON {"advice":[{"tag":"岗位重点|建议技能|量化建议|常见误区","msg":"...","sev":"warn或空"}],"suggestions":["成果句式"]}。4-6 条 advice、5-8 条 suggestions。`;
  if (mode === 'workgen') return `你是简历顾问。为「${roleTitle || '该岗位'}」生成 4-5 条工作经历要点：动词开头、含量化结果、通用可套用。只返回 JSON {"bullets":["...","..."]}。`;
  if (mode === 'fill') return `你是中文简历助手。请为求职者撰写【${fl}】这段完整内容，${pos}。${hint} ${ex} 贴合实际、尽量可量化、直接可用（3-5 句/条）。只返回 JSON {"text":"内容"}。同类句式参考：\n${g}`;
  return `你是中文简历助手。字段「${fl}」，${pos}。请检查并给建议。只返回 JSON {"advice":[{"tag":"","msg":"","sev":"warn或空"}],"suggestions":["参考句式"]}。当前内容：\n${text}\n同类句式参考：\n${g}`;
}
async function apiAiRun(req, res, body) {
  const mode = ['check', 'expand', 'polish', 'guide', 'workgen', 'fill'].includes(body.mode) ? body.mode : 'check';
  const field = String(body.field || 'text').slice(0, 40);
  const text = String(body.text || '').slice(0, 4000);
  const profession = String(body.profession || '').slice(0, 60);
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  if (blocked(`ai|${ip}`, 60)) return send(res, 429, { error: 'AI 调用太频繁，请稍后再试' });
  const gloss = await glossFor(profession);
  const suggestions = gloss.slice(0, 6).map((g) => g.text);
  const tpls = (await templates()).templates;
  const it = String(body.intent || profession || '');
  const tpl = tpls.find((t) => t.slug === profession)
    || tpls.find((t) => profession && t.title && (profession.indexOf(t.title) >= 0 || t.title.indexOf(profession) >= 0))
    || tpls.find((t) => t.title && it && it.indexOf(t.title.slice(0, 3)) >= 0);
  const roleTitle = (tpl && tpl.title) || it || String(body.role || '') || '';
  const glossRows = tpl ? await glossFor(tpl.slug) : gloss;
  const sugs = (glossRows.length ? glossRows : gloss).slice(0, 8).map((g) => g.text);

  const o = await llmJSON(aiPrompt(mode, field, text, glossRows, roleTitle));
  if (o) {
    const provider = llmLabel();
    if (mode === 'workgen') { const bl = Array.isArray(o.bullets) ? o.bullets.map(String).filter(Boolean).slice(0, 6) : []; if (bl.length) return send(res, 200, { source: 'llm', provider, text: '', bullets: bl, suggestions: [], advice: [] }); }
    else if (mode === 'guide') return send(res, 200, { source: 'llm', provider, text: '', suggestions: Array.isArray(o.suggestions) ? o.suggestions.slice(0, 8).map(String) : sugs, advice: Array.isArray(o.advice) ? o.advice.map((a) => ({ tag: String((a && a.tag) || '建议'), msg: String((a && a.msg) || ''), sev: a && a.sev === 'warn' ? 'warn' : '' })) : [] });
    else if (mode === 'fill') return send(res, 200, { source: 'llm', provider, text: String(o.text || ''), suggestions: [], advice: [] });
    else return send(res, 200, { source: 'llm', provider, text: mode === 'polish' ? String(o.text || '') : '', suggestions: Array.isArray(o.suggestions) ? o.suggestions.slice(0, 6).map(String) : suggestions, advice: Array.isArray(o.advice) ? o.advice.map((a) => ({ tag: String((a && a.tag) || '建议'), msg: String((a && a.msg) || ''), sev: a && a.sev === 'warn' ? 'warn' : '' })) : ruleAdvice(field, text) });
  }

  if (mode === 'guide') { const advice = []; if (tpl && tpl.summary) advice.push({ tag: '岗位重点', msg: tpl.summary, sev: '' }); const secs = Array.isArray(tpl && tpl.sections) ? tpl.sections : []; if (secs.length) advice.push({ tag: '建议板块', msg: secs.map((s) => (typeof s === 'string' ? s : (s.title || s.name || ''))).filter(Boolean).join('、'), sev: '' }); advice.push({ tag: '量化建议', msg: '用数字说话：负责品类数、图纸/样件量、降本%、提效工时、项目规模与你的角色。', sev: '' }); advice.push({ tag: '常见误区', msg: '别写「负责/参与」等泛词，改成动词开头的成果句；技能要与岗位 JD 对齐。', sev: 'warn' }); return send(res, 200, { source: 'rule', text: '', suggestions: sugs, advice }); }
  if (mode === 'workgen') { const fromGloss = (glossRows.length ? glossRows : gloss).slice(0, 5).map((g) => g.text).filter(Boolean); const generic = [`负责${roleTitle || '该岗位'}相关核心模块的方案设计与落地，把控进度与交付质量。`, '主导关键指标优化，通过数据分析定位瓶颈并推动改进，达成可量化成果。', '协同跨部门资源推进项目，沉淀标准化流程与文档，提升团队整体效率。', `跟进${roleTitle || '本'}行业动态与最佳实践，持续迭代方法与工具。`]; const bullets = (fromGloss.length >= 3 ? fromGloss : fromGloss.concat(generic)).slice(0, 5); return send(res, 200, { source: 'rule', text: '', bullets, suggestions: [], advice: [] }); }
  if (mode === 'fill') { const sen = glossRows.map((g) => g.text).filter(Boolean); let out = ''; if (field === 'summary') out = ((tpl && tpl.summary) ? tpl.summary + ' ' : '') + sen.slice(0, 2).join('；') + (sen.length ? '。' : ''); else if (field === 'tags') out = sen.slice(0, 8).join('、'); else out = sen.slice(0, 3).join('\n'); if (!out.trim()) out = FILL_EXAMPLE[field] || ''; return send(res, 200, { source: 'rule', text: out, suggestions: [], advice: [] }); }
  return send(res, 200, { source: 'rule', text: '', suggestions, advice: ruleAdvice(field, text) });
}

/* ------------------------------------------------------------- 站长后台 */
const ADMIN = makeAdmin({ db, hashPassword, send, templatesCacheBreak });

/* ------------------------------------------------------------------ 路由 */
async function handleApi(req, res, url, user) {
  const p = url.pathname;
  const q = url.searchParams;
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);

  if (p.startsWith('/api/admin/')) {
    if (!user) return send(res, 401, { error: '请先登录站长账号' });
    if (user.role !== 'admin') return send(res, 403, { error: '当前账号无后台权限' });
    return ADMIN.route(req, res, url, body, user);
  }

  if (p === '/api/bootstrap' && req.method === 'GET') {
    const t = await templates();
    const plan = planOf(user);
    let exportLeft = null;
    if (isLimited(user)) exportLeft = Math.max(0, GUEST_EXPORT_LIMIT - (await guestExportCount(user.id)));
    return send(res, 200, {
      me: user ? { id: user.id, username: user.username, role: user.role } : null,
      plan,
      guestExportLimit: GUEST_EXPORT_LIMIT,
      exportLeft,
      templates: t.templates.map((x) => ({
        slug: x.slug, title: x.title, industry: x.industry, summary: x.summary, sort: x.sort,
      })),
      meta: t.meta,
      counts: { templates: t.templates.length },
    });
  }
  if (p === '/api/templates' && req.method === 'GET') return send(res, 200, await templates());
  if (p === '/api/me') {
    if (req.method === 'GET') return user ? send(res, 200, { user }) : send(res, 401, { error: '未登录' });
    if (req.method === 'POST') {
      const gone = readToken(req);
      sessionCache.delete(gone);
      await db('sessions', { method: 'DELETE', query: { token: `eq.${gone}` } }).catch(() => {});
      return send(res, 200, { ok: true }, { 'Set-Cookie': CLEAR_COOKIE() });
    }
  }
  if (p === '/api/guest' && req.method === 'POST') return apiGuest(req, res);
  if (p === '/api/register' && req.method === 'POST') return apiRegister(req, res, body, user);
  if (p === '/api/login' && req.method === 'POST') return apiLogin(req, res, body);
  if (p === '/api/reset' && req.method === 'POST') return apiReset(req, res, body);

  if (p === '/api/resumes' && req.method === 'GET') {
    if (!user) return send(res, 401, { error: '请先登录' });
    const rows = await db('resumes', {
      query: {
        select: 'id,name,layout,version,label,score,archived,created_at,updated_at',
        owner: `eq.${user.id}`,
        archived: 'eq.false',
        order: 'updated_at.desc',
        limit: 200,
      },
    });
    return send(res, 200, { resumes: rows || [] });
  }
  if (p === '/api/resumes' && req.method === 'POST') return apiResumes(req, res, body, user);
  if (p === '/api/resumes/batch' && req.method === 'POST') return apiBatch(req, res, body, user);
  if (p === '/api/import/parse' && req.method === 'POST') return apiImportParse(req, res, body);

  const mResume = p.match(/^\/api\/resumes\/([\w-]+)$/);
  if (mResume) {
    const id = mResume[1];
    if (req.method === 'GET') {
      if (!user) return send(res, 401, { error: '请先登录' });
      const r = await ownResume(req, user, id);
      return r ? send(res, 200, { resume: r }) : send(res, 404, { error: '简历不存在或无权限' });
    }
    if (req.method === 'PATCH') return apiSaveResume(req, res, body, user, id);
    if (req.method === 'DELETE') return apiArchiveResume(req, res, user, id, q.get('purge'));
  }
  const mDup = p.match(/^\/api\/resumes\/([\w-]+)\/(duplicate|restore)$/);
  if (mDup && req.method === 'POST') {
    if (mDup[2] === 'restore' && isLimited(user)) return send(res, 403, { error: '版本回滚需填写邀请码解锁', needRegister: true });
    return mDup[2] === 'duplicate' ? apiDuplicate(req, res, user, mDup[1]) : apiRestore(req, res, body, user, mDup[1]);
  }
  const mVer = p.match(/^\/api\/resumes\/([\w-]+)\/versions$/);
  if (mVer && req.method === 'GET') {
    if (!user) return send(res, 401, { error: '请先登录' });
    if (isLimited(user)) return send(res, 403, { error: '版本历史需填写邀请码解锁', needRegister: true });
    const r = await ownResume(req, user, mVer[1]);
    if (!r) return send(res, 404, { error: '简历不存在或无权限' });
    const rows = await db('resume_versions', {
      query: { select: 'id,version,created_at', resume_id: `eq.${r.id}`, order: 'version.desc', limit: 21 },
    });
    return send(res, 200, { versions: rows || [] });
  }

  if (p === '/api/applications') {
    if (req.method === 'GET') {
      if (!user) return send(res, 401, { error: '请先登录' });
      const rows = await db('applications', {
        query: { select: '*', owner: `eq.${user.id}`, order: 'updated_at.desc', limit: 300 },
      });
      return send(res, 200, { items: rows || [] });
    }
    if (req.method === 'POST') return apiApplications(req, res, body, user, null);
  }
  const mApp = p.match(/^\/api\/applications\/([\w-]+)$/);
  if (mApp) return apiApplications(req, res, body, user, mApp[1]);

  if (p === '/api/export/docx' && req.method === 'POST') {
    let exportLeft = null;
    if (isLimited(user)) {
      const used = await guestExportCount(user.id);
      if (used >= GUEST_EXPORT_LIMIT) return send(res, 402, { error: '导出次数已用完，填写邀请码解锁后可不限次数导出', needRegister: true, plan: 'guest', exportLimit: GUEST_EXPORT_LIMIT });
      await setGuestExportCount(user.id, used + 1);
      exportLeft = Math.max(0, GUEST_EXPORT_LIMIT - (used + 1));
    }
    const doc = body.resume || {};
    const buf = buildDocx({ name: doc.name, theme: doc.theme || {}, data: doc.data || {} });
    const fname = encodeURIComponent(`${doc.name || '简历'}.docx`);
    const headers = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="resume.docx"; filename*=UTF-8''${fname}`,
    };
    if (exportLeft != null) headers['X-Export-Left'] = String(exportLeft);
    return send(res, 200, buf, headers);
  }

  if (p === '/api/share' && req.method === 'POST') { if (isLimited(user)) return send(res, 403, { error: '在线分享需填写邀请码解锁', needRegister: true }); return apiShareCreate(req, res, body, user); }
  if (p === '/api/share/mine' && req.method === 'GET') { if (isLimited(user)) return send(res, 403, { error: '在线分享需填写邀请码解锁', needRegister: true }); return apiShareMine(req, res, user); }
  if (p === '/api/share/revoke' && req.method === 'POST') { if (isLimited(user)) return send(res, 403, { error: '在线分享需填写邀请码解锁', needRegister: true }); return apiShareRevoke(req, res, body, user); }
  if (p === '/api/share/view' && req.method === 'GET') return apiShareView(req, res, url);
  if (p === '/api/ai/run' && req.method === 'POST') return apiAiRun(req, res, body);

  return send(res, 404, { error: 'no such api' });
}

/* 统一的请求处理入口。
 * - 本地 `node server.js`：由下方 createServer(handleRequest) 调用。
 * - Vercel / serverless：由 api/[...path].js 直接 import 并作为函数 handler 导出。
 * 注意：serverless 环境里没有常驻进程，本文件里的内存缓存（sessionCache / throttle /
 * tplCache / snapAt）会在冷启动时重置；登录鉴权仍以数据库为准，功能正确，只是限流
 * 计数变成“每实例”，属可接受的弱化。 */
export async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  /* ② 自愈补发 cookie：老会话只有 Authorization: Bearer、浏览器里还没有 rw_sess cookie 时，
     借这次已认证的请求把 cookie 下发出去。否则前端清掉 localStorage 副本后，
     用户下次刷新就既无本地 token 也无 cookie —— 会被当成游客（线上实测踩过这个坑）。 */
  const authHdr = String(req.headers.authorization || '');
  if (authHdr.startsWith('Bearer ') && !cookieToken(req)) {
    const bearer = authHdr.slice(7).trim();
    if (bearer.length >= 20) {
      try { res.setHeader('Set-Cookie', authCookie(req, bearer)); } catch (e) { /* 响应已发出则跳过 */ }
    }
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      const user = await currentUser(req);
      return await handleApi(req, res, url, user);
    }
    return await serveStatic(url.pathname, res);
  } catch (e) {
    console.error('[resume-workshop]', e.message);
    if (res.headersSent) return res.end();
    return send(res, e.status || 500, { error: e.message || 'server error' });
  }
}

/* 仅在被「直接运行」时才起监听；被 serverless 运行时 import 时不监听、不占端口。 */
const isDirectRun = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  createServer(handleRequest).listen(PORT, HOST, () => {
    console.log(`简历工坊 listening on ${HOST}:${PORT}, db=${SB ? 'ready' : 'MISSING'}`);
  });
}
