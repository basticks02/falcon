import { runAgent } from "@fca/agent";

// ── Determine mode: direct (no session) or live (from Slack) ─
const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session");
const tipParam = params.get("tip");

// ── UI state ──────────────────────────────────────────────────
const cards = new Map(); // toolCallId → card DOM element

if (sessionId) {
  connectToSession(sessionId);
} else if (tipParam) {
  document.getElementById("tipInput").value = decodeURIComponent(tipParam);
  startDirectAgent(decodeURIComponent(tipParam));
}

document.getElementById("submitBtn")?.addEventListener("click", () => {
  const tip = document.getElementById("tipInput").value.trim();
  if (tip) startDirectAgent(tip);
});

async function startDirectAgent(tip) {
  clearFeed();
  const apiKey = document.getElementById("apiKey")?.value || import.meta.env.VITE_ANTHROPIC_API_KEY;

  await runAgent(tip, apiKey, {
    onToolSpawn: (toolCall) => spawnCard(toolCall),
    onToolResult: (toolCall, result) => resolveCard(toolCall.id, toolCall.name, result),
    onThinking: (text) => console.log("[thinking]", text)
  }).then(result => renderBrief(result));
}

// ── Live mode (from Slack) ────────────────────────────────────
function connectToSession(sessionId) {
  const slackBotUrl = import.meta.env.VITE_SLACK_BOT_URL || "http://localhost:3001";
  const es = new EventSource(`${slackBotUrl}/api/session/${sessionId}`);

  clearFeed();
  showLiveBanner();

  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "tool_spawn") spawnCard(event.toolCall);
    if (event.type === "tool_result") resolveCard(event.toolCallId, event.name, event.result);
    if (event.type === "done") { renderBrief(event.result); es.close(); }
    if (event.type === "error") { showError(event.message); es.close(); }
  };

  es.onerror = () => showError("Lost connection to agent stream");
}

// ── Card management ───────────────────────────────────────────
const TOOL_META = {
  fetch_usaspending: {
    label: "USASpending",
    url: "api.usaspending.gov",
    highlights: (input, result) => {
      if (!result) return [`Searching for "${input.keyword}"...`];
      if (!result.found) return [result.message];
      return [
        `${result.total_contracts} contracts · $${(result.total_value / 1e6).toFixed(1)}M total`,
        result.contracts?.[0] ? `Latest: ${result.contracts[0].agency} · ${result.contracts[0].start}` : null,
        result.contracts?.[0]?.uei ? `UEI: ${result.contracts[0].uei}` : null
      ].filter(Boolean);
    },
    flags: (result) => {
      if (!result?.found) return [];
      const sorted = [...(result.contracts || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
      return sorted[0]?.start ? [`First award: ${sorted[0].start}`] : [];
    }
  },
  fetch_cms: {
    label: "CMS / NPI",
    url: "npiregistry.cms.hhs.gov",
    highlights: (input, result) => {
      if (!result) return [`Looking up NPI ${input.npi || input.company_name}...`];
      if (!result.found) return [result.message];
      const p = result.providers[0];
      return [
        `${p.name} · ${p.specialty || "unknown specialty"}`,
        p.address ? `${p.address.city}, ${p.address.state}` : null,
        `Enumerated: ${p.enumeration_date}`
      ].filter(Boolean);
    },
    flags: (result) => {
      if (!result?.found) return [];
      const p = result.providers[0];
      return !p.address?.address_1 ? ["⚠ No physical address on file"] : [];
    }
  },
  fetch_opencorporates: {
    label: "OpenCorporates",
    url: "opencorporates.com",
    highlights: (input, result) => {
      if (!result) return [`Searching corporate registries for "${input.company_name}"...`];
      if (!result.found) return [result.message];
      const c = result.companies[0];
      return [
        `${c.name} · ${c.jurisdiction} · inc. ${c.incorporation_date || "unknown"}`,
        c.registered_agent ? `Agent: ${c.registered_agent}` : null,
        c.dissolution_date ? `Dissolved: ${c.dissolution_date}` : null
      ].filter(Boolean);
    },
    flags: (result) => {
      if (!result?.found) return [];
      return result.companies[0]?.inactive ? ["⚠ Company is inactive/dissolved"] : [];
    }
  },
  fetch_edgar: {
    label: "SEC EDGAR",
    url: "efts.sec.gov",
    highlights: (input, result) => {
      if (!result) return [`Searching EDGAR for "${input.query}"...`];
      if (!result.found) return [result.message];
      return [
        `${result.total_filings} total filings`,
        result.recent_filings[0] ? `Latest: ${result.recent_filings[0].form_type} · ${result.recent_filings[0].filed}` : null
      ].filter(Boolean);
    },
    flags: () => []
  },
  fetch_sam: {
    label: "SAM.gov",
    url: "sam.gov",
    highlights: (input, result) => {
      if (!result) return [`Checking SAM.gov for "${input.company_name || input.uei}"...`];
      if (!result.found) return [result.message];
      const e = result.entities[0];
      return [
        `${e.name} · CAGE ${e.cage}`,
        `Status: ${e.status} · Expires: ${e.expiry}`
      ].filter(Boolean);
    },
    flags: (result) => {
      if (!result?.found) return [];
      return result.entities[0]?.exclusion_flag === "Y" ? ["⚠ EXCLUSION FLAG ACTIVE"] : [];
    }
  }
};

function spawnCard(toolCall) {
  const meta = TOOL_META[toolCall.name] || { label: toolCall.name, url: "", highlights: () => [], flags: () => [] };
  const card = document.createElement("div");
  card.className = "tool-card running";
  card.id = `card-${toolCall.id}`;

  const inputSummary = Object.values(toolCall.input || {}).filter(Boolean).join(" · ");
  const initialLines = meta.highlights(toolCall.input, null);

  card.innerHTML = `
    <div class="card-header" onclick="this.closest('.tool-card').classList.toggle('collapsed')">
      <div class="spinner"></div>
      <span class="card-title">${meta.label}</span>
      <span class="card-url">${meta.url}</span>
      <span class="chevron">▶</span>
    </div>
    <div class="card-body">
      <div class="url-row"><span class="url-chip">${meta.url}${inputSummary ? ` · ${inputSummary}` : ""}</span></div>
      ${initialLines.map(l => `<div class="log"><span class="li">·</span><span class="lt muted">${l}</span></div>`).join("")}
    </div>
  `;

  getFeed().appendChild(card);
  cards.set(toolCall.id, { el: card, meta, input: toolCall.input });
}

function resolveCard(toolCallId, toolName, result) {
  const entry = cards.get(toolCallId);
  if (!entry) return;
  const { el, meta, input } = entry;

  el.className = "tool-card done";
  const spinner = el.querySelector(".spinner");
  if (spinner) spinner.outerHTML = `<span class="check">✓</span>`;

  const body = el.querySelector(".card-body");
  const highlights = meta.highlights(input, result);
  const flags = meta.flags(result);

  [...highlights, ...flags].forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "log";
    const isFlag = i >= highlights.length;
    div.innerHTML = `<span class="li">${isFlag ? "⚠" : "·"}</span><span class="lt ${isFlag ? "flag" : "note"}">${line}</span>`;
    body.appendChild(div);
  });
}

// ── Brief renderer ────────────────────────────────────────────
function renderBrief(result) {
  if (!result || result.error) {
    showError(result?.error || "Unknown error");
    return;
  }

  const brief = document.getElementById("brief");
  if (!brief) return;
  brief.style.display = "block";

  document.getElementById("brief-confidence").textContent = result.confidence;
  document.getElementById("brief-reasoning").textContent = result.reasoning;
  document.getElementById("brief-next").textContent = result.next_steps;

  const anomalyList = document.getElementById("brief-anomalies");
  (result.anomalies || []).forEach(a => {
    const li = document.createElement("div");
    li.className = `anomaly-row ${a.severity}`;
    li.innerHTML = `<span class="badge ${a.severity}">${a.severity.toUpperCase()}</span> ${a.description} <span class="source">${a.source}</span>`;
    anomalyList.appendChild(li);
  });

  const statuteList = document.getElementById("brief-statutes");
  (result.statutes || []).forEach(s => {
    const li = document.createElement("div");
    li.className = "statute-row";
    li.innerHTML = `<span class="badge blue">${s.code}</span> ${s.description}`;
    statuteList.appendChild(li);
  });
}

// ── Helpers ───────────────────────────────────────────────────
function getFeed() { return document.getElementById("feed"); }
function clearFeed() { getFeed().innerHTML = ""; cards.clear(); document.getElementById("brief").style.display = "none"; }
function showError(msg) { getFeed().insertAdjacentHTML("beforeend", `<div class="error-row">❌ ${msg}</div>`); }
function showLiveBanner() {
  getFeed().insertAdjacentHTML("beforebegin", `<div class="live-banner">⚡ Live — triggered from Slack</div>`);
}
