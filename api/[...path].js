/* 简历工坊 · Vercel / serverless 入口
 * ---------------------------------------------------------------------------
 * 这是「单个 catch-all 函数」：把所有 /api/* 请求交给与本地完全相同的那套
 * handleRequest 处理，零逻辑分叉、零第三方依赖。
 *
 * - 静态资源（public/index.html、app.js、style.css、admin.html 等）由 Vercel
 *   CDN 直接返回，不会进入本函数（见 vercel.json 的 outputDirectory=public）。
 * - 命中不到静态文件的 /api/* 请求，落到这里；req.url 保留原始路径，
 *   所以 server.js 里的路由判断（/api/login、/api/admin/... 等）照常生效。
 * - 数据库凭据从 Vercel 项目环境变量读取：SUPABASE_URL、SUPABASE_ANON_KEY。
 */
import { handleRequest } from '../server.js';

export default async function handler(req, res) {
  return handleRequest(req, res);
}
