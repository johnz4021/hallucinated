# Store content and catalog: the contract for agent tools

The storefront reads two sources at runtime. Neither needs a redeploy.

| What | Where it lives | How the site sees changes |
|---|---|---|
| Products, sizes, prices, product images | **Stripe** (Products + Prices) | Cached 60 s, or immediately after `POST /api/revalidate` |
| Banners, lookbook, drop pages, announcement bar | **`content.json` on Vercel Blob** | Immediately: every admin write revalidates the site |

`BASE` is the store URL from `store.json` (`url`). Admin calls send `Authorization: Bearer $STORE_ADMIN_SECRET`. The secret is in Vercel env vars and in `storefront/.env.admin` on the Mac; copy it into the repo-root `.env` for the agents' tools. Never log it.

---

## 1. Catalog (Stripe)

One **Product** per garment/design. One **Price** per size. Prices are one-time and in USD.

### Product
- `name`: what the customer sees, e.g. `Wordmark hoodie, forest`
- `description`: one or two sentences
- `images`: up to 8 public https URLs, first one is the card image. Use 4:5 portrait images (upload them with §2.1). Product-shot backgrounds: sand/bone.
- `marketing_features`: bullet points on the product page, `[{ "name": "Forest green pullover hoodie" }]`
- `metadata` (all strings):

| key | required | example | notes |
|---|---|---|---|
| `slug` | yes | `wordmark-hoodie-forest` | URL `/p/<slug>`. Lowercase, dashes. Unique. Products without a slug are ignored. |
| `status` | yes | `live` or `preorder` | Anything else hides the product. `live` = pay now. `preorder` = card saved, charged at launch. |
| `launch_window` | for preorder | `Dec 2026` | Shown on cards, product page and Checkout. |
| `drop` | yes | `drop-2` | Groups products on `/drops/2`. |
| `design_id` | yes | `bc1dbe9d9aae` | Our design tool's ID, or `logo-<variant>` for the wordmark. |
| `garment` | yes | `tee`, `hoodie`, `cap`, `tote` | `tee` shows the tee size guide. |
| `color` | yes | `black` | |
| `category` | yes | `tees`, `hoodies`, `headwear`, `accessories` | Must be one of `store.config.json` `categories` to appear in the filters. |
| `sort` | no | `10` | Lower first. Default 100. |

### Price (one per size)
- `unit_amount` (cents), `currency: "usd"`, `lookup_key: "<slug>-<size lowercase>"` (e.g. `wordmark-hoodie-forest-m`)
- `metadata` (all strings): `size` (`S`/`M`/`L`/`XL`/`OS`), `design_id`, `garment`, `color`, `drop`, `slug`. **A Price without `metadata.size` is not sold.**

### Add a product (exact calls)
```bash
SK=$STRIPE_SECRET_KEY   # from the repo-root .env
P=$(curl -s https://api.stripe.com/v1/products -u "$SK:" \
  -d name="Wordmark beanie" -d description="Black rib beanie with the wordmark." \
  -d "images[]=https://<blob-url>.jpg" \
  -d "marketing_features[0][name]=Black rib knit" \
  -d "metadata[slug]=wordmark-beanie-black" -d "metadata[status]=preorder" -d "metadata[launch_window]=Jan 2027" \
  -d "metadata[drop]=drop-3" -d "metadata[design_id]=logo-black-tee" -d "metadata[garment]=beanie" \
  -d "metadata[color]=black" -d "metadata[category]=headwear" -d "metadata[sort]=20" | jq -r .id)
curl -s https://api.stripe.com/v1/prices -u "$SK:" -d product=$P -d unit_amount=3500 -d currency=usd \
  -d lookup_key=wordmark-beanie-black-os -d transfer_lookup_key=true \
  -d "metadata[size]=OS" -d "metadata[design_id]=logo-black-tee" -d "metadata[garment]=beanie" \
  -d "metadata[color]=black" -d "metadata[drop]=drop-3" -d "metadata[slug]=wordmark-beanie-black"
curl -s -X POST $BASE/api/revalidate -H "Authorization: Bearer $STORE_ADMIN_SECRET" -d '{"what":"catalog"}'
```
- **Launch a pre-order item as pay-now:** set the product's `metadata[status]=live`, then revalidate.
- **Hide an item:** set `active=false` on the product, then revalidate.
- **Change a price:** create a new Price with the same `lookup_key` and `transfer_lookup_key=true`, set `active=false` on the old one, then revalidate. `npm run setup-stripe` does all of this for `seed/catalog.json`.
- **Don't** create a product with `status=live` unless we can actually print and hand it over.

---

## 2. Content (Vercel Blob)

### 2.1 Upload an image
```bash
curl -s -X POST "$BASE/api/admin/upload?name=drop-3-banner" \
  -H "Authorization: Bearer $STORE_ADMIN_SECRET" -H "Content-Type: image/jpeg" \
  --data-binary @banner.jpg
# -> {"url":"https://….public.blob.vercel-storage.com/media/agents/drop-3-banner-<rand>.jpg", "pathname": "...", "bytes": 512345}
```
PNG, JPEG or WebP, up to 4.4 MB. Use JPEG (quality ~85) for photos. Banners are 3:2 landscape (1536×1024); lookbook images are 2:3 portrait (1024×1536).

### 2.2 Publish or update a banner, lookbook image or drop
`PATCH $BASE/api/admin/content` with a JSON body. Upsert matches on `id` and merges fields.
```bash
curl -s -X PATCH $BASE/api/admin/content -H "Authorization: Bearer $STORE_ADMIN_SECRET" -H "Content-Type: application/json" -d '{
  "op": "upsert", "collection": "banners",
  "item": { "id": "drop-3-launch", "title": "Drop 3 is in pre-order", "subtitle": "One line, dry.",
            "image": "<url from upload>", "image_alt": "What the photo shows",
            "cta_label": "See drop 3", "cta_href": "/drops/3", "focus": "right", "sort": 1 } }'
```
- **Remove an item:** `{"op":"remove","collection":"banners","id":"drop-3-launch"}`
- **Pause an item without deleting it:** upsert `{"id":"…","active":false}`
- **Announcement bar:** `{"op":"announcement","text":"Drop 3 opens Friday."}`. Pass `""` to clear it.
- **Read the current document:** `GET $BASE/api/admin/content`, which returns `{ version, content }`.
- **Replace the whole document:** `PUT $BASE/api/admin/content` with the full JSON. It's validated, and an invalid document gets a 400 that says why.
- A `409` means another write landed first. Retry the PATCH.

### 2.3 Schema (`content.json`)
```ts
{
  version: 1, updated_at: string, announcement?: string /* ≤200 */,
  banners: [{ id, title /*≤120*/, subtitle? /*≤240*/, image /*https*/, image_alt, cta_label? /*≤40*/,
              cta_href? /* "/…" or https */, focus?: "left"|"right"|"center", active?: boolean, sort?: number }],
  lookbook: [{ id, image, alt, caption? /*≤200*/, product_slug?, drop? /* "drop-1" */, active?, sort? }],
  drops: [{ id: "drop-<n>", n: number, title, tagline?, description?, status: "live"|"preorder"|"archived", image? }],
  designs: [{ id /* = slug */, slug, design_id, title, trend: { summary, sources: [{ label, url }] }, pitch,
             ceo: { verdict: "approved", reason, at }, product_session?, ceo_session?, created_at }]   // see §4
}
```
- `id` is lowercase letters, digits and dashes.
- The home page shows the first 3 active banners by `sort`. They rotate every 7 s.
- `focus` is where the subject sits in the photo; the text box goes on the other side. On mobile the text sits under the image.
- Lookbook images show on the home strip and on `/drops/<n>` when `drop` matches.

### 2.4 Rules for anything published
- People in images are fictional: no real people, celebrities or look-alikes. No real brands or logos except ours.
- The print has to be our real design, with exact text. Reject garbled prints.
- The footer already says the imagery is AI-generated. Don't remove that.
- Keep `image_alt` honest: say what the photo shows.

Storage note: every write saves a new version as `content/v/<ms>-<rand>.json` (newest wins; the last 20 are kept). Overwriting a single file doesn't work because Blob's CDN keeps serving the old copy. `node scripts/content.mjs pull|push <file>` reads and writes it directly.

---

## 3. Orders: what the agents read from Stripe

List completed Checkout Sessions (`GET /v1/checkout/sessions?status=complete&created[gte]=…`) and branch on `metadata.kind`.

### 3.1 Pay-now orders: `mode=payment`, `metadata.kind="order"` (missing on the first sessions, which are also orders)
- **Paid?** Only fulfil when `payment_status == "paid"`.
- **Line items:** use `expand[]=line_items.data.price.product`. Each line item has a `quantity`, and `price.metadata = { size, design_id, garment, color, drop, slug }`.
- **Customer:** `customer_details.email`, `customer_details.name`, `created`, `amount_total`.
- **Session metadata:**
  - `drop`: comma-joined drops in the cart.
  - `items`: a human summary like `git-reset-hard-tee:Mx1;git-reset-hard-tee:Lx2`.
  - `size` and `design_id`: only on single-line sessions (back-compat).
- **Legacy fixtures:** the two first sessions (`cs_test_a1dWFK…`, `cs_test_a1AJIT…`) used the old single price `price_1UZH8EBnHpN1EAwPy0NcjArA`. It has no `size` in its price metadata; read `session.metadata.size` there.
- **Payment intent and invoice:** the same metadata is on the PaymentIntent. An invoice is created per sale (`invoice`).

### 3.2 Pre-orders: `mode=setup`, `metadata.kind="preorder"`
- `metadata.preorder_items`: a JSON string, `[{"price_id":"price_…","qty":1}, …]`. Look each price up for size, design and garment.
- `metadata.preorder_total`: the item total to charge at launch, in cents.
- `metadata.fulfilment`: `ship` or `pickup`, chosen in the bag before checkout. `ask` means the buyer's browser was running an older version of the site without the choice: email them before charging. Sessions from before this change have no `fulfilment` at all: ask as well.
- `metadata.preorder_shipping`: shipping in cents to add at launch: 600 when `fulfilment=ship` and the item total is under $75, else 0 (the config rule at the time of the order). Charge `preorder_total + preorder_shipping`.
- The shipping address is collected in Checkout for every pre-order (Stripe can't make it optional for pickup). In setup mode Stripe saves it on the **Customer** (`customer.shipping`), not on the session. It stays in Stripe; never read or copy it. Whether one exists is enough for the agents. `metadata.currency` is `usd`. `metadata.launch_window` and `metadata.drop` are also set.
- **Customer:** `customer` (always created), plus `customer_details.email` and `.name`.
- **Saved card:** `setup_intent`. Expand it; its `payment_method` is attached to the customer, with `usage=off_session`.
- **Charging at launch** is the agents' job, behind an `ask` tool with John's OK. Create a PaymentIntent with `customer`, `payment_method`, `amount=preorder_total`, `currency`, `off_session=true`, `confirm=true` and the same metadata. Expect some to need re-authentication (`authentication_required`): email those customers a payment link. The site has no charge endpoint.
- **Cancellations** arrive by email. Mark them, e.g. on the customer with `metadata.preorder_cancelled=<session id>`, and skip them at launch.

### 3.3 Drop alerts
Signups are Stripe Customers with `metadata.drop_alerts="yes"` (plus `drop_alerts_source` and `drop_alerts_at`). Find them with `GET /v1/customers/search?query=metadata['drop_alerts']:'yes'`.

### 3.4 Mixed carts
The site doesn't allow mixing pay-now and pre-order items in one checkout. The API returns 400 for a mixed bag, and the UI offers "Start a new bag". Each session is therefore exactly one kind.

---

## 4. Agent-designed products: the publish flow

The store shows these on the home page ("Fresh from the agents", newest 6), on `/new`, and on product pages with a "Why this exists" panel. Run the five steps below in order. `STORE` is always the production URL, **`https://hallucinated-store.vercel.app`**, even when testing on a preview or with the sandbox key: the site recognises its own mockup URLs on any of its hosts. Admin calls send `Authorization: Bearer $STORE_ADMIN_SECRET`.

### Step 1. Upload the print (transparent PNG, light ink, made for a black tee)
```bash
curl -s -X POST "$STORE/api/admin/upload?name=<slug>-print" \
  -H "Authorization: Bearer $STORE_ADMIN_SECRET" -H "Content-Type: image/png" --data-binary @print.png
# -> {"url":"https://x2ww2cgnt2vbaqob.public.blob.vercel-storage.com/media/agents/<slug>-print-<rand>.png", ...}
```
Keep it under 4.4 MB; 2000 px on the long side is plenty. Downscale the 300-dpi print file first.

### Step 2. Build the mockup URL (no call needed)
```
MOCKUP_BACK  = $STORE/api/mockup?side=back&print=<urlencoded print url>
MOCKUP_FRONT = $STORE/api/mockup?side=front&print=<urlencoded print url>
MOCKUP_FLAT  = $STORE/api/mockup?side=flat&print=<urlencoded print url>    # the print alone on shirt black
```
- The route returns a 1200×1500 PNG of a black tee with the print placed as it would be printed:
  - `back`: centred between the shoulder blades, up to about 11 in wide;
  - `front`: chest, up to about 10 in wide.
- It's cached for a year (print URLs never change).
- It only accepts print URLs on our own Blob store under `media/`; anything else gets a 400.
- Use the side the design is printed on. A back print gets `MOCKUP_BACK` as its first image.

### Step 3. Create the Stripe product and one price per size
```bash
P=$(curl -s https://api.stripe.com/v1/products -u "$STRIPE_SECRET_KEY:" \
  -d name="<Title> tee" -d description="<one-line pitch>" \
  -d "images[0]=$MOCKUP_BACK" -d "images[1]=$MOCKUP_FLAT" \
  -d "marketing_features[0][name]=Black tee" -d "marketing_features[1][name]=Back: <what the print is>" \
  -d "metadata[slug]=<slug>" -d "metadata[status]=preorder" -d "metadata[origin]=agents" \
  -d "metadata[launch_window]=When it launches" -d "metadata[drop]=agents" \
  -d "metadata[design_id]=<design id>" -d "metadata[garment]=tee" -d "metadata[color]=black" \
  -d "metadata[category]=tees" -d "metadata[placement]=back" | jq -r .id)
for SIZE in S M L XL; do
  curl -s https://api.stripe.com/v1/prices -u "$STRIPE_SECRET_KEY:" -d product=$P -d unit_amount=3800 -d currency=usd \
    -d lookup_key=<slug>-$(echo $SIZE | tr A-Z a-z) -d transfer_lookup_key=true \
    -d "metadata[size]=$SIZE" -d "metadata[design_id]=<design id>" -d "metadata[garment]=tee" \
    -d "metadata[color]=black" -d "metadata[drop]=agents" -d "metadata[slug]=<slug>" -d "metadata[origin]=agents"
done
```
- **`slug`**: lowercase, digits and dashes, unique, e.g. `merge-conflict-tee`. Check that no active product already uses it.
- **`origin=agents`**: puts the product in "Fresh from the agents" and on `/new`. Newest first, ordered by the product's `created` time.
- **`status=preorder`**: always, for agent designs. The site never sells them pay-now: checkout saves a card, and the charge happens only at launch, through the ask-permission tool.
- **`launch_window`**:
  - Text without a digit ("When it launches") is shown as plain "Pre-order", with no date promised.
  - A real month ("Jan 2027") is shown as "Est. Jan 2027".
- **`placement`**: `back` or `front`. It decides which mockup is the product's first image and how the product page describes the print.
- **Price**: `unit_amount` 3800 ($38, the store price for tees), unless John says otherwise. The site always shows whatever Stripe says.
- **Images**:
  - `images[0]` is the card and first gallery image.
  - Add `MOCKUP_FLAT` as the second image: the print on shirt black.
  - Don't use the raw print URL as an image; light ink on a transparent background disappears on the site's light tiles.
  - Up to 8 images in total.
- **Sandbox vs live:** run with whichever `STRIPE_SECRET_KEY` the agents use. A sandbox product appears only on deployments using the sandbox key (previews), never in production.

### Step 4. Write the dossier (the "why this exists" panel)
```bash
curl -s -X PATCH $STORE/api/admin/content -H "Authorization: Bearer $STORE_ADMIN_SECRET" -H "Content-Type: application/json" -d '{
  "op": "upsert", "collection": "designs",
  "item": {
    "slug": "<slug>",
    "design_id": "<design id>",
    "title": "<Title>",
    "trend": { "summary": "<2-3 sentences: what people in SF/tech were saying and why it is shirt-worthy>",
               "sources": [ { "label": "r/sanfrancisco thread, 1.2k upvotes", "url": "https://..." } ] },
    "pitch": "<Product agent: what the shirt is and why it works, 1-3 sentences>",
    "ceo": { "verdict": "approved", "reason": "<CEO agent reason, verbatim>", "at": "2026-11-08T17:02:00Z" },
    "product_session": "ses_...", "ceo_session": "ses_...",
    "created_at": "2026-11-08T16:40:00Z"
  } }'
```
- **Keyed by `slug`:** upserting the same slug merges the fields.
- **Remove:** `{"op":"remove","collection":"designs","id":"<slug>"}`
- **Limits:**
  - `trend.summary` up to 600 characters;
  - `pitch` up to 600;
  - `ceo.reason` up to 800;
  - `trend.sources` up to 6, each with a `label` (up to 120 characters) and an http(s) `url`.
- **Visibility:** a dossier is shown only when an **active product with the same slug exists in that deployment's Stripe catalog**. Blob is shared across environments, so a sandbox dossier stays invisible in production.
- **Sources** render as plain links and are never embedded. Use the real URLs the trend tool returned.

### Step 5. Revalidate
```bash
curl -s -X POST $STORE/api/revalidate -H "Authorization: Bearer $STORE_ADMIN_SECRET" -d '{"what":"all"}'
```
- The product appears at `$STORE/p/<slug>`, on `$STORE/new` and on the home page.
- **For a preview deployment, call that preview's own `/api/revalidate`;** otherwise wait up to 60 s for the catalog cache.

### Retire or launch a design
- **Hide:** set the product `active=false`, then revalidate. The dossier is hidden automatically; remove it if you like.
- **Launch for real:** set `status=live` once it can actually be printed and handed over, then revalidate. Charging the saved pre-order cards is the agents' ask-permission tool (§3.2).

---

## 5. Campaigns: the agents' ads

Ads made by the creative agent and passed by the vision reviewer appear in several places:
- product pages: an "As seen in" strip for every product named in `featured_products` (newest 3);
- `/hq`: an "Ads the agents made" row (newest 6 non-test);
- `/campaigns` ("Ads, by the agents"): a wall of all of them, newest first;
- the home hero: the newest 1–3 **image** campaigns rotate in after the banners;
- the content admin API: Growth posts the same media on X.

`STORE` = `https://hallucinated-store.vercel.app` (for a preview, use the preview URL for every call, including revalidation). Admin calls send `Authorization: Bearer $STORE_ADMIN_SECRET`.

### Step 1. Get the media onto our Blob store
Pick by size. Every path returns a public `url` on `x2ww2cgnt2vbaqob.public.blob.vercel-storage.com`.

**A. Images and short videos up to 4.4 MB: direct upload** (Vercel caps a function request body at 4.5 MB)
```bash
curl -s -X POST "$STORE/api/admin/upload?name=<campaign-id>" \
  -H "Authorization: Bearer $STORE_ADMIN_SECRET" -H "Content-Type: image/png" --data-binary @ad.png
# Content-Type: image/png | image/jpeg | image/webp | video/mp4 | video/webm
# -> {"url":"https://…/media/agents/<campaign-id>-<rand>.png","pathname":"…","bytes":123456}
```

**B. Videos and anything else up to 50 MB: URL ingest.** The store fetches the file and copies it to Blob. Use this when the file is already reachable over https, for example served by our MCP server's tunnel `/files/...` or a URL returned by the video model.
```bash
curl -s -X POST "$STORE/api/admin/ingest" -H "Authorization: Bearer $STORE_ADMIN_SECRET" \
  -H "Content-Type: application/json" -d '{"url":"https://<tunnel>/files/ad-123.mp4","name":"<campaign-id>"}'
# -> {"url":"https://…/media/agents/<campaign-id>-<rand>.mp4","pathname":"…","bytes":18234567,"content_type":"video/mp4"}
```
- The source must be https and answer within about 90 s.
- It must send a `Content-Type` of image/png, image/jpeg, image/webp, video/mp4 or video/webm.
- It must be at most 50 MB. Anything bigger is rejected and nothing is kept.

**C. Local file with Node and `@vercel/blob`, up to 50 MB: client token**
```js
// 1) ask the store for a one-off token scoped to a single path
const r = await fetch(`${STORE}/api/admin/upload-token`, { method: "POST",
  headers: { Authorization: `Bearer ${process.env.STORE_ADMIN_SECRET}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "<campaign-id>", content_type: "video/mp4" }) });
const { pathname, client_token } = await r.json();          // valid 15 min, that pathname only
// 2) upload straight to Blob (no 4.5 MB limit; multipart for big files)
import { put } from "@vercel/blob";
const blob = await put(pathname, fs.readFileSync("ad.mp4"), { access: "public", token: client_token, contentType: "video/mp4", multipart: true });
// blob.url is the media_url
```

**Video specs:** H.264 MP4, ≤ 60 s, ≤ 1080 px on the long side, no audio needed (the site plays muted). Also upload a **poster** frame (JPEG, same aspect ratio) with path A. It shows before playback and on slow connections.

**Image specs:** PNG or JPEG.
- **Square (1:1) and 4:5** both work on `/campaigns`.
- **In the home hero**, the whole ad is shown (letterboxed on dark green), never cropped.
- **Text:** keep it inside the image, because nothing is overlaid on it.

### Step 2. Publish the campaign
```bash
curl -s -X PATCH $STORE/api/admin/content -H "Authorization: Bearer $STORE_ADMIN_SECRET" -H "Content-Type: application/json" -d '{
  "op": "upsert", "collection": "campaigns",
  "item": {
    "id": "ad-2026-11-08-standup-roast",
    "kind": "image",
    "media_url": "<Blob url from step 1>",
    "poster_url": "<Blob url, videos only>",
    "concept": "<creative agent: the idea and why it is funny, 1-3 sentences, its own words>",
    "caption": "<the line that runs with the ad, same as the X post or close>",
    "event": false,
    "sources": [],
    "featured_products": ["git-reset-hard-tee"],
    "x_url": "https://x.com/hallucinateddpt/status/<id>",
    "created_at": "2026-11-08T18:05:00Z",
    "test": false
  } }'
```

| field | rules |
|---|---|
| `id` | lowercase letters, digits and dashes, ≤ 80 characters, unique. Upserting the same id merges the fields. |
| `kind` | `image` or `video` |
| `media_url` | our Blob store, `https://x2ww2cgnt2vbaqob.public.blob.vercel-storage.com/media/…` |
| `poster_url` | optional, same host. Strongly recommended for video. |
| `concept` | ≤ 600 characters. Shown as "the agent's note". |
| `caption` | ≤ 280 characters |
| `event` | `true` when the ad reacts to a specific news event. Then `sources` must have at least 1 entry. |
| `sources` | ≤ 6 `{label ≤120, url http(s)}`. Rendered as plain links, never embedded. |
| `featured_products` | ≤ 4 product slugs. The first one that is active in the catalog becomes the ad's link (hero and wall); otherwise it links to `/campaigns`. |
| `x_url` | optional `https://x.com/...` link to the post that ran this ad. When set, the product page's "As seen in" strip links there (otherwise to `/campaigns`). Add it later with an upsert of `{id, x_url}` once Growth has posted. |
| `created_at` | ISO time. Sort order, newest first. |
| `test` | `true` = **never shown on production**, only on previews and locally. Use it for every dry run. |
| `active` | optional. `false` hides the campaign without deleting it. |

- **Remove a campaign:** `{"op":"remove","collection":"campaigns","id":"<id>"}`. The media stays on Blob; that's fine.
- Every write revalidates the site, so the campaign appears within seconds with no separate call. `/campaigns` also refreshes every 60 s.

### Rules
- The rules in §2.4 apply: fictional people only, no real people or look-alikes, no real brands or logos except ours.
- Our shirts may appear only as our real designs.
- **Event ads:** link the real sources the agent used, and roast the moment, not a person.

---

## 6. Launch images: on-model shots of new designs

After a design is approved and published (§4), the agents generate 2–3 photos of the shirt on people and attach them to the product. The store then uses them:
- **Home hero:** the newest launch leads ("New: <title>", "Shop the drop" → the product), before the curated banners;
- **Product gallery:** on-model shots first, then the mockups (back, front, flat) from the Stripe product;
- **Lookbook strip:** recent launch shots, newest first, mixed in with the curated lookbook;
- **"This week from the agents" cards:** the first on-model shot appears as the hover image.

The Stripe product's `images` are not touched (they stay the mockups, ≤ 8). Launch images live in the content store as a `launches` collection keyed by product slug.

### Step 1. Upload each image
Use §2.1 (`POST $STORE/api/admin/upload?name=<slug>-launch-1`, ≤ 4.4 MB) or §5's `/api/admin/ingest` for a URL.
- **Format:** JPEG, quality ~85, portrait 2:3 (1024×1536) or 4:5.
- **Content:** the shirt as printed (back or front, matching the design's placement), on a fictional person, no real people or brands (§2.4).
- **Check:** the print must match the real design. Reject garbled text.

### Step 2. Attach them to the product
```bash
curl -s -X PATCH $STORE/api/admin/content -H "Authorization: Bearer $STORE_ADMIN_SECRET" -H "Content-Type: application/json" -d '{
  "op": "upsert", "collection": "launches",
  "item": {
    "slug": "<product slug>",
    "title": "<product title, optional; defaults to the Stripe name>",
    "images": [
      { "url": "<Blob url from step 1>", "alt": "<what the photo shows>", "kind": "on_model" },
      { "url": "<…>", "alt": "<…>", "kind": "on_model" }
    ],
    "created_at": "2026-11-08T18:20:00Z",
    "test": false
  } }'
```

| field | rules |
|---|---|
| `slug` | the product's `metadata.slug` (also the item's id). Upserting the same slug replaces `images` and merges the other fields. |
| `images` | 1–6 items. `url` must be on our Blob store under `media/`; `alt` is required, ≤ 300 chars; `kind` is `"on_model"`. Order = display order. |
| `title` | optional, ≤ 120 |
| `created_at` | ISO time; the newest launch leads the hero |
| `test` | `true` = shown on previews and locally only, never in production |
| `active` | optional; `false` hides it |

- **Remove:** `{"op":"remove","collection":"launches","id":"<slug>"}`
- **Visibility:** a launch shows only when its slug is an active product in that deployment's own Stripe catalog (so sandbox tests stay off production), and not `test` in production.
- Every write revalidates the site, so no separate call is needed.

---

## 7. Pre-promotion checklist (storefront)

Run these against the **preview URL** (test key) before every promotion; all must pass.

```bash
cd storefront
npx tsc --noEmit && npm run build:local                      # types + production build
VERCEL_OIDC=1 node scripts/test-flows.mjs <preview-url>       # click-through: product -> bag -> choice -> Checkout opens
PLAN=single VERCEL_OIDC=1 node scripts/test-checkout.mjs <preview-url> order       # pays with 4242, checks shipping
PLAN=single SHIP=ship VERCEL_OIDC=1 node scripts/test-checkout.mjs <preview-url> preorder   # saves a card, checks fulfilment
VERCEL_OIDC=1 node scripts/screenshot.mjs <preview-url> test-output/shots "/,/shop,/p/<slug>"   # look at them (1440 + 390 px)
```
- `test-flows.mjs` covers: buy-now tee (no choice in the bag; Stripe asks), pre-order cap (choice shown, ship), the newest agent tee (choice, pickup), a **stale bag** (archived price + wrong kind in localStorage gets corrected before checkout), and an **old-client** API call without a choice (accepted as `fulfilment: "ask"`; a current client gets 400).
- Any change to what `/api/checkout` requires must stay backward compatible: tabs opened before a deploy keep running the old bundle and call the new API.
- `VERCEL_OIDC=1` uses the linked project's short-lived development token from `storefront/.env.local` (refresh: `npx vercel@latest env pull .env.local --yes`), sent only to the store's own origin.

