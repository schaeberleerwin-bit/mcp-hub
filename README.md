# MCP Hub

**Model Context Protocol (MCP) Server für Obsidian-Vault-Zugriff und E-Mail-Automatisierung.**

## Konzept

Stellt LLM-Tools (z.B. für Claude) über den MCP-Standard bereit, um mit einem lokalen Obsidian-Vault und E-Mail-Postfächern zu interagieren, ohne dass das Modell direkten Dateisystem- oder Mail-Server-Zugriff braucht.

## Features

- ✅ Lesen/Schreiben von Notizen im Obsidian-Vault (mit Path-Traversal-Schutz)
- ✅ E-Mail-Versand über Nodemailer
- ✅ IMAP-Postfachzugriff über ImapFlow
- ✅ SSE-Transport für MCP-Clients

## Tech Stack

| Schicht | Technologie |
|---|---|
| Server | Node.js, Express |
| MCP | @modelcontextprotocol/sdk |
| E-Mail | Nodemailer, ImapFlow, Mailparser |
| Validierung | Zod |

## Setup

```bash
npm install
npm start
```

Konfiguration über `.env`:
```
PORT=3456
OBSIDIAN_VAULT_PATH=C:/path/to/vault
```
