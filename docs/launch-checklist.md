# 上线资料与素材源

密钥不要提交到 Git。生产环境放 Cloudflare Secrets；本地放 `.env.local`。

## 必需账号与密钥

### Cloudflare

1. [创建 API Token](https://dash.cloudflare.com/profile/api-tokens)
2. [官方创建 Token 指引](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
3. [查找 Account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)

使用 Cloudflare 默认域名，不绑定自定义域名：

- 用户站：`<public-project>.pages.dev`
- 私有后台：`<admin-project>.pages.dev`
- API：`<api-worker>.<workers-subdomain>.workers.dev`

Token 只授予账号级最小权限：

- Workers Scripts: Edit
- Cloudflare Pages: Edit
- D1: Edit
- Workers R2 Storage: Edit

不需要 Zone ID，也不需要 Zone DNS: Edit。

需要填写：

```dotenv
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
```

不要提供 Cloudflare 密码或 Global API Key。

GitHub Actions 中把这两项放在 Repository Secrets；项目名、资源名和公开 URL 放 Repository Variables。完整列表见根目录 README。

### 腾讯云 OCR

1. [开通文字识别](https://console.cloud.tencent.com/ocr/overview)
2. [创建 SecretId / SecretKey](https://console.cloud.tencent.com/cam/capi)
3. [免费额度说明](https://cloud.tencent.com/document/product/866/35945)
4. [通用印刷体识别 API](https://cloud.tencent.com/document/api/866/33526)

通用印刷体识别当前每月免费 1,000 次。建议创建仅允许 OCR 的 CAM 子用户密钥，不使用主账号永久密钥。需要填写：

```dotenv
OCR_PROVIDER=tencent
TENCENTCLOUD_SECRET_ID=
TENCENTCLOUD_SECRET_KEY=
TENCENTCLOUD_REGION=ap-guangzhou
```

### Cloudflare Turnstile

1. [创建 Turnstile Widget](https://dash.cloudflare.com/?to=/:account/turnstile)
2. [官方 Widget 指引](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)

把用户站的 `<public-project>.pages.dev` 加入 Hostname，选择 Managed 模式。需要填写：

```dotenv
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

## 服务配置

后台独立部署到另一个 Pages 项目，不链接到用户站。管理 API 需要独立 Bearer Token：

```dotenv
NEXT_PUBLIC_API_BASE_URL=/api
VITE_API_BASE_URL=/api
API_ORIGIN=https://<api-worker>.<workers-subdomain>.workers.dev
WEB_ORIGINS=https://<public-project>.pages.dev
ADMIN_ORIGINS=https://<admin-project>.pages.dev
VITE_PUBLIC_WEB_URL=https://<public-project>.pages.dev
ADMIN_API_TOKEN=生成一个至少32字节的随机值
```

两个 Pages 项目的 `/api/*` 都由 Pages Function 同源转发到 `API_ORIGIN`。公共 API 不提供词库列表，只有 `/admin/v1/*` 可以读取和修改完整词库。

署名由服务构建配置决定，用户界面无法修改：

```dotenv
NEXT_PUBLIC_AUTHOR_MARK=
```

需要署名时填写自己的公开标识；留空表示不显示。

## 可免费商用的素材源

“免费商用”不等于所有图片都没有额外权利。人物肖像、品牌、商标和虚构角色仍可能受到限制。

### 推荐 1：Wikimedia Commons

- [素材站](https://commons.wikimedia.org/)
- [商用复用说明](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- [机器可读授权元数据](https://commons.wikimedia.org/wiki/Commons:Machine-readable_data)
- API 无需 Key：`https://commons.wikimedia.org/w/api.php`

通过 `prop=imageinfo&iiprop=url|extmetadata` 获取图片 URL、作者、授权地址。为了让生成图片不附带额外授权文字，自动发布只接受：

- CC0
- Public Domain

CC BY / CC BY-SA 可以商用，但需要署名或相同方式共享，不能在没有素材署名的输出里自动使用。

### 推荐 2：Pexels

- [申请免费 API Key](https://www.pexels.com/api/)
- [API 文档](https://www.pexels.com/api/documentation/)
- [内容许可](https://www.pexels.com/license/)

适合食品、动物、人物和一般物品照片。许可允许免费商用和修改，通常不强制署名；API 默认 200 请求/小时、20,000 请求/月。`images.pexels.com` 返回 CORS 头，可直接画进浏览器 Canvas。

```dotenv
PEXELS_API_KEY=
```

### 备选：Unsplash

- [创建 Developer Application](https://unsplash.com/developers)
- [API 技术规范](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)
- [许可](https://unsplash.com/license)

可免费商用，但 API 强制：

- 使用 API 返回的热链 URL
- 用户选用图片时调用 download endpoint
- 在应用内标注 Unsplash 和摄影师

因此它适合有素材来源页的后续版本，不作为当前“无附加文字”输出的第一选择。

```dotenv
UNSPLASH_ACCESS_KEY=
```

### 发现工具：Openverse

- [API](https://api.openverse.org/v1/)
- [使用条款](https://docs.openverse.org/terms_of_service.html)

它是开放授权内容的搜索聚合器，不保证每条授权准确。只用来发现候选，发布前仍回源验证 license、作者和原始页面。

### 不作为首选：Pixabay

[Pixabay Content License](https://pixabay.com/service/license-summary/) 允许免费商用和修改，但禁止独立分发，带品牌/商标的内容还有额外限制；其 API 热链政策也不如 Pexels / Unsplash 清晰。

## 图片只存链接时的门禁

词库至少保存：

```text
image_url
source_page_url
source_provider
author
license
license_url
attribution_required
last_verified_at
```

启用前自动检查：

1. HTTPS、图片 MIME、尺寸和文件大小
2. 图片域返回 `Access-Control-Allow-Origin`，否则 Canvas 无法导出
3. 授权仍在允许列表
4. 链接仍可访问

允许直接热链的首批域名建议限定为：

- `images.pexels.com`
- `images.unsplash.com`（遵守 API 署名和 download 规则后）
- `upload.wikimedia.org`

链接失效或没有 CORS 时，只有在许可允许保存副本的情况下才镜像到 R2。

## 商业 IP

宝可梦、麦当劳等准确角色或品牌素材，一般不存在一个“免费商用图库”可以替代权利方授权。当前按项目方确认的“非官方、非商业测试”范围使用角色立绘和产品图，并保留来源字段；正式商业化前必须重新核对商标、角色版权和素材来源。
