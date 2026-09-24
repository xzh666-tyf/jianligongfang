/* 最小 .docx 生成器：Node 内置 zlib 做 CRC/压缩，自己拼 ZIP，不依赖任何三方包。 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + data.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function run(text, opt = {}) {
  const rpr = ['<w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑" w:hAnsi="Calibri"/>'];
  if (opt.b) rpr.push('<w:b/>');
  if (opt.color) rpr.push(`<w:color w:val="${esc(String(opt.color).replace('#', ''))}"/>`);
  if (opt.size) rpr.push(`<w:sz w:val="${Math.round(opt.size * 2)}"/><w:szCs w:val="${Math.round(opt.size * 2)}"/>`);
  return `<w:r><w:rPr>${rpr.join('')}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(children, opt = {}) {
  const ppr = [];
  if (opt.align) ppr.push(`<w:jc w:val="${opt.align}"/>`);
  if (opt.spaceBefore || opt.spaceAfter) {
    ppr.push(
      `<w:spacing w:before="${opt.spaceBefore || 0}" w:after="${opt.spaceAfter == null ? 60 : opt.spaceAfter}" w:line="276" w:lineRule="auto"/>`
    );
  } else {
    ppr.push('<w:spacing w:after="60" w:line="276" w:lineRule="auto"/>');
  }
  if (opt.bullet) ppr.push('<w:ind w:left="420" w:hanging="210"/>');
  const kids = (Array.isArray(children) ? children : [children])
    .filter(Boolean)
    .map((c) => (typeof c === 'string' ? run(c, opt) : c))
    .join('');
  return `<w:p><w:pPr>${ppr.join('')}</w:pPr>${opt.bullet ? run('• ', { color: opt.accent, b: true }) : ''}${kids}</w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑" w:hAnsi="Calibri" w:cs="Calibri"/>
<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

function coreXml(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>${esc(title)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>简历工坊</Application></Properties>`;

function sectPr(accent) {
  return `<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="964" w:right="1077" w:bottom="964" w:left="1077" w:header="708" w:footer="708" w:gutter="0"/>
<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="${esc(String(accent).replace('#', '') || 'cccccc')}"/></w:pBdr>
</w:sectPr>`;
}

/** 生成 .docx 二进制 */
export function buildDocx({ name = '简历', theme = {}, data = {} }) {
  const b = data.base || {};
  const accent = (theme.accent || '#2f5c8f').replace('#', '');
  const p = [];

  p.push(para([run(b.name || name || '未命名', { b: true, size: 22, color: accent })], { spaceAfter: 20 }));
  const mask = !!theme.mask;
  const mp = (v) => String(v).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  const mm = (v) => { const m = String(v).match(/^([^@]{1,2})[^@]*(@.*)$/); return m ? m[1] + '***' + m[2] : v; };
  const keep = mask ? ['intent', 'city', 'phone', 'email', 'years'] : ['intent', 'city', 'phone', 'email', 'wechat', 'qq', 'marital', 'eduLevel', 'birth', 'nation', 'polity', 'home', 'build', 'years', 'salary', 'available', 'license'];
  const rawVals = { intent: b.intent, city: b.city, phone: b.phone, email: b.email, wechat: b.wechat, qq: b.qq, marital: b.marital, eduLevel: b.eduLevel, birth: b.birth, nation: b.nation, polity: b.polity, home: b.home, build: b.build, years: b.years ? `${b.years} 年经验` : '', salary: b.salary, available: b.available, license: b.license };
  const line = keep.map((k) => (k === 'phone' && mask ? mp(rawVals.phone || '') : k === 'email' && mask ? mm(rawVals.email || '') : rawVals[k]))
    .filter(Boolean)
    .join('   |   ');
  if (line) p.push(para([run(line, { size: 9.5, color: '666666' })], { spaceAfter: 20 }));
  const extras = (data.extra || []).filter((x) => x && x.k && x.v);
  if (extras.length) p.push(para([run(extras.map((x) => `${x.k}：${x.v}`).join('　　'), { size: 9.5, color: '666666' })], { spaceAfter: 160 }));

  const h = (t) => para([run(t, { b: true, size: 13, color: accent })], { spaceBefore: 160, spaceAfter: 70 });

  /* ② 与网页预览保持一致：校园经历并入「教育与校园经历」，不再单列一个标题 */
  if ((data.education || []).length || (data.campus || []).length) {
    p.push(h('教育与校园经历'));
    for (const e of data.education) {
      p.push(
        para(
          [
            run([e.school, e.major, e.degree].filter(Boolean).join(' · '), { b: true }),
            e.start || e.end ? run(`　${[e.start, e.end].filter(Boolean).join(' - ')}`, { color: '777777' }) : null,
          ],
          { spaceAfter: 30 }
        )
      );
      if (e.note) p.push(para([run(e.note, { size: 9.5 })]));
    }
    for (const c of data.campus || []) {
      p.push(
        para(
          [
            run([c.company || c.name, c.role].filter(Boolean).join('　'), { b: true }),
            c.start || c.end ? run(`　${[c.start, c.end].filter(Boolean).join(' - ')}`, { color: '777777' }) : null,
          ],
          { spaceAfter: 30 }
        )
      );
      if (c.desc) p.push(para([run(c.desc, { size: 10 })]));
    }
  }

  const workBlock = (title, list, withBullets) => {
    if (!list || !list.length) return;
    p.push(h(title));
    for (const w of list) {
      p.push(
        para(
          [
            run([w.company || w.name, w.role].filter(Boolean).join('　'), { b: true }),
            w.start || w.end ? run(`　${[w.start, w.end].filter(Boolean).join(' - ')}`, { color: '777777' }) : null,
          ],
          { spaceAfter: 30 }
        )
      );
      if (withBullets) {
        for (const t of w.bullets || []) {
          if (String(t || '').trim()) p.push(para([run(String(t).replace(/^[•·-]\s*/, ''), { size: 10 })], { bullet: true, accent }));
        }
      } else if (w.desc) {
        p.push(para([run(w.desc, { size: 10 })]));
      }
    }
  };
  workBlock('工作经历', data.work, true);
  workBlock('项目经历', data.projects, false);

  if ((data.skills || []).length || (data.skillTags || []).length) {
    p.push(h('专业技能'));
    for (const s of data.skills || []) {
      if (s && s.name) p.push(para([run(`${s.name}　`, { b: true, size: 10 }), run('★'.repeat(Math.max(1, Math.round((Number(s.level) || 3) / 20))) + '☆'.repeat(Math.max(0, 5 - Math.round((Number(s.level) || 3) / 20))), { color: accent, size: 10 })], { bullet: true, accent }));
    }
    const tags = (data.skillTags || []).filter(Boolean);
    if (tags.length) p.push(para([run(tags.join(' / '), { size: 10 })], { spaceAfter: 60 }));
  }

  if ((data.certs || []).length || (data.awards || []).length) {
    p.push(h('证书与荣誉'));
    for (const c of data.certs || []) {
      const t = typeof c === 'string' ? c : [c.name, c.date, c.org].filter(Boolean).join('　');
      if (t) p.push(para([run(t, { size: 10 })], { bullet: true, accent }));
    }
    for (const a of data.awards || []) {
      if (a) p.push(para([run(typeof a === 'string' ? a : a.name || '', { size: 10 })], { bullet: true, accent }));
    }
  }

  if (data.summary) {
    p.push(h('自我评价'));
    for (const t of String(data.summary).split('\n').filter(Boolean)) p.push(para([run(t, { size: 10 })]));
  }

  if (data.hobbies) {
    p.push(h('兴趣爱好'));
    p.push(para([run(String(data.hobbies), { size: 10 })]));
  }

  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${p.join('')}${sectPr(accent)}</w:body></w:document>`;

  return zipStore([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'docProps/core.xml', data: coreXml(b.name || name || '简历') },
    { name: 'docProps/app.xml', data: APP_XML },
  ]);
}
