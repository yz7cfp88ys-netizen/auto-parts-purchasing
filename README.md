# PARTSBRIDGE / automotosourcing.com

现有英文汽摩配采购站的 Node.js 22 动态升级版。保留原首页视觉、品牌、服务内容和原 PHP 代码。**正式部署以 Express + MySQL 版本为准。**

- 产品、分类、搜索：MySQL 持久保存，后台新增、编辑、发布和下架。下架保留历史询价快照。
- 客户采购清单：目录产品与未上架产品混合提交，数量、规格、车型、联系人和目的地一并保存。
- 真实询价：数据库事务保存主单、明细、处理历史和邮件任务；获得回执后才显示成功。请求 UUID 保证重试不重复创建。
- 管理后台：`/admin.html`，密码哈希验证、数据库会话、CSRF、同源校验、输入校验、限流和安全响应头。
- 邮件：SMTP 通知运营人员，可查看失败、重试和 SMTP 接受状态；失败不丢询价，不把 SMTP 接受写成收件箱送达。

完整部署参数、必须提供的私有配置与验收步骤见 [Hostinger 部署说明](docs/hostinger-deployment.md)。本地与公网验证范围见 [Node 验证记录](docs/node-verification.md)。

## 恢复与运行

完整本地副本：`D:\AI项目库\auto-parts-purchasing`，包含 source / data / config / docs / backup。

1. 安装 Node.js 22；执行 `npm ci`。
2. 创建一个专用 MySQL 数据库及用户，按 `.env.example` 在本地 `.env` 或主机环境变量中配置。不要提交 `.env`、数据库、密码或备份。
3. 执行 `npm run admin:hash`，交互输入至少 14 位密码，将输出配置为 `ADMIN_PASSWORD_HASH`。
4. 执行 `npm run build`、`npm run check`、`npm test`、`npm run check:deployment`。
5. 执行 `npm start`。启动时创建 `ams_` 前缀表，不自动导入演示产品，也不会迁移旧 SQLite 业务数据。
6. 访问 `/api/health` 和 `/admin.html`；在后台建立真实分类与产品，再完成一次客户提交到后台查询的实测。

`npm run dev` 用于已配置数据库环境下的服务开发；`npm run dev:static` 仅预览旧静态页面。

## 测试

- `npm test`：询价格式与浏览器提交回执兼容性。
- `npm run test:integration`：需要独立的 `TEST_DB_NAME=ams_test`（或 ams_test_ 加小写字母数字），验证真实 SQL/HTTP/本地 SMTP 协议链路，绝不使用正式业务库。
- `npm run test:browser`：同样使用独立测试库，通过本机 Chrome；CI 设置 `BROWSER_CHANNEL=chromium`。截图位于忽略提交的 `docs/qa/`。
- `npm run mail:verify`：验证 SMTP 连接和认证，不发送邮件，不证明收件箱送达。
- GitHub Actions 使用 Node.js 22 和 MySQL 8.4 自动检查、构建、集成测试及浏览器测试。

测试数据均带 QA / Test 标记，只写独立测试数据库。正式数据库默认为空，必须录入实际商品资料。

## 历史代码及数据

`source/api/*.php`、旧 `admin.html/admin.js`、cart/search 等文件保留，防止丢失此前未提交的订单、搜索与 PayPal 工作。

- `npm run dev:orders` / `npm run build:legacy-php`：旧 PHP 版本，仅单独恢复和维护。**它不是本次 Node.js 部署产物。**
- 旧 SQLite 在 `data/orders-private/`，升级前备份在 `backup/before-node-*/`。本次不改写旧数据库。
- 旧付款、图片上传、车型证据搜索未接入 Node.js，也未宣称已在正式站可用。订单管理、AI、多语言及图片询价作为后续扩展，详见部署文档。

## 备份与恢复

代码保存在 D 盘与 GitHub，业务数据保存在主机 MySQL；两者都需要备份。主机数据库导出或主机快照应定期复制到本地 `backup/`，同时安全保管私有环境变量。恢复时先恢复数据库，再配置凭据、构建并启动，核对健康检查、产品和询价记录。GitHub 源码不能替代数据库备份。
