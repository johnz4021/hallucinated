# Copies every live, reviewer-passed ad (not withdrawn, not test) from Blob into ad-library/ with INDEX.md
# (file, state, X post link, caption). Safe to re-run: skips files already downloaded.
import json, os, urllib.request
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.makedirs("ad-library", exist_ok=True)
a = json.load(open("ads.json"))["ads"]
xl = json.load(open("x-ledger.json"))
posted = {p.get("ad_id"): p for p in xl["posts"] if p.get("ad_id")}
rows = []
for k, x in sorted(a.items(), key=lambda kv: kv[1].get("created_at", "")):
    if x.get("test") or x.get("state") == "withdrawn" or not x.get("media_url"):
        continue
    ext = ".mp4" if x.get("kind") == "video" else os.path.splitext(x["media_url"].split("?")[0])[1] or ".png"
    fn = f"{x.get('created_at','')[:16].replace(':','')}_{x.get('kind')}_{(x.get('featured_products') or ['brand'])[0]}{ext}"
    path = os.path.join("ad-library", fn)
    if not os.path.exists(path):
        urllib.request.urlretrieve(x["media_url"], path)
    if x.get("poster_url"):
        pp = path.rsplit(".", 1)[0] + "_poster.jpg"
        if not os.path.exists(pp):
            urllib.request.urlretrieve(x["poster_url"], pp)
    p = posted.get(k)
    rows.append((fn, x.get("state"), x.get("caption", ""), f"https://x.com/hallucinateddpt/status/{p['id']}" if p and p.get("id") else ""))
with open("ad-library/INDEX.md", "w") as f:
    f.write("# Hallucinated ad library (reviewer-passed, live)\n\n| file | state | X post | caption |\n|---|---|---|---|\n")
    for fn, st, cap, xu in rows:
        f.write(f"| [{fn}]({fn}) | {st} | {xu} | {cap.replace('|', '/').replace(chr(10), ' ')} |\n")
print(f"{len(rows)} ads in ad-library/")
