/* 简历工坊 前端 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const LS_TOKEN = 'rw.token';
const LS_GUEST = 'rw.guest';
const LS_SEEN = 'rw.seen';

const API = {
  async call(path, opt = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(path, { ...opt, headers });
    const txt = await res.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { json = { error: txt.slice(0, 180) }; }
    if (!res.ok) throw new Error((json && json.error) || '请求失败 ' + res.status);
    return json;
  },
};

const DEFAULT_THEME = {
  layout: 'default',
  style: 'classic',
  themeId: 'cl-blue',
  accent: '#2f5c8f',
  secondary: '#55606d',
  sf: 1,
  lh: 1.55,
  ls: 0,
  dens: 1,
  font: 'sans',
  photo: 'rounded',
  head: 'bar',
  mask: false,
  hidden: [],
};

/* 样式模板：不只是换排版，标题、字体、疏密、配色、渲染方式一起换 */
const STYLES = [
  { id: 'classic', name: '经典商务', layout: 'default', head: 'underline', font: 'serif', dens: 1, lh: 1.6, accent: '#2f5c8f' },
  { id: 'modern', name: '现代色块', layout: 'default', head: 'bar', font: 'sans', dens: .95, lh: 1.5, accent: '#0f3460' },
  { id: 'minimal', name: '极简无饰', layout: 'default', head: 'plain', font: 'sans', dens: 1.08, lh: 1.7, accent: '#1c1c1e' },
  { id: 'timeline', name: '时间轴', layout: 'default', head: 'underline', font: 'sans', dens: 1, lh: 1.6, accent: '#1f6f5c', timeline: true },
  { id: 'sidebar', name: '彩色侧栏', layout: 'sidebar', head: 'underline', font: 'sans', dens: 1, lh: 1.55, accent: '#244a75' },
  { id: 'banner', name: '顶部横幅', layout: 'banner', head: 'bar', font: 'sans', dens: .98, lh: 1.55, accent: '#1f6f5c' },
  { id: 'magazine', name: '杂志双栏', layout: 'magazine', head: 'underline', font: 'serif', dens: 1, lh: 1.5, accent: '#7a3f5c' },
  { id: 'corporate', name: '稳重大方', layout: 'banner', head: 'underline', font: 'serif', dens: 1.02, lh: 1.6, accent: '#35566b' },
  { id: 'ats', name: 'ATS 纯文本', layout: 'default', head: 'plain', font: 'sans', dens: 1, lh: 1.6, accent: '#333333', ats: true },
];
const styleOf = (id) => STYLES.find((s) => s.id === id) || STYLES[0];
const styleTheme = (s) => ({
  ...DEFAULT_THEME, layout: s.layout, style: s.id, accent: s.accent, head: s.head, font: s.font,
  dens: s.dens, lh: s.lh, timeline: !!s.timeline, ats: !!s.ats, hidden: [],
});

/* 简历主题库：样式骨架 + 配色 + 疏密字体，成套一键套用 */
const RESUME_THEMES = [
  { id: 'min-ink', name: '石墨极简', g: '极简', base: 'minimal', accent: '#1c1c1e' },
  { id: 'min-grey', name: '灰阶极简', g: '极简', base: 'minimal', accent: '#4b4b50' },
  { id: 'min-navy', name: '蓝墨极简', g: '极简', base: 'minimal', accent: '#0f3460' },
  { id: 'cl-blue', name: '沉稳蓝', g: '商务', base: 'classic', accent: '#2f5c8f' },
  { id: 'cl-steel', name: '钢青商务', g: '商务', base: 'classic', accent: '#35566b' },
  { id: 'cl-red', name: '中国红', g: '商务', base: 'classic', accent: '#c0392b' },
  { id: 'mo-navy', name: '深海蓝块', g: '现代', base: 'modern', accent: '#0f3460' },
  { id: 'mo-green', name: '松墨绿块', g: '现代', base: 'modern', accent: '#1f6f5c' },
  { id: 'mo-violet', name: '靛蓝紫块', g: '现代', base: 'modern', accent: '#4a3f8f' },
  { id: 'mo-rust', name: '赭石块', g: '现代', base: 'modern', accent: '#8f3f2f' },
  { id: 'sb-navy', name: '深蓝侧栏', g: '侧栏', base: 'sidebar', accent: '#244a75' },
  { id: 'sb-teal', name: '青竹侧栏', g: '侧栏', base: 'sidebar', accent: '#117a65' },
  { id: 'sb-plum', name: '绛紫侧栏', g: '侧栏', base: 'sidebar', accent: '#7a3f5c' },
  { id: 'bn-teal', name: '青绿横幅', g: '横幅', base: 'banner', accent: '#1f6f5c' },
  { id: 'bn-amber', name: '暖橙横幅', g: '横幅', base: 'banner', accent: '#b5651d' },
  { id: 'bn-blue', name: '亮蓝横幅', g: '横幅', base: 'banner', accent: '#0a84ff' },
  { id: 'tl-green', name: '松绿时间轴', g: '时间轴', base: 'timeline', accent: '#1f6f5c' },
  { id: 'tl-steel', name: '钢蓝时间轴', g: '时间轴', base: 'timeline', accent: '#2b5f7a' },
  { id: 'mg-plum', name: '绛紫双栏', g: '杂志', base: 'magazine', accent: '#7a3f5c' },
  { id: 'mg-olive', name: '橄榄双栏', g: '杂志', base: 'magazine', accent: '#3b5c2f' },
  { id: 'co-navy', name: '稳重大方', g: '特殊', base: 'corporate', accent: '#35566b' },
  { id: 'ats-plain', name: 'ATS 纯文本', g: '特殊', base: 'ats', accent: '#333333' },
];
const THEME_GROUPS = ['全部', ...Array.from(new Set(RESUME_THEMES.map((t) => t.g)))];
function themeObj(t) {
  const o = styleTheme(styleOf(t.base));
  o.accent = t.accent;
  o.themeId = t.id;
  return o;
}
function applyTheme(r, t) {
  const o = themeObj(t);
  r.theme = { ...r.theme, ...o, hidden: r.theme.hidden || [] };
  r.layout = o.layout;
}

const PALETTES = [
  ['#2f5c8f', '沉稳蓝'], ['#0f3460', '深海蓝'], ['#1f6f5c', '松墨绿'], ['#117a65', '青竹绿'],
  ['#3b5c2f', '橄榄绿'], ['#7a3f5c', '绛紫'], ['#4a3f8f', '靛蓝紫'], ['#8a5a19', '暖棕'],
  ['#8f3f2f', '赭红'], ['#c0392b', '中国红'], ['#35566b', '钢青'], ['#1c1c1e', '石墨黑'],
];
const LAYOUTS = [
  ['default', '标准单栏'],
  ['banner', '横幅头图'],
  ['magazine', '杂志双栏'],
  ['sidebar', '左侧边栏'],
];
const FONTS = [['sans', '无衬线（现代）'], ['serif', '衬线（正式）'], ['mix', '标题衬线 + 正文无衬线']];
const SECTION_TITLES = {
  base: '基本信息', education: '教育经历', work: '工作经历', projects: '项目经历',
  skills: '专业技能', certs: '证书与荣誉', summary: '自我评价',
};
const EN_TITLES = { 教育经历: 'EDUCATION', 工作经历: 'EXPERIENCE', 项目经历: 'PROJECTS', 专业技能: 'SKILLS', 证书与荣誉: 'CERTIFICATES & HONORS', 自我评价: 'SUMMARY' };
const maskPhone = (v) => String(v).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
const maskMail = (v) => { const m = String(v).match(/^([^@]{1,2})[^@]*(@.*)$/); return m ? m[1] + '***' + m[2] : v; };
const STATUSES = ['已投递', '初筛通过', '面试中', '谈薪', '已 offer', '不合适', '已撤回'];

const state = {
  token: localStorage.getItem(LS_TOKEN) || '',
  me: null,
  view: 'tpl',
  thGroup: '全部',
  labelFilter: '',
  shown: [],
  sel: new Set(),
  imp: null,
  ui: localStorage.getItem('rw.ui') || 'auto',
  templates: [],
  glossary: {},
  meta: {},
  guest: load(LS_GUEST, { resumes: [], activeId: '' }),
  resumes: [],
  cur: null,
  apps: [],
  dirty: false,
  timer: null,
  dismissed: {},
};

function load(k, dft) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? dft : v; } catch { return dft; }
}
function saveGuest() { localStorage.setItem(LS_GUEST, JSON.stringify(state.guest)); }
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (s) => (s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? '' : o[k]), obj);
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i];
    if (o[k] === undefined) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[k];
  }
  o[ks[ks.length - 1]] = val;
}

function blankData() {
  return {
    base: { name: '', intent: '', city: '', phone: '', email: '', birth: '', years: '', site: '', photo: '', nation: '', polity: '', home: '', build: '', salary: '', available: '', license: '' },
    extra: [],
    education: [], work: [], projects: [], skills: [], skillTags: [], certs: [], awards: [], summary: '', lang: 'zh',
  };
}
function blankResume(name = '未命名简历') {
  return { id: 'g' + uid(), name, layout: DEFAULT_THEME.layout, theme: { ...DEFAULT_THEME, hidden: [] }, data: blankData(), version: 1, profession: '' };
}
function fromTemplate(tpl) {
  const raw = JSON.parse(JSON.stringify(tpl.sample || {}));
  const empty = blankData();
  const data = { ...empty, ...raw };
  for (const k of Object.keys(empty)) if (data[k] === undefined) data[k] = empty[k];
  data.base = { ...empty.base, ...(raw.base || {}) };
  data.extra = Array.isArray(raw.extra) ? raw.extra : [];
  const theme = { ...DEFAULT_THEME, hidden: [], ...(tpl.theme || {}), profession: tpl.slug };
  return {
    id: 'g' + uid(), name: `${tpl.title} · 示例`, layout: theme.layout, theme, data,
    version: 1, profession: tpl.slug, tips: tpl.summary || '',
  };
}

/* --------------------------------------------------------------- 当前简历 */
function listFor() {
  return state.me ? state.resumes : state.guest.resumes;
}
function curResume() { return state.cur; }
function setCur(r) {
  state.cur = r;
  renderEditor();
  renderPreview();
  renderSuggestions();
  syncSaveState();
}
function newResume(obj) {
  if (!state.me) {
    state.guest.resumes.unshift(obj);
    state.guest.activeId = obj.id;
    saveGuest();
  }
  setCur(obj);
  go('edit');
  if (state.me) save();
}

/* --------------------------------------------------------------- 视图切换 */
function moveSegment() {
  const nav = $('#tabs');
  const on = nav.querySelector('button.on');
  const thumb = $('#segthumb');
  if (!on || !thumb) return;
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}
function go(view) {
  state.view = view;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + view));
  moveSegment();
  if (view === 'tpl') renderTemplates();
  if (view === 'mine') renderMine();
  if (view === 'edit') { renderEditor(); renderPreview(); }
}

/* --------------------------------------------------------------- 模板中心 */
function mockThumb(theme, layout) {
  const a = theme.accent || DEFAULT_THEME.accent;
  const plain = theme.head === 'plain';
  const bar = (w, c = '#dfe4ea', h = 4) => `<i style="display:block;width:${w};height:${h}px;background:${c};border-radius:2px;margin:3px 0"></i>`;
  const line = (w) => `<i style="display:block;width:${w};height:3px;background:#e3e6ea;border-radius:2px;margin:4px 0"></i>`;
  let body;
  if (theme.timeline) {
    body = `<div style="display:flex;gap:5px;padding:5px 10px 8px"><div style="width:5px;border-left:2px solid ${a};opacity:.45"></div><div style="flex:1">${bar('46%', a, 6)}${line('90%')}${line('76%')}${bar('38%', a, 6)}${line('86%')}</div></div>`;
  } else if (layout === 'magazine') {
    body = `<div style="display:flex;gap:6px;padding:0 10px 8px">${`<div style="flex:1">${bar('100%')}${bar('92%')}${bar('70%')}</div>`.repeat(2)}</div>`;
  } else if (plain) {
    body = `<div style="padding:0 10px 9px">${bar('32%', '#8b8f96', 5)}${line('92%')}${line('80%')}${line('88%')}${line('58%')}</div>`;
  } else {
    body = `<div style="padding:0 10px 9px">${bar('100%', a, 5)}${bar('88%')}${bar('76%')}${bar('94%')}${bar('62%')}</div>`;
  }
  const head = layout === 'banner'
    ? `<div style="background:${a};padding:9px 10px">${bar('34%', '#ffffff', 7)}${bar('48%', 'rgba(255,255,255,.6)')}</div>`
    : layout === 'sidebar'
      ? `<div style="display:flex"><div style="width:34%;background:${a};padding:8px">${bar('60%','#fff',6)}${bar('80%','rgba(255,255,255,.55)')}${bar('70%','rgba(255,255,255,.4)')}</div><div style="flex:1;padding:8px">${bar('50%', '#c8d2de', 6)}${bar('90%')}${bar('82%')}</div></div>`
      : `<div style="padding:9px 10px">${bar('38%', a, 8)}${bar('56%', '#c8d2de')}${plain ? '' : bar('40%', '#e6ebf1')}</div>`;
  return head + body;
}

function renderTemplates() {
  const kw = ($('#tplSearch').value || '').trim();
  const ind = $('#tplIndustries').dataset.on || '';
  const inds = Array.from(new Set(state.templates.map((t) => t.industry)));
  const box = $('#tplIndustries');
  if (!box.childElementCount) {
    box.innerHTML = ['全部', ...inds].map((i) => `<button data-ind="${esc(i)}" class="${i === '全部' ? 'on' : ''}">${esc(i)}</button>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      $$('#tplIndustries button').forEach((x) => x.classList.toggle('on', x === b));
      box.dataset.on = b.dataset.ind === '全部' ? '' : b.dataset.ind;
      renderTemplates();
    });
  }
  const list = state.templates.filter((t) => {
    if (ind && t.industry !== ind) return false;
    if (!kw) return true;
    return (t.title + t.industry + (t.summary || '')).includes(kw);
  });
  $('#tplGrid').innerHTML = list.map((t) => {
    const th = { ...DEFAULT_THEME, ...(t.theme || {}) };
    return `<div class="card">
      <div class="thumb"><div class="tb">${mockThumb(th, th.layout)}</div></div>
      <div class="body">
        <span class="ind">${esc(t.industry)}</span>
        <h4>${esc(t.title)}</h4>
        <p>${esc(t.summary || '含示例数据，套用后可逐字段改写')}</p>
        <div class="act">
          <button class="btn navy" data-use="${esc(t.slug)}">用这个模板</button>
          <button class="btn" data-preview="${esc(t.slug)}">看骨架</button>
        </div>
      </div>
    </div>`;
  }).join('') || `<p class="hint">没有匹配的职业模板。可以直接「新建简历 → 空白简历」。</p>`;
  const stamp = state.meta.tpl_synced_at && state.meta.tpl_synced_at.at;
  $('#tplUpdated').textContent = `共 ${state.templates.length} 个职业模板${stamp ? ` · 模板库更新于 ${stamp}` : ''} · 示例内容均为虚构假名`;
  $('#tplCount').textContent = `${state.templates.length} 个职业模板`;
}

/* --------------------------------------------------------------- 编辑面板 */
const FIELDS = {
  base: [
    [['姓名', 'name'], ['求职意向', 'intent']],
    [['现居城市', 'city'], ['出生年月', 'birth', 'month']],
    [['联系电话', 'phone'], ['邮箱', 'email', 'email']],
    [['工作年限', 'years'], ['个人主页 / 作品', 'site']],
    [['民族', 'nation'], ['政治面貌', 'polity', ['群众', '共青团员', '中共党员', '民主党派']]],
    [['户籍', 'home'], ['身高 / 体重', 'build']],
    [['期望薪资', 'salary'], ['到岗时间', 'available']],
    [['驾照 / 车型', 'license']],
  ],
  education: [
    [['学校', 'school'], ['专业', 'major']],
    [['学历', 'degree', ['大专', '本科', '硕士', '博士', '中专/高中']], ['在校时间', 'start', 'month'], ['至', 'end', 'month']],
    [['主修课程 / 成绩 / 保研奖学金等', 'note', 'area']],
  ],
  work: [
    [['公司', 'company'], ['职位', 'role']],
    [['入职', 'start', 'month'], ['离职 / 至今', 'end', 'month']],
  ],
  projects: [
    [['项目名', 'name'], ['担任角色', 'role']],
    [['开始', 'start', 'month'], ['结束', 'end', 'month']],
    [['项目说明（背景 / 你的动作 / 结果）', 'desc', 'area']],
  ],
};

function fieldHTML(item, path) {
  const [label, key, kind] = item;
  const val = getPath(curResume().data, path + '.' + key);
  if (kind === 'area') return `<div class="f" style="grid-column:1/-1"><span>${esc(label)}</span><textarea class="t" data-p="${path}.${key}">${esc(val)}</textarea></div>`;
  if (kind === 'month') return `<div class="f"><span>${esc(label)}</span><input class="t" type="month" data-p="${path}.${key}" value="${esc(val)}" /></div>`;
  if (kind === 'email') return `<div class="f"><span>${esc(label)}</span><input class="t" type="email" data-p="${path}.${key}" value="${esc(val)}" placeholder="name@mail.com" /></div>`;
  if (Array.isArray(kind)) {
    return `<div class="f"><span>${esc(label)}</span><select class="t" data-p="${path}.${key}"><option value="">请选择</option>${kind.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  }
  return `<div class="f"><span>${esc(label)}</span><input class="t" data-p="${path}.${key}" value="${esc(val)}" /></div>`;
}

function renderEditor() {
  const r = curResume();
  if (!r) { $('#editor').innerHTML = `<p class="hint">先「新建简历」或到模板中心挑一个模板。</p>`; return; }
  const d = r.data;
  const out = [];

  out.push(`<fieldset><legend>简历名称</legend>
    <div class="row"><label>用于区分版本</label><input class="t" data-p="#name" value="${esc(r.name)}" /></div>
    <div class="row"><label>头像</label><div class="avatarslot">
      ${d.base.photo ? `<img src="${d.base.photo}" />` : '<span class="hint">未上传</span>'}
      <button class="mini" data-act="photo">上传 / 更换</button>
      ${d.base.photo ? '<button class="del" data-act="photodel">移除</button>' : ''}
      <span class="hint" style="font-size:11px">证件照 24×30mm，仅存本地/你的账号</span>
    </div></div>
  </fieldset>`);

  d.extra = d.extra || [];
  const extraRows = d.extra.map((x, i) => `<div class="row">
      <input class="t" style="flex:0 0 128px" data-p="extra.${i}.k" value="${esc(x.k)}" placeholder="字段名，如 英语水平" />
      <input class="t" style="flex:1" data-p="extra.${i}.v" value="${esc(x.v)}" placeholder="内容，如 CET-6 545 分" />
      <button class="del" data-act="itemdel" data-k="extra" data-i="${i}">删</button></div>`).join('');
  out.push(`<fieldset><legend>基本信息</legend>${FIELDS.base.map((row) =>
    `<div class="grid2">${row.map((i) => fieldHTML(i, 'base')).join('')}</div>`).join('')}
    <div class="famlabel">对外分享</div>
    <label class="toggle"><input type="checkbox" data-p="#theme.mask" ${r.theme.mask ? 'checked' : ''}/> 脱敏模式：手机号中间四位与邮箱打码，隐藏出生、户籍、身高体重、驾照</label>
    <div class="famlabel">语言</div>
    <div class="grid2"><label class="toggle"><input type="radio" name="lang" data-p="#lang" value="zh" ${(d.lang || 'zh') === 'zh' ? 'checked' : ''}/> 中文板块标题</label>
      <label class="toggle"><input type="radio" name="lang" data-p="#lang" value="en" ${d.lang === 'en' ? 'checked' : ''}/> English headings</label></div>
    <div class="famlabel">自定义字段（按需要加，会一并显示在简历基本信息里）</div>
    ${extraRows}<button class="mini" data-act="extraadd">+ 加一个字段</button>
  </fieldset>`);

  const listBlock = (key, title, mk, headFields, bullet) => {
    const arr = d[key] || [];
    const items = arr.map((it, i) => {
      const grid = headFields.map((row) =>
        row.length > 1
          ? `<div class="${row.length === 3 ? 'grid3' : 'grid2'}">${row.map((f) => fieldHTML(f, `${key}.${i}`)).join('')}</div>`
          : `<div class="grid2">${fieldHTML(row[0], `${key}.${i}`)}</div>`).join('');
      const bullets = bullet ? `<div class="bullets">${(it.bullets || []).map((b, bi) =>
        `<div class="brow"><textarea class="t" data-p="${key}.${i}.bullets.${bi}" placeholder="做了什么 → 怎么做 → 量化结果">${esc(b)}</textarea><button class="del" data-act="btdel" data-p="${key}.${i}.bullets.${bi}">×</button></div>`).join('')}
        <button class="mini" data-act="btadd" data-p="${key}.${i}.bullets">+ 加一条要点</button></div>` : '';
      return `<div class="itembox"><div class="ib-h"><span>第 ${i + 1} 条</span><span><button class="mini" data-act="mvup" data-k="${key}" data-i="${i}">↑</button> <button class="mini" data-act="mvdn" data-k="${key}" data-i="${i}">↓</button> <button class="del" data-act="itemdel" data-k="${key}" data-i="${i}">删除</button></span></div>${grid}${bullets}</div>`;
    }).join('');
    out.push(`<fieldset><legend>${title}</legend>${items || '<p class="hint" style="margin:0 0 8px">还没有条目。</p>'}
      <button class="add" data-act="itemadd" data-k="${key}">+ 新增一段</button></fieldset>`);
  };

  listBlock('education', '教育经历', null, FIELDS.education, false);
  listBlock('work', '工作经历（倒序，最近一份放最上）', null, FIELDS.work, true);
  listBlock('projects', '项目经历', null, FIELDS.projects, false);

  out.push(`<fieldset><legend>专业技能</legend>
    <div class="famlabel">能力条（拖动调整熟练度）</div>
    ${(d.skills || []).map((s, i) => `<div class="row"><input class="t" style="flex:1" data-p="skills.${i}.name" value="${esc(s.name)}" placeholder="技能名" />
      <input type="range" min="20" max="100" step="5" data-p="skills.${i}.level" value="${Number(s.level) || 60}" />
      <span style="width:34px;font-size:12px">${Number(s.level) || 60}%</span>
      <button class="del" data-act="itemdel" data-k="skills" data-i="${i}">删</button></div>`).join('')}
    <button class="mini" data-act="skilladd">+ 加技能条</button>
    <div class="famlabel">技能标签（用顿号或逗号分隔）</div>
    <textarea class="t" data-p="#tags" placeholder="SolidWorks、GD&T、DFMEA、公差分析…">${esc((d.skillTags || []).join('、'))}</textarea>
  </fieldset>`);

  out.push(`<fieldset><legend>证书与荣誉</legend>
    ${(d.certs || []).map((c, i) => `<div class="row"><input class="t" style="flex:2" data-p="certs.${i}.name" value="${esc(c.name)}" placeholder="证书名称" />
      <input class="t" style="flex:1" data-p="certs.${i}.date" value="${esc(c.date)}" placeholder="取得时间" />
      <button class="del" data-act="itemdel" data-k="certs" data-i="${i}">删</button></div>`).join('')}
    <button class="mini" data-act="certadd">+ 加证书</button>
    <div class="famlabel">获奖（每行一条）</div>
    <textarea class="t" data-p="#awards">${esc((d.awards || []).join('\n'))}</textarea>
  </fieldset>`);

  out.push(`<fieldset><legend>自我评价</legend>
    <textarea class="t" style="min-height:88px" data-p="summary" placeholder="3-5 句：年限 + 核心能力 + 代表性成果 + 求职动机">${esc(d.summary)}</textarea>
    <p class="hint" style="margin:6px 0 0">提示：写“能带来什么”，别写“吃苦耐劳”。量化比形容词有用。</p>
  </fieldset>`);

  out.push(`<fieldset><legend>版式与主题</legend>
    <div class="famlabel">简历主题</div>
    <div class="chips thgrp">${THEME_GROUPS.map((g) => `<button data-act="thgrp" data-g="${g}" class="${state.thGroup === g ? 'on' : ''}">${g}</button>`).join('')}</div>
    <div class="thgrid">${RESUME_THEMES.filter((t) => state.thGroup === '全部' || t.g === state.thGroup).map((t) => {
      const th = themeObj(t);
      return `<button class="thcard ${r.theme.themeId === t.id ? 'on' : ''}" data-act="theme" data-t="${t.id}" title="${t.name}">
        <span class="sth">${mockThumb(th, th.layout)}</span><span class="stn">${t.name}</span></button>`;
    }).join('')}</div>
    <div class="famlabel">配色</div>
    <div class="pal">${PALETTES.map(([c, n]) => `<button class="pal-dot ${String(r.theme.accent).toLowerCase() === c ? 'on' : ''}" style="background:${c}" data-act="palette" data-c="${c}" title="${n} · ${c}"></button>`).join('')}
      <span class="swatch" style="margin-left:auto">主色<input type="color" data-p="#theme.accent" value="${esc(r.theme.accent)}" /></span>
      <span class="swatch">辅助<input type="color" data-p="#theme.secondary" value="${esc(r.theme.secondary)}" /></span>
    </div>
    <div class="famlabel">排版微调</div>
    <div class="row"><label>字号</label><input type="range" min="0.86" max="1.14" step="0.02" data-p="#theme.sf" value="${r.theme.sf}" /><span style="width:38px;font-size:12px">${Math.round(r.theme.sf * 100)}%</span></div>
    <div class="row"><label>行距</label><input type="range" min="1.3" max="1.9" step="0.05" data-p="#theme.lh" value="${r.theme.lh}" /><span style="width:38px;font-size:12px">${r.theme.lh}</span></div>
    <div class="row"><label>字间距</label><input type="range" min="0" max="1.2" step="0.1" data-p="#theme.ls" value="${r.theme.ls}" /><span style="width:38px;font-size:12px">${r.theme.ls}px</span></div>
    <div class="row"><label>紧凑度</label><input type="range" min="0.7" max="1.3" step="0.05" data-p="#theme.dens" value="${r.theme.dens}" /></div>
    <div class="row"><label>字体</label><select class="t" data-p="#theme.font">${FONTS.map(([k, t]) => `<option value="${k}" ${r.theme.font === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label style="flex:0 0 60px">头像形状</label><select class="t" data-p="#theme.photo"><option value="rounded" ${r.theme.photo === 'rounded' ? 'selected' : ''}>圆角</option><option value="circle" ${r.theme.photo === 'circle' ? 'selected' : ''}>圆形</option><option value="square" ${r.theme.photo === 'square' ? 'selected' : ''}>直角</option></select></div>
    <div class="famlabel">显示哪些板块</div>
    <div class="grid2">${Object.keys(SECTION_TITLES).filter((k) => k !== 'base').map((k) =>
      `<label class="toggle"><input type="checkbox" data-p="#theme.hidden" value="${k}" ${(r.theme.hidden || []).includes(k) ? '' : 'checked'} /> ${SECTION_TITLES[k]}</label>`).join('')}</div>
  </fieldset>`);

  $('#editor').innerHTML = out.join('');
}

/* --------------------------------------------------------------- 简历预览 */
function pageHTML(r, forPrint) {
  const d = r.data || {};
  const b = d.base || {};
  const t = { ...DEFAULT_THEME, ...(r.theme || {}) };
  const hidden = t.hidden || [];
  const show = (k) => !hidden.includes(k);
  const info = [
    ['电话', b.phone], ['邮箱', b.email], ['现居', b.city], ['出生', b.birth], ['民族', b.nation], ['政治面貌', b.polity],
    ['户籍', b.home], ['身高体重', b.build], ['年限', b.years ? b.years + ' 年' : ''], ['期望薪资', b.salary],
    ['到岗', b.available], ['驾照', b.license], ['主页', b.site],
  ].filter((x) => has(x[1])).concat((d.extra || []).filter((x) => has(x.k) && has(x.v)).map((x) => [x.k, x.v]));
  const dropKeys = ['出生', '户籍', '身高体重', '驾照'];
  const shownInfo = t.mask
    ? info.filter(([k]) => !dropKeys.includes(k)).map(([k, v]) => [k, k === '电话' ? maskPhone(v) : k === '邮箱' ? maskMail(v) : v])
    : info;
  const photo = (b.photo && !t.ats) ? `<img class="photo ${t.photo}" src="${b.photo}" />` : '';
  const head = `<div class="head">${photo ? '' : ''}<div><div class="nm">${esc(b.name || '姓名')}</div>
      ${has(b.intent) ? `<div class="it">${esc(b.intent)}</div>` : ''}</div><div class="sp"></div>${photo}</div>
      ${shownInfo.length ? `<div class="info">${shownInfo.map((x) => `<div><span class="k">${x[0]}：</span>${esc(x[1])}</div>`).join('')}</div>` : ''}`;

  const sec = (key, title, inner) => {
    const body = inner();
    if (!body || !show(key)) return '';
    const lb = d.lang === 'en' && EN_TITLES[title] ? EN_TITLES[title] : title;
    const h = t.head === 'bar' ? `<div class="secbar">${lb}</div>`
      : t.head === 'plain' ? `<div class="secp">${lb}</div>`
        : `<div class="secu">${lb}</div>`;
    return `<div class="sec">${h}${body}</div>`;
  };
  const exp = (o) => `<div class="exphead"><b>${esc(o.company || o.name || '')}</b>${has(o.role) ? `<span class="role">${esc(o.role)}</span>` : ''}<span class="tm">${[o.start, o.end].filter(Boolean).join(' – ')}</span></div>`;

  const edu = () => (d.education || []).map((e) => `${exp(e)}${has(e.note) ? `<div class="infoline">${esc(e.note)}</div>` : ''}`).join('');
  const item = (o, body) => t.timeline ? `<div class="tl"><div class="node">${exp(o)}${body}</div></div>` : exp(o) + body;
  const work = () => (d.work || []).map((w) => {
    const body = (w.bullets || []).filter(has).length
      ? `<ul class="ul">${w.bullets.filter(has).map((x) => `<li>${esc(String(x).replace(/^[•·-]\s*/, ''))}</li>`).join('')}</ul>` : '';
    return item(w, body);
  }).join('');
  const prj = () => (d.projects || []).map((p) => item(p, has(p.desc) ? `<div class="infoline">${esc(p.desc)}</div>` : '')).join('');
  const skl = () => {
    const named = (d.skills || []).filter((s) => has(s.name));
    if (t.ats) {
      const asText = named.length ? `<div class="infoline">${named.map((s) => `${esc(s.name)}（${Math.min(100, Number(s.level) || 60)}%）`).join('；')}</div>` : '';
      const tagText = (d.skillTags || []).filter(has).length ? `<div class="infoline">${esc((d.skillTags || []).filter(has).join('、'))}</div>` : '';
      return asText + tagText;
    }
    const bars = named.map((s) =>
      `<div class="skl"><span>${esc(s.name)}</span><span class="track"><i style="width:${Math.min(100, Number(s.level) || 60)}%"></i></span></div>`).join('');
    const tags = (d.skillTags || []).filter(has).length ? `<div class="tags" style="margin-top:6px">${d.skillTags.filter(has).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : '';
    return bars + tags;
  };
  const cert = () => {
    const a = (d.certs || []).filter((c) => has(c.name)).map((c) => `<li>${esc(c.name)}${has(c.date) ? `　<span style="color:#8d97a3">${esc(c.date)}</span>` : ''}</li>`).join('');
    const w = (d.awards || []).filter(has).map((x) => `<li>${esc(x)}</li>`).join('');
    return a || w ? `<ul class="ul">${a}${w}</ul>` : '';
  };
  const sum = () => (has(d.summary) ? `<div class="infoline" style="white-space:pre-wrap">${esc(d.summary)}</div>` : '');

  const main = [
    sec('education', '教育经历', edu),
    sec('work', '工作经历', work),
    sec('projects', '项目经历', prj),
    sec('skills', '专业技能', skl),
    sec('certs', '证书与荣誉', cert),
    sec('summary', '自我评价', sum),
  ].join('');

  const vars = `--accent:${t.accent};--secondary:${t.secondary};--tagbg:${mix(t.accent, '#ffffff', 0.88)};--sf:${t.sf};--lh:${t.lh};--ls:${t.ls}px;--dens:${t.dens};`;
  const family = t.font === 'serif' ? 'Georgia,"Songti SC","SimSun",serif'
    : t.font === 'mix' ? 'inherit' : 'inherit';
  const cls = `page layout-${t.layout} font-${t.font} st-${t.style || 'classic'}${t.timeline ? ' has-tl' : ''}${t.ats ? ' is-ats' : ''}`;

  if (t.layout === 'banner') {
    return `<div class="${cls}" style="${vars};font-family:${family}">
      <div class="band" style="background:${t.accent}">${head}</div><div class="wrap">${main}</div></div>`;
  }
  if (t.layout === 'sidebar') {
    const side = `${head}<div class="secu">专业技能</div>${skl() || '<div class="sb">—</div>'}
      <div class="secu">证书与荣誉</div><div class="sb">${(d.certs || []).filter((c) => has(c.name)).map((c) => esc(c.name)).join('、') || '—'}</div>
      <div class="secu">联系方式</div><div class="sb">${shownInfo.map((x) => esc(x[1])).join('<br/>') || '—'}</div>`;
    return `<div class="${cls}" style="${vars};font-family:${family}">
      <div class="side" style="background:${t.accent}">${side}</div>
      <div class="main">${[sec('education', '教育经历', edu), sec('work', '工作经历', work), sec('projects', '项目经历', prj), sec('certs', '证书与荣誉', cert), sec('summary', '自我评价', sum)].join('')}</div></div>`;
  }
  if (t.layout === 'magazine') {
    return `<div class="${cls}" style="${vars};font-family:${family}">${head}<div class="rule"></div><div class="body">${main}</div></div>`;
  }
  return `<div class="${cls}" style="${vars};font-family:${family}">${head}<div class="rule"></div>${main}</div>`;
}

function mix(hex, hex2, ratio) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  try {
    const a = p(hex), b = p(hex2);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * ratio).toString(16).padStart(2, '0')).join('');
  } catch { return '#eef2f7'; }
}

function renderPreview() {
  const r = curResume();
  if (!r) { $('#paper').innerHTML = ''; return; }
  $('#paper').innerHTML = pageHTML(r);
  const el = $('#paper .page');
  if (el) {
    const pages = Math.max(1, Math.ceil(el.scrollHeight / 1122));
    const pct = completeness(r);
    $('#pageInfo').textContent = `约 ${pages} 页 · 完成度 ${pct}% · ${LAYOUTS.find((l) => l[0] === r.layout)[1]}`;
  }
}

function completeness(r) {
  const d = r.data || {}; const b = d.base || {};
  const checks = [has(b.name), has(b.intent), has(b.phone), has(b.email), (d.education || []).length, (d.work || []).length,
    (d.work || []).some((w) => (w.bullets || []).filter(has).length >= 2), (d.skills || []).length + (d.skillTags || []).length >= 4,
    has(d.summary), (d.certs || []).length + (d.awards || []).length > 0];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/* --------------------------------------------------------------- 建议 */
function buildSuggestions() {
  const r = curResume();
  if (!r) return [];
  const d = r.data; const b = d.base;
  const out = [];
  const push = (t, desc, act, kind) => { if (!state.dismissed[t]) out.push({ t, desc, act, kind }); };

  if (!has(b.name)) push('姓名未填', '简历标题位置是空的，HR 第一眼要看到你叫什么。', () => focusField('base.name'));
  if (!has(b.intent)) push('求职意向未填', '写清楚应聘岗位，例如「结构开发工程师」，别写「技术类岗位」。', () => focusField('base.intent'));
  if (has(b.phone) && !/^[\d+\-\s()]{7,20}$/.test(b.phone)) push('电话格式可疑', `当前填写：${b.phone}。建议用手机号，方便直接拨。`, () => focusField('base.phone'));
  if (has(b.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) push('邮箱格式可疑', `当前填写：${b.email}。注意别漏 @ 或域名后缀。`, () => focusField('base.email'));
  if (!(d.work || []).length) push('缺工作经历', '至少写一段实习或工作，没有正式工作可用项目/课程设计代替。', () => go('edit'));
  if ((d.work || []).length && !d.work.some((w) => (w.bullets || []).filter(has).length >= 3))
    push('每段经历建议 3 条要点', '少于 3 条会显得单薄。用「负责什么 → 怎么做 → 结果数字」三段式。', () => go('edit'), 'warn');
  const q = (d.work || []).some((w) => (w.bullets || []).some((x) => /\d+(\.\d+)?\s*(%|万|k|元|台|套|天|小时|人)/.test(String(x))));
  if ((d.work || []).length && !q) push('成果缺少量化', '通篇没有数字。加一个「降本 x%」「交期缩短 x 天」这类硬指标，通过率明显不同。', () => go('edit'), 'warn');
  if ((d.skillTags || []).length + (d.skills || []).length < 4) push('技能太少', '至少 4-6 个可被搜索到的关键词（软件、标准、工艺名）。', () => focusField('#tags'));
  if (!has(d.summary)) push('自我评价为空', '3-5 句就够：年限 + 核心能力 + 代表成果 + 动机。', () => focusField('summary'));
  else if (String(d.summary).length < 40) push('自我评价偏短', '太短的自我评价容易被跳过，补一句能量化的成果。', () => focusField('summary'), 'warn');
  if (String(d.summary || '').includes('吃苦耐劳') || String(d.summary || '').includes('团队合作精神'))
    push('自我评价有套话', '「吃苦耐劳」这类词占版面但不传递信息，换成具体事例。', () => focusField('summary'), 'warn');

  const gl = state.glossary[r.profession] || [];
  const used = new Set((d.work || []).flatMap((w) => (w.bullets || []).map((x) => String(x).trim())));
  for (const g of gl.filter((x) => x.kind === '职责句式' || x.kind === '成果句式').slice(0, 6)) {
    if (used.has(g.text.trim())) continue;
    push(`词库：${g.text.slice(0, 14)}…`, `按「${g.kind}」补进最近一段经历，记得把数字改成你自己的。`, () => insertBullet(g.text), 'ok');
  }
  return out;
}

function insertBullet(text) {
  const r = curResume();
  if (!r) return;
  if (!r.data.work.length) r.data.work = [{ company: '', role: '', start: '', end: '', bullets: [] }];
  const last = r.data.work[r.data.work.length - 1];
  last.bullets = last.bullets || [];
  last.bullets.push(text);
  markDirty();
  renderEditor();
  renderPreview();
  renderSuggestions();
}
function focusField(p) {
  go('edit');
  setTimeout(() => {
    const el = $(`#editor [data-p="${p}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
  }, 60);
}
function renderSuggestions() {
  const list = buildSuggestions();
  $('#rvBadge').textContent = list.length;
  $('#rvList').innerHTML = list.length ? list.map((s, i) =>
    `<div class="rv-item ${s.kind === 'warn' ? 'warn' : ''}"><span class="sw"></span>
      <div><div class="t">${esc(s.t)}</div><div class="d">${esc(s.desc)}</div></div>
      <div class="btns"><button class="rv-ok" data-sug="${i}">去处理</button><button class="rv-no" data-ign="${i}">忽略</button></div>
    </div>`).join('') : '<div class="rv-empty">没有待办建议，可以导出了。</div>';
}

/* --------------------------------------------------- 岗位 JD 关键词匹配 */
const JD_STOP = new Set(('的 了 和 与 及 或 在 是 对 能 会 有 并 等 您 我们 你 我 他 她 它 这 那 之 也 都 很 更 最 各 每 由 以 于 类 相关 要求 具备 优先 优先录用 工作 经验 能力 团队 沟通 学习 职位 岗位 公司 以上 以下 左右 年 职责 学历 专业 熟悉 了解 掌握 熟练 精通 参与 完成 进行 良好 较强 扎实 至少 具有 从事 负责 承担 协助 配合 推动 落地 提供 确保 保证 制定 输出 编写 撰写 维护 优化 支持 服务 客户 用户 项目 产品 业务 部门 任职 条件 薪资 待遇 地点 时间 年龄 性别 全日制 加分项 任职要求 岗位职责 职位描述 岗位职责').split(/\s+/).filter(Boolean));

function resumeCorpus(r) {
  const d = r.data || {}; const parts = [];
  (d.skillTags || []).forEach((x) => parts.push(x));
  (d.skills || []).forEach((s) => { if (s.name) parts.push(s.name); });
  (d.certs || []).forEach((c) => { if (c.name) parts.push(c.name); });
  (d.awards || []).forEach((a) => parts.push(a));
  (d.education || []).forEach((e) => { parts.push(e.major || ''); parts.push(e.note || ''); });
  (d.work || []).forEach((w) => { parts.push(w.role || ''); parts.push(w.company || ''); (w.bullets || []).forEach((b) => parts.push(b)); });
  (d.projects || []).forEach((p) => { parts.push(p.name || ''); parts.push(p.role || ''); parts.push(p.desc || ''); });
  parts.push(d.base && d.base.intent ? d.base.intent : '');
  parts.push(d.summary || '');
  return parts.filter(Boolean).join(' \n ');
}
function jdTerms(text) {
  const map = new Map();
  (text.match(/[A-Za-z][A-Za-z0-9+#.&\-\/]{1,}/g) || []).forEach((t) => {
    const u = t.toUpperCase();
    if (t.length >= 2 && !JD_STOP.has(u) && !JD_STOP.has(t)) map.set(u, t);
  });
  // 中文：去标点后的连续汉字串，剥掉开头连接词/动词与结尾虚词，只留 2-6 字、不含虚词/停用词的技能型名词
  const NOISE = /[的了和与及或有能会着过很更最就都也还把被让请之者项]/;
  const LEAD = /^[与和及的在由为从对把被让使请懂会能可要需应从事负责具备掌握熟悉了解熟练精通能够具有拥有优先加分]+/;
  const TAIL = /[的了等以上以下优先经验能力岗位]+$/;
  (text.match(/[一-龥]{2,}/g) || []).forEach((run) => {
    let r = run.replace(LEAD, '').replace(TAIL, '');
    if (r.length >= 2 && r.length <= 6 && !NOISE.test(r) && !JD_STOP.has(r) && !JD_STOP.has(run)) map.set(r, r);
  });
  return Array.from(map.entries());
}
function analyzeJd() {
  const r = curResume(); if (!r) { toast('先新建一份简历', true); return; }
  const jd = $('#jdText').value.trim();
  if (jd.length < 15) { $('#jdResult').innerHTML = '<p class="fine">粘贴的 JD 太短，至少几十个字。</p>'; return; }
  const corpus = resumeCorpus(r), corpusU = corpus.toUpperCase();
  const terms = jdTerms(jd);
  const hit = [], miss = [];
  for (const [term, disp] of terms) {
    const inResume = /[A-Za-z]/.test(disp) ? corpusU.includes(term) : corpus.includes(disp);
    (inResume ? hit : miss).push(disp);
  }
  const total = hit.length + miss.length;
  const pct = total ? Math.round((hit.length / total) * 100) : 0;
  const jdU = jd.toUpperCase();
  const mySkills = (r.data.skillTags || []).concat((r.data.skills || []).map((s) => s.name)).filter(Boolean);
  const extra = mySkills.filter((s) => s && !jdU.includes(s.toUpperCase()) && !jd.includes(s));
  renderJdResult(pct, hit, miss, extra);
}
function renderJdResult(pct, hit, miss, extra) {
  const verdict = pct >= 70 ? '匹配度较高，把命中关键词写进经历要点里即可。' : pct >= 40 ? '有一定匹配，建议补齐下面的缺口关键词。' : '匹配度偏低，考虑换更对口的岗位或针对性补技能。';
  let html = `<div class="jd-score">
    <div class="jd-ring" style="--p:${pct}"><i>${pct}%</i></div>
    <div class="jd-verdict"><b>关键词命中 ${hit.length}/${hit.length + miss.length}</b><br>${verdict}</div>
  </div>`;
  if (miss.length) html += `<div class="jd-group"><h4>建议补充（JD 要求、简历里暂时没有）</h4><div class="jd-chips">${miss.map((t) => `<span class="jd-kw miss">${esc(t)}<button data-jdadd="${esc(t)}">+技能</button></span>`).join('')}</div></div>`;
  if (hit.length) html += `<div class="jd-group"><h4>已命中（记得在经历要点里体现）</h4><div class="jd-chips">${hit.map((t) => `<span class="jd-kw hit">${esc(t)}</span>`).join('')}</div></div>`;
  if (extra.length) html += `<div class="jd-group"><h4>JD 未提及、但你会（可考虑弱化）</h4><div class="jd-chips">${extra.slice(0, 12).map((t) => `<span class="jd-kw">${esc(t)}</span>`).join('')}</div></div>`;
  $('#jdResult').innerHTML = html;
}
function jdAddSkill(term) {
  const r = curResume(); if (!r) return;
  r.data.skillTags = r.data.skillTags || [];
  if (r.data.skillTags.includes(term)) return toast('技能里已有：' + term);
  r.data.skillTags.push(term);
  markDirty(); renderEditor(); renderPreview(); renderSuggestions(); analyzeJd();
  toast('已加入技能：' + term);
}

/* --------------------------------------------------------------- 保存 */
function markDirty() {
  state.dirty = true;
  $('#saveState').textContent = '未保存…';
  $('#saveState').className = 'save';
  clearTimeout(state.timer);
  state.timer = setTimeout(save, 1400);
}
function syncSaveState() {
  $('#saveState').textContent = state.me ? (state.cur ? '已同步' : '') : '本地草稿';
  $('#saveState').className = 'save';
}

async function save(manual) {
  const r = curResume();
  if (!r) return;
  state.dirty = false;
  if (!state.me) {
    saveGuest();
    state.guest.activeId = r.id;
    saveGuest();
    $('#saveState').textContent = '本地已存 ' + now();
    return;
  }
  try {
    $('#saveState').textContent = '保存中…';
    if (!r.serverId) {
      const out = await API.call('/api/resumes', { method: 'POST', body: JSON.stringify({ name: r.name, layout: r.layout, theme: { ...r.theme, profession: r.profession || '' }, data: r.data, score: completeness(r), label: r.label || '' }) });
      r.serverId = out.resume.id;
      r.version = out.resume.version;
      state.resumes.unshift({ ...out.resume });
    } else {
      const out = await API.call('/api/resumes/' + r.serverId, { method: 'PATCH', body: JSON.stringify({ name: r.name, layout: r.layout, theme: { ...r.theme, profession: r.profession || '' }, data: r.data, score: completeness(r), label: r.label || '', snapshot: !!manual }) });
      r.version = out.resume.version;
      const idx = state.resumes.findIndex((x) => x.id === r.serverId);
      if (idx >= 0) state.resumes[idx] = { ...state.resumes[idx], name: r.name, updated_at: out.resume.updated_at, version: out.resume.version };
    }
    $('#saveState').textContent = '已保存 ' + now();
    if (manual) toast('已存为一个版本，可在「版本历史」回退');
  } catch (e) {
    $('#saveState').textContent = '保存失败';
    $('#saveState').className = 'save err';
    toast(e.message, true);
  }
}

/* --------------------------------------------------------------- 我的简历 */
async function loadResumes() {
  if (!state.me) { state.resumes = []; return; }
  const out = await API.call('/api/resumes');
  state.resumes = out.resumes || [];
}

async function renderMine() {
  const raw = state.me
    ? state.resumes.slice()
    : state.guest.resumes.map((r) => ({ id: r.id, name: r.name, layout: r.layout, version: r.version, score: completeness(r), label: r.label || '', updated_at: null, _g: r }));
  const labels = Array.from(new Set(raw.map((x) => x.label || '').filter(Boolean)));
  const lf = $('#labelFilter');
  lf.innerHTML = labels.length
    ? ['全部', '未分组'].concat(labels).map((l) => '<button data-lf="' + esc(l) + '" class="' + ((state.labelFilter || '全部') === l ? 'on' : '') + '">' + esc(l) + '</button>').join('')
    : '';
  const shown = raw.filter((x) => {
    const v = state.labelFilter || '全部';
    if (v === '全部') return true;
    if (v === '未分组') return !(x.label || '');
    return (x.label || '') === v;
  });
  state.shown = shown;
  $('#resumeList').innerHTML = shown.length ? shown.map((x) => {
    const g = x._g || x;
    const lay = LAYOUTS.find((l) => l[0] === g.layout);
    const sc = Number(x.score || 0);
    const cid = curResume();
    const on = cid && (cid.serverId || cid.id) === x.id;
    const cls = 'it' + (on ? ' on' : '');
    return '<div class="' + cls + '">'
      + '<input type="checkbox" class="bsel" data-batch="' + esc(x.id) + '" ' + (state.sel.has(x.id) ? 'checked' : '') + ' />'
      + '<div class="grow"><div class="nm">' + esc(g.name) + '</div>'
      + '<div class="mt">' + (lay ? lay[1] : '') + ' · v' + (g.version || 1) + ' · ' + (x.updated_at ? fmtDate(x.updated_at) : '本地') + (x.label ? ' · ' + esc(x.label) : '') + '</div></div>'
      + '<div class="score ' + (sc >= 80 ? 'g' : sc >= 50 ? 'y' : 'r') + '" title="完善度评分">' + sc + '</div>'
      + '<div class="rt">'
      + '<button class="mini" data-open="' + esc(x.id) + '">打开</button>'
      + '<button class="mini" data-ren="' + esc(x.id) + '">改名</button>'
      + (state.me ? '<button class="mini" data-copy="' + esc(x.id) + '">复制</button><button class="mini" data-en="' + esc(x.id) + '">英文版</button>' : '')
      + '<button class="del" data-del="' + esc(x.id) + '">' + (state.me ? '回收' : '删除') + '</button>'
      + '</div></div>';
  }).join('') : '<p class="hint">还没有简历。可以到模板中心挑一个，或点顶栏「导入简历」把老简历灌进来。</p>';
  renderBatchBar();
  $('#guestTip').innerHTML = state.me
    ? '当前登录：<b>' + esc(state.me.username) + '</b>。简历只归属这个账号，其他用户看不到。'
    : '<b>游客模式</b>：内容只存在这台设备。注册账号后会自动带走；换电脑时用「导出 → 备份文件」搬家。<button class="mini" id="goAuth">注册 / 登录</button>';
  renderApps();
}

function renderBatchBar() {
  const bar = $('#batchBar');
  const list = state.shown || [];
  bar.hidden = !list.length;
  const n = state.sel.size;
  const all = list.length > 0 && list.every((x) => state.sel.has(x.id));
  const dis = n ? '' : 'disabled';
  bar.innerHTML = '<label class="toggle"><input type="checkbox" id="selAll" ' + (all ? 'checked' : '') + '/> 全选</label>'
    + '<span class="hint">已选 <b>' + n + '</b> 份</span><span class="bsp"></span>'
    + '<button class="mini" data-bop="label" ' + dis + '>打岗位标签</button>'
    + '<button class="mini" data-bop="export" ' + dis + '>打包导出</button>'
    + (state.me ? '<button class="mini" data-bop="duplicate" ' + dis + '>批量复制</button>'
      + '<button class="mini" data-bop="theme" ' + dis + '>批量套主题</button>' : '')
    + '<button class="del" data-bop="archive" ' + dis + '>' + (state.me ? '批量移入回收' : '批量删除') + '</button>';
}

async function batchOp(op, extra) {
  const ids = Array.from(state.sel);
  if (!ids.length) return toast('先勾选要处理的简历', true);
  if (!state.me) {
    if (op === 'archive') state.guest.resumes = state.guest.resumes.filter((r) => !state.sel.has(r.id));
    if (op === 'label') state.guest.resumes.forEach((r) => { if (state.sel.has(r.id)) r.label = (extra && extra.label) || ''; });
    saveGuest();
    state.sel.clear();
    renderMine();
    return toast('已处理本地简历');
  }
  try {
    const out = await API.call('/api/resumes/batch', { method: 'POST', body: JSON.stringify(Object.assign({ ids, op }, extra || {})) });
    await loadResumes();
    state.sel.clear();
    renderMine();
    toast('完成 ' + out.done + ' 份' + (out.skipped ? '，跳过 ' + out.skipped + ' 份' : ''));
  } catch (e) {
    toast(e.message, true);
  }
}

function pickThemeThen(cb) {
  $('#verMask').classList.add('on');
  $('#verList').innerHTML = '<p class="hint">选一套主题，应用到勾选的简历</p><div class="thgrid">' + RESUME_THEMES.map((t) => {
    const th = themeObj(t);
    return '<button class="thcard" data-pt="' + t.id + '"><span class="sth">' + mockThumb(th, th.layout) + '</span><span class="stn">' + t.name + '</span></button>';
  }).join('') + '</div>';
  $('#verList').onclick = (e) => {
    const b = e.target.closest('[data-pt]');
    if (!b) return;
    $('#verMask').classList.remove('on');
    $('#verList').onclick = null;
    const th = themeObj(RESUME_THEMES.find((x) => x.id === b.dataset.pt));
    cb({ layout: th.layout, style: th.style, themeId: th.themeId, accent: th.accent, head: th.head, font: th.font, dens: th.dens, lh: th.lh, timeline: th.timeline, ats: th.ats });
  };
}

async function batchExport() {
  const ids = Array.from(state.sel);
  if (!ids.length) return toast('先勾选要导出的简历', true);
  const items = [];
  for (const id of ids) {
    if (state.me) {
      try { items.push((await API.call('/api/resumes/' + id)).resume); } catch (err) { /* 跳过 */ }
    } else {
      const g = state.guest.resumes.find((x) => x.id === id);
      if (g) items.push(g);
    }
  }
  if (!items.length) return toast('没有可导出的内容', true);
  const payload = {
    app: 'resume-workshop', version: 2, exported_at: new Date().toISOString(),
    resumes: items.map((x) => ({ name: x.name, layout: x.layout, theme: x.theme, data: x.data, profession: (x.theme || {}).profession || '' })),
  };
  download(JSON.stringify(payload, null, 2), '简历打包-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
  toast('已导出 ' + items.length + ' 份');
}

function bindBatch() {
  $('#labelFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lf]');
    if (!b) return;
    state.labelFilter = b.dataset.lf === '全部' ? '' : b.dataset.lf;
    $$('#labelFilter button').forEach((x) => x.classList.toggle('on', x === b));
    renderMine();
  });
  $('#resumeList').addEventListener('change', (e) => {
    const c = e.target.closest('[data-batch]');
    if (!c) return;
    if (c.checked) state.sel.add(c.dataset.batch); else state.sel.delete(c.dataset.batch);
    renderBatchBar();
  });
  $('#resumeList').addEventListener('click', async (e) => {
    const ren = e.target.closest('[data-ren]');
    const en = e.target.closest('[data-en]');
    if (ren) {
      const id = ren.dataset.ren;
      const cur = state.me ? state.resumes.find((x) => x.id === id) : state.guest.resumes.find((x) => x.id === id);
      if (!cur) return;
      const nv = prompt('新的简历名称', cur.name);
      if (!nv || nv === cur.name) return;
      cur.name = nv.slice(0, 60);
      const c2 = curResume();
      if (c2 && (c2.serverId || c2.id) === id) c2.name = cur.name;
      if (state.me) await API.call('/api/resumes/' + id, { method: 'PATCH', body: JSON.stringify({ name: cur.name }) }).catch(() => {});
      else saveGuest();
      renderMine();
      return toast('已改名');
    }
    if (en) {
      try {
        const r = (await API.call('/api/resumes/' + en.dataset.en)).resume;
        const d = Object.assign({}, blankData(), r.data || {}, { lang: 'en' });
        await API.call('/api/resumes', { method: 'POST', body: JSON.stringify({ name: (r.name + ' EN').slice(0, 60), layout: r.layout, theme: r.theme, data: d, label: r.label || '' }) });
        await loadResumes();
        renderMine();
        toast('已生成英文版副本，板块标题变英文，内容请改写成英文');
      } catch (err) { toast(err.message, true); }
    }
  });
  $('#batchBar').addEventListener('click', (e) => {
    if (e.target.closest('#selAll')) {
      const on = !state.shown.every((x) => state.sel.has(x.id));
      state.shown.forEach((x) => (on ? state.sel.add(x.id) : state.sel.delete(x.id)));
      renderMine();
      return;
    }
    const b = e.target.closest('[data-bop]');
    if (!b || b.disabled) return;
    const op = b.dataset.bop;
    if (op === 'export') return batchExport();
    if (op === 'theme') return pickThemeThen((th) => batchOp('theme', { theme: th }));
    if (op === 'label') {
      const lb = prompt('岗位标签，用于分组，例如：结构工程师', '');
      if (lb === null) return;
      return batchOp('label', { label: lb.slice(0, 20) });
    }
    if (op === 'archive' && !confirm('把选中的 ' + state.sel.size + ' 份简历' + (state.me ? '移入回收' : '删除') + '？')) return;
    return batchOp(op);
  });
}

/* ------------------------------------------------------------- 导入向导 */
function openImport() {
  state.imp = null;
  $('#impResult').innerHTML = '';
  $('#impConfirm').disabled = true;
  $('#impName').value = '';
  $('#impMask').classList.add('on');
}
function readB64(f) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error('读取文件失败'));
    r.readAsDataURL(f);
  });
}
async function doImportParse(body) {
  $('#impResult').innerHTML = '<p class="hint">正在识别文字与段落…</p>';
  try {
    const out = await API.call('/api/import/parse', { method: 'POST', body: JSON.stringify(body) });
    if (out.kind === 'json') {
      state.imp = null;
      $('#impResult').innerHTML = '<p class="fine">这是本站备份文件，共 ' + out.resumes.length + ' 份。请用「导出 ▾ → 导入备份文件…」整批导入。</p>';
      return;
    }
    const d = out.data;
    state.imp = d;
    $('#impName').value = (d.base.name || '未识别姓名') + ' · 导入版';
    const pills = [['姓名', d.base.name || '未识别'], ['电话', d.base.phone || '—'], ['邮箱', d.base.email || '—'],
      ['城市', d.base.city || '—'], ['教育', d.education.length + ' 段'], ['工作', d.work.length + ' 段'],
      ['项目', d.projects.length + ' 个'], ['技能', (d.skillTags.length + d.skills.length) + ' 项']]
      .map((x) => '<span class="pill ' + (x[1] === '未识别' ? 'r' : 'g') + '">' + x[0] + '：' + esc(x[1]) + '</span>').join('');
    $('#impResult').innerHTML = '<div class="imp-sum">' + pills + '</div>'
      + '<p class="fine">' + ((out.notes || []).map(esc).join(' · ') || '识别完成，请核对后生成简历') + '</p>'
      + '<details><summary>看识别到的工作经历（' + d.work.length + '）</summary>'
      + (d.work.map((w, i) => '<div class="imp-w"><b>' + (i + 1) + '. ' + esc(w.company) + (w.role ? ' · ' + esc(w.role) : '') + '</b>'
        + '<span class="hint"> ' + esc(w.start || '?') + ' ~ ' + esc(w.end || '至今') + '</span>'
        + '<ul>' + (w.bullets || []).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>').join('')
        || '<p class="fine">没识别到工作经历，可生成后手动补。</p>')
      + '</details>';
    $('#impConfirm').disabled = false;
  } catch (e) {
    state.imp = null;
    $('#impResult').innerHTML = '<p class="fine" style="color:var(--red)">' + esc(e.message) + '</p>';
  }
}
async function confirmImport() {
  if (!state.imp) return;
  const r = {
    id: 'g' + uid(), name: ($('#impName').value || '导入的简历').slice(0, 60),
    layout: DEFAULT_THEME.layout, theme: Object.assign({}, DEFAULT_THEME, { hidden: [] }),
    data: Object.assign({}, blankData(), state.imp), version: 1, profession: '',
  };
  $('#impMask').classList.remove('on');
  newResume(r);
  toast('已生成简历，识别结果请逐条核对');
}
function bindImport() {
  $('#btnImport').addEventListener('click', openImport);
  $('#impTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]');
    if (!b) return;
    $$('#impTabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.imp-pane').forEach((p) => { p.hidden = p.dataset.src !== b.dataset.src; });
  });
  $('#impParse').addEventListener('click', () => {
    const t = $('#impText').value.trim();
    if (t.length < 20) return toast('粘贴的内容太短，至少几十个字', true);
    doImportParse({ text: t });
  });
  $('#impFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { doImportParse({ fileBase64: await readB64(f), filename: f.name }); } catch (err) { toast(err.message, true); }
    e.target.value = '';
  });
  $('#impPickJson').addEventListener('click', () => $('#fileJson').click());
  $('#impCancel').addEventListener('click', () => $('#impMask').classList.remove('on'));
  $('#impConfirm').addEventListener('click', confirmImport);
  $('#impMask').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('on'); });
}


async function renderApps() {
  $('#appForm').innerHTML = `<input class="t" id="apCompany" placeholder="公司" />
    <input class="t" id="apPos" placeholder="岗位" />
    <input class="t" id="apChan" placeholder="渠道（内推/BOSS/官网）" />
    <input class="t" id="apDate" type="date" />
    <select class="t" id="apStatus">${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select>
    <button class="btn navy" id="apAdd">记录一次投递</button>`;
  let items = [];
  if (state.me) { try { items = (await API.call('/api/applications')).items || []; } catch (e) { toast(e.message, true); } }
  else items = load('rw.apps', []);
  $('#appTable').innerHTML = items.length
    ? `<table class="tr"><tr><th>公司</th><th>岗位</th><th>渠道</th><th>日期</th><th>状态</th><th></th></tr>${items.map((a) =>
      `<tr><td>${esc(a.company)}</td><td>${esc(a.position || '')}</td><td>${esc(a.channel || '')}</td><td>${esc(a.applied_on || '')}</td>
        <td><span class="pill ${statusCls(a.status)}">${esc(a.status)}</span></td>
        <td style="text-align:right"><button class="del" data-appdel="${esc(a.id)}">删</button></td></tr>`).join('')}</table>`
    : '<p class="hint">记一记投了哪家、什么状态，避免重复投和跟进断档。</p>';
  $('#appTable').dataset.guest = JSON.stringify(items);
}
const statusCls = (s) => (['已 offer', '面试中'].includes(s) ? 'g' : ['不合适', '已撤回'].includes(s) ? 'r' : s === '谈薪' ? 'y' : '');

/* --------------------------------------------------------------- 账号 */
function renderAcct() {
  $('#acct').innerHTML = state.me
    ? `${state.me.role === 'admin' ? '<a class="mini" href="./admin.html">站长后台</a>' : ''}<span class="who"><b>${esc(state.me.username)}</b></span><button class="btn" id="btnLogout">退出</button>`
    : `<button class="btn navy" id="btnAuth">登录 / 注册</button>`;
  const bar = $('#guestBar');
  if (bar) bar.hidden = !!state.me;
  $('#btnExport').disabled = !curResume();
}
function showAuthPane(name) {
  $$('.auth-body').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  const first = { login: '#liName', reg: '#rgName', reset: '#rsName' }[name];
  setTimeout(() => { const el = $(first); if (el) el.focus(); }, 120);
}
function openAuth(tab) {
  $('#authMask').classList.add('on');
  showAuthPane(tab || 'login');
}
async function afterAuth(json) {
  state.token = json.token;
  localStorage.setItem(LS_TOKEN, json.token);
  state.me = json.user;
  const guestList = state.guest.resumes.slice(0, 10);
  state.guest = { resumes: [], activeId: '' };
  saveGuest();
  await loadResumes();
  renderAcct();
  go(state.resumes.length ? 'mine' : 'tpl');
  if (json.imported && json.imported.length) toast(`已把 ${json.imported.length} 份本地草稿带进账号`);
}

/* --------------------------------------------------------------- 导出 */
async function exportAs(kind) {
  const r = curResume();
  if (!r) return toast('先新建一份简历', true);
  if (kind === 'pdf') {
    renderPreview();
    setTimeout(() => window.print(), 120);
    return toast('打印窗口里选「另存为 PDF」，纸张 A4、边距默认');
  }
  if (kind === 'json') {
    let apps = [];
    try { apps = state.me ? ((await API.call('/api/applications')).items || []) : load('rw.apps', []); } catch (e) { apps = []; }
    const payload = { app: 'resume-workshop', version: 2, exported_at: new Date().toISOString(), resumes: (state.me ? await fetchAllServer() : state.guest.resumes).map((x) => ({ name: x.name, layout: x.layout, theme: x.theme, data: x.data, profession: x.profession || '' })), applications: apps.map((a) => ({ company: a.company || '', position: a.position || '', channel: a.channel || '', applied_on: a.applied_on || '', status: a.status || '已投递', resume_id: a.resume_id || '' })) };
    download(JSON.stringify(payload, null, 2), `简历备份-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    return toast('备份文件已下载，含全部简历 + 投递跟踪');
  }
  if (kind === 'docx') {
    try {
      const res = await fetch('/api/export/docx', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: { name: r.name, theme: r.theme, data: r.data } }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '导出失败');
      download(await res.blob(), `${r.name}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      toast('Word 文件已下载');
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (kind === 'png') {
    toast('正在生成图片…');
    try {
      if (!window.html2canvas) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      const el = $('#paper .page');
      const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      canvas.toBlob((b) => { download(b, `${r.name}.png`, 'image/png'); toast('PNG 已下载'); });
    } catch (e) { toast('图片导出需要加载外部库，当前网络不可用；可改用 PDF 打印', true); }
  }
}
async function fetchAllServer() {
  const out = [];
  for (const x of state.resumes) {
    try { out.push((await API.call('/api/resumes/' + x.id)).resume); } catch { /* 跳过 */ }
  }
  return out;
}
function download(data, filename, type) {
  const url = data instanceof Blob ? URL.createObjectURL(data) : URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function loadScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = no;
    document.body.appendChild(s);
  });
}

/* --------------------------------------------------------------- 交互 */
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on' + (bad ? ' bad' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.className = 'toast'), 3200);
}

function bind() {
  applyUi();
  bindBatch();
  bindImport();
  $('#menuUi').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ui]');
    if (!b) return;
    setUi(b.dataset.ui);
    $$('.dd').forEach((x) => x.classList.remove('open'));
  });
  if (mqDark) {
    const fn = () => { if (state.ui === 'auto') applyUi(); };
    if (mqDark.addEventListener) mqDark.addEventListener('change', fn); else if (mqDark.addListener) mqDark.addListener(fn);
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) go(b.dataset.view);
  });
  $$('.dd > button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = b.parentElement;
    const open = dd.classList.contains('open');
    $$('.dd').forEach((x) => x.classList.remove('open'));
    dd.classList.toggle('open', !open);
  }));
  document.addEventListener('click', () => $$('.dd').forEach((x) => x.classList.remove('open')));

  $('#menuNew').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.new === 'blank') { newResume(blankResume('未命名简历')); toast('已新建空白简历'); }
    else go('tpl');
  });
  $('#menuExport').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.exp === 'import') $('#fileJson').click();
    else exportAs(b.dataset.exp);
  });
  $('#tplSearch').addEventListener('input', renderTemplates);
  $('#tplGrid').addEventListener('click', (e) => {
    const use = e.target.closest('[data-use]');
    const pv = e.target.closest('[data-preview]');
    if (use) {
      const t = state.templates.find((x) => x.slug === use.dataset.use);
      newResume(fromTemplate(t));
      toast(`已套用「${t.title}」示例，直接改写即可`);
    }
    if (pv) {
      const t = state.templates.find((x) => x.slug === pv.dataset.preview);
      $('#verMask').classList.add('on');
      $('#verList').innerHTML = `<p class="hint">${esc(t.summary || '')}</p><div class="paper" style="transform:scale(.62);transform-origin:top center;margin-bottom:-120px">${pageHTML(fromTemplate(t))}</div>`;
    }
  });

  $('#editor').addEventListener('input', (e) => {
    const el = e.target;
    const p = el.dataset.p;
    if (!p) return;
    const r = curResume();
    const v = el.value;
    if (p === '#name') { r.name = v; renderMine(); }
    else if (p === '#lang') { r.data.lang = v; }
    else if (p === '#tags') { r.data.skillTags = v.split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean); }
    else if (p === '#awards') { r.data.awards = v.split('\n').map((x) => x.trim()).filter(Boolean); }
    else if (p === '#layout') { r.layout = v; r.theme.layout = v; }
    else if (p === '#theme.hidden') { /* 由 change 事件处理 */ }
    else if (p.startsWith('#theme.')) {
      const k = p.split('.')[1];
      r.theme[k] = el.type === 'range' || k === 'ls' || k === 'sf' || k === 'lh' || k === 'dens' ? Number(v) : v;
    } else setPath(r.data, p, v);
    if (el.type === 'range') { const s = el.parentElement.querySelector('span'); if (s && s !== el) s.textContent = el.type === 'range' && p.includes('level') ? v + '%' : Math.round(v * 100) + '%'; }
    renderPreview();
    renderSuggestions();
    markDirty();
  });
  $('#editor').addEventListener('change', (e) => {
    const el = e.target;
    const r = curResume();
    if (el.dataset.p === '#layout') { r.theme.layout = el.value; renderPreview(); renderMine(); }
    if (el.name === 'lay') { r.layout = el.value; r.theme.layout = el.value; renderPreview(); renderMine(); markDirty(); }
    if (el.dataset.p === '#theme.mask') { r.theme.mask = el.checked; renderPreview(); markDirty(); return; }
    if (el.name === 'lang') { r.data.lang = el.value; renderPreview(); markDirty(); return; }
    if (el.dataset.p === '#theme.hidden') {
      const on = $$('#editor [data-p="#theme.hidden"]').filter((x) => !x.checked).map((x) => x.value);
      r.theme.hidden = on;
      renderPreview();
      markDirty();
    }
    if (el.dataset.p && el.dataset.p.includes('level')) renderEditor();
  });
  $('#editor').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const r = curResume();
    const d = r.data;
    const act = b.dataset.act;
    const k = b.dataset.k;
    const i = Number(b.dataset.i);
    if (act === 'itemadd') {
      d[k] = d[k] || [];
      d[k].push(k === 'work' ? { company: '', role: '', start: '', end: '', bullets: [''] }
        : k === 'education' ? { school: '', major: '', degree: '', start: '', end: '', note: '' }
          : k === 'projects' ? { name: '', role: '', start: '', end: '', desc: '' }
            : k === 'skills' ? { name: '', level: 60 } : { name: '', date: '', org: '' });
    } else if (act === 'itemdel') { d[k].splice(i, 1); }
    else if (act === 'mvup' && i > 0) { [d[k][i - 1], d[k][i]] = [d[k][i], d[k][i - 1]]; }
    else if (act === 'mvdn' && i < d[k].length - 1) { [d[k][i + 1], d[k][i]] = [d[k][i], d[k][i + 1]]; }
    else if (act === 'btadd') { const arr = getPath(d, b.dataset.p); arr.push(''); }
    else if (act === 'btdel') { const ks = b.dataset.p.split('.'); const arr = getPath(d, ks.slice(0, -1).join('.')); arr.splice(Number(ks[ks.length - 1]), 1); }
    else if (act === 'skilladd') { d.skills.push({ name: '', level: 60 }); }
    else if (act === 'certadd') { d.certs.push({ name: '', date: '', org: '' }); }
    else if (act === 'extraadd') { d.extra.push({ k: '', v: '' }); }
    else if (act === 'theme') { const th = RESUME_THEMES.find((x) => x.id === b.dataset.t); if (th) applyTheme(r, th); }
    else if (act === 'thgrp') { state.thGroup = b.dataset.g; renderEditor(); return; }
    else if (act === 'palette') { r.theme.accent = b.dataset.c; }
    else if (act === 'photo') { $('#filePhoto').click(); return; }
    else if (act === 'photodel') { d.base.photo = ''; }
    renderEditor(); renderPreview(); renderSuggestions(); markDirty();
  });

  $('#filePhoto').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const max = 480;
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      curResume().data.base.photo = c.toDataURL('image/jpeg', 0.85);
      renderEditor(); renderPreview(); markDirty();
      toast('头像已处理（本地压缩，不上传原图）');
    };
    img.src = URL.createObjectURL(f);
  });
  $('#fileJson').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const list = Array.isArray(j.resumes) ? j.resumes : [];
      const apps = Array.isArray(j.applications) ? j.applications : [];
      if (!list.length && !apps.length) throw new Error('备份文件里没有内容');
      for (const x of list) {
        const r = { ...blankResume(x.name || '导入的简历'), layout: x.layout || 'default', theme: { ...DEFAULT_THEME, ...(x.theme || {}) }, data: { ...blankData(), ...(x.data || {}) }, profession: x.profession || '' };
        if (state.me) {
          await API.call('/api/resumes', { method: 'POST', body: JSON.stringify({ name: r.name, layout: r.layout, theme: r.theme, data: r.data }) });
        } else state.guest.resumes.unshift(r);
      }
      let appN = 0;
      for (const a of apps) {
        if (!a || !String(a.company || '').trim()) continue;
        if (state.me) { await API.call('/api/applications', { method: 'POST', body: JSON.stringify({ company: a.company, position: a.position, channel: a.channel, applied_on: a.applied_on, status: a.status }) }).catch(() => {}); }
        else { const arr = load('rw.apps', []); arr.unshift({ ...a, id: uid() }); localStorage.setItem('rw.apps', JSON.stringify(arr)); }
        appN++;
      }
      saveGuest();
      if (state.me) await loadResumes();
      $('#impMask').classList.remove('on');
      toast(`已导入 ${list.length} 份简历` + (appN ? ` + ${appN} 条投递` : ''));
      go('mine');
    } catch (err) { toast('导入失败：' + err.message, true); }
    e.target.value = '';
  });

  $('#rvFab').addEventListener('click', () => { renderSuggestions(); $('#rvMask').classList.add('on'); });
  $('#rvClose').addEventListener('click', () => $('#rvMask').classList.remove('on'));
  $('#rvList').addEventListener('click', (e) => {
    const ok = e.target.closest('[data-sug]');
    const ign = e.target.closest('[data-ign]');
    const list = buildSuggestions();
    if (ok) { const s = list[Number(ok.dataset.sug)]; if (s && s.act) s.act(); $('#rvMask').classList.remove('on'); }
    if (ign) { const s = list[Number(ign.dataset.ign)]; state.dismissed[s.t] = 1; renderSuggestions(); }
  });

  $('#btnSaveVer').addEventListener('click', () => save(true));
  $('#btnPrevVer').addEventListener('click', showVersions);
  $('#verClose').addEventListener('click', () => $('#verMask').classList.remove('on'));
  $('#btnJd').addEventListener('click', () => {
    if (!curResume()) return toast('先新建一份简历', true);
    $('#jdMask').classList.add('on'); $('#jdResult').innerHTML = '';
    setTimeout(() => $('#jdText').focus(), 80);
  });
  $('#jdRun').addEventListener('click', analyzeJd);
  $('#jdClear').addEventListener('click', () => { $('#jdText').value = ''; $('#jdResult').innerHTML = ''; });
  $('#jdClose').addEventListener('click', () => $('#jdMask').classList.remove('on'));
  $('#jdResult').addEventListener('click', (e) => { const b = e.target.closest('[data-jdadd]'); if (b) jdAddSkill(b.dataset.jdadd); });
  $('#verList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rv]');
    if (!b) return;
    const r = curResume();
    if (!r || !r.serverId) return toast('先保存一次', true);
    try {
      await API.call(`/api/resumes/${r.serverId}/restore`, { method: 'POST', body: JSON.stringify({ version: Number(b.dataset.rv) }) });
      const rr = (await API.call('/api/resumes/' + r.serverId)).resume;
      setCur({ ...r, name: rr.name, layout: rr.layout, theme: { ...DEFAULT_THEME, ...(rr.theme || {}) }, data: { ...blankData(), ...(rr.data || {}) }, version: rr.version });
      $('#verMask').classList.remove('on');
      toast(`已回退到 v${b.dataset.rv}`);
    } catch (err) { toast(err.message, true); }
  });
  $('#resumeList').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    const c = e.target.closest('[data-copy]');
    const d = e.target.closest('[data-del]');
    if (o) {
      const id = o.dataset.open;
      if (state.me) {
        const r = (await API.call('/api/resumes/' + id)).resume;
        setCur({ id, serverId: id, name: r.name, layout: r.layout, theme: { ...DEFAULT_THEME, ...(r.theme || {}) }, data: { ...blankData(), ...(r.data || {}) }, version: r.version, profession: (r.theme || {}).profession || '' });
      } else {
        setCur(state.guest.resumes.find((x) => x.id === id));
        state.guest.activeId = id; saveGuest();
      }
      go('edit');
    }
    if (c) {
      const out = await API.call('/api/resumes/' + c.dataset.copy + '/duplicate', { method: 'POST', body: '{}' });
      await loadResumes(); renderMine();
      toast('已复制一份');
    }
    if (d) {
      if (!confirm('确定删除这份简历？' + (state.me ? '（会先进回收状态，可随时找我恢复）' : '（本地删除不可恢复，建议先导出备份）'))) return;
      if (state.me) { await API.call('/api/resumes/' + d.dataset.del, { method: 'DELETE' }); await loadResumes(); }
      else { state.guest.resumes = state.guest.resumes.filter((x) => x.id !== d.dataset.del); saveGuest(); }
      if (curResume() && curResume().id === d.dataset.del) state.cur = null;
      renderMine(); renderAcct();
    }
  });
  $('#appTable').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-appdel]');
    if (!del) return;
    if (state.me) await API.call('/api/applications/' + del.dataset.appdel, { method: 'DELETE' });
    else localStorage.setItem('rw.apps', JSON.stringify(load('rw.apps', []).filter((x) => x.id !== del.dataset.appdel)));
    renderApps();
  });
  $('#appForm').addEventListener('click', async (e) => {
    if (e.target.id !== 'apAdd') return;
    const item = {
      company: $('#apCompany').value.trim(), position: $('#apPos').value.trim(), channel: $('#apChan').value.trim(),
      applied_on: $('#apDate').value || new Date().toISOString().slice(0, 10), status: $('#apStatus').value,
      resume_id: state.me && curResume() ? curResume().serverId || '' : '',
    };
    if (!item.company) return toast('公司名不能为空', true);
    if (state.me) await API.call('/api/applications', { method: 'POST', body: JSON.stringify(item) });
    else { const arr = load('rw.apps', []); arr.unshift({ ...item, id: uid() }); localStorage.setItem('rw.apps', JSON.stringify(arr)); }
    ['apCompany', 'apPos', 'apChan'].forEach((k) => ($('#' + k).value = ''));
    renderApps();
    toast('已记录');
  });
  $('#guestTip').addEventListener('click', (e) => { if (e.target.id === 'goAuth') openAuth('reg'); });
  $('#guestBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) openAuth(b.dataset.goto);
  });
  $('#acct').addEventListener('click', async (e) => {
    if (e.target.closest('#btnAuth')) return openAuth();
    if (!e.target.closest('#btnLogout')) return;
    try { await API.call('/api/me', { method: 'POST' }); } catch { /* 忽略 */ }
    state.token = ''; state.me = null; localStorage.removeItem(LS_TOKEN);
    state.resumes = []; state.cur = null;
    renderAcct(); go('tpl'); toast('已退出，本地草稿不受影响');
  });
  $('#authX').addEventListener('click', () => $('#authMask').classList.remove('on'));
  $('.auth').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) showAuthPane(b.dataset.go);
  });
  $('#authMask').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('on'); });
  $$('.rv-mask, .modal-mask').forEach((m) => m.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('on'); }));
  $('#doLogin').addEventListener('click', async () => {
    try {
      const j = await API.call('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#liName').value.trim(), password: $('#liPass').value }) });
      $('#authMask').classList.remove('on');
      await afterAuth(j);
      toast(`欢迎回来，${j.user.username}`);
    } catch (e) { toast(e.message, true); }
  });
  $('#doReg').addEventListener('click', async () => {
    try {
      const guest = { resumes: state.guest.resumes.map((r) => ({ name: r.name, layout: r.layout, theme: r.theme, data: r.data })) };
      const j = await API.call('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: $('#rgName').value.trim(), password: $('#rgPass').value, code: $('#rgCode').value.trim(), guestData: guest.resumes.length ? guest : undefined }),
      });
      $('#authMask').classList.remove('on');
      await afterAuth(j);
      showRestoreCode(j.restoreCode);
    } catch (e) { toast(e.message, true); }
  });
  $('#doReset').addEventListener('click', async () => {
    try {
      const j = await API.call('/api/reset', {
        method: 'POST',
        body: JSON.stringify({ username: $('#rsName').value.trim(), restoreCode: $('#rsCode').value.trim(), newPassword: $('#rsPass').value }),
      });
      $('#authMask').classList.remove('on');
      toast('密码已重置，请用新密码登录');
      if (j.restoreCode) showRestoreCode(j.restoreCode, true);
    } catch (e) { toast(e.message, true); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (curResume()) save(true); }
  });
  window.addEventListener('beforeunload', () => { if (state.dirty) save(); });
  window.addEventListener('resize', moveSegment);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveSegment).catch(() => {});
}

function showRestoreCode(code, again) {
  $('#verMask').classList.add('on');
  $('#verList').innerHTML = `<p><b>${again ? '新的恢复码（本次有效）' : '你的恢复码'}</b></p>
    <p style="font:16px/1.6 ui-monospace,Menlo,Consolas,monospace;letter-spacing:2px;background:var(--soft);padding:10px;border-radius:8px">${esc(code)}</p>
    <p class="hint">忘记密码时，在「恢复码重置密码」里输入用户名 + 这串码即可自助重设。这是唯一凭证，请保存到密码管理器，不要发到群里。</p>`;
}
async function showVersions() {
  const r = curResume();
  if (!r) return;
  if (!state.me) { $('#verMask').classList.add('on'); $('#verList').innerHTML = '<p class="hint">版本历史需要登录账号后开启。</p>'; return; }
  if (!r.serverId) { toast('先保存一次'); return; }
  const out = await API.call(`/api/resumes/${r.serverId}/versions`);
  $('#verMask').classList.add('on');
  $('#verList').innerHTML = (out.versions || []).length
    ? out.versions.map((v) => `<div class="it"><span>v${v.version} · ${fmtDate(v.created_at)}</span><button class="mini" data-rv="${v.version}">回退到这里</button></div>`).join('')
    : '<p class="hint">还没有历史版本。每次保存间隔 3 分钟以上会自动留一档，或点「存一个版本」强制留档。</p>';
}

/* ------------------------------------------------------------- 界面外观 */
const mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const isDark = () => state.ui === 'dark' || (state.ui === 'auto' && !!(mqDark && mqDark.matches));
function applyUi() {
  document.documentElement.dataset.ui = isDark() ? 'dark' : 'light';
  $$('#menuUi button').forEach((b) => b.classList.toggle('on', b.dataset.ui === state.ui));
  const btn = $('#btnUi');
  if (btn) btn.textContent = `${state.ui === 'dark' ? '暗色' : state.ui === 'light' ? '亮色' : '外观'} ▾`;
}
function setUi(mode) {
  state.ui = mode;
  localStorage.setItem('rw.ui', mode);
  applyUi();
}

/* ---------------------------------------------------------------- 启动 */
async function boot() {
  bind();
  try {
    const [bs, full] = await Promise.all([API.call('/api/bootstrap'), API.call('/api/templates')]);
    state.me = bs.me || null;
    state.meta = { ...(bs.meta || {}), ...(full.meta || {}) };
    state.templates = full.templates || [];
    state.glossary = full.glossary || {};
  } catch (e) {
    toast('模板库加载失败：' + e.message, true);
  }
  if (state.me) await loadResumes();
  if (state.me && state.resumes.length) {
    const r = (await API.call('/api/resumes/' + state.resumes[0].id)).resume;
    setCur({ id: r.id, serverId: r.id, name: r.name, layout: r.layout, theme: { ...DEFAULT_THEME, ...(r.theme || {}) }, data: { ...blankData(), ...(r.data || {}) }, version: r.version });
  } else if (!state.me && state.guest.resumes.length) {
    state.guest.resumes.forEach((r) => { r.theme = { ...DEFAULT_THEME, ...(r.theme || {}) }; r.data = { ...blankData(), ...(r.data || {}) }; });
    const first = state.guest.resumes.find((x) => x.id === state.guest.activeId) || state.guest.resumes[0];
    setCur(first);
  } else {
    $('#editor').innerHTML = '<p class="hint">先到「模板中心」挑一个职业模板，或点右上角「新建简历 → 空白简历」。</p>';
  }
  renderAcct();
  renderTemplates();
  go(state.cur ? 'edit' : 'tpl');
}
boot();
