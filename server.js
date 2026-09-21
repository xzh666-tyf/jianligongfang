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
import { parseResumeText, docxToText } from './lib/parse.js';
import { makeAdmin } from './lib/admin.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '0.0.0.0';

const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
const DASHSCOPE_KEY = (process.env.DASHSCOPE_API_KEY || '').trim();
const ARK_KEY = (process.env.ARK_API_KEY || '').trim();
const ARK_MODEL = (process.env.ARK_MODEL || 'doubao-pro-32k').trim();
const SESSION_DAYS = 30;
const MAX_BODY = 10 * 1024 * 1024;

/* ------------------------------------------------------------------ 数据访问 */
async function db(path, { method = 'GET', query = {}, body, prefer } = {}) {
  const url = new URL(`${SB}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
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
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
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

/* ------------------------------------------------------------------ 工具 */
function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(buf);
}
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

async function apiRegister(req, res, body) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  if (blocked(`reg|${ip}`, 8)) return send(res, 429, { error: '尝试太频繁，请稍后再试' });
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const code = String(body.code || '').trim().toUpperCase();
  if (!NAME_OK.test(username)) return send(res, 400, { error: '用户名需 3-24 位，可用中文、字母、数字、下划线' });
  if (password.length < 8) return send(res, 400, { error: '密码至少 8 位，建议字母加数字加符号' });
  if (password.length > 64) return send(res, 400, { error: '密码过长' });
  if (!code) return send(res, 400, { error: '需要邀请码' });

  const codes = await db('invite_codes', { query: { select: 'code,max_uses,used,enabled', code: `eq.${code}`, limit: 1 } });
  const ic = codes && codes[0];
  if (!ic || !ic.enabled) return send(res, 400, { error: '邀请码无效' });
  if (ic.used >= ic.max_uses) return send(res, 400, { error: '邀请码名额已用完' });

  const exist = await db('users', { query: { select: 'id', username: `eq.${username}`, limit: 1 } });
  if (exist && exist.length) return send(res, 409, { error: '该用户名已被占用' });

  const salt = crypto.randomBytes(16).toString('hex');
  const restore = newCode(6);
  const rSalt = crypto.randomBytes(16).toString('hex');
  const created = await db('users', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      username,
      pass_salt: salt,
      pass_hash: hashPassword(password, salt),
      restore_hash: hashPassword(restore, rSalt),
      restore_salt: rSalt,
    },
  });
  const user = created && created[0];
  if (!user) return send(res, 500, { error: '注册失败，请重试' });
  await db('invite_codes', { method: 'PATCH', query: { code: `eq.${code}` }, body: { used: ic.used + 1 } });
  const sess = await makeSession(user.id);

  const imported = [];
  const guest = body.guestData;
  if (guest && typeof guest === 'object') {
    const list = Array.isArray(guest.resumes) ? guest.resumes : [];
    for (const g of list.slice(0, 10)) {
      if (!g || !g.data) continue;
      await db('resumes', {
        method: 'POST',
        body: { owner: user.id, name: g.name || '未命名简历', layout: g.layout || 'default', theme: g.theme || {}, data: g.data },
      });
      imported.push(g.name || '未命名简历');
    }
  }
  return send(res, 200, {
    token: sess.token,
    user: { id: user.id, username: user.username, role: user.role },
    restoreCode: restore,
    imported,
  });
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
  return send(res, 200, { token: sess.token, user: { id: u.id, username: u.username, role: u.role } });
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
      else if (fn.endsWith('.pdf')) return send(res, 400, { error: 'PDF 请在电脑里全选文字复制，再用「粘贴文本」导入' });
      else text = buf.toString('utf8');
    }
    if (!text.trim()) return send(res, 400, { error: '没有可解析的文字内容' });
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
  if (ARK_KEY) calls.push({ url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', key: ARK_KEY, model: ARK_MODEL, extra: {} });
  if (DASHSCOPE_KEY) calls.push({ url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', key: DASHSCOPE_KEY, model: 'qwen-plus', extra: { response_format: { type: 'json_object' } } });
  for (const c of calls) {
    try {
      const r = await fetch(c.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
        body: JSON.stringify(Object.assign({ model: c.model, temperature: 0.6, messages: [{ role: 'user', content: prompt }] }, c.extra)),
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
const FIELD_LABEL = { summary: '自我评价', note: '主修课程/成绩', desc: '项目说明', bullet: '工作要点', tags: '技能标签', intent: '求职意向' };
function aiPrompt(mode, field, text, gloss, roleTitle) {
  const g = gloss.slice(0, 8).map((x) => x.text).join('\n');
  const fl = FIELD_LABEL[field] || field;
  if (mode === 'polish') return `你是中文简历助手。请把下面这段润色得更专业、量化、简洁。只返回 JSON {"text":"润色结果"}：\n${text}`;
  if (mode === 'expand') return `你是中文简历助手，岗位「${roleTitle || fl}」。该字段为空，给 4-6 条可参考写法要点。只返回 JSON {"suggestions":["..."]}。同类句式参考：\n${g}`;
  if (mode === 'guide') return `你是简历顾问。目标岗位「${roleTitle || '未指定'}」。给该岗位简历的填写思路。只返回 JSON {"advice":[{"tag":"岗位重点|建议技能|量化建议|常见误区","msg":"...","sev":"warn或空"}],"suggestions":["成果句式"]}。4-6 条 advice、5-8 条 suggestions。`;
  if (mode === 'workgen') return `你是简历顾问。为「${roleTitle || '该岗位'}」生成 4-5 条工作经历要点：动词开头、含量化结果、通用可套用。只返回 JSON {"bullets":["...","..."]}。`;
  if (mode === 'fill') return `你是中文简历助手。请为求职者撰写【${fl}】这段完整内容，岗位「${roleTitle || ''}」，贴合实际、尽量可量化、直接可用（3-5 句/条）。只返回 JSON {"text":"内容"}。同类句式参考：\n${g}`;
  return `你是中文简历助手。字段「${fl}」。请检查并给建议。只返回 JSON {"advice":[{"tag":"","msg":"","sev":"warn或空"}],"suggestions":["参考句式"]}。当前内容：\n${text}\n同类句式参考：\n${g}`;
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
  if (mode === 'fill') { const sen = glossRows.map((g) => g.text).filter(Boolean); let out = ''; if (field === 'summary') out = ((tpl && tpl.summary) ? tpl.summary + ' ' : '') + sen.slice(0, 2).join('；') + (sen.length ? '。' : ''); else if (field === 'tags') out = sen.slice(0, 8).join('、'); else out = sen.slice(0, 3).join('\n'); return send(res, 200, { source: 'rule', text: out, suggestions: [], advice: [] }); }
  return send(res, 200, { source: 'rule', text: '', suggestions, advice: ruleAdvice(field, text) });
}

/* ------------------------------------------------------------- 站长后台 */
const ADMIN = makeAdmin({ db, hashPassword, send, templatesCacheBreak, SB, KEY });

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
    return send(res, 200, {
      me: user ? { id: user.id, username: user.username, role: user.role } : null,
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
      sessionCache.delete((req.headers.authorization || '').slice(7).trim());
      await db('sessions', { method: 'DELETE', query: { token: `eq.${(req.headers.authorization || '').slice(7).trim()}` } }).catch(() => {});
      return send(res, 200, { ok: true });
    }
  }
  if (p === '/api/register' && req.method === 'POST') return apiRegister(req, res, body);
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
    return mDup[2] === 'duplicate' ? apiDuplicate(req, res, user, mDup[1]) : apiRestore(req, res, body, user, mDup[1]);
  }
  const mVer = p.match(/^\/api\/resumes\/([\w-]+)\/versions$/);
  if (mVer && req.method === 'GET') {
    if (!user) return send(res, 401, { error: '请先登录' });
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
    const doc = body.resume || {};
    const buf = buildDocx({ name: doc.name, theme: doc.theme || {}, data: doc.data || {} });
    const fname = encodeURIComponent(`${doc.name || '简历'}.docx`);
    return send(res, 200, buf, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="resume.docx"; filename*=UTF-8''${fname}`,
    });
  }

  if (p === '/api/share' && req.method === 'POST') return apiShareCreate(req, res, body, user);
  if (p === '/api/share/mine' && req.method === 'GET') return apiShareMine(req, res, user);
  if (p === '/api/share/revoke' && req.method === 'POST') return apiShareRevoke(req, res, body, user);
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
