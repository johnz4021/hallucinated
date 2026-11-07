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
  drops: [{ id: "drop-<n>", n: number, title, tagline?, description?, status: "live"|"preorder"|"archived", image? }]
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
- `metadata.preorder_total`: the amount to charge at launch, in cents. `metadata.currency` is `usd`. `metadata.launch_window` and `metadata.drop` are also set.
- **Customer:** `customer` (always created), plus `customer_details.email` and `.name`.
- **Saved card:** `setup_intent`. Expand it; its `payment_method` is attached to the customer, with `usage=off_session`.
- **Charging at launch** is the agents' job, behind an `ask` tool with John's OK. Create a PaymentIntent with `customer`, `payment_method`, `amount=preorder_total`, `currency`, `off_session=true`, `confirm=true` and the same metadata. Expect some to need re-authentication (`authentication_required`): email those customers a payment link. The site has no charge endpoint.
- **Cancellations** arrive by email. Mark them, e.g. on the customer with `metadata.preorder_cancelled=<session id>`, and skip them at launch.

### 3.3 Drop alerts
Signups are Stripe Customers with `metadata.drop_alerts="yes"` (plus `drop_alerts_source` and `drop_alerts_at`). Find them with `GET /v1/customers/search?query=metadata['drop_alerts']:'yes'`.

### 3.4 Mixed carts
The site doesn't allow mixing pay-now and pre-order items in one checkout. The API returns 400 for a mixed bag, and the UI offers "Start a new bag". Each session is therefore exactly one kind.
