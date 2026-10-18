# Hostinger Node.js 22 正式部署

本说明针对当前 Express + MySQL 版本，正式域名为 `automotosourcing.com`。原 PHP / SQLite / PayPal 发布包不适用于此次 Node.js 部署。

## 部署页面逐项填写

| 字段 | 值 |
| --- | --- |
| Repository | `yz7cfp88ys-netizen/auto-parts-purchasing` |
| Branch | `main` |
| Framework / Preset | `Express`（不能选静态站、Vite 或 GitHub Pages） |
| Node.js version | `22` |
| Package manager | `npm` |
| Root directory | `.`（仓库根目录） |
| Install command（若出现） | `npm ci` |
| Build command | `npm run build` |
| Output directory | `.`（完整应用根目录，包含 server.js、source/server 和 dist/public） |
| Entry file | `server.js` |
| Start command（若出现） | `npm start` |
| Domain | `automotosourcing.com` |

构建写入 `dist/public`，但**不能把 Output directory 填成 dist/public**：那只有静态资源，没有后台。`server.js` 才是入口，由 Express 明确只公开 dist/public。相对路径 `.` 表示应用根目录；如果页面将根目录显示为 `/`，保留其根目录表示，不能切到 source 或 dist/public。

服务监听主机提供的 `PORT` 和 `0.0.0.0`，不要在生产页面随意另填端口。部署设置是配置在本地验证的准确值；本账号 hPanel 的实际构建仍需要在取得授权后验收。

## 需要你在 Hostinger 私有环境变量中填写

不要把以下密码提交到 GitHub，也无需发到公开文档或聊天：

| 变量 | 填写要求 |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://automotosourcing.com`；临时域名验收时使用实际临时 HTTPS origin，切正式域名时再更新 |
| `DB_HOST` | 主机数据库管理页面显示的地址，Hostinger 同主机通常是 `localhost` |
| `DB_PORT` | 数据库实际端口，通常 `3306` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | 创建的专用数据库名、用户及密码，保留主机分配前缀 |
| `DB_SSL` | 同机 localhost 通常 `false`；外部数据库应使用 `true`，必要时提供 `DB_SSL_CA` |
| `ADMIN_EMAIL` | 你实际使用的管理员邮箱 |
| `ADMIN_PASSWORD_HASH` | 本地运行 `npm run admin:hash`，输入独立、至少 14 位密码，粘贴输出哈希；登录使用原密码 |
| `SMTP_HOST` | 邮件服务实际 SMTP 主机 |
| `SMTP_PORT` | 实际 SMTP 端口，通常 `465` 或 `587` |
| `SMTP_SECURE` | 465 填 `true`；587 填 `false`，生产强制 STARTTLS |
| `SMTP_USER` / `SMTP_PASSWORD` | 真实邮箱账户及 SMTP 密码或应用专用密码 |
| `MAIL_FROM` | 该账户获准发送的完整邮箱地址，不填显示名 |
| `INQUIRY_NOTIFY_TO` | 接收新询价通知的运营邮箱，当前支持单个地址 |
| `TRUST_PROXY_HOPS` | `.env.example` 示例为 `1`；必须核对 Hostinger 实际代理层数及请求 IP 后使用，不设则默认不信任代理 |

管理员没有默认账号或密码；环境配置定义首个管理员。更改密码哈希会令旧会话失效。主机需允许上述邮箱端口出站，并为发信域名配置服务商要求的 SPF / DKIM / DMARC；本次未验证其账号和 DNS 状态。

生产环境缺少数据库、管理员或邮件必需参数时启动会拒绝运行，避免误将未接通的表单开放给客户。本地 development 环境可以不配置 SMTP，询价仍保存，通知显示 pending。

## 数据库、启动与持久化

1. 在 Hostinger 数据库管理中创建专用 MySQL 数据库、用户并分配权限。应用启动建表需要 CREATE / REFERENCES / INDEX 等建表权限，运行需要 SELECT / INSERT / UPDATE / DELETE。不要使用其他业务数据库。
2. 在私有环境变量中填写配置并部署。构建不连接数据库；启动才连接并以锁保护创建 `ams_` 前缀表。
3. 确认 Runtime logs 显示数据库已连接，访问 `/api/health` 返回 database=connected。
4. 访问 `/admin.html`，以设置的邮箱和密码登录，先新建分类和真实产品。正式数据库不会自动添加示例产品、库存、价格或供应承诺。
5. 设置正式域名，依 hPanel 实际 DNS 记录绑定域名并启用 HTTPS。可将 www 在主机端跳转到根域名，避免跨域表单提交。DNS 记录值依本账号页面，不在这里编造 IP。

业务表存放在主机 MySQL，而不是部署目录、应用内存或临时 SQLite 文件。重新构建和重启不会清空数据库。旧本地 `data/orders-private/*.sqlite` 保留，**不会自动迁移到新 MySQL**；如要迁移历史订单或图片，须先核对数据和映射后另行执行。

## 正式上线必须完成的真实验收

- `/api/health` 成功，未登录请求 `/api/admin/inquiries` 返回 401。
- 后台新建、编辑产品及分类，刷新页面仍存在；前台可分类搜索并把多个产品加入询价。
- 另加一个网站没有的产品，填写数量与规格、联系方式和同意存储选项；预览并点 Send inquiry。
- 客户收到 IQ- 开头回执；后台按回执找到同一询价，明细数量与规格完整。再用 phpMyAdmin 核对对应 ams_inquiries / ams_inquiry_items 记录。
- 修改询价状态并刷新，确认状态与历史持久保存；重启应用后重复核对。
- 等待邮件队列处理（每 15 秒一次），后台显示 sent，并在真实收件箱核对回执和明细。sent 只代表 SMTP 服务器接受，不独立证明收件箱送达。
- 故意配置不可用 SMTP 应只令邮件失败，不丢询价；恢复配置后后台点 Retry email notification，验证最终收件。
- 使用 `npm run mail:verify` 检查 SMTP 连接与认证；它不发送邮件，不能替代收件验收。
- 检查 /.env、/source/server/schema.sql、/data/ 等无法下载；确认正式 HTTPS 下的管理员 Cookie 有 Secure、HttpOnly、SameSite=Strict。

邮件任务与询价在同一事务内提交，异常自动回滚；发送失败指数退避重试，最多 10 次，可人工重试。进程重启后从数据库恢复。SMTP 网络中断发生在对方接受邮件之后时可能重复通知，因此邮件带稳定 Message-ID；这是至少一次投递，不能承诺绝对零重复。

## 备份、范围与扩展

主机数据库要定期导出并复制到 D 盘 `backup/`，密码由私有密码管理器另行保管。主机文件备份或 GitHub 不包含业务数据库。恢复时先导入 MySQL，再配置变量、npm ci、构建、启动和核对询价。上线后的数据库备份同步仍需主机权限及备份来源；目前未配置远程定时同步。

Node 功能已包括产品 / 分类 CRUD、搜索、混合与自定义询价、后台登录、状态处理、审计历史、真实事务存储、邮件持久队列与重试。产品删除采取下架保留引用方式，避免破坏过去询价。

AI 客服、多语言、图片询价、订单支付与物流没有在此 Node 版本开放。已分离 catalogue / inquiries / auth / mail 模块，产品 UUID、询价 UUID、locale 字段与明细快照为后续关联附件、翻译、订单及 AI 工具提供稳定接入点。原 PHP 的车型证据搜索和图片 / PayPal 代码仍在源目录，需单独迁移与验收后才能启用。

## 官方核验来源（2026-10-18）

- [Hostinger Node.js 应用部署与构建目录说明](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Hostinger MySQL 与 Node.js 环境变量连接](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)
- [Nodemailer SMTP 与 TLS 配置](https://nodemailer.com/smtp)
- [Express 代理信任说明](https://expressjs.com/en/guide/behind-proxies/)
