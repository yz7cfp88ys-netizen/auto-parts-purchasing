# 搜索、车型适配与图片代找

2026-10-18。沿用 `D:\AI项目库\auto-parts-purchasing`，没有重建网站、创建仓库或推送部署。原有未提交的订单、报价、付款、目录与询价代码已先检查和备份。

## 运行与数据位置

```powershell
Set-Location 'D:\AI项目库\auto-parts-purchasing'
npm run dev:orders
```

客户首页 `http://127.0.0.1:4184/`，后台 `http://127.0.0.1:4184/admin.html`。已有同端口服务时直接使用；不要启动第二个实例覆盖或终止用户原有服务。`npm run dev` / `dist/` 是静态预览，不执行搜索、上传、下单或支付。

本地继续使用项目已有的 PHP 8.5.11 与 PDO SQLite。默认私有目录 `data/orders-private/`；服务器默认 `dirname(DOCUMENT_ROOT)/private/auto-parts-orders/`。`ORDER_STORAGE_DIR` 指定订单及默认搜索数据位置，`PARTS_STORAGE_DIR` 可单独指定搜索位置，`ORDER_SETTINGS_FILE` 指定已有私有管理员／商户配置。所有私有位置必须在网站公开目录外。

- `orders.sqlite`：原有订单、报价版本、付款和发货记录，沿用原接口。
- `parts.sqlite`：商品、号码、车型、适配、代找、附件引用、审计和限流。
- `sourcing-images/*.bin`：私有、不可直接访问的 JPG／PNG／WebP 原始附件，数据库保存 MIME、大小、SHA-256。后台鉴权后才可取回，取回前重新校验哈希。
- `settings.json`：沿用原管理员密钥和 PayPal 配置；不自动添加支付凭据，不写入公开目录。

## 数据库结构

建表及版本记录见 `source/api/parts-schema.sql`。`parts_migrations` 保存 schema 版本 1；`CREATE TABLE IF NOT EXISTS` 只增建新表，不清空已有业务表。

| 表 | 用途 |
| --- | --- |
| part_products | 商品、品牌、系统／品类、图片、可空售价／MOQ、供货状态、发布标志、核实依据、修订号 |
| part_numbers | OEM／制造商／交叉号，分别保存品牌、原始号码、规范号码和依据 |
| part_vehicles | auto／moto 分开；品牌、车型、生产年、发动机唯一组合 |
| part_fitments | 商品与具体车型组合的多对多关系；每条独立核实依据 |
| sourcing_requests | 未上架产品也能保存；SR 编号、原始搜索、车型、联系方式、要求、处理状态、关联订单 |
| sourcing_files | 私有图片引用、哈希与 MIME |
| parts_audit | 商品维护及代找状态审计 |
| sourcing_rates | 按实际来源 IP 的哈希及全站计数限流，不信任可伪造的转发头 |

不从名称、图片或另一个车型猜测适配。生产年份只代表有依据的生产区间，不能替代 VIN、实际发动机代码与生产月份核对。同品牌／车型的汽车与摩托车记录不会混用。

## 运营者如何维护真实目录

在原有后台输入私有管理员密钥后，可查看代找请求及维护目录。先点 `Export catalogue for editing`，编辑并保留 `expectedRevision`，再点 `Validate & save catalogue JSON`。每批 1–100 条，整个批次在事务中校验／保存；任一错误全部回滚，旧修订号不能覆盖新修订。

导入契约为 `{ "products": [...] }`，每个商品需要：

- `sku`、`name`、`brand`、`system`、`category`、`source`、`verifiedAt`。
- `published` 布尔值；撤下商品使用 false，保留原数据和订单。
- `numbers` 数组：每条包含 `kind`（oem／manufacturer／cross）、`brand`、`number`、`source`、`verifiedAt`。
- `fitments` 数组：每条包含 `type`（auto／moto）、`make`、`model`、整数 `year`、`engine`、`source`、`verifiedAt`。
- `unitPriceCents` 和 `moq` 未确认时为 null；有明确价格／MOQ／供货状态时还必须给出 `commercialEvidence`。货币沿用原订单 USD，金额用整数美分。
- `supplyStatus` 为 unconfirmed／on_request／available／unavailable。未确认不显示“现货”；已确认供应在整单报价前仍须复核。unavailable 不能下单。
- `image` 可为本地 `./assets/` 路径或 HTTPS 图片地址；缺图明确显示未提供，不冒用其他商品图片。

首次部署不会自动导入商品。`config/catalog.json` 原有六类代采购请求保留，不能充当真实零件目录。`config/reference-validation.json` 是独立验收用的厂家参考数据，不自动进入经营商品库，也不代表能供货。

## 搜索规则与操作

首页统一框支持直接输入号码、品牌、名称、关键词，不强制选择车型。车型入口允许逐步选择类型→品牌→车型→年份→发动机→系统→品类，选项只来自已发布商品的有据适配记录。更改上游选项时清空下游，避免旧发动机与新车型混合。

号码只统一大小写及空白，保留连字符、斜线、数字、字母和其他允许的标点。精确号码优先；已核实交叉号标为 `Verified cross-reference match`。关键词和编辑距离为 1 的近似号码明确标为候选，不能假装相同号码或适配已确认。近似候选最多 6 个，搜索每页 24 条；不创建虚构替换关系。

结果显示图片或缺图提示、名称、品牌、号码、独立适配证据、报价状态／售价、MOQ 和供货状态。精确记录可加入原购物车，与旧目录项目混合下单；需要核对的候选进入确认／代找。客户端及服务端都执行 MOQ，最终运费与总额仍由完整报价确定。

## 图片代找与专属报价

无可靠结果始终显示 `Can't find your part? Let us source it for you`。打开表单会携带刚才的号码／搜索词及车型；客户补联系方式、数量、要求，可上传最多 3 张、每张 5 MB 的 JPG／PNG／WebP 或提供网页链接。服务器核对实际图片内容及尺寸，不以扩展名判断。网页链接只保存供运营者查看，不由服务器抓取。

提交后，图片移入私有位置，哈希复核后与请求在数据库中提交，才返回 `SR-日期-随机值`。同请求 ID、同内容重试返回原编号；修改内容使用新 ID，同 ID 不同内容返回 409。失败保留当前表单。新请求按来源每小时 10 条、全站每小时 200 条限流；已收件重试不占新增配额。

后台可查看原始资料和私有图片，记录 reviewing／located／unable_to_source 等结果。没有接入视觉模型，不会显示虚构识别结果；`imageAssessment` 明确为未评估，图片只能辅助候选，适配须另有依据。

标记 located 后，运营者填写核实过的商品名称、规格／适配依据及客户提供的送货地址，创建不公开的 `SRC-...` 商品订单。同一代找重复转换使用同一订单。沿用现有后台核实供应商、成本、库存、售价与运费，发布完整报价后生成私有客户链接。客户查看并确认最新报价，才允许发起整单全款 PayPal；真实支付状态只来自 PayPal 服务端核对。

不自动发邮件或 WhatsApp；运营者自行复制链接发送。未配置商户凭据时明确失败，不模拟支付。原项目未发现定金／尾款分期实现，本次没有擅自新增或改造支付逻辑，不能声称已通过分期支付回归。

## Hostinger 的实际边界

本次本地 CLI 凭据缓存只发现 `client_id`，没有有效登录凭据字段；只读 `hosting websites list` 查询超时，没有取得真实套餐、站点、域名、目录或扩展清单。没有上传主机、修改 DNS、购买服务或重设账户。

当前可运行实现沿用已有 PHP + SQLite，以尽量减少交易代码变更。这是已验证的本地实现和待验证的主机部署候选，不能把它说成已确认适合现有 Hostinger 套餐。Hostinger 的[官方数据库说明](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/)说明 Web／Cloud 使用 MariaDB，并将 SQLite 替代方案指向 VPS；因此必须实查目标的 `pdo_sqlite`，不能凭品牌假定支持。

获得实际站点访问后，先备份目标，再检查 PHP 8.1+、PDO SQLite、可写私有目录、图片检查函数、上传限制、cURL 和 HTTPS。已添加仅管理员可调用的 `parts.php` POST `{ "action": "preflight" }`，后台 `Check server readiness` 可查看实际检查结果。缺少 SQLite 时应保持原站点并改用经实测的 MariaDB 适配或用户现有合适主机，不能直接上传本包冒充可用，也不能因此自动购买 VPS。

`npm run build:hostinger` 生成 `data/hostinger-release/public_html/`，附 `.user.ini`（5M 单文件／16M 总请求／3 附件）与 Apache 访问限制。具体主机是否执行这些配置仍须线上验证。

## 备份与恢复

`node source/scripts/backup-orders.mjs` 现已同时备份 `orders.sqlite`、`parts.sqlite`、私有设置及该数据库快照所引用的图片。SQLite 使用一致快照并执行完整性检查，图片复制后核对数据库原 SHA-256。备份位于 D 盘 `backup/mixed-orders-时间/`，包含源代码、配置、文档、私有数据及校验清单，绝不能上传到 public_html 或公开 Git。

恢复时先停写，保留现有副本，将数据库、settings.json 和 sourcing-images 一并恢复至私有目录，保持环境变量指向正确位置，再运行数据库检查、搜索、附件和订单回归。若显式将 PARTS_STORAGE_DIR 与 ORDER_STORAGE_DIR 分开，备份脚本会拒绝报告完整备份，需分别导出并核验两处数据。

测试结果见 `docs/search-verification.md`。
