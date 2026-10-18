# 混合采购订单：运行、配置和恢复

2026-10-18。现有项目目录：`D:\AI项目库\auto-parts-purchasing`。用户消息中的 `auto--purchasing` 不存在，沿用已确认的现有项目；未迁移项目。保留开发前已有的未提交改动。

## 已实现

- 同一购物车添加不同类别和货号；独立数量、规格、删除、继续添加。同一货号合并数量。产品来自服务端目录；客户端价格不参与计价。
- 一次提交一张订单、一个 `PO-日期-随机编号`。服务端事务写入 SQLite，重复请求返回同一编号。失败保留购物车及请求 ID，禁止将未确认的响应显示为下单成功。
- 金额使用整数美分；固定价自动计算小计，询价商品金额保持 null／待报价。初始订单总额保持待报价，包含所有商品，运费不默认为零。
- 管理端用独立密钥读取订单；每项核实供应商、进货成本、库存、销售价及交期；整单给出合并运费、运输条件和报价备注。供应商、进货成本和库存核实字段不返回客户。
- 缺货项单独排除并保留原因，其他商品仍在原订单；每次报价变更产生新版本、清除旧确认，旧版本／旧总额无法付款。旧报价链接随新报价撤销。
- 管理端可复制完整报价或打开邮箱应用，由运营者发送；没有配置 SMTP、自动发信或通知，不声称邮件已送达。
- PayPal REST 创建整单结账与服务端 Capture；金额仅取当前已确认的数据库订单。服务端逐一校验订单引用、报价版本、币种、美分金额和完成状态，记录唯一收款号。客户跳转返回不等于已付款，须点击“Verify PayPal payment”；运营者也可“Reconcile with PayPal”。中断后可重试核对同一交易。
- PayPal 结账启动后锁定商业条款，先核对交易再处理修改，避免旧付款链接与新报价冲突；已付款订单不能直接改价。退款流程不在本次功能内，须通过商户渠道处理后另行约定。
- 只有 Live 真实已付款订单允许登记统一发货。Sandbox 明确标识为测试，并阻止真实发货；发货记录包含全部可采购货号、承运方与整票物流号。

## 运行与私有配置

```powershell
npm run dev:orders
```

客户：`http://127.0.0.1:4184/#shop`；运营：`http://127.0.0.1:4184/admin.html`。保留已有其他端口预览服务。

开发脚本仅给当前 PHP 进程加载扩展，不修改 PHP 系统配置或系统环境。默认使用项目已有便携 PHP；其他环境设置进程级 `PHP_BINARY`，并安装／启用 `pdo_sqlite`，PayPal 另外要求 `curl` 和可验证远程 TLS 的证书环境。

本地私有位置：`data/orders-private/`，数据库 `orders.sqlite`，配置 `settings.json`。管理员密钥仅从私有文件读取，在管理页面输入；不要贴到聊天、公开 Git 或 `site.json` 中。商户配置示例位于 `config/order-settings.example.json`，它不会被打包进公开网站。

Hostinger PHP 版本：`npm run build:hostinger`，部署内容为 `data/hostinger-release/public_html/`。默认私有订单目录为 `dirname(DOCUMENT_ROOT)/private/auto-parts-orders/`；可通过 `ORDER_STORAGE_DIR` 指定。配置文件默认该目录下的 `settings.json`，可通过 `ORDER_SETTINGS_FILE` 指定，必须位于网站公开目录外。数据库或配置位于公开目录时，接口拒绝工作。

私有配置中的 `adminToken` 至少 32 个随机字符；`publicBaseUrl` 为正式网站完整 HTTPS URL，允许子目录，不带查询参数和片段。`paypal.environment` 为 `sandbox` 或 `live`，分别填写对应商户的 `clientId`、`clientSecret`。严禁把 Live 密钥用于 Sandbox 验收。切换环境前需结清旧环境的未完成交易。

生产商品目录 `config/catalog.json` 默认只有明确标示的 sourcing request 参考货号，价格均为 null；没有编造真实库存、价格或适配承诺。真实商品及固定价格须由运营者核实后配置。测试中的固定价格只存在独立测试目录，未写入正式目录。

## 本地验收证据

`npm run test:orders` 使用真实 PHP HTTP、私有 SQLite 和合成客户数据。2026-10-18 首轮证据：`data/order-tests/run-mEmdCa/acceptance.json`。

| 测试货号 | 数量 | 单价 USD | 小计 USD |
| --- | ---: | ---: | ---: |
| TEST-BRK-001 | 2 | 12.50 | 25.00 |
| TEST-FLT-002 | 3 | 8.20 | 24.60 |
| TEST-MOT-003 | 5 | 下单时待报价，后报价 4.10 | 20.50 |

初始固定价小计 49.60、1 项待报价；整单报价商品 70.10 + 合并运费 12.30 = **82.40 USD**。排除 TEST-FLT-002 后为 **57.80 USD**，仍为同一订单号，必须重新确认。

浏览器实际操作：`data/browser-acceptance/order.json`、`quote.json`、`confirmed.json`。订单 **PO-20261018-014E98DBA1799D1B**，PB-BRK-001 × 2、PB-FLT-001 × 3、PB-MOT-001 × 5；客户表单一次提交，管理表单发布 82.40 报价，客户表单确认，私有数据库保存。它是明确标记的合成验收订单，不是客户订单、市场价格或实际收入。

后续浏览器缺货验收 `data/browser-acceptance/exclusion.json`：PB-FLT-001 单独排除，总额 57.80；重新打开后再次发布至报价版本 3，客户页面重新要求确认，旧确认不再允许付款。已修复隐藏库存输入的验证阻断及缺货行旧交期文案。最新后端证据 `data/order-tests/run-rbe68C/acceptance.json`，订单测试 4 项全部通过。

最终再次核对当前完整 PHP 构建：`data/browser-acceptance/final.json`，同一订单 3 项明细、报价版本 3、57.80 美元、quoted／unpaid，与源码接口哈希一致。最后一次后端测试证据为 `data/order-tests/run-s473jq/acceptance.json`。开发过程中发现同目录商品搜索任务在并发修改，保留其接入；最终源码检查及构建已通过。浏览器最终补拍管理页时连接超时，已保留此前管理页截图、最终手机总额截图及成功表单操作证据，没有将补拍失败报告为通过。

桌面／手机截图位于 `docs/qa/mixed-orders/`，浏览器量测宽度 1440 与 390，均无横向溢出。原询价单元测试及 PHP 收件回归须同时通过。

后端验收覆盖：进程重启后读取、同 ID 并发重试只建一单、无效数量、未知或重复货号、价格篡改、跨域请求、缺失权限、报价整单回滚、旧版本并发覆盖拦截、旧金额和旧报价链接失效、未付款不可发货、存储不可写／公开目录拒绝、数据库完整性。PayPal 返回值校验的单元样本不是 PayPal 服务模拟，也不证明实际支付成功。

## 尚未完成的外部验收

没有设置 PayPal 商户凭据或正式 HTTPS 回调地址，未发起真实 PayPal Sandbox／Live 交易；未实测公网 Hostinger 订单。付款配置缺失时服务端返回明确错误、订单保持 unpaid。本地功能通过不等于已经上线或已经能真实收款。

公网部署前须备份现有目标站点和私有数据，确认 PHP 扩展、私有目录写入、Authorization 头传递（部署包包含 Apache 规则）和 HTTPS。商户完成私有配置后，依次验收 Sandbox 审批／Capture／重试与整单金额，确认后再做经用户授权的 Live 小额整单交易。任何真实支付或发送客户报价仍需用户明确授权。

## 备份与恢复

源码、配置模板、构建脚本及说明均在 D 盘。开发前备份：`backup/before-mixed-orders-20261018-163943/`。阶段备份另保存在 `backup/`。

备份正式数据库前先暂停写入，或用 SQLite 在线备份接口取得一致副本；不要在持续写入时仅复制单个数据库文件。私有配置和订单数据库单独保管，恢复后检查管理员配置、商品目录、`PRAGMA integrity_check`，再启动 PHP。不要上传本地测试订单、运行时、密钥、授权缓存、Git 或备份文件。

实现参考：[PayPal Orders v2](https://developer.paypal.com/api/orders/v2)、[PayPal 请求幂等](https://developer.paypal.com/api/rest/reference/idempotency/)、[PDO 事务](https://www.php.net/manual/en/pdo.transactions.php)。

## 界面复核结论

复核结论：接受本次混合订单界面扩展，没有未解决的实质问题。

| 复核项 | 结果 |
| --- | --- |
| PARTSBRIDGE 风格和范围 | 通过 |
| 桌面／手机订单可读性 | 通过 |
| 金额与整单报价确认 | 通过 |
| 缺货单项排除与再次发布 | 通过 |
| 排除数量及导出报价文案 | 通过，已核对最终代码和手机截图 |
| 未付款与支付配置缺失状态 | 已在验收范围内通过 |
| 计算对比度、完整键盘与读屏 | 未验证 |
| PayPal 实际成功收款 | 未验证，仍需要商户配置 |
