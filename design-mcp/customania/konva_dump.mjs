// Dumps the editor's Konva object tree after uploading the front design, to find the movable design node.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CustomaniaSession } from "./customania.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, ".."), ROOT = path.resolve(MCP, "..");
const OUT = path.join(ROOT, "customania-runs");
const log = (m) => { console.log(m); fs.appendFileSync(path.join(OUT, "konva.log"), m + "\n"); };
const s = new CustomaniaSession({ root: ROOT, outDir: OUT, log });
try {
  await s.start();
  await s.upload("front", path.join(MCP, "refs", "logo.png"));
  const tree = await s.editor.evaluate(() => {
    const walk = (n, d) => {
      const a = n.attrs || {};
      const o = { cls: n.getClassName(), id: n.id?.() || undefined, name: n.name?.() || undefined,
        drag: n.draggable?.() || undefined, vis: n.isVisible?.(),
        attrs: Object.fromEntries(Object.entries(a).filter(([k, v]) => typeof v !== "object" || v === null).slice(0, 25)) };
      if (n.getClientRect && d > 0) { try { const r = n.getClientRect(); o.rect = [r.x, r.y, r.width, r.height].map((x) => Math.round(x)); } catch {} }
      if (n.children && d < 6) o.kids = n.children.map((c) => walk(c, d + 1));
      return o;
    };
    return (window.Konva.stages || []).map((st, i) => ({ i, container: st.container()?.id || st.container()?.className, visible: st.content?.offsetParent !== null, tree: walk(st, 0) }));
  });
  fs.writeFileSync(path.join(OUT, "konva-tree.json"), JSON.stringify(tree, null, 1));
  log("stages: " + tree.map((t) => `${t.i}:${t.container}:${t.visible}`).join(" | "));
  const tr = await s.editor.evaluate(() => {
    const out = [];
    for (const st of window.Konva.stages) for (const t of st.find("Transformer")) out.push({ nodes: (t.nodes?.() || []).map((n) => ({ cls: n.getClassName(), id: n.id(), name: n.name(), attrs: Object.keys(n.attrs) })) });
    return out;
  });
  log("transformers: " + JSON.stringify(tr));
} catch (e) { log("EXCEPTION " + e.message); }
await s.close();
log("== konva dump done");
