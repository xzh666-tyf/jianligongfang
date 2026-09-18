# 简历工坊 · 源码说明

这是一套完整的在线简历生成站源码。在线版：https://8nthc3gy.qwenwork.host/

## 文件结构

```
resume-workshop/
├─ server.js          服务端（Node 22，零第三方依赖）：账号/会话/邀请码、简历 CRUD、
│                     批量操作、版本快照、投递跟踪、docx 导出、导入解析、模板库接口
├─ package.json       启动入口 server.js，type=module
├─ lib/
│  ├─ docx.js         自实现 ZIP 写入器 + 最小 OOXML 生成（.docx 导出）
│  ├─ parse.js        老简历文本解析（自解 .docx ZIP 抽正文 + 启发式字段识别）
│  └─ admin.js        站长后台接口（统计/账号/邀请码/模板库/词库管理）
├─ public/
│  ├─ index.html      前台单页（模板中心 / 编辑工作台 / 我的简历）
│  ├─ app.js          前台逻辑（22 套主题、主题色、脱敏、双语、批量、导入向导）
│  ├─ style.css       iOS 风格样式 + 暗色模式 + 4 套简历版式 + 打印规则
│  ├─ admin.html      站长后台页面
│  └─ admin.js        后台逻辑
└─ docs/
   └─ schema.sql      数据库建表 SQL（自托管时在新库里执行一遍即可）
```

## 在线版与本地的关系

在线版由千问办公 QW Pages 托管：数据库凭据（SUPABASE_URL / SUPABASE_ANON_KEY）由运行时
以环境变量注入，**不会出现在源码里**。因此：

- 直接 `node server.js` 本地跑：页面、样式、主题、预览、PDF/PNG/JSON 导出都能用；
  但登录、保存、模板库这些需要数据库的接口会报错（缺环境变量）。
- 想完整自托管：新建一个 Supabase 项目 → 在 SQL 编辑器里执行 `docs/schema.sql` →
  在 `invite_codes` 表里插一条邀请码 → 启动时设置环境变量：
  `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`PORT`（默认 8081）、`HOST`。
  服务端会自动用这两个变量访问 PostgREST，不需要其他配置。

## 部署到 Vercel（自托管 · 免费 · 去水印 · 可读网址）

> 目标：把本站搬到你自己名下，得到一个像 `jianligongfang.vercel.app` 这样的可读网址，
> 并且**没有千问办公平台注入的品牌栏/水印**（水印是 QW Pages 运行时注入的，源码本就干净，
> 自托管后自然消失）。数据走一个**全新的 Supabase 库**（不迁移旧线上数据）。

> ⚠️ 前提提醒：`*.vercel.app` 是海外节点，**中国大陆直连可能很慢或打不开**，需要代理才稳。
> 若要求境内稳定秒开，应改用「国内服务器 + 买域名 + ICP 备案」那条路（本包代码同样可跑，只是托管地点不同）。

准备：一个 **Supabase** 账号（免费）+ 一个 **Vercel** 账号（免费，可用 GitHub 登录）。

### 1) 建一个全新的 Supabase 库

1. Supabase 控制台 New project，起个名字，设好数据库密码，等它就绪。
2. 打开 **SQL Editor**，把本仓库 `docs/schema.sql` 整个粘进去 **Run**（幂等，可重复跑）。
   - （可选）**一键导入现有模板**：若想把线上那 30 个职业模板 + 56 条词库直接搬进新库，
     再把 `docs/seed_templates.sql` 粘进去 Run（同样幂等）。不跑也不影响使用，只是新库模板为空，
     需日后在站长后台自行录入。
3. **放一条邀请码**（注册前台要用），在 SQL Editor 执行（把 `ABCDEF123456` 换成你自己的码）：
   ```sql
   INSERT INTO invite_codes (code, label, max_uses, enabled)
   VALUES ('ABCDEF123456', '首发', 50, true)
   ON CONFLICT (code) DO NOTHING;
   ```
4. 记下 **Project Settings → API** 里的两个值：`Project URL` → 后面当 `SUPABASE_URL`；
   `anon public` key → 后面当 `SUPABASE_ANON_KEY`。（用 anon key 即可，服务端已按 owner 强制隔离数据。）

### 2) 部署代码到 Vercel

方式 A（推荐，走 GitHub）：把本目录推到一个 GitHub 仓库 → Vercel **Add New → Project → Import** 该仓库。
Vercel 会读到本仓库的 `vercel.json`（静态托管 `public/` + `api/[...path].js` 单个函数），无需手填构建命令。

方式 B（本地 Vercel CLI，需先装 Node 22）：在项目根目录执行 `vercel` 登录并按提示创建，再 `vercel --prod` 发布。

配置环境变量（两种方式都要）：Project **Settings → Environment Variables** 添加
- `SUPABASE_URL` = 上一步的 Project URL
- `SUPABASE_ANON_KEY` = 上一步的 anon key

然后 **Deploy**。之后每次改代码，推回仓库 / `vercel --prod` 即自动发新版，网址不变。

### 3) 换成可读网址

Project **Settings → Domains**：默认是 `随机.vercel.app`。把项目 **Rename** 成你想要的（如 `jianligongfang`），
即得 `https://jianligongfang.vercel.app`。若日后有自己的域名，也在 Domains → Add 绑定（可选，需按提示加 DNS）。

### 4) 造出第一个「站长」账号（全新库必做）

前台注册出来的账号默认都是普通用户，且「提升权限」只有站长能做——所以第一个站长要在数据库里手工设：

1. 先去 `https://你的网址/` 注册一个账号（用第 1 步那条邀请码）。
2. 回 Supabase **SQL Editor** 执行（把 `你的用户名` 换成刚注册的）：
   ```sql
   UPDATE users SET role = 'admin' WHERE username = '你的用户名';
   ```
3. 刷新页面，右上角会出现「站长后台」入口（`/admin.html`），在里面可继续加邀请码、管用户、维护模板库。

### 本地怎么先自测一下

装好 Node 22 后，在项目根目录（PowerShell）：
```
$env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_ANON_KEY="eyJ..."; node server.js
```
浏览器开 `http://127.0.0.1:8081/` 即可完整跑通登录/保存/导出。

## 常用修改入口

| 想改什么 | 文件 |
| --- | --- |
| 界面配色 / 暗色 / 版式外观 | public/style.css（`:root` 变量、`html[data-ui=dark]`） |
| 简历主题 / 配色预设 / 职业模板映射 | public/app.js 顶部 `STYLES` / `RESUME_THEMES` / `PALETTES` |
| 板块与表单字段 | public/app.js 的 `FIELDS`、`blankData()` 与 `pageHTML()` |
| 职业模板内容 | 数据库表 `tpl_professions` / `tpl_glossary`（后台可直接改） |
| 导出 Word 版式 | lib/docx.js |
| 导入识别规则 | lib/parse.js |

## 账号与安全

- 注册需要邀请码（表 `invite_codes`），站长在 /admin.html 里可增停。
- 密码为 scrypt 加盐散列，数据库不存明文；忘记密码用注册时的恢复码。
- 简历数据按账号隔离，所有查询在服务端强制过滤 owner。
- 不要把身份证号、银行卡号写进简历；这不是端到端加密存储。

## 在线版现状（2026-09-04，V12）

- V12 前端由主电脑生成的「升级包」合并而来：暗色修复、岗位匹配（JD 关键词命中/缺口）、
  备份文件含投递记录；合并时已剥离包内固化的平台品牌脚本（mulepage 注入代码），保持源码干净。

- 14 个职业模板（假名示例）+ 22 套简历主题 + 12 套配色预设
- 账号 xie3273556246 为站长；平台会在页面注入千问办公品牌栏，代码层无法去除，
  完全无水印需用本源码自托管。
