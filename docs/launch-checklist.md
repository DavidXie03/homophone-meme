# Launch credentials and asset sources

Never commit secrets. Store production values in Cloudflare or GitHub Actions Secrets and local values in ignored `.env.local` or `.env.deploy.local` files.

## Required services

### Cloudflare

Resources:

- Two Pages projects: public app and private admin app
- One Worker for the Hono API
- One D1 database
- One R2 bucket

Default `pages.dev` and `workers.dev` domains do not require a Zone ID or DNS permissions.

Create a scoped [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) with only the permissions required for:

- Workers Scripts: Edit
- Cloudflare Pages: Edit
- D1: Edit
- Workers R2 Storage: Edit
- Account: Read

Do not use a Cloudflare password or Global API Key.

GitHub Actions requires:

```dotenv
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
```

Store both values as repository secrets. Store project names, resource names, and public URLs as repository variables. The complete list is in the root README.

### Tencent Cloud OCR

References:

- [OCR console](https://console.cloud.tencent.com/ocr/overview)
- [SecretId and SecretKey](https://console.cloud.tencent.com/cam/capi)
- [Free quota](https://cloud.tencent.com/document/product/866/35945)
- [GeneralBasicOCR API](https://cloud.tencent.com/document/api/866/33526)

Use a dedicated CAM user that can call only `ocr:GeneralBasicOCR`. Do not use permanent root-account credentials.

```dotenv
OCR_PROVIDER=tencent
TENCENTCLOUD_SECRET_ID=
TENCENTCLOUD_SECRET_KEY=
TENCENTCLOUD_REGION=ap-guangzhou
```

Mock OCR remains available for local development and built-in samples.

### Cloudflare Turnstile

Turnstile is optional. If enabled, add the public Pages hostname to the widget and use Managed mode.

```dotenv
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

The backend integration exists, but the public widget must also be enabled before setting the production secret.

## Service configuration

Both Pages projects proxy same-origin `/api/*` requests to the Worker through a Pages Function.

```dotenv
NEXT_PUBLIC_API_BASE_URL=/api
VITE_API_BASE_URL=/api
API_ORIGIN=https://<api-worker>.<workers-subdomain>.workers.dev
PUBLIC_WEB_URL=https://<public-project>.pages.dev
ADMIN_PUBLIC_URL=https://<admin-project>.pages.dev
WEB_ORIGINS=https://<public-project>.pages.dev
ADMIN_ORIGINS=https://<admin-project>.pages.dev
VITE_PUBLIC_WEB_URL=https://<public-project>.pages.dev
ADMIN_API_TOKEN=<at-least-32-random-bytes>
```

Only authenticated `/admin/v1/*` routes expose lexicon administration. The public API does not provide an entity-list endpoint.

Optional poster attribution is a build-time public value:

```dotenv
NEXT_PUBLIC_AUTHOR_MARK=
```

Leave it empty to hide attribution.

## Asset sources

"Commercial-use friendly" does not remove third-party trademark, character, or likeness rights. Verify both the file license and the depicted subject.

### Wikimedia Commons

- [Media library](https://commons.wikimedia.org/)
- [Reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- [Machine-readable licensing](https://commons.wikimedia.org/wiki/Commons:Machine-readable_data)
- API: `https://commons.wikimedia.org/w/api.php`

Use `prop=imageinfo&iiprop=url|extmetadata` to retrieve the source URL, author, license, and license URL.

CC0 and Public Domain files are the simplest options for generated output without attribution text. CC BY and CC BY-SA require attribution and, for ShareAlike content, compatible distribution terms.

### Pexels

- [API](https://www.pexels.com/api/)
- [Documentation](https://www.pexels.com/api/documentation/)
- [License](https://www.pexels.com/license/)

Pexels is suitable for generic food, animals, people, and objects. It does not replace licensed IP artwork.

### Unsplash

- [Developer portal](https://unsplash.com/developers)
- [API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)
- [License](https://unsplash.com/license)

The API requires hotlinked image URLs, photographer attribution, and a download-endpoint call when an image is selected. Do not integrate it as an unattributed output source.

### Openverse

- [API](https://api.openverse.org/v1/)
- [Terms](https://docs.openverse.org/terms_of_service.html)

Openverse is a discovery index, not a license guarantee. Verify every candidate at its original source.

### Pixabay

[Pixabay's license](https://pixabay.com/service/license-summary/) permits many commercial uses but restricts standalone redistribution. Brand and trademark restrictions still apply, so it is not a preferred IP source.

## Link-only image validation

For production-grade source records, store:

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

Before enabling an image:

1. Require HTTPS and an image MIME type.
2. Validate dimensions and file size.
3. Confirm that the license is still allowed.
4. Confirm that the source URL still resolves.
5. Verify Canvas compatibility or route the image through the API proxy.

Mirror a file to R2 only when its license permits storing a copy.

## Commercial IP

Accurate Pokémon, restaurant-brand, game-character, celebrity, and media artwork is generally not available from a generic "free commercial image" library. Current catalog assets are limited to the project's non-commercial prototype scope. Re-audit every trademark, character, likeness, and image license before commercial launch.
