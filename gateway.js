/* 简历工坊 · CORS 网关
 *
 * 只做一件事：在不改动 server.js 任何业务代码的前提下，给响应加跨站头，
 * 让 Qoder 自带站点（不同域名）能直连本站 /api/*。
 *
 * - 只按 Origin 精确匹配白名单；未命中就原样透传，同源部署（CloudBase 自己）行为零变化。
 * - 跨站用 Authorization: Bearer 认证，不依赖 Cookie，因此不发 Allow-Credentials（更安全）。
 * - 暴露 x-export-left / content-disposition，前端才读得到导出剩余次数和文件名。
 * - 云托管启动入口由 `node server.js` 换成 `node gateway.js`。
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleRequest } from './server.js';

const ALLOW = (process.env.CORS_ORIGINS || 'https://jianli-gongfang-6qvb2gbqdv5.qoder.website')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsFor(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin || !ALLOW.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Expose-Headers': 'x-export-left, content-disposition',
    'Access-Control-Max-Age': '600',
  };
}

export async function gateway(req, res) {
  const cors = corsFor(req);

  /* 浏览器跨站写请求会先发 OPTIONS 预检；这里直接答复，不进鉴权和路由 */
  if (req.method === 'OPTIONS') {
    if (!cors) {
      res.writeHead(403, { 'Content-Length': '0' });
      return res.end();
    }
    res.writeHead(204, { ...cors, 'Content-Length': '0' });
    return res.end();
  }

  /* 包住 writeHead：白名单命中就给每个响应补 CORS 头，包括 401/402/500 这类错误响应 */
  if (cors) {
    const original = res.writeHead.bind(res);
    res.writeHead = (status, a, b) => {
      /* 兼容 writeHead(status, headers) 与 writeHead(status, message, headers) 两种签名 */
      if (typeof a === 'string') return original(status, a, { ...(b || {}), ...cors });
      return original(status, { ...(a || {}), ...cors });
    };
  }

  return handleRequest(req, res);
}

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

/* 被直接运行才监听；被测试或 serverless import 时不占端口 */
const isDirectRun = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  createServer(gateway).listen(PORT, HOST, () => {
    console.log(`简历工坊 gateway listening on ${HOST}:${PORT}, cors=${ALLOW.length} origin(s)`);
  });
}
