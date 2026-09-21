/* 简历文本解析：无第三方依赖。支持 .docx（自己解 ZIP + 抽段落）、txt/md、粘贴文本。
 * 输出与前端 blankData() 同构的数据 + 解析说明，交由用户在导入向导里核对后再落库。
 */
import zlib from 'node:zlib';

/* --------------------------------------------------------- docx 文本抽取 */
function unzipTexts(buf) {
  const out = {};
  let p = 0;
  while (p + 4 <= buf.length) {
    if (buf.readUInt32LE(p) !== 0x04034b50) break;
    const method = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26);
    const elen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nlen).toString('utf8');
    const start = p + 30 + nlen + elen;
    const raw = buf.slice(start, start + csize);
    try {
      if (method === 0) out[name] = raw;
      else if (method === 8) out[name] = zlib.inflateRawSync(raw, { finishFlush: zlib.constants.ZLIB_FINISH });
    } catch { /* 跳过坏条目 */ }
    p = start + csize;
  }
  return out;
}

export function docxToText(buf) {
  const files = unzipTexts(buf);
  const xml = (files['word/document.xml'] || Buffer.from('')).toString('utf8');
  if (!xml) throw new Error('这个 .docx 里找不到正文，可能不是有效的 Word 文件');
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------- 文本解析 */
const PHONE = /(?:\+?86[\s-]?)?(1[3-9]\d[\s-]?\d{4}[\s-]?\d{4})/;
const MAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const DATE_RANGE = /(20\d{2})\s*[年./-]\s*(\d{1,2})?\s*[月.]?\s*[-–—~至到]{1,2}\s*(至今|现在|20\d{2}\s*[年./-]?\d{0,2})/;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[•·\-—*\d.、)\s]+/, '').trim();
const month = (y, m) => (y ? `${y}-${String(m || '01').padStart(2, '0')}` : '');

function parseRange(seg) {
  const m = seg.match(DATE_RANGE);
  if (m) {
    const endRaw = m[3] || '';
    const ey = (endRaw.match(/20\d{2}/) || [])[0];
    const em = (endRaw.match(/[.\-\/年]\s*(\d{1,2})/) || [])[1];
    return { start: month(m[1], m[2]), end: ey ? month(ey, em) : '至今' };
  }
  const toks = seg.match(/20\d{2}(?:[./\-]\d{1,2})?/g) || [];
  if (!toks.length) return { start: '', end: '' };
  const norm = (t) => {
    const mm = t.match(/(20\d{2})(?:[./\-](\d{1,2}))?/);
    return mm ? month(mm[1], mm[2]) : '';
  };
  const start = norm(toks[0]);
  const ongoing = /至今|现在|今/.test(seg);
  const end = toks[1] ? norm(toks[1]) : (ongoing ? '至今' : '');
  return { start, end };
}

const ORG_KEYS = /(公司|集团|厂|中心|研究院|研究所|事务所|银行|医院|学校|大学|学院|科技|电子|机械|进出口|贸易|工程)/;
const ROLE_KEYS = /(工程师|主管|经理|专员|助理|总监|设计师|技术员|作业员|操作员|会计|出纳|人事|行政|销售|跟单|单证|计划|品质|采购|仓管|司机|教师|实习|顾问|分析|开发)/;
const EDU_KEYS = /(大学毕业|学院|硕士|本科|大专|中专|高中|博士|MBA)/;

export function parseResumeText(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length);
  const data = {
    base: { name: '', intent: '', city: '', phone: '', email: '', birth: '', years: '', site: '', photo: '', nation: '', polity: '', home: '', build: '', salary: '', available: '', license: '' },
    extra: [], education: [], work: [], projects: [], campus: [], skills: [], skillTags: [], certs: [], awards: [], summary: '',
  };
  const notes = [];
  const used = new Set();

  /* 联系方式 */
  const all = lines.join(' ');
  const ph = all.match(PHONE);
  if (ph) data.base.phone = ph[1].replace(/[\s-]/g, '');
  const ml = all.match(MAIL);
  if (ml) data.base.email = ml[0];
  if (data.base.phone) notes.push('识别到手机号');
  if (data.base.email) notes.push('识别到邮箱');
  const url = all.match(/(?:https?:\/\/|www\.)[^\s，。;；]+/);
  if (url) data.base.site = url[0];
  const yr = all.match(/(\d{1,2})\s*年(?:工作经验|经验|资历)/);
  if (yr) data.base.years = yr[1];
  const city = all.match(/(?:现居|所在城市|居住地|现居住地)[：: ]*([\u4e00-\u9fa5]{2,8}?(?:市|县|区)?)/) || all.match(/([\u4e00-\u9fa5]{2,6}市)/);
  if (city && city[1] && city[1].length >= 2) data.base.city = city[1];
  const home = all.match(/(?:户\s*籍|籍\s*贯)[：: ]*([\u4e00-\u9fa5]{2,10}?)(?=[\s,，、;；]|$)/);
  if (home && home[1]) data.base.home = home[1];
  const nat = all.match(/民\s*族[：: ]*([\u4e00-\u9fa5]{1,6}族?)/);
  if (nat && nat[1]) data.base.nation = nat[1];
  const pol = all.match(/政治面貌[：: ]*([\u4e00-\u9fa5]{2,8})/);
  if (pol && pol[1]) data.base.polity = pol[1];
  const lic = all.match(/(C[12]\s*驾照|驾照|C1|C2|B2|A2)/);
  if (lic && lic[1]) data.base.license = lic[1];
  const birth = all.match(/(?:出生|出生日期)[：: ]*(\d{4})[年./-]?(\d{1,2})?/);
  if (birth) data.base.birth = month(birth[1], birth[2]);
  const sal = all.match(/(?:期望薪资|薪资要求|期望月薪)[：: ]*([^\s，。;；]{2,20})/);
  if (sal) data.base.salary = sal[1];
  const wc = all.match(/(?:微信号码|微信号|微信|WeChat|wx)[：: ]*([A-Za-z0-9_\-]{4,24})/i);
  if (wc) data.base.wechat = wc[1];
  const qq = all.match(/(?:QQ|Q 号|qq)[：: ]*?(\d{5,12})/i);
  if (qq) data.base.qq = qq[1];
  const edu = all.match(/(?:最高学历|学\s*历|文化程度)[：: ]*?(本科|硕士|研究生|博士|大专|专科|高中|中专)/);
  if (edu) data.base.eduLevel = edu[1] === '研究生' ? '硕士' : (edu[1] === '专科' ? '大专' : edu[1]);

  /* 姓名：优先带标签的，其次第一行短中文 */
  const named = all.match(/(?:姓\s*名|Name)[：: ]*([\u4e00-\u9fa5·]{2,6}|[A-Za-z .'-]{2,24})/);
  if (named) data.base.name = named[1].trim();
  else {
    const HEAD_WORD = /^(教育|工作|项目|实习|技能|证书|荣誉|获奖|自我|个人|基本|联系|求职|期望|总结)/;
    for (const l of lines.slice(0, 8)) {
      const lead = clean(l).split(/[\s|,，、·:：]/)[0];
      if (/^[\u4e00-\u9fa5·]{2,4}$/.test(lead) && !HEAD_WORD.test(lead) && !ORG_KEYS.test(lead)) { data.base.name = lead; break; }
    }
  }
  const intent = all.match(/(?:求职意向|应聘岗位|意向职位|目标岗位)[：: ]*([^\s，。;；]{2,24})/);
  if (intent) data.base.intent = intent[1];
  if (!data.base.name) notes.push('没识别出姓名，请手动补');
  const gender = all.match(/(?:性别)[：: ]*(男|女)/) || (lines[0] || '').match(/[，,]\s*(男|女)\s*[，,]/);
  if (gender && gender[1]) data.extra.push({ k: '性别', v: gender[1] });
  const married = all.match(/(未婚|已婚已育|已婚|离异)/);
  if (married) data.base.marital = married[1];

  /* 分块 */
  const SECTION = {
    教育: 'education', 工作: 'work', 经历: 'work', 项目: 'projects', 技能: 'skills',
    证书: 'certs', 荣誉: 'certs', 获奖: 'awards', 自我评价: 'summary', 个人总结: 'summary', 自我介绍: 'summary',
    兴趣爱好: 'hobbies', 兴趣: 'hobbies', 特长: 'hobbies',
    校园: 'campus', 学校经历: 'campus', 实践: 'campus', 志愿: 'campus', 学生会: 'campus', 社团: 'campus', 课外: 'campus',
  };
  let bucket = null;
  let cur = null;
  const pushWork = (o) => { data.work.push(o); cur = o; bucket = 'work'; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = clean(line);
    if (!t) continue;
    if (t.length <= 12 && !/[，。;；]/.test(t)) {
      let best = null, bestAt = 99, bestLen = 0;
      for (const k of Object.keys(SECTION)) {
        const at = t.indexOf(k);
        if (at >= 0 && (at < bestAt || (at === bestAt && k.length > bestLen))) { best = k; bestAt = at; bestLen = k.length; }
      }
      if (best) { bucket = SECTION[best]; cur = null; continue; }
    }

    if (bucket === 'education' || (!bucket && EDU_KEYS.test(t) && /(\d{4}).*(\d{4}|至今|应届)/.test(t))) {
      const r = parseRange(t);
      const school = (t.match(/([\u4e00-\u9fa5]{2,16}(?:大学|学院|学校|中学))/) || [])[1] || '';
      const major = (t.match(/([\u4e00-\u9fa5]{2,12}(?:专业|工程|管理|设计|技术|学))/) || [])[1] || '';
      const degree = (['博士', '硕士', '本科', '大专', '中专', '高中'].find((d) => t.includes(d)) || '');
      if (school || major || degree) {
        data.education.push({ school, major, degree, start: r.start, end: r.end, note: '' });
        used.add(i);
        continue;
      }
    }

    const looksLikeAddr = /[一-龥]{2,6}(路|街|道|巷)[一-龥\d]*号?/.test(t) || /\d+号楼|幢/.test(t);
    const orgLike = ORG_KEYS.test(t) && /有限公司|公司|集团|厂|事务所|研究院|中心|银行|医院|学校|大学|学院/.test(t);
    if (bucket === 'work'
        ? (orgLike && (ROLE_KEYS.test(t) || /\d{4}/.test(t)))
        : (!bucket && !looksLikeAddr && orgLike && (ROLE_KEYS.test(t) || /公司|集团|厂/.test(t)))) {
      const r = parseRange(t);
      const org = (t.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,28}?(?:有限公司|公司|集团|厂|事务所|研究院|中心|银行|医院|学校|大学|学院))/) || [])[1] || '';
      let rest = org ? t.replace(org, ' ') : t;
      rest = rest.replace(/\d{4}\s*[年.\/-]?\s*\d{0,2}\s*[月.]?\s*[-–—~至到]{1,2}\s*(至今|现在|20\d{2}[^ \t，,]*)/g, ' ');
      rest = rest.replace(/[\d\s./年\-–—~至到]+/g, ' ');
      const role = (rest.split(/[|,，、;；:：\s]+/).map((x) => x.trim()).filter((x) => x.length >= 2 && /[\u4e00-\u9fa5A-Za-z]/.test(x))[0] || '').slice(0, 20);
      if (org) {
        pushWork({ company: org, role, start: r.start, end: r.end, bullets: [] });
        used.add(i);
        continue;
      }
    }

    if (bucket === 'projects') {
      const r = parseRange(t);
      const isHead = /项目|课题|系统|平台|装置|模具/.test(t) && (r.start || /[·|、,，\-]/.test(t));
      if (isHead || !cur) {
        cur = { name: t.replace(/[·|\-–—].*$/, '').slice(0, 40), role: (t.split(/[·|\-–—,，]+/)[1] || '').trim().slice(0, 20), start: r.start, end: r.end, desc: '' };
        data.projects.push(cur);
      } else {
        cur.desc = (cur.desc || '') + (cur.desc ? ' ' : '') + t;
      }
      continue;
    }
    if (bucket === 'campus') {
      const r = parseRange(t);
      const isHead = /(学生会|社团|志愿服务|志愿者|社会实践|协会|竞赛|比赛|大赛|队长|副队长|部长|干事|社长|主席|秘书长|副会长|理事|营员|成员)/.test(t) && (r.start || /[·|\-–—]/.test(t) || (t.length <= 26 && !/[。；;]/.test(t)));
      if (isHead || !cur) {
        cur = { name: t.replace(/[·|\-–—].*$/, '').slice(0, 40), role: (t.split(/[·|\-–—,，]+/)[1] || '').trim().slice(0, 20), start: r.start, end: r.end, desc: '' };
        data.campus.push(cur);
      } else {
        cur.desc = (cur.desc || '') + (cur.desc ? ' ' : '') + t;
      }
      continue;
    }
    if (bucket === 'skills') {
      if (/^[\u4e00-\u9fa5A-Za-z0-9+#. ]{2,20}[：:]\s*\d{1,3}\s*[%％]/.test(t)) {
        const [n, v] = t.split(/[：:]/);
        data.skills.push({ name: clean(n), level: Math.max(20, Math.min(100, parseInt(v, 10) || 60)) });
      } else {
        t.split(/[、，,;；\/|]/).map((x) => clean(x)).filter((x) => x && x.length <= 24).forEach((x) => data.skillTags.push(x));
        if (!data.skillTags.length) data.skillTags.push(t.slice(0, 30));
      }
      continue;
    }
    if (bucket === 'certs') { const c = t.match(/^(.{2,30}?)[\s（(](\d{4}[年./-]?\d{0,2})/); data.certs.push({ name: c ? c[1] : t.slice(0, 40), date: c ? c[2] : '', org: '' }); continue; }
    if (bucket === 'awards') { data.awards.push(t); continue; }
    if (bucket === 'summary') { data.summary += (data.summary ? '\n' : '') + t; continue; }
    if (bucket === 'hobbies') { const s = t.replace(/^[，、,。\s]+|^[兴趣爱好特长]+[：:]/g, '').trim(); if (s) data.hobbies = (data.hobbies ? data.hobbies + '、' : '') + s; continue; }
    if (bucket === 'work' && cur) { cur.bullets.push(t); continue; }
    if (bucket === 'education') continue;
  }

  /* 项目：把带“项目”字样的段落补进来 */
  for (const l of lines) {
    const t = clean(l);
    if (/^项目/.test(t) && t.length > 6 && t.length < 80) {
      const r = parseRange(t);
      data.projects.push({ name: t.replace(/^项目[：:\s]*(名称)?/, '').slice(0, 40), role: '', start: r.start, end: r.end, desc: '' });
    }
  }
  data.skillTags = Array.from(new Set(data.skillTags)).slice(0, 30);
  if (!data.work.length && !data.campus.length) notes.push('没识别出工作/校园经历，可能需要手动补');
  if (data.campus.length) notes.push('识别到校园经历');
  if (data.summary) notes.push('识别到自我评价');
  return { data, notes, lines: lines.length };
}

/* ---- PDF 文字抽取（零依赖：node:zlib 解 Flate + 解析内容流文本算子 + ToUnicode 映射 CID）---- */
function _inflate(buf) {
  try { return zlib.inflateSync(buf); } catch (e) {}
  try { return zlib.inflateRawSync(buf, { finishFlush: zlib.constants.ZLIB_FINISH }); } catch (e) {}
  return null;
}
function _hexToBytes(h) {
  h = h.replace(/[^0-9A-Fa-f]/g, '');
  if (h.length % 2) h += '0';
  const out = Buffer.alloc(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function _unescapeLit(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if (g === 'n') return '\n'; if (g === 'r') return '\r'; if (g === 't') return '\t';
    if (g === 'b') return '\b'; if (g === 'f') return '\f';
    if (g === '(' || g === ')' || g === '\\') return g;
    const c = parseInt(g, 8); return isNaN(c) ? g : String.fromCharCode(c & 0xff);
  });
}
function _utf16be(buf) {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) { const cp = (buf[i] << 8) | buf[i + 1]; if (cp) s += String.fromCharCode(cp); }
  return s;
}
export function pdfToText(buf) {
  // 1) 收集所有 stream 原始字节
  const streams = [];
  const mkS = Buffer.from('stream'), mkE = Buffer.from('endstream');
  let pos = 0;
  while (true) {
    const i = buf.indexOf(mkS, pos); if (i < 0) break;
    let start = i + mkS.length;
    if (buf[start] === 0x0d) start++; if (buf[start] === 0x0a) start++;
    const j = buf.indexOf(mkE, start); if (j < 0) break;
    let end = j;
    if (buf[end - 1] === 0x0a) end--; if (buf[end - 1] === 0x0d) end--;
    streams.push(buf.slice(start, Math.max(start, end)));
    pos = j + mkE.length;
  }
  // 2) 解压（能解的解，不能解的原样保留）
  const contents = streams.map((d) => _inflate(d) || d);
  // 3) 全局 ToUnicode 映射（CID -> unicode）
  const cmap = new Map();
  for (const c of contents) {
    const t = c.toString('latin1');
    if (!/beginbfchar|beginbfrange/.test(t)) continue;
    let blk, re;
    re = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((blk = re.exec(t))) {
      let m; const r = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      while ((m = r.exec(blk[1]))) { const cid = parseInt(m[1], 16); cmap.set(cid, _utf16be(_hexToBytes(m[2]))); }
    }
    re = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((blk = re.exec(t))) {
      let m; const r = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[(.*?)\])/g;
      while ((m = r.exec(blk[1]))) {
        const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
        if (m[3]) { let d = parseInt(m[3], 16); for (let c = lo; c <= hi && c - lo < 65536; c++) { cmap.set(c, String.fromCharCode(((d + (c - lo)) & 0xffff))); } }
        else if (m[4]) { let k = 0; const rr = /<([0-9A-Fa-f]+)>/g; let dm; while ((dm = rr.exec(m[4])) && lo + k <= hi) { cmap.set(lo + k, _utf16be(_hexToBytes(dm[1]))); k++; } }
      }
    }
  }
  const hasCmap = cmap.size > 0;
  // 4) 从内容流抽取文本
  let out = '';
  for (const c of contents) {
    const t = c.toString('latin1');
    if (!/(Tj|TJ|'|\bTd\b|\bTD\b|T\*)/.test(t)) continue;
    // 逐个 token：字符串 + 文本算子；遇到换行算子补 \n
    const re = /\[((?:[^\[\]\\]|\\.)*)\]\s*TJ|\((?:\\.|[^\\()])*\)\s*(Tj|'|")|<([0-9A-Fa-f\s]*)>\s*(Tj|'|")|\b(Td|TD|T\*|ET|BT)\b/g;
    let m;
    const emit = (str) => { out += str; };
    const decodeHex = (h) => {
      const b = _hexToBytes(h);
      if (hasCmap) { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) { const cid = (b[i] << 8) | b[i + 1]; s += cmap.has(cid) ? cmap.get(cid) : ''; } return s; }
      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return _utf16be(b.slice(2));
      return _utf16be(b);
    };
    while ((m = re.exec(t))) {
      if (m[1] != null) { // TJ 数组
        const arr = m[1]; let s = '';
        const r2 = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]*)>/g; let a;
        while ((a = r2.exec(arr))) {
          const tok = a[0];
          if (tok[0] === '(') s += _unescapeLit(tok.slice(1, -1));
          else s += decodeHex(a[1]);
        }
        emit(s);
      } else if (m[2] != null) { // (..)Tj
        emit(_unescapeLit(m[0].slice(1, m[0].lastIndexOf(')'))));
      } else if (m[3] != null) { // <..>Tj
        emit(decodeHex(m[3]));
      } else if (m[6]) { // 布局算子 -> 换行
        if (m[6] === 'Td' || m[6] === 'TD' || m[6] === 'T*' || m[6] === 'ET') emit('\n');
      }
    }
    out += '\n';
  }
  // 5) 规整空白
  return out.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---- 版式重排：把带坐标的文本片段按 y 聚成视觉行、按 x 排序，还原阅读顺序 ----
   runs: [{x, y, sz, s}]，y 为 PDF 坐标（原点左下，越大越靠上） */
function clusterRuns(runs) {
  const valid = (runs || []).filter((r) => r && typeof r.s === 'string' && r.s.trim());
  valid.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = []; let cur = []; let anchor = null;
  for (const r of valid) {
    const tol = Math.max(2.5, (r.sz || 10) * 0.6);
    if (anchor === null || Math.abs(r.y - anchor) <= tol) {
      cur.push(r); if (anchor === null) anchor = r.y;
    } else {
      lines.push(cur); cur = [r]; anchor = r.y;
    }
  }
  if (cur.length) lines.push(cur);
  const out = [];
  for (const ln of lines) {
    ln.sort((a, b) => a.x - b.x);
    let seg = ''; let px = null; let psz = null;
    for (const r of ln) {
      if (px !== null && (r.x - px) > Math.max(4, (psz || r.sz || 10) * 1.2)) seg += ' ';
      seg += r.s; px = r.x; psz = r.sz;
    }
    out.push(seg);
  }
  return out.join('\n');
}

/* ---- PDF 优先用 pdf.js(unpdf) 逐字体正确解码 + 坐标重排；库不可用/异常回退到零依赖线性抽取 ----
   背景：密集表格式/子集字体 PDF 用全局 ToUnicode 会 CID 撞车乱码且缺表头，pdf.js 能正确还原。 */
export async function extractPdfText(buf) {
  try {
    const mod = await import('unpdf');
    const fn = mod.extractTextItems;
    if (typeof fn === 'function') {
      const data = new Uint8Array(buf.byteLength); data.set(buf);
      const res = await fn(data);
      const pages = (res && res.items) || [];
      const merged = pages.map((pageItems) => clusterRuns(
        (pageItems || []).map((it) => ({ x: Number(it.x) || 0, y: Number(it.y) || 0, sz: Number(it.fontSize) || 10, s: it.str })),
      )).join('\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (merged.length >= 20) return merged;
    }
  } catch (e) { /* 依赖加载失败等 -> 回退零依赖抽取 */ }
  return pdfToText(buf);
}
