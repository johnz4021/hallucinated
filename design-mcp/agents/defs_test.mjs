// Unit check: every agent's tool config turns OFF every Naïve built-in and every hallucinated.* tool it isn't given, so
// nothing can raise a surprise approval card (Product's board_write did). Pure; no network.
//   node agents/defs_test.mjs
import assert from "node:assert/strict";
import { agentDefs, applyTools, ALL_BUILTINS, ALL_MCP_TOOLS, NEVER_AUTO, MCP } from "./defs.mjs";

const NOT_SETTABLE = new Set(["payments", "payments_request"]);   // template-app tools: the SDK refuses to name them, and they're only offered to toolsets that do
const base = { default_config: { permission: "allow" }, configs: {} };
for (const live of [false, true]) for (const [key, d] of Object.entries(agentDefs({ live }))) {
  const t = applyTools(base, d);
  for (const n of ALL_BUILTINS) {
    if (NOT_SETTABLE.has(n)) continue;
    const want = !!d.builtins?.[n];
    assert.equal(t.configs[n]?.enabled !== false, want, `${key}: built-in ${n} should be ${want ? "on" : "off"}`);
    if (want) assert.equal(t.configs[n].permission, d.builtins[n].permission, `${key}: ${n} permission`);
  }
  for (const n of ALL_MCP_TOOLS) {
    const p = d.tools[n], c = t.configs[`${MCP}.${n}`];
    if (!p || p === "off") assert.equal(c.enabled, false, `${key}: ${n} should be off`);
    else { assert.equal(c.enabled, true, `${key}: ${n} should be on`); assert.equal(c.permission, p, `${key}: ${n} permission`); }
  }
}
assert.equal(applyTools(base, agentDefs({}).product).configs.board_write.enabled, false);
for (const n of ["customania_handoff_payment", "courier_book", "charge_preorders"]) assert.ok(NEVER_AUTO.has(`${MCP}.${n}`));
console.log(`defs: ${Object.keys(agentDefs({})).length} agents x ${ALL_BUILTINS.length} built-ins + ${ALL_MCP_TOOLS.length} MCP tools: only the granted ones are on: OK`);
