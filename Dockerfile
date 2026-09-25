# 简历工坊 · 腾讯云 CloudBase 云托管镜像
# 现有 server.js 同时提供前端静态(public/) + /api + 站长后台，单端口一把梭，
# 所以云托管只需跑这一个进程，前端用相对路径 /api 即可，无需改前端、无跨域。
# 注：启动入口改为 gateway.js——它只在外面包一层 CORS 白名单，不改 server.js 的业务代码，
# 目的是让 Qoder 自带站点等其它域名也能直连 /api；同源访问（本站前端）行为保持不变。
FROM node:22-alpine

WORKDIR /app

# 依赖层（package.json 含 type:module 与 unpdf 依赖）
COPY package.json ./
RUN npm install --omit=dev

# 源码：服务端 + 网关 + 库 + 前端静态资源
COPY server.js ./
COPY gateway.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
# 云托管默认监听端口约定 8080；若控制台里设了别的端口，改这里或在环境变量覆盖 PORT
ENV HOST=0.0.0.0
ENV PORT=8080
# 允许跨站直连 /api 的前端域名（逗号分隔，可在云托管环境变量里覆盖）
ENV CORS_ORIGINS=https://jianli-gongfang-6qvb2gbqdv5.qoder.website
EXPOSE 8080

CMD ["node", "gateway.js"]
