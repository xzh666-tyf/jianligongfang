/* 站长后台：仅 role=admin 可访问。所有接口都在服务端二次校验身份。 */
import crypto from 'node:crypto';

export function makeAdmin(ctx) {
  const { db, hashPassword, templatesCacheBreak } = ctx;

  async function countOf(table, query = {}) {
    const url = new URL(`${ctx.SB}/rest/v1/${table}`);
    url.searchParams.set('select', 'id');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method: 'GET',
      headers: { apikey: ctx.KEY, Authorization: `Bearer ${ctx.KEY}`, Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = res.headers.get('content-range') || '';
    const m = cr.split('/')[1];
    return Number(m || 0);
  }

  async function stats(res) {
    const [users, resumes, versions, apps, tpl, gloss, sessions] = await Promise.all([
      countOf('users'), countOf('resumes'), countOf('resume_versions'), countOf('applications'),
      countOf('tpl_professions'), countOf('tpl_glossary'), countOf('sessions'),
    ]);
    const recent = await db('users', { query: { select: 'id,username,created_at,role', order: 'created_at.desc', limit: 10 } });
    return ctx.send(res, 200, {
      stats: { users, resumes, versions, apps, tpl, gloss, sessions },
      recent: recent || [],
    });
  }

  async function listUsers(res) {
    const users = await db('users', { query: { select: 'id,username,role,created_at,failed_count,locked_until', order: 'created_at.desc', limit: 500 } });
    const owned = await db('resumes', { query: { select: 'owner', limit: 5000 } });
    const n = {};
    for (const o of owned || []) n[o.owner] = (n[o.owner] || 0) + 1;
    return ctx.send(res, 200, {
      users: (users || []).map((u) => ({ ...u, resumes: n[u.id] || 0 })),
    });
  }

  async function findUser(username) {
    const rows = await db('users', { query: { select: '*', username: `eq.${String(username || '').trim()}`, limit: 1 } });
    return rows && rows[0];
  }

  return {
    async route(req, res, url, body, admin) {
      const p = url.pathname.replace('/api/admin/', '');
      if (p === 'stats' && req.method === 'GET') return stats(res);
      if (p === 'users' && req.method === 'GET') return listUsers(res);
      if (p === 'users/role' && req.method === 'POST') {
        const u = await findUser(body.username);
        if (!u) return ctx.send(res, 404, { error: '用户不存在' });
        if (u.id === admin.id) return ctx.send(res, 400, { error: '不能修改自己的权限' });
        const role = body.role === 'admin' ? 'admin' : 'user';
        await db('users', { method: 'PATCH', query: { id: `eq.${u.id}` }, body: { role } });
        return ctx.send(res, 200, { ok: true, role });
      }
      if (p === 'users/lock' && req.method === 'POST') {
        const u = await findUser(body.username);
        if (!u) return ctx.send(res, 404, { error: '用户不存在' });
        const locked = body.locked !== false;
        await db('users', {
          method: 'PATCH',
          query: { id: `eq.${u.id}` },
          body: { locked_until: locked ? new Date(Date.now() + 100 * 365 * 86400e3).toISOString() : null },
        });
        if (locked) await db('sessions', { method: 'DELETE', query: { owner: `eq.${u.id}` } });
        return ctx.send(res, 200, { ok: true, locked });
      }
      if (p === 'users/reset' && req.method === 'POST') {
        const u = await findUser(body.username);
        if (!u) return ctx.send(res, 404, { error: '用户不存在' });
        const tmp = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '') + 'aA1';
        const salt = crypto.randomBytes(16).toString('hex');
        await db('users', {
          method: 'PATCH',
          query: { id: `eq.${u.id}` },
          body: { pass_salt: salt, pass_hash: hashPassword(tmp, salt), failed_count: 0, locked_until: null },
        });
        await db('sessions', { method: 'DELETE', query: { owner: `eq.${u.id}` } });
        return ctx.send(res, 200, { ok: true, tempPassword: tmp, note: '一次性临时密码，请转交本人登录后自行修改' });
      }
      if (p === 'users/delete' && req.method === 'POST') {
        const u = await findUser(body.username);
        if (!u) return ctx.send(res, 404, { error: '用户不存在' });
        if (u.id === admin.id) return ctx.send(res, 400, { error: '不能删除自己' });
        await db('resume_versions', { method: 'DELETE', query: { owner: `eq.${u.id}` } });
        await db('applications', { method: 'DELETE', query: { owner: `eq.${u.id}` } });
        await db('resumes', { method: 'DELETE', query: { owner: `eq.${u.id}` } });
        await db('users', { method: 'DELETE', query: { id: `eq.${u.id}` } });
        return ctx.send(res, 200, { ok: true, deleted: u.username });
      }
      if (p === 'invite' && req.method === 'GET') {
        const rows = await db('invite_codes', { query: { select: '*', order: 'created_at.desc' } });
        return ctx.send(res, 200, { codes: rows || [] });
      }
      if (p === 'invite' && req.method === 'POST') {
        const code = String(body.code || 'RW-' + crypto.randomBytes(3).toString('hex')).toUpperCase().replace(/[^A-Z0-9-]/g, '');
        const max = Math.max(1, Math.min(1000, Number(body.max_uses) || 20));
        const out = await db('invite_codes', {
          method: 'POST', prefer: 'return=representation',
          body: { code, label: String(body.label || '').slice(0, 40) || null, max_uses: max, used: 0, enabled: true },
        });
        return ctx.send(res, 200, { code: out[0] });
      }
      if (p === 'invite/toggle' && req.method === 'POST') {
        await db('invite_codes', { method: 'PATCH', query: { code: `eq.${String(body.code).toUpperCase()}` }, body: { enabled: !!body.enabled } });
        return ctx.send(res, 200, { ok: true });
      }
      if (p === 'templates' && req.method === 'GET') {
        const rows = await db('tpl_professions', { query: { select: '*', order: 'sort.asc' } });
        return ctx.send(res, 200, { templates: rows || [] });
      }
      if (p === 'templates/save' && req.method === 'POST') {
        const t = body.template || {};
        if (!t.slug) return ctx.send(res, 400, { error: 'slug 不能为空' });
        await db('tpl_professions', {
          method: 'POST', prefer: 'resolution=merge-duplicates',
          body: {
            slug: String(t.slug).slice(0, 40),
            title: String(t.title || t.slug).slice(0, 40),
            industry: String(t.industry || '通用').slice(0, 20),
            summary: String(t.summary || '').slice(0, 300) || null,
            sections: t.sections || ['base', 'education', 'work', 'skills', 'summary'],
            sample: t.sample || {},
            theme: t.theme || {},
            sort: Number(t.sort) || 500,
            updated_at: new Date().toISOString(),
          },
        });
        templatesCacheBreak();
        return ctx.send(res, 200, { ok: true });
      }
      if (p === 'templates/delete' && req.method === 'POST') {
        await db('tpl_professions', { method: 'DELETE', query: { slug: `eq.${String(body.slug)}` } });
        templatesCacheBreak();
        return ctx.send(res, 200, { ok: true });
      }
      if (p === 'glossary' && req.method === 'GET') {
        const rows = await db('tpl_glossary', {
          query: { select: '*', profession: `eq.${q0(url)}`, order: 'weight.desc', limit: 300 },
        });
        return ctx.send(res, 200, { rows: rows || [] });
      }
      if (p === 'glossary/save' && req.method === 'POST') {
        const g = body.row || {};
        if (!g.profession || !g.text) return ctx.send(res, 400, { error: 'profession 与 text 必填' });
        await db('tpl_glossary', {
          method: 'POST',
          body: {
            profession: String(g.profession).slice(0, 40),
            kind: String(g.kind || '职责句式').slice(0, 20),
            text: String(g.text).slice(0, 400),
            weight: Math.max(1, Math.min(10, Number(g.weight) || 7)),
            source: String(g.source || '站长添加').slice(0, 40),
          },
        });
        templatesCacheBreak();
        return ctx.send(res, 200, { ok: true });
      }
      if (p === 'glossary/delete' && req.method === 'POST') {
        await db('tpl_glossary', { method: 'DELETE', query: { id: `eq.${String(body.id)}` } });
        templatesCacheBreak();
        return ctx.send(res, 200, { ok: true });
      }
      if (p === 'mark-refresh' && req.method === 'POST') {
        await db('tpl_meta', {
          method: 'POST', prefer: 'resolution=merge-duplicates',
          body: { key: 'tpl_synced_at', value: { at: new Date().toISOString().slice(0, 16).replace('T', ' ') }, updated_at: new Date().toISOString() },
        });
        templatesCacheBreak();
        return ctx.send(res, 200, { ok: true });
      }
      return ctx.send(res, 404, { error: 'no such admin api' });
    },
  };
}
const q0 = (url) => url.searchParams.get('profession') || '';
