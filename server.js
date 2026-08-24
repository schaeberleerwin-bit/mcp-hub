import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import dotenv from "dotenv";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

dotenv.config();

const PORT = parseInt(process.env.PORT ?? "3456");
const VAULT = (process.env.OBSIDIAN_VAULT_PATH ?? "C:/path/to/vault").replace(/\\/g, "/");

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function vaultPath(rel) {
  const abs = path.resolve(VAULT, rel.endsWith(".md") ? rel : rel + ".md");
  if (!abs.startsWith(path.resolve(VAULT))) throw new Error("Path traversal denied");
  return abs;
}

function ok(text) {
  return { content: [{ type: "text", text: String(text) }] };
}

function json(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

// ──────────────────────────────────────────────
// MCP Server factory
// ──────────────────────────────────────────────

function buildServer() {
  const server = new McpServer({ name: "schae-mcp-hub", version: "1.0.0" });

  // ── Obsidian ──────────────────────────────

  server.tool(
    "obsidian_read",
    "Liest eine Notiz aus dem Obsidian-Vault",
    { note_path: z.string().describe("Pfad relativ zum Vault, z.B. '02 Projects/Lead Outreach System'") },
    async ({ note_path }) => {
      const content = await fs.readFile(vaultPath(note_path), "utf-8");
      return ok(content);
    }
  );

  server.tool(
    "obsidian_write",
    "Erstellt oder überschreibt eine Notiz im Vault",
    {
      note_path: z.string().describe("Pfad relativ zum Vault"),
      content: z.string().describe("Vollständiger Markdown-Inhalt"),
    },
    async ({ note_path, content }) => {
      const full = vaultPath(note_path);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf-8");
      return ok(`Notiz gespeichert: ${note_path}`);
    }
  );

  server.tool(
    "obsidian_append",
    "Hängt Text an eine bestehende Vault-Notiz an",
    {
      note_path: z.string().describe("Pfad relativ zum Vault"),
      text: z.string().describe("Text der angehängt werden soll"),
    },
    async ({ note_path, text }) => {
      const full = vaultPath(note_path);
      let existing = "";
      try { existing = await fs.readFile(full, "utf-8"); } catch {}
      await fs.writeFile(full, existing + "\n" + text, "utf-8");
      return ok(`Angehängt an: ${note_path}`);
    }
  );

  server.tool(
    "obsidian_list",
    "Listet alle Markdown-Dateien im Vault (optional gefiltert nach Ordner)",
    { folder: z.string().optional().describe("Optionaler Unterordner, z.B. '02 Projects'") },
    async ({ folder }) => {
      const base = folder ? path.join(VAULT, folder) : VAULT;
      const results = [];
      async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else if (e.name.endsWith(".md")) results.push(path.relative(VAULT, full).replace(/\\/g, "/"));
        }
      }
      await walk(base);
      return json(results);
    }
  );

  server.tool(
    "obsidian_search",
    "Sucht nach Text in allen Vault-Notizen",
    { query: z.string().describe("Suchbegriff") },
    async ({ query }) => {
      const matches = [];
      const lower = query.toLowerCase();
      async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else if (e.name.endsWith(".md")) {
            const content = await fs.readFile(full, "utf-8");
            if (content.toLowerCase().includes(lower)) {
              const rel = path.relative(VAULT, full).replace(/\\/g, "/");
              const lines = content.split("\n").filter(l => l.toLowerCase().includes(lower));
              matches.push({ file: rel, matches: lines.slice(0, 3) });
            }
          }
        }
      }
      await walk(VAULT);
      return json(matches);
    }
  );

  // ── Apollo ───────────────────────────────

  server.tool(
    "apollo_search_people",
    "Sucht nach Leads/Kontakten in Apollo.io",
    {
      q_keywords: z.string().optional().describe("Keywords für die Suche"),
      person_titles: z.array(z.string()).optional().describe("Job-Titel, z.B. ['CEO', 'Geschäftsführer']"),
      organization_locations: z.array(z.string()).optional().describe("Standorte, z.B. ['Germany']"),
      organization_num_employees_ranges: z.array(z.string()).optional().describe("Mitarbeiteranzahl, z.B. ['1,50', '51,200']"),
      page: z.number().optional().default(1),
      per_page: z.number().optional().default(10),
    },
    async (args) => {
      const key = process.env.APOLLO_API_KEY;
      if (!key) return ok("ERROR: APOLLO_API_KEY nicht gesetzt");
      const body = {
        api_key: key,
        q_keywords: args.q_keywords,
        person_titles: args.person_titles,
        organization_locations: args.organization_locations,
        organization_num_employees_ranges: args.organization_num_employees_ranges,
        page: args.page,
        per_page: args.per_page,
      };
      const res = await fetch("https://api.apollo.io/v1/mixed_people/api_search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return json(data);
    }
  );

  server.tool(
    "apollo_enrich_person",
    "Reichert einen Kontakt in Apollo.io anhand der E-Mail an",
    {
      email: z.string().describe("E-Mail-Adresse des Kontakts"),
    },
    async ({ email }) => {
      const key = process.env.APOLLO_API_KEY;
      if (!key) return ok("ERROR: APOLLO_API_KEY nicht gesetzt");
      const res = await fetch(`https://api.apollo.io/v1/people/match?api_key=${key}&email=${encodeURIComponent(email)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      return json(data);
    }
  );

  // ── Exa Search ───────────────────────────

  server.tool(
    "exa_search",
    "Semantische Web-Suche via Exa AI",
    {
      query: z.string().describe("Suchanfrage"),
      num_results: z.number().optional().default(5),
      use_autoprompt: z.boolean().optional().default(true),
      type: z.enum(["neural", "keyword", "auto"]).optional().default("auto"),
    },
    async (args) => {
      const key = process.env.EXA_API_KEY;
      if (!key) return ok("ERROR: EXA_API_KEY nicht gesetzt");
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          query: args.query,
          numResults: args.num_results,
          useAutoprompt: args.use_autoprompt,
          type: args.type,
        }),
      });
      const data = await res.json();
      return json(data);
    }
  );

  server.tool(
    "exa_get_contents",
    "Liest den Textinhalt von URLs via Exa AI",
    {
      ids: z.array(z.string()).describe("Liste von URLs oder Exa-Result-IDs"),
    },
    async ({ ids }) => {
      const key = process.env.EXA_API_KEY;
      if (!key) return ok("ERROR: EXA_API_KEY nicht gesetzt");
      const res = await fetch("https://api.exa.ai/contents", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      return json(data);
    }
  );

  // ── E-Mail Outreach ───────────────────────

  server.tool(
    "email_send",
    "Sendet eine E-Mail über das IONOS-Konto",
    {
      to: z.string().describe("Empfänger-Adresse"),
      subject: z.string().describe("Betreff"),
      html: z.string().describe("HTML-Inhalt der E-Mail"),
      text: z.string().optional().describe("Plaintext-Fallback"),
      from_name: z.string().optional().default("Erwin Schaeberle"),
    },
    async ({ to, subject, html, text, from_name }) => {
      const user = process.env.IONOS_USER;
      const pass = process.env.IONOS_PASS;
      if (!user || !pass) return ok("ERROR: IONOS_USER oder IONOS_PASS nicht gesetzt");
      const transporter = nodemailer.createTransport({
        host: process.env.IONOS_SMTP_HOST ?? "smtp.ionos.de",
        port: parseInt(process.env.IONOS_SMTP_PORT ?? "587"),
        secure: false,
        auth: { user, pass },
      });
      const info = await transporter.sendMail({
        from: `"${from_name}" <${user}>`,
        to,
        subject,
        html,
        text,
      });
      return ok(`E-Mail gesendet. MessageId: ${info.messageId}`);
    }
  );

  server.tool(
    "email_check_replies",
    "Prüft den IMAP-Posteingang auf neue Antworten (letzte 7 Tage)",
    {
      since_days: z.number().optional().default(7).describe("Wie viele Tage zurück suchen"),
      folder: z.string().optional().default("INBOX"),
    },
    async ({ since_days, folder }) => {
      const user = process.env.IONOS_USER;
      const pass = process.env.IONOS_PASS;
      if (!user || !pass) return ok("ERROR: IONOS_USER oder IONOS_PASS nicht gesetzt");
      const client = new ImapFlow({
        host: process.env.IONOS_IMAP_HOST ?? "imap.ionos.de",
        port: parseInt(process.env.IONOS_IMAP_PORT ?? "993"),
        secure: true,
        auth: { user, pass },
        logger: false,
      });
      await client.connect();
      const messages = [];
      const lock = await client.getMailboxLock(folder);
      try {
        const since = new Date(Date.now() - since_days * 24 * 60 * 60 * 1000);
        for await (const msg of client.fetch({ since }, { envelope: true, flags: true })) {
          messages.push({
            uid: msg.uid,
            from: msg.envelope.from?.[0]?.address ?? "",
            subject: msg.envelope.subject ?? "",
            date: msg.envelope.date,
            seen: msg.flags.has("\\Seen"),
          });
        }
      } finally {
        lock.release();
        await client.logout();
      }
      return json(messages);
    }
  );

  // ── Telegram ─────────────────────────────

  server.tool(
    "telegram_send",
    "Sendet eine Nachricht an den OpenClaw- oder Hermes-Telegram-Bot",
    {
      chat_id: z.string().describe("Telegram Chat-ID (z.B. deine persönliche ID)"),
      text: z.string().describe("Nachrichtentext (Markdown erlaubt)"),
      bot: z.enum(["openclaw", "hermes"]).optional().default("openclaw").describe("Welchen Bot verwenden"),
    },
    async ({ chat_id, text, bot }) => {
      const token = bot === "hermes"
        ? process.env.TELEGRAM_HERMES_TOKEN
        : process.env.TELEGRAM_OPENCLAW_TOKEN;
      if (!token) return ok(`ERROR: TELEGRAM_${bot.toUpperCase()}_TOKEN nicht gesetzt`);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, parse_mode: "Markdown" }),
      });
      const data = await res.json();
      return json(data);
    }
  );

  // ── Gemini Image ─────────────────────────

  server.tool(
    "gemini_generate_image",
    "Generiert ein Bild mit Google Gemini Imagen",
    {
      prompt: z.string().describe("Bildbeschreibung"),
      aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3"]).optional().default("1:1"),
      number_of_images: z.number().optional().default(1),
    },
    async ({ prompt, aspect_ratio, number_of_images }) => {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return ok("ERROR: GEMINI_API_KEY nicht gesetzt");
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { aspectRatio: aspect_ratio, sampleCount: number_of_images },
          }),
        }
      );
      const data = await res.json();
      return json(data);
    }
  );

  // ── HeyGen ───────────────────────────────

  server.tool(
    "heygen_generate_video",
    "Generiert ein Avatar-Video mit HeyGen",
    {
      script: z.string().describe("Sprechtext für den Avatar"),
      avatar_id: z.string().optional().default("Angela-inblackskirt-20220820").describe("HeyGen Avatar-ID"),
      voice_id: z.string().optional().default("en-US-JennyNeural").describe("Stimmen-ID"),
    },
    async ({ script, avatar_id, voice_id }) => {
      const key = process.env.HEYGEN_API_KEY;
      if (!key) return ok("ERROR: HEYGEN_API_KEY nicht gesetzt");
      const res = await fetch("https://api.heygen.com/v2/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": key },
        body: JSON.stringify({
          video_inputs: [{
            character: { type: "avatar", avatar_id },
            voice: { type: "text", input_text: script, voice_id },
          }],
          dimension: { width: 1280, height: 720 },
        }),
      });
      const data = await res.json();
      return json(data);
    }
  );

  server.tool(
    "heygen_video_status",
    "Prüft den Status eines HeyGen Video-Auftrags",
    { video_id: z.string().describe("HeyGen Video-ID") },
    async ({ video_id }) => {
      const key = process.env.HEYGEN_API_KEY;
      if (!key) return ok("ERROR: HEYGEN_API_KEY nicht gesetzt");
      const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${video_id}`, {
        headers: { "X-Api-Key": key },
      });
      const data = await res.json();
      return json(data);
    }
  );

  // ── ElevenLabs ───────────────────────────

  server.tool(
    "elevenlabs_tts",
    "Konvertiert Text zu Sprache mit ElevenLabs",
    {
      text: z.string().describe("Sprechtext"),
      voice_id: z.string().optional().default("21m00Tcm4TlvDq8ikWAM").describe("ElevenLabs Voice-ID"),
      model_id: z.string().optional().default("eleven_multilingual_v2"),
    },
    async ({ text, voice_id, model_id }) => {
      const key = process.env.ELEVENLABS_API_KEY;
      if (!key) return ok("ERROR: ELEVENLABS_API_KEY nicht gesetzt");
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": key },
        body: JSON.stringify({ text, model_id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return ok(`ERROR: ${JSON.stringify(err)}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return ok(`Audio generiert (${buf.length} bytes). Base64: ${buf.toString("base64").slice(0, 100)}...`);
    }
  );

  // ── ImgBB ────────────────────────────────

  server.tool(
    "imgbb_upload",
    "Lädt ein Bild auf ImgBB hoch und gibt die URL zurück",
    {
      image_base64: z.string().describe("Bild als Base64-String"),
      name: z.string().optional().describe("Dateiname (optional)"),
    },
    async ({ image_base64, name }) => {
      const key = process.env.IMGBB_API_KEY;
      if (!key) return ok("ERROR: IMGBB_API_KEY nicht gesetzt");
      const body = new URLSearchParams({ key, image: image_base64 });
      if (name) body.set("name", name);
      const res = await fetch("https://api.imgbb.com/1/upload", {
        method: "POST",
        body,
      });
      const data = await res.json();
      return json({ url: data.data?.url, display_url: data.data?.display_url, delete_url: data.data?.delete_url });
    }
  );

  // ── X / Twitter ──────────────────────────

  server.tool(
    "x_search_recent",
    "Sucht nach aktuellen Posts auf X/Twitter",
    {
      query: z.string().describe("Suchanfrage, z.B. 'Elon Musk crypto'"),
      max_results: z.number().optional().default(10),
    },
    async ({ query, max_results }) => {
      const token = process.env.X_BEARER_TOKEN;
      if (!token) return ok("ERROR: X_BEARER_TOKEN nicht gesetzt");
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${max_results}&tweet.fields=created_at,author_id,text`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${decodeURIComponent(token)}` },
      });
      const data = await res.json();
      return json(data);
    }
  );

  return server;
}

// ──────────────────────────────────────────────
// Express App
// ──────────────────────────────────────────────

const app = express();
const sessions = new Map();

app.get("/health", (_, res) => {
  res.json({ status: "ok", sessions: sessions.size, vault: VAULT });
});

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = buildServer();
  sessions.set(transport.sessionId, transport);
  res.on("close", () => sessions.delete(transport.sessionId));
  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const id = req.query.sessionId;
  const transport = sessions.get(id);
  if (!transport) return res.status(404).json({ error: "Session not found" });
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[MCP Hub] http://localhost:${PORT}/sse`);
  console.log(`[MCP Hub] Vault: ${VAULT}`);
});
