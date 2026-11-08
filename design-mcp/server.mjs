// Hallucinated design tool as an MCP server (Streamable HTTP, stateless). Bearer-token protected.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { generateDesign } from "./generate.mjs";
import { STYLE_IDS, loadStyleLedger, issueStyle, recordStyle } from "./designs/styles.mjs";
import { registerCustomaniaTools } from "./customania/tools.mjs";
import { registerXTools } from "./x/tools.mjs";
import { registerCourierTools } from "./courier/tools.mjs";
import { registerAgentMailTools } from "./agentmail/tools.mjs";
import { registerStripeTools } from "./stripe/tools.mjs";
import { registerTrendsTools } from "./trends/tools.mjs";
import { registerPreorderTools } from "./stripe/preorders.mjs";
import { registerSupportTools } from "./stripe/support.mjs";
import { registerDesignTools } from "./designs/tools.mjs";
import { registerCreativeTools } from "./creative/tools.mjs";
import { registerLinkedInTools } from "./linkedin/tools.mjs";

export function buildMcp(ctx) {
  const server = new McpServer({ name: "hallucinated", version: "0.1.0" });
  server.registerTool("generate_design", {
    title: "Generate a print-ready Hallucinated t-shirt graphic",
    description:
      "Makes one t-shirt graphic with GPT Image as a print-ready transparent PNG (300 DPI) for a black tee. Brand palette, style, banned content " +
      "and our official logo (as a reference image) are applied automatically. The result is QA-checked on a black shirt and returns pass/fail " +
      "with specific issues (including any misspelled text): if it fails, rewrite your prompt to fix those issues and call again.",
    inputSchema: {
      prompt: z.string().describe("What the graphic should look like: subject, composition, style, colors, where the text sits."),
      text: z.string().optional().describe("Exact text that must appear, e.g. '> git reset --hard'. Omit for no text."),
      placement: z.enum(["back", "front-chest"]).optional().describe("back (default) or front-chest."),
      references: z.array(z.enum(["logo", "git-reset-back"])).optional().describe("Reference images to attach. The logo is attached automatically whenever 'Hallucinated' or a chest print is involved; add 'git-reset-back' to match our approved back-graphic style."),
      style: z.enum(STYLE_IDS).optional().describe("The art style. Leave it out to use the one next_design_style gave you (the rotation). Another style needs style_reason."),
      style_reason: z.string().max(300).optional().describe("Why the joke needs a different style than the rotation's pick (required when you override it)."),
    },
  }, async (args) => {
    try {
      // The style rotation is decided in code (designs/styles.mjs): the pending style from next_design_style, or a new pick.
      // A design using our house line-art reference (drop #1 runs) stays line art.
      let style = args.style, override = null;
      if (ctx.rootDir) {
        const pending = loadStyleLedger(ctx.rootDir).pending;
        const issued = pending && Date.now() - new Date(pending.at).getTime() < 6 * 3600_000 ? pending.style : null;
        if (!style) style = issued || ((args.references || []).includes("git-reset-back") ? "terminal_lineart" : issueStyle(ctx.rootDir));
        else if (issued && style !== issued) {
          if (!args.style_reason || args.style_reason.trim().length < 10) return { isError: true, content: [{ type: "text", text: `refused: the rotation picked "${issued}" for this run; to use "${style}" instead, give style_reason (why the joke needs it)` }] };
          override = args.style_reason.trim();
        }
      }
      const r = await generateDesign({ ...args, style }, ctx);
      if (ctx.rootDir && r.pass) recordStyle(ctx.rootDir, r.style, r.id, override);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `generation failed: ${e.message}` }] };
    }
  });
  if (ctx.rootDir) registerCustomaniaTools(server, ctx);
  if (ctx.rootDir) registerXTools(server, ctx);
  if (ctx.rootDir) registerCourierTools(server, ctx);
  if (ctx.rootDir) registerAgentMailTools(server, ctx);
  if (ctx.rootDir) registerStripeTools(server, ctx);
  if (ctx.rootDir) registerTrendsTools(server, ctx);
  if (ctx.rootDir) registerPreorderTools(server, ctx);
  if (ctx.rootDir) registerSupportTools(server, ctx);
  if (ctx.rootDir) registerDesignTools(server, ctx);
  if (ctx.rootDir) registerCreativeTools(server, ctx);
  if (ctx.rootDir) registerLinkedInTools(server, ctx);
  return server;
}

export function startServer({ port, token, ctx }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/files", express.static(ctx.outDir));
  if (ctx.runsDir) app.use("/runs", express.static(ctx.runsDir));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  const auth = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ error: "unauthorized" });
    next();
  };
  app.post("/mcp", auth, async (req, res) => {
    ctx.log?.(`MCP ${req.body?.method ?? "?"}${req.body?.params?.name ? " " + req.body.params.name : ""}`);
    const server = buildMcp(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  for (const m of ["get", "delete"]) app[m]("/mcp", (_req, res) => res.status(405).json({ error: "method not allowed" }));
  return new Promise((resolve) => { const s = app.listen(port, () => resolve(s)); });
}
