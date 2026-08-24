# MCP Hub

**Model Context Protocol (MCP) Server für Obsidian-Vault-Zugriff, E-Mail-Automatisierung, Lead-Recherche, KI-Medien-Generierung und Social-Media-Integration.**

## Konzept

Stellt LLM-Tools (z.B. für Claude) über den MCP-Standard bereit, um mit einem lokalen Obsidian-Vault, E-Mail-Postfächern und externen APIs zu interagieren, ohne dass das Modell direkten Dateisystem- oder Service-Zugriff braucht.

## Features

### Obsidian Vault
- ✅ `obsidian_read` – Notiz aus dem Vault lesen
- ✅ `obsidian_write` – Notiz erstellen/überschreiben
- ✅ `obsidian_append` – Text an bestehende Notiz anhängen
- ✅ `obsidian_list` – Alle Markdown-Dateien auflisten (optional nach Ordner gefiltert)
- ✅ `obsidian_search` – Volltextsuche über alle Vault-Notizen

### Apollo.io (Lead-Recherche)
- ✅ `apollo_search_people` – Leads/Kontakte suchen (nach Keywords, Titel, Standort, Firmengröße)
- ✅ `apollo_enrich_person` – Kontakt anhand der E-Mail-Adresse anreichern

### Exa AI (Web-Suche)
- ✅ `exa_search` – Semantische Web-Suche (neural/keyword/auto)
- ✅ `exa_get_contents` – Textinhalt von URLs extrahieren

### E-Mail (IONOS)
- ✅ `email_send` – E-Mail über IONOS-SMTP versenden (HTML + Plaintext)
- ✅ `email_check_replies` – IMAP-Posteingang auf neue Antworten prüfen

### Telegram
- ✅ `telegram_send` – Nachricht über OpenClaw- oder Hermes-Bot senden

### Gemini Imagen (Bildgenerierung)
- ✅ `gemini_generate_image` – Bild generieren mit Google Gemini Imagen 3.0

### HeyGen (Avatar-Video)
- ✅ `heygen_generate_video` – Avatar-Video mit Sprechtext generieren
- ✅ `heygen_video_status` – Status eines Video-Auftrags abfragen

### ElevenLabs (Text-to-Speech)
- ✅ `elevenlabs_tts` – Text zu Sprache konvertieren (multilingual)

### ImgBB (Bild-Upload)
- ✅ `imgbb_upload` – Bild (Base64) hochladen, öffentliche URL erhalten

### X / Twitter
- ✅ `x_search_recent` – Aktuelle Posts auf X/Twitter durchsuchen

## Tech Stack

| Schicht | Technologie |
|---|---|
| Server | Node.js, Express |
| MCP | @modelcontextprotocol/sdk |
| E-Mail | Nodemailer (SMTP), ImapFlow (IMAP) |
| Validierung | Zod |
| Apollo.io | fetch → REST API |
| Exa AI | fetch → REST API |
| Telegram | fetch → Bot API |
| Gemini Imagen | fetch → Generative Language API |
| HeyGen | fetch → REST API |
| ElevenLabs | fetch → REST API |
| ImgBB | fetch → REST API |
| X / Twitter | fetch → Twitter API v2 |

## Setup

```bash
npm install
npm start
```

Konfiguration über `.env`:
```
PORT=3456
OBSIDIAN_VAULT_PATH=C:/path/to/vault

# Apollo.io
APOLLO_API_KEY=...

# Exa AI
EXA_API_KEY=...

# IONOS E-Mail
IONOS_USER=...
IONOS_PASS=...
IONOS_SMTP_HOST=smtp.ionos.de
IONOS_SMTP_PORT=587
IONOS_IMAP_HOST=imap.ionos.de
IONOS_IMAP_PORT=993

# Telegram
TELEGRAM_OPENCLAW_TOKEN=...
TELEGRAM_HERMES_TOKEN=...

# Google Gemini
GEMINI_API_KEY=...

# HeyGen
HEYGEN_API_KEY=...

# ElevenLabs
ELEVENLABS_API_KEY=...

# ImgBB
IMGBB_API_KEY=...

# X / Twitter
X_BEARER_TOKEN=...
```
