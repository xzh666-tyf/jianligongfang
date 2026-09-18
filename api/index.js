/* 简历工坊 · Vercel serverless 入口（单函数 + vercel.json rewrite 承接全部 /api/*） */
import { handleRequest } from '../server.js';
export default async function handler(req, res) {
  return handleRequest(req, res);
}
