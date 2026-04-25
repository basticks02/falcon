<h1 align="center"> falcon</h1>

<p align="center"><strong>AI agent for False Claims Act investigation</strong></p>

<p align="center">
Takes a whistleblower tip. Searches 8 government and sanctions databases in parallel.<br>
Returns a structured evidence package in under 10 seconds.
</p>

<p align="center">─────────────────────────────────────</p>

<p align="center"><em>Built for the <strong>c0mpiled-10/DC: AI for Government Hackathon</strong> · DC · April 2026</em></p>

<br>
<br>

<p align="center">
  <video src="https://github.com/user-attachments/assets/1dcebe6f-d6db-4fc9-8747-d11646fab9d1" width="720" controls></video>
</p>

<br>
<br>

---

## What it does

1. User pastes a tip: *"MedSupply Corp is billing Medicare for equipment never delivered"*
2. Agent extracts entities (company names, NPIs, contract IDs, dates, amounts, DUNS/UEI)
3. Queries USASpending, Registry Lookup, GLEIF, OFAC, and OpenSanctions in parallel — CMS, EDGAR, and SAM.gov conditionally
4. Returns a structured case file: entities, anomalies, applicable FCA statutes, confidence score
5. One-click export to LaTeX or PDF

**Slack stretch goal:** DM the bot a tip — get a reply with a link — click to watch the agent run live in the web app, cards spawning in real time.

---

## Monorepo structure

```
falcon/
├── apps/
│   ├── web/                  # Vite frontend — timeline UI + case brief + LaTeX export
│   └── slack-bot/            # Slack Bolt bot + SSE server
├── packages/
│   ├── agent/                # Core agentic loop (runAgent)
│   ├── tools/                # All 8 API calls
│   └── prompts/              # System prompt + tool definitions
├── .env.example
└── package.json              # npm workspaces root
```

---

## Quickstart

### 1. Clone and install

```bash
git clone <your-repo>
cd falcon
cp .env.example .env
npm install
```

### 2. Get your API keys

| Key                            | Where                                                | Free tier              |
| ------------------------------ | ---------------------------------------------------- | ---------------------- |
| `VITE_ANTHROPIC_API_KEY`       | console.anthropic.com                                | Pay-per-use            |
| `VITE_SAM_API_KEY`             | sam.gov/profile/details → Public API Key             | Free                   |
| `VITE_REGISTRY_LOOKUP_API_KEY` | registry-lookup.com                                  | 5,000 calls/month free |
| `VITE_OPENSANCTIONS_API_KEY`   | opensanctions.org/api/                               | 30-day trial           |
| `SLACK_BOT_TOKEN`              | api.slack.com                                        | Free                   |
| `SLACK_SIGNING_SECRET`         | api.slack.com → Basic Information                    | Free                   |
| `SLACK_APP_TOKEN`              | api.slack.com → Basic Information → App-Level Tokens | Free                   |

USASpending, CMS NPI Registry, GLEIF, OFAC (sanctions.network), and EDGAR are **free with no key required.**

### 3. Run web app only (no Slack)

```bash
npm run dev:web
# → http://localhost:5173
```

### 4. Run everything (web + Slack bot)

```bash
# Terminal 1
npm run dev:slack

# Terminal 2 — expose the bot SSE server for the web app
npx ngrok http 3001
# copy the ngrok URL into .env as VITE_SLACK_BOT_URL

# Terminal 3
npm run dev:web
```

---

## How the agent works

```
Tip
 ↓
Claude (turn 1)
 ├─ extracts entities
 └─ fires in parallel: fetch_usaspending, fetch_registrylookup,
                       fetch_gleif, fetch_ofac, fetch_opensanctions
                       + fetch_cms if medical context
 ↓
Promise.all() — all tool calls execute simultaneously
 ↓
Claude (turn 2) — reads all results
 ├─ if registry returns shell/dissolved entity → fetch_edgar
 ├─ if contracts + anomaly already found → fetch_sam
 ├─ if LEI found in registry → pass directly to fetch_gleif
 └─ if enough data → final JSON synthesis
 ↓
Claude (turn 3) — final synthesis
 └─ returns structured JSON: entities, anomalies, statutes, confidence
```

Max 6 turns. Typical run: 3 turns, ~8 seconds end to end. Model: `claude-sonnet-4-20250514`.

---

## Data sources

| Tool                   | Source                                                  | Auth    |
| ---------------------- | ------------------------------------------------------- | ------- |
| `fetch_usaspending`    | api.usaspending.gov                                     | None    |
| `fetch_registrylookup` | registry-lookup.com — 521M+ entities, 309 jurisdictions | API key |
| `fetch_gleif`          | api.gleif.org — global LEI registry, ownership chains   | None    |
| `fetch_ofac`           | sanctions.network — OFAC SDN, UN, EU lists              | None    |
| `fetch_opensanctions`  | api.opensanctions.org — sanctions + PEPs                | API key |
| `fetch_cms`            | npiregistry.cms.hhs.gov — medical provider registry     | None    |
| `fetch_edgar`          | efts.sec.gov — SEC filings, directors, related entities | None    |
| `fetch_sam`            | api.sam.gov — contractor registration + exclusion flags | API key |

---

## Anomaly detection rules

The system prompt instructs Claude to flag **only** these structural patterns:

- Company incorporated within 90 days of first contract award
- Billing volume increase >100% in a single quarter
- No physical address on file for a supplier
- Parent company or registered agent matches a debarred entity
- Active SAM.gov registration with exclusion flag on a related entity
- Multiple LLCs sharing a registered agent that dissolved post-audit
- GLEIF `registration_status = LAPSED` while entity holds active federal contracts
- GLEIF jurisdiction is a known secrecy/shell-company jurisdiction (BVI, Cayman, Panama, etc.)
- Any OFAC/sanctions match on an entity holding active federal contracts

Claude does **not** flag: high contract values alone, recently founded companies without structural red flags, or absence of data.

---

## Output format

```json
{
  "entities":   [ { "name": "", "type": "company|person|npi", "source": "" } ],
  "contracts":  [ { "id": "", "amount": 0, "agency": "", "date": "" } ],
  "anomalies":  [ { "type": "", "description": "", "severity": "high|medium|low", "source": "" } ],
  "statutes":   [ { "code": "", "description": "" } ],
  "confidence": "high|medium|low|insufficient",
  "reasoning":  "",
  "next_steps": ""
}
```

`confidence` is set to `"insufficient"` if fewer than 2 anomalies are found. Results can be exported as a formatted LaTeX document or PDF directly from the UI.

---

## Pitch

> "We're not building a dashboard. We're building the associate that whistleblower law firms can't afford — one that does in 10 seconds what currently takes 3 months."

Applicable statute: **31 U.S.C. § 3729** — False Claims Act. Successful qui tam relators keep 15–30% of whatever's recovered. Medicare loses $60B+ annually to fraud.
