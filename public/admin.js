/* 站长后台脚本：所有请求都由服务端二次校验 role=admin */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const token = () => localStorage.getItem('rw.token') || '';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opt = {}) {
  const res = await fetch('/api/admin/' + path, {
    method: opt.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const txt = await res.text();
  let j = {};
  try { j = txt ? JSON.parse(txt) : {}; } catch { j = { error: txt.slice(0, 160) }; }
  if (!res.ok) throw new Error(j.error || '请求失败');
  return j;
}
function toast(m, bad) {
  const t = $('#toast');
  t.textContent = m;
  t.className = 'toast on' + (bad ? ' bad' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.className = 'toast'), 3000);
}
const LABELS = { users: '注册账号', resumes: '简历份数', versions: '历史版本', apps: '投递记录', tpl: '职业模板', gloss: '词库条目', sessions: '活跃登录' };

let SLUGS = [];

async function overview() {
  const d = await api('stats');
  $('#statCards').innerHTML = Object.entries(d.stats).map(([k, v]) =>
    `<div class="stat"><b>${v}</b><span>${LABELS[k] || k}</span></div>`).join('');
  $('#recent').innerHTML = d.recent.length
    ? `<table class="tr"><tr><th>用户名</th><th>角色</th><th>注册时间</th></tr>${d.recent.map((u) =>
      `<tr><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '<span class="pill g">站长</span>' : '<span class="pill">普通</span>'}</td><td>${esc((u.created_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}</table>`
    : '<p class="hint">还没有注册账号。</p>';
}

async function users() {
  const d = await api('users');
  $('#userTable').innerHTML = d.users.length
    ? `<table class="tr"><tr><th>用户名</th><th>角色</th><th>简历</th><th>注册</th><th>状态</th><th style="text-align:right">操作</th></tr>${d.users.map((u) => {
      const locked = u.locked_until && new Date(u.locked_until) > new Date();
      return `<tr><td><b>${esc(u.username)}</b></td>
        <td>${u.role === 'admin' ? '<span class="pill g">站长</span>' : '<span class="pill">普通</span>'}</td>
        <td>${u.resumes}</td><td>${esc((u.created_at || '').slice(0, 10))}</td>
        <td>${locked ? '<span class="pill r">已封禁</span>' : '<span class="pill">正常</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="mini" data-act="role" data-u="${esc(u.username)}" data-v="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? '取消站长' : '设为站长'}</button>
          <button class="mini" data-act="lock" data-u="${esc(u.username)}" data-v="${locked ? '0' : '1'}">${locked ? '解封' : '封禁'}</button>
          <button class="mini" data-act="reset" data-u="${esc(u.username)}">重置密码</button>
          <button class="del" data-act="del" data-u="${esc(u.username)}">删除</button></td></tr>`;
    }).join('')}</table>`
    : '<p class="hint">还没有账号。前台注册后会出现在这里。</p>';
}

async function codes() {
  const d = await api('invite');
  $('#codeTable').innerHTML = `<table class="tr"><tr><th>邀请码</th><th>备注</th><th>已用 / 上限</th><th>状态</th><th style="text-align:right">操作</th></tr>${(d.codes || []).map((c) =>
    `<tr><td class="mono">${esc(c.code)}</td><td>${esc(c.label || '')}</td><td>${c.used} / ${c.max_uses}</td>
     <td>${c.enabled ? '<span class="pill g">可用</span>' : '<span class="pill r">已停用</span>'}</td>
     <td style="text-align:right"><button class="mini" data-act="tg" data-c="${esc(c.code)}" data-v="${c.enabled ? '0' : '1'}">${c.enabled ? '停用' : '启用'}</button></td></tr>`).join('')}</table>`;
}

async function tplList() {
  const d = await api('templates');
  SLUGS = (d.templates || []).map((t) => ({ slug: t.slug, title: t.title }));
  $('#gsProf').innerHTML = SLUGS.map((s) => `<option value="${esc(s.slug)}">${esc(s.title)}</option>`).join('');
  $('#tplTable').innerHTML = `<table class="tr"><tr><th>排序</th><th>职业</th><th>分组</th><th>slug</th><th>说明</th><th style="text-align:right">操作</th></tr>${(d.templates || []).map((t) =>
    `<tr><td>${t.sort}</td><td><b>${esc(t.title)}</b></td><td>${esc(t.industry)}</td><td class="mono">${esc(t.slug)}</td>
     <td style="max-width:320px">${esc(t.summary || '')}</td>
     <td style="text-align:right;white-space:nowrap">
       <button class="mini" data-act="edit" data-s="${esc(t.slug)}">载入编辑</button>
       <button class="del" data-act="del" data-s="${esc(t.slug)}">删除</button></td></tr>`).join('')}</table>`;
  $('#tplTable').dataset.raw = JSON.stringify(d.templates || []);
}

async function gloss() {
  const prof = $('#gsProf').value || SLUGS[0]?.slug;
  if (!prof) { $('#glossTable').innerHTML = '<p class="hint">先创建模板。</p>'; return; }
  const d = await api('glossary?profession=' + encodeURIComponent(prof));
  $('#glossTable').innerHTML = `<p class="hint">当前筛选：${esc(prof)}（共 ${d.rows.length} 条）</p>` + (d.rows.length
    ? `<table class="tr"><tr><th>类型</th><th>内容</th><th>权重</th><th>来源</th><th></th></tr>${d.rows.map((g) =>
      `<tr><td><span class="pill">${esc(g.kind)}</span></td><td>${esc(g.text)}</td><td>${g.weight}</td><td>${esc(g.source || '')}</td>
       <td style="text-align:right"><button class="del" data-act="gdel" data-i="${esc(g.id)}">删</button></td></tr>`).join('')}</table>`
    : '<p class="hint">该职业还没有词库条目。</p>');
}

const LOAD = { ov: overview, users, codes, tpl: tplList, gloss };

function bind() {
  $('#panes').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#panes button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.pane').forEach((p) => p.classList.toggle('on', p.dataset.p === b.dataset.p));
    const f = LOAD[b.dataset.p];
    if (f) f().catch((err) => toast(err.message, true));
  });
  $('#btnOut').addEventListener('click', async () => {
    try { await fetch('/api/me', { method: 'POST', headers: { Authorization: 'Bearer ' + token() } }); } catch { /* 忽略 */ }
    localStorage.removeItem('rw.token');
    location.href = './index.html';
  });
  $('#btnMark').addEventListener('click', () => api('mark-refresh', { method: 'POST', body: {} }).then(() => toast('已更新模板库时间戳')).catch((e) => toast(e.message, true)));

  $('#ncAdd').addEventListener('click', async () => {
    try {
      const d = await api('invite', { method: 'POST', body: { code: $('#ncCode').value, label: $('#ncLabel').value, max_uses: $('#ncMax').value } });
      toast('已生成：' + d.code.code);
      $('#ncCode').value = '';
      codes();
    } catch (e) { toast(e.message, true); }
  });

  $('#tsSave').addEventListener('click', async () => {
    try {
      const t = {
        slug: $('#tsSlug').value.trim(), title: $('#tsTitle').value.trim(), industry: $('#tsInd').value.trim() || '通用',
        sort: $('#tsSort').value, summary: $('#tsSummary').value.trim(),
        theme: JSON.parse($('#tsTheme').value || '{}'), sample: JSON.parse($('#tsSample').value || '{}'),
      };
      if (!t.slug) throw new Error('slug 必填');
      await api('templates/save', { method: 'POST', body: { template: t } });
      toast('模板已保存');
      tplList();
    } catch (e) { toast('保存失败：' + e.message, true); }
  });

  $('#gsProf').addEventListener('change', () => gloss().catch((e) => toast(e.message, true)));
  $('#gsAdd').addEventListener('click', async () => {
    try {
      await api('glossary/save', {
        method: 'POST',
        body: { row: { profession: $('#gsProf').value, kind: $('#gsKind').value, text: $('#gsText').value.trim(), weight: $('#gsW').value } },
      });
      $('#gsText').value = '';
      toast('已添加');
      gloss();
    } catch (e) { toast(e.message, true); }
  });

  document.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'role') { await api('users/role', { method: 'POST', body: { username: b.dataset.u, role: b.dataset.v } }); users(); }
      if (act === 'lock') { await api('users/lock', { method: 'POST', body: { username: b.dataset.u, locked: b.dataset.v === '1' } }); users(); }
      if (act === 'reset') {
        if (!confirm(`确定重置 ${b.dataset.u} 的密码？`)) return;
        const d = await api('users/reset', { method: 'POST', body: { username: b.dataset.u } });
        toast('临时密码：' + d.tempPassword);
        prompt('把这条临时密码转交本人（只显示这一次）：', d.tempPassword);
      }
      if (act === 'del') {
        if (!confirm(`删除账号 ${b.dataset.u} 将连同其全部简历与投递记录一起清除，确定？`)) return;
        await api('users/delete', { method: 'POST', body: { username: b.dataset.u } });
        users();
      }
      if (act === 'tg') { await api('invite/toggle', { method: 'POST', body: { code: b.dataset.c, enabled: b.dataset.v === '1' } }); codes(); }
      if (act === 'gdel') { await api('glossary/delete', { method: 'POST', body: { id: b.dataset.i } }); gloss(); }
      if (act === 'edit') {
        const raw = JSON.parse($('#tplTable').dataset.raw || '[]');
        const t = raw.find((x) => x.slug === b.dataset.s);
        if (!t) return;
        $('#tsSlug').value = t.slug; $('#tsTitle').value = t.title; $('#tsInd').value = t.industry;
        $('#tsSort').value = t.sort; $('#tsSummary').value = t.summary || '';
        $('#tsTheme').value = JSON.stringify(t.theme || {});
        $('#tsSample').value = JSON.stringify(t.sample || {}, null, 1);
        document.querySelector('[data-p="tpl"]').scrollIntoView({ block: 'start' });
        toast('已载入编辑区');
      }
      if (act === 'del' && b.dataset.s) {
        if (!confirm(`删除模板 ${b.dataset.s}？`)) return;
        await api('templates/delete', { method: 'POST', body: { slug: b.dataset.s } });
        tplList();
      }
    } catch (err) { toast(err.message, true); }
  });
}

(async function boot() {
  bind();
  try {
    await overview();
    await tplList();
    $('#who').textContent = '当前身份：站长';
  } catch (e) {
    document.querySelector('.wrap').innerHTML = `<div class="box"><h3>无法进入后台</h3>
      <p>${esc(e.message)}</p><p class="hint">请先用站长账号在前台登录后，再打开本页。</p>
      <a class="btn navy" href="./index.html">去前台登录</a></div>`;
  }
})();
