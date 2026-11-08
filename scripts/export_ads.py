# Pulls all brand media into ad-library/ (git-ignored), safe to re-run (skips existing files):
#   ads/          live reviewer-passed ads (not withdrawn/test) + 2:3 (1080x1620) versions of every video
#   on-model/lookbook/  store lookbook;  on-model/launches/<slug>/  launch shots per shirt
#   banners/      store hero banners;     products/<slug>/  store product images (mockups)
# INDEX.md lists everything with captions / X links. Needs STORE_ADMIN_SECRET in .env (read, never printed).
import json, os, re, subprocess, urllib.request
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
L = "ad-library"
env = open(".env").read()
secret = (re.search(r"^STORE_ADMIN_SECRET=(.+)$", env, re.M) or [None, ""])[1].strip().strip("'\"")
STORE = json.load(open("store.json"))["url"]
lines = ["# Hallucinated media library\n"]

def get(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as e:
            print(f"skip {url[:90]}: {e}")
            return None
    return path

def ext_of(url, default=".png"):
    e = os.path.splitext(url.split("?")[0])[1].lower()
    return e if e in (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".gif") else default

def urls_in(item):
    out = []
    for k, v in item.items():
        if isinstance(v, str) and v.startswith("https://") and re.search(r"\.(png|jpe?g|webp|mp4|gif)(\?|$)", v): out.append(v)
        elif isinstance(v, list):
            for u in v:
                if isinstance(u, str) and u.startswith("https://"): out.append(u)
                elif isinstance(u, dict) and isinstance(u.get("url"), str) and u["url"].startswith("https://"): out.append(u["url"])
    return out

def to_2x3(src):
    dst = src.rsplit(".", 1)[0] + "_2x3.mp4"
    if os.path.exists(dst): return dst
    # crop to 2:3 keeping the top (headline band) and centre; then scale to 1080x1620
    vf = "crop='if(gt(iw/ih,2/3),ih*2/3,iw)':'if(gt(iw/ih,2/3),ih,iw*3/2)':'(iw-ow)/2':'min((ih-oh),ih*0.04)',scale=1080:1620:flags=lanczos,setsar=1"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
                    "-crf", "18", "-preset", "medium", "-c:a", "copy", "-movflags", "+faststart", dst], check=True)
    return dst

# 1. ads
a = json.load(open("ads.json"))["ads"]
xl = json.load(open("x-ledger.json"))
posted = {p.get("ad_id"): p for p in xl["posts"] if p.get("ad_id")}
withdrawn = {k for k, x in a.items() if x.get("state") == "withdrawn" or x.get("test")}
lines += ["\n## Ads (reviewer-passed)\n", "| file | 2:3 | state | X post | caption |", "|---|---|---|---|---|"]
for k, x in sorted(a.items(), key=lambda kv: kv[1].get("created_at", "")):
    if k in withdrawn or not x.get("media_url"): continue
    fn = f"{x.get('created_at','')[:16].replace(':','')}_{x.get('kind')}_{(x.get('featured_products') or ['brand'])[0]}"
    p = get(x["media_url"], f"{L}/ads/{fn}{'.mp4' if x.get('kind')=='video' else ext_of(x['media_url'])}")
    v23 = ""
    if x.get("kind") == "video":
        v23 = os.path.relpath(to_2x3(p), L)
        if x.get("poster_url"): get(x["poster_url"], f"{L}/ads/{fn}_poster.jpg")
    xp = posted.get(k); xu = f"https://x.com/hallucinateddpt/status/{xp['id']}" if xp and xp.get("id") else ""
    lines.append(f"| [{os.path.relpath(p, L)}]({os.path.relpath(p, L)}) | {v23} | {x.get('state')} | {xu} | {(x.get('caption') or '').replace('|','/').replace(chr(10),' ')} |")

# 2. store content: lookbook, launches, banners (skip test items, skip retired poster campaigns)
req = urllib.request.Request(f"{STORE}/api/admin/content", headers={"Authorization": f"Bearer {secret}"})
c = json.load(urllib.request.urlopen(req)); c = c.get("content", c)
for coll, folder in (("lookbook", "on-model/lookbook"), ("launches", "on-model/launches"), ("banners", "banners")):
    lines += [f"\n## {coll}\n"]
    for it in c.get(coll, []) or []:
        if it.get("test"): continue
        key = (it.get("slug") or it.get("id") or "item")
        for i, u in enumerate(urls_in(it)):
            if "/api/mockup" in u: continue
            sub = f"{folder}/{key}" if coll == "launches" else folder
            p = get(u, f"{L}/{sub}/{key}_{i}{ext_of(u)}")
            if not p: continue
            lines.append(f"- [{os.path.relpath(p, L)}]({os.path.relpath(p, L)}) {(it.get('caption') or it.get('title') or it.get('alt') or '')[:120]}")

# 3. product images from the live catalog (mockups rendered by the store)
lines += ["\n## products (store mockups)\n"]
slugs = [x["slug"] for x in json.load(open("store.json")).get("products", [])] + [d.get("slug") for d in c.get("designs", []) if d.get("slug") and not d.get("test")]
for slug in dict.fromkeys(slugs):
    try:
        html = urllib.request.urlopen(f"{STORE}/p/{slug}").read().decode("utf8", "ignore")
    except Exception:
        continue
    imgs = [u for u in dict.fromkeys(re.findall(r'https://[^"\s&;]+?\.(?:png|jpe?g|webp)', html)) if "%" not in u][:4]
    for i, u in enumerate(imgs):
        p = get(u, f"{L}/products/{slug}/{slug}_{i}{ext_of(u)}")
        if not p: continue
        lines.append(f"- [{os.path.relpath(p, L)}]({os.path.relpath(p, L)})")

open(f"{L}/INDEX.md", "w").write("\n".join(lines) + "\n")
n = sum(len(fs) for _, _, fs in os.walk(L)) - 1
print(f"{n} files in {L}/")
