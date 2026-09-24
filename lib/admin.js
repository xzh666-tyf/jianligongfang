/* 站长后台：仅 role=admin 可访问。所有接口都在服务端二次校验身份。 */
import crypto from 'node:crypto';

export function makeAdmin(ctx) {
  const { db, hashPassword, templatesCacheBreak } = ctx;

  /* 计数统一走 db()，由 DB_MODE 决定打 CloudBase 还是 Supabase。
     原来这里直拼 ctx.SB（东京 Supabase），上海云托管容器访问 *.supabase.co 被网络重置，
     fetch 抛出 "fetch failed" 并原样透给前端 —— 站长后台进不去的根因。
     keyCol：PostgREST 的 select 必须给真实存在的列，tpl_professions 主键是 slug、sessions 是 token，
     写死 id 会让这两张表 400（DATABASE_42703）。 */
  async function countOf(table, query = {}, keyCol = 'id') {
    return db(table, { query: { select: keyCol, ...query }, prefer: 'count=exact', wantCount: true });
  }

  async function stats(res) {
    /* 七项计数彼此独立：任何一项失败都不该让整页进不去，失败的显示为 null（前端渲染成 —）
       并把原因放进 countErrors 回传，便于判断网关是否支持 content-range 计数 */
    const jobs = [
      ['users', () => countOf('users')],
      ['resumes', () => countOf('resumes')],
      ['versions', () => countOf('resume_versions')],
      ['apps', () => countOf('applications')],
      ['tpl', () => countOf('tpl_professions', {}, 'slug')],
      ['gloss', () => countOf('tpl_glossary', {}, 'id')],
      ['sessions', () => countOf('sessions', {}, 'token')],
    ];
    const settled = await Promise.allSettled(jobs.map(([, f]) => f()));
    const out = {};
    const countErrors = {};
    settled.forEach((r, i) => {
      const key = jobs[i][0];
      if (r.status === 'fulfilled') out[key] = r.value;
      else {
        out[key] = null;
        countErrors[key] = String((r.reason && r.reason.message) || r.reason || '').slice(0, 160);
      }
    });
    const recent = await db('users', { query: { select: 'id,username,created_at,role', order: 'created_at.desc', limit: 10 } }).catch(() => []);
    return ctx.send(res, 200, { stats: out, recent: recent || [], countErrors });
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
  /* 删除一个用户名下所有关联数据（版本/投递/分享/登录/简历/导出计数），再删账号本身 */
  async function deleteOwned(uid) {
    await db('resume_versions', { method: 'DELETE', query: { owner: `eq.${uid}` } }).catch(() => {});
    await db('applications', { method: 'DELETE', query: { owner: `eq.${uid}` } }).catch(() => {});
    await db('shares', { method: 'DELETE', query: { owner: `eq.${uid}` } }).catch(() => {});
    await db('sessions', { method: 'DELETE', query: { owner: `eq.${uid}` } }).catch(() => {});
    await db('resumes', { method: 'DELETE', query: { owner: `eq.${uid}` } }).catch(() => {});
    await db('tpl_meta', { method: 'DELETE', query: { key: `eq.export:${uid}` } }).catch(() => {});
    await db('users', { method: 'DELETE', query: { id: `eq.${uid}` } });
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
      if (p === 'users/purge-preview' && req.method === 'POST') {
        const prefix = String(body.prefix || '').trim();
        if (prefix.length < 3) return ctx.send(res, 400, { error: '前缀至少 3 个字符，避免误伤全部账号' });
        const users = await db('users', { query: { select: 'id,username,role', order: 'created_at.desc', limit: 1000 } });
        const owned = await db('resumes', { query: { select: 'owner', limit: 5000 } });
        const n = {}; for (const o of owned || []) n[o.owner] = (n[o.owner] || 0) + 1;
        const matches = (users || [])
          .filter((u) => u.role !== 'admin' && u.id !== admin.id && String(u.username).startsWith(prefix))
          .map((u) => ({ id: u.id, username: u.username, role: u.role, resumes: n[u.id] || 0 }));
        return ctx.send(res, 200, { prefix, matches, count: matches.length });
      }
      if (p === 'users/purge' && req.method === 'POST') {
        if (String(body.confirm || '') !== 'PURGE') return ctx.send(res, 400, { error: '请输入 PURGE 二次确认后再执行删除' });
        const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{16,40}$/i.test(x)).slice(0, 500) : [];
        if (!ids.length) return ctx.send(res, 400, { error: '没有要删除的账号（请先预览）' });
        const found = await db('users', { query: { select: 'id,username,role', id: `in.(${ids.join(',')})` } });
        const deleted = []; const skipped = [];
        for (const u of found || []) {
          if (u.role === 'admin' || u.id === admin.id) { skipped.push(u.username + '(受保护)'); continue; }
          await deleteOwned(u.id);
          deleted.push(u.username);
        }
        const hit = new Set((found || []).map((f) => f.id));
        for (const id of ids) if (!hit.has(id)) skipped.push(id.slice(0, 8) + '(不存在)');
        return ctx.send(res, 200, { ok: true, deleted, skipped, count: deleted.length });
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
