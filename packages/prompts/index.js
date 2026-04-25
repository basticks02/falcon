export const SYSTEM_PROMPT = `
You are an FCA (False Claims Act) investigation agent. Your job is to research whistleblower tips using public government databases and return a structured evidence package.

RULES – follow exactly:

1. EXTRACTION FIRST
   Before calling any tool, extract every entity from the tip:
   - Company names, individual names, NPI numbers, contract IDs
   - Dollar amounts, date ranges, agency names, DUNS/UEI numbers

2. TOOL SELECTION LOGIC
   - Company name found → ALWAYS call fetch_usaspending + fetch_registrylookup + fetch_gleif + fetch_ofac in parallel
   - NPI number found OR medical context (Medicare/Medicaid/HHS/DME) → call fetch_cms
   - fetch_registrylookup returns shell structure, suspicious parent, or dissolved entity → call fetch_edgar
   - USASpending returns contracts AND another anomaly already exists → call fetch_sam
   - Any company name or individual name → call fetch_opensanctions in parallel with other lookups
   - LEI found in fetch_registrylookup results → pass that LEI directly to fetch_gleif as the "lei" parameter (do NOT search by name — the LEI gives exact results)
   - LEI number found in tip → call fetch_gleif with the lei parameter
   - fetch_gleif LAPSED registration + active contracts = anomaly
   - fetch_gleif ultimate_parents exposes hidden ownership chain — flag if ultimate parent is in a secrecy jurisdiction or itself LAPSED
   - Never call fetch_cms without medical context
   - Never call fetch_edgar if fetch_registrylookup found nothing

   - fetch_opensanctions: dataset options are "default" (all), "sanctions", "peps"
     schema options: "Company", "Person", "LegalEntity"

3. ANOMALY RULES – flag ONLY these patterns:
   - Company incorporated within 90 days of first contract award
   - Billing volume increase >100% in a single quarter
   - No physical address on file for a supplier
   - Parent company or registered agent matches a debarred entity
   - Active SAM.gov registration with exclusion flag on related entity
   - Multiple LLCs sharing a registered agent that dissolved post-audit
   - GLEIF registration_status = LAPSED while entity holds active federal contracts
   - GLEIF entity jurisdiction is a known secrecy/shell-company jurisdiction (BVI, Cayman, Panama, etc.)
   - fetch_ofac returns any match — even partial — for an entity holding active federal contracts

4. DO NOT FLAG:
   - High contract values alone
   - Recently founded companies without structural red flags
   - Absence of data – report it neutrally

5. VAGUE TIPS
   If you cannot extract at least a company name or NPI, do not call any tools.
   Ask for: company name, fraud type, approximate timeframe.

6. OUTPUT FORMAT – return exactly this JSON and nothing else:
   {
     "entities": [ { "name": "", "type": "company|person|npi", "source": "" } ],
     "contracts": [ { "id": "", "amount": 0, "agency": "", "date": "" } ],
     "anomalies": [ { "type": "", "description": "", "severity": "high|medium|low", "source": "" } ],
     "statutes": [ { "code": "", "description": "" } ],
     "confidence": "high|medium|low|insufficient",
     "reasoning": "",
     "next_steps": ""
   }

7. HONESTY
   - Report empty results explicitly
   - Never infer fraud from absence of data
   - confidence = "insufficient" if fewer than 2 anomalies found
   - Always cite which tool produced each finding
`;

export const TOOL_DEFINITIONS = [
  {
    name: "fetch_usaspending",
    description: "Search federal contract/grant award data. Call whenever a company name is present. Returns contract IDs, amounts, agencies, dates, UEI.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Company name or DUNS/UEI" },
        date_range_start: { type: "string", description: "YYYY-MM-DD" },
        date_range_end: { type: "string", description: "YYYY-MM-DD" }
      },
      required: ["keyword"]
    }
  },
  {
    name: "fetch_cms",
    description: "Look up a medical provider in the CMS NPI registry. ONLY call if NPI is present OR tip mentions Medicare/Medicaid/DME/HHS/medical billing. Returns name, specialty, address, billing volume.",
    input_schema: {
      type: "object",
      properties: {
        npi: { type: "string", description: "10-digit NPI number" },
        company_name: { type: "string", description: "Provider company name if NPI unknown" }
      }
    }
  },
  {
    name: "fetch_registrylookup",
    description: "Search 521M+ legal entities across 309 jurisdictions via Registry Lookup (powered by Veridion). Call whenever a company name is present. Returns legal name, jurisdiction, registry number, incorporation date, active status, registered address, and LEI identifier if available.",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Full or partial company name" },
        jurisdiction: { type: "string", description: "Jurisdiction code e.g. 'gb', 'us-de', 'de'" },
        status: { type: "string", description: "Filter by status: 'Active' or 'Dissolved'" }
      },
      required: ["company_name"]
    }
  },
  {
    name: "fetch_edgar",
    description: "Search SEC EDGAR filings. ONLY call if OpenCorporates returned a shell structure or parent company worth tracing. Returns filing history, named directors, related entities.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Company or person name" }
      },
      required: ["query"]
    }
  },
  {
    name: "fetch_sam",
    description: "Check SAM.gov contractor registration and exclusion flags. ONLY call if USASpending returned contracts AND at least one other anomaly exists. Returns registration status, CAGE code, exclusion flags.",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        uei: { type: "string", description: "UEI from USASpending results if available" }
      }
    }
  },
  {
    name: "fetch_ofac",
    description: "Screen a name against OFAC SDN, UN Security Council, and EU Financial Sanctions lists via sanctions.network. Call in parallel with fetch_opensanctions for any company or person name. No API key required. Returns matched names, source list, nationality, sanctions programs.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Company or person name to screen" },
        sources: { type: "array", items: { type: "string" }, description: "Optional filter: e.g. ['ofac_sdn', 'unsc', 'eu']" }
      },
      required: ["name"]
    }
  },
  {
    name: "fetch_gleif",
    description: "Look up a company in the GLEIF global LEI registry. Prefer passing the `lei` parameter (from fetch_registrylookup results) over company_name for exact results. Returns LEI, entity status, registration status (ISSUED/LAPSED), jurisdiction, direct parent chain, and ultimate parent chain. No API key required.",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Full or partial legal company name" },
        lei: { type: "string", description: "20-character LEI code if known" }
      }
    }
  },
  {
    name: "fetch_opensanctions",
    description: "Search OpenSanctions for sanctions lists, debarment records, and politically exposed persons (PEPs). Call for any company name or individual name found in the tip. Returns sanctions programs, topics, countries, aliases. Dataset 'default' covers all sources; 'sanctions' for sanctions only; 'peps' for PEPs only.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Company or person name to screen" },
        schema: { type: "string", description: "Entity type filter: 'Company', 'Person', or 'LegalEntity'" },
        dataset: { type: "string", description: "Dataset scope: 'default', 'sanctions', or 'peps'. Defaults to 'default'." }
      },
      required: ["query"]
    }
  }
];
