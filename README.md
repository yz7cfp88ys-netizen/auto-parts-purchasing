# PARTSBRIDGE — Auto Parts Purchasing

面向海外汽修厂、摩修厂和汽配商的英文国际采购网站。业务定位为汽车后市场汽摩配一站式采购，支持小批量采购、源头工厂对接、代找产品、验货、集中采购和合并发货。

## 本地恢复和运行

完整本地项目位于 `D:\AI项目库\auto-parts-purchasing`。安装 Node.js 22 或更新版本后，在项目根目录执行：

```powershell
npm run dev
```

访问 `http://127.0.0.1:4173`。没有第三方 npm 依赖，无需运行 npm install。

```powershell
npm run check
npm test
npm run build
```

`dist/` 是完整静态网站，可以上传到 GitHub Pages、Nginx 或任意静态托管平台。所有资源使用相对路径，兼容 GitHub 项目子路径。

## 目录

- `source/`：HTML、CSS、JavaScript、本地图片与构建脚本。
- `config/site.json`：公开业务配置，不放密码或密钥。
- `data/`：本地数据预留目录，默认不提交业务数据。
- `docs/`：网站维护、功能边界和素材说明。
- `backup/`：本地备份目录，备份文件默认不上传 GitHub。
- `.github/workflows/pages.yml`：验证、构建和 Pages 部署。

## 业务联系方式

目前未提供真实公司名称、邮箱、WhatsApp、域名或工商资料。PARTSBRIDGE 是本项目采用的暂定展示名称，使用前应核实品牌及商标。网站没有虚构客户、销量、库存、价格、工厂认证或送达承诺。

在 `config/site.json` 填入确认过的 `email` 后，页脚显示邮箱，询价预览增加“Open email app”。`whatsapp` 填国际区号加号码的纯数字（不带 +、空格）。`siteUrl` 填正式站点完整 URL；构建会据此生成 sitemap。修改后重新构建并推送。

## 询价功能边界

可添加、删除零件行，校验数量、填写业务信息，预览、复制和下载询价文本。数据只保留在当前浏览器标签页；表单不会发送或存储客户资料，不接收付款或自动下单。真实邮箱配置前，网站以下载采购简报为主流程。需要在线收件、CRM、文件上传或订单管理时应另行配置服务端，不能把下载当成已收件。

## GitHub 发布

仓库地址：https://github.com/yz7cfp88ys-netizen/auto-parts-purchasing 。主分支：`main`。工作流默认运行检查、测试和构建。网页部署默认关闭；如需启用 GitHub Pages，在仓库 Settings → Pages 将来源设为 GitHub Actions，并在 Settings → Secrets and variables → Actions → Variables 添加 `ENABLE_PAGES=true`，之后手动运行工作流。成功部署的 URL 会显示在 Actions / Environments 中。仓库上传成功与网页部署成功需分别核验。

## 备份恢复

保留 D 盘完整目录及 `backup/` 内阶段压缩包。恢复到新文件夹，检查 `config/site.json` 后运行上述验证命令。项目没有生产数据库、密钥或外部付费依赖。不要将真实客户询价文件提交到公开仓库。
