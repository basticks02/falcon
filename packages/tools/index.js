// All public API calls. No auth except SAM.gov, OpenSanctions.
// Each returns clean JSON – errors included as { error: string }

// Works in both Node (process.env) and Vite browser builds (import.meta.env.VITE_*)
function getEnv(key) {
  try { if (import.meta.env) return import.meta.env[`VITE_${key}`] || import.meta.env[key]; } catch {}
  try { if (typeof process !== "undefined") return process.env[key]; } catch {}
  return undefined;
}

// APIs that block browser CORS requests are routed through the Vite dev-server proxy.
const IS_BROWSER = typeof window !== "undefined";
function apiUrl(direct, proxyPrefix) {
  return IS_BROWSER ? direct.replace(/^https?:\/\/[^/]+/, proxyPrefix) : direct;
}

export async function fetch_usaspending({ keyword, date_range_start, date_range_end }) {
  const body = {
    filters: {
      keywords: [keyword],
      award_type_codes: ["A", "B", "C", "D"],
      ...(date_range_start && {
        time_period: [{ start_date: date_range_start, end_date: date_range_end || new Date().toISOString().split("T")[0] }]
      })
    },
    fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Start Date", "End Date", "recipient_uei_derived"],
    limit: 10,
    sort: "Award Amount",
    order: "desc"
  };

  try {
    const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { error: `USASpending ${res.status}` };
    const data = await res.json();
    if (!data.results?.length) return { found: false, message: `No contracts found for "${keyword}"` };
    return {
      found: true,
      total_contracts: data.results.length,
      total_value: data.results.reduce((s, r) => s + (r["Award Amount"] || 0), 0),
      contracts: data.results.map(r => ({
        id: r["Award ID"],
        recipient: r["Recipient Name"],
        amount: r["Award Amount"],
        agency: r["Awarding Agency"],
        start: r["Start Date"],
        end: r["End Date"],
        uei: r["recipient_uei_derived"]
      }))
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_cms({ npi, company_name }) {
  if (!npi && !company_name) return { error: "Need NPI or company name" };
  const base = npi
    ? `https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`
    : `https://npiregistry.cms.hhs.gov/api/?organization_name=${encodeURIComponent(company_name)}&version=2.1&limit=5`;
  const url = apiUrl(base, '/proxy/cms');
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `CMS ${res.status}` };
    const data = await res.json();
    if (!data.results?.length) return { found: false, message: "No provider found" };
    return {
      found: true,
      providers: data.results.map(p => ({
        npi: p.number,
        name: p.basic?.organization_name || `${p.basic?.first_name} ${p.basic?.last_name}`,
        type: p.basic?.organization_name ? "organization" : "individual",
        specialty: p.taxonomies?.[0]?.desc,
        address: p.addresses?.[0],
        status: p.basic?.status,
        enumeration_date: p.basic?.enumeration_date,
        last_updated: p.basic?.last_updated
      }))
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_opencorporates({ company_name, jurisdiction }) {
  const OC_API_KEY = getEnv("OPENCORPORATES_API_KEY");
  let url = apiUrl(
    `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(company_name)}&per_page=5`,
    '/proxy/opencorporates'
  );
  if (jurisdiction) url += `&jurisdiction_code=${jurisdiction}`;
  if (OC_API_KEY) url += `&api_token=${OC_API_KEY}`;
  try {
    const res = await fetch(url);
    if (res.status === 401) return { error: "OpenCorporates requires an API key. Set OPENCORPORATES_API_KEY in .env. Free key at opencorporates.com/api_accounts/new" };
    if (!res.ok) return { error: `OpenCorporates ${res.status}` };
    const data = await res.json();
    const companies = data.results?.companies;
    if (!companies?.length) return { found: false, message: `No corporate records for "${company_name}"` };
    return {
      found: true,
      companies: companies.map(c => ({
        name: c.company.name,
        jurisdiction: c.company.jurisdiction_code,
        incorporation_date: c.company.incorporation_date,
        dissolution_date: c.company.dissolution_date,
        status: c.company.current_status,
        registered_agent: c.company.registered_agent_name,
        company_type: c.company.company_type,
        url: c.company.opencorporates_url,
        inactive: c.company.inactive
      }))
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_edgar({ query }) {
  const url = `https://efts.sec.gov/LATEST/search-index?q="${encodeURIComponent(query)}"&dateRange=custom&startdt=2018-01-01&enddt=${new Date().toISOString().split("T")[0]}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "FCA-Agent hackathon@example.com" } });
    if (!res.ok) return { error: `EDGAR ${res.status}` };
    const data = await res.json();
    const hits = data.hits?.hits;
    if (!hits?.length) return { found: false, message: `No EDGAR filings for "${query}"` };
    return {
      found: true,
      total_filings: data.hits.total?.value,
      recent_filings: hits.slice(0, 5).map(h => ({
        entity: h._source.display_names?.[0] ?? null,
        form_type: h._source.form ?? h._source.root_forms?.[0] ?? null,
        filed: h._source.file_date,
        period: h._source.period_ending ?? null
      }))
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_sam({ company_name, uei }) {
  const SAM_API_KEY = getEnv("SAM_API_KEY");
  if (!SAM_API_KEY) return { error: "SAM_API_KEY not set" };
  const param = uei ? `ueiSAM=${uei}` : `legalBusinessName=${encodeURIComponent(company_name)}`;
  const url = `https://api.sam.gov/entity-information/v3/entities?api_key=${SAM_API_KEY}&${param}&includeSections=entityRegistration,coreData`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `SAM.gov ${res.status}` };
    const data = await res.json();
    if (!data.entityData?.length) return { found: false, message: `No SAM.gov registration for "${company_name || uei}"` };
    return {
      found: true,
      entities: data.entityData.map(e => ({
        name: e.entityRegistration?.legalBusinessName,
        uei: e.entityRegistration?.ueiSAM,
        cage: e.entityRegistration?.cageCode,
        status: e.entityRegistration?.registrationStatus,
        expiry: e.entityRegistration?.registrationExpirationDate,
        exclusion_flag: e.entityRegistration?.exclusionStatusFlag,
        activation_date: e.entityRegistration?.activationDate
      }))
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_opensanctions({ query, schema, dataset = "default" }) {
  const API_KEY = getEnv("OPENSANCTIONS_API_KEY");
  if (!API_KEY) return { error: "OPENSANCTIONS_API_KEY not set. Free non-commercial key at opensanctions.org/api/ (30-day trial available)" };
  const params = new URLSearchParams({ q: query, limit: "5" });
  if (schema) params.set("schema", schema);
  const url = apiUrl(`https://api.opensanctions.org/search/${dataset}?${params}`, '/proxy/opensanctions');
  try {
    const res = await fetch(url, { headers: { "Authorization": `ApiKey ${API_KEY}`, "Accept": "application/json" } });
    if (!res.ok) return { error: `OpenSanctions ${res.status}: ${await res.text()}` };
    const data = await res.json();
    if (!data.results?.length) return { found: false, message: `No sanctions/PEP records for "${query}"` };
    return {
      found: true,
      total: data.total?.value ?? data.results.length,
      results: data.results.map(e => ({
        id: e.id,
        name: e.caption,
        schema: e.schema,
        datasets: e.datasets,
        topics: e.properties?.topics ?? [],
        countries: e.properties?.country ?? [],
        aliases: e.properties?.alias ?? [],
        birth_date: e.properties?.birthDate ?? [],
        sanction_program: e.properties?.program ?? [],
        first_seen: e.first_seen,
        last_seen: e.last_seen
      }))
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_registrylookup({ company_name, jurisdiction, status }) {
  const API_KEY = getEnv("REGISTRY_LOOKUP_API_KEY");
  if (!API_KEY) return { error: "REGISTRY_LOOKUP_API_KEY not set. Free key (5,000 calls/month) at registry-lookup.com" };
  const params = new URLSearchParams({ q: company_name, per_page: "10" });
  if (jurisdiction) params.set("jurisdiction", jurisdiction);
  if (status) params.set("status", status);
  const url = apiUrl(`https://api.registry-lookup.com/v1/companies/search?${params}`, '/proxy/registrylookup');
  try {
    const res = await fetch(url, { headers: { "X-API-Key": API_KEY, "Accept": "application/json" } });
    if (res.status === 401) return { error: "Invalid REGISTRY_LOOKUP_API_KEY" };
    if (res.status === 429) return { error: "Registry Lookup rate limit exceeded" };
    if (!res.ok) return { error: `Registry Lookup ${res.status}` };
    const data = await res.json();
    if (!data.results?.length) return { found: false, message: `No registry records for "${company_name}"` };
    return {
      found: true,
      total: data.pagination?.total_results,
      companies: data.results.map(c => ({
        id: c.id,
        name: c.legal_name,
        jurisdiction: c.jurisdiction_code,
        registry_number: c.registry_number,
        status: c.status,
        is_active: c.is_active,
        incorporation_date: c.incorporation_date,
        legal_form: c.legal_form,
        address: c.registered_address,
        lei: c.identifiers?.find(i => i.type === "LEI")?.value ?? null,
        has_enriched_data: c.has_enriched_data
      })),
      facets: data.facets
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_gleif({ company_name, lei }) {
  if (!company_name && !lei) return { error: "Need company_name or lei" };

  try {
    let records;

    if (lei) {
      const url = apiUrl(`https://api.gleif.org/api/v1/lei-records/${encodeURIComponent(lei)}`, '/proxy/gleif');
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { error: `GLEIF ${res.status}` };
      const data = await res.json();
      records = data.data ? [data.data] : [];
    } else {
      const url = apiUrl(
        `https://api.gleif.org/api/v1/lei-records?filter[fullLegalName]=${encodeURIComponent(company_name)}&page[size]=5`,
        '/proxy/gleif'
      );
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { error: `GLEIF ${res.status}` };
      const data = await res.json();
      records = data.data ?? [];
    }

    if (!records.length) return { found: false, message: `No GLEIF records for "${company_name || lei}"` };

    // For the first match, fetch ownership links
    const topLei = records[0].attributes?.lei;
    let ownership = null;
    if (topLei) {
      const ownerUrl = apiUrl(
        `https://api.gleif.org/api/v1/lei-records/${topLei}/direct-parents?page[size]=3`,
        '/proxy/gleif'
      );
      const ownerRes = await fetch(ownerUrl, { headers: { Accept: "application/json" } });
      if (ownerRes.ok) {
        const ownerData = await ownerRes.json();
        ownership = (ownerData.data ?? []).map(p => ({
          lei: p.attributes?.lei,
          name: p.attributes?.entity?.legalName?.name,
          country: p.attributes?.entity?.legalAddress?.country,
          status: p.attributes?.entity?.status
        }));
      }
    }

    return {
      found: true,
      entities: records.map(r => {
        const a = r.attributes ?? {};
        const e = a.entity ?? {};
        return {
          lei: a.lei,
          name: e.legalName?.name,
          other_names: (e.otherNames ?? []).map(n => n.name),
          jurisdiction: e.legalJurisdiction,
          category: e.category,
          status: e.status,
          registration_status: a.registration?.status,
          registered_at: a.registration?.initialRegistrationDate,
          last_updated: a.registration?.lastUpdateDate,
          next_renewal: a.registration?.nextRenewalDate,
          country: e.legalAddress?.country,
          managing_lou: a.registration?.managingLou
        };
      }),
      direct_parents: ownership
    };
  } catch (e) { return { error: e.message }; }
}

// Tool executor – maps Claude's tool_use name to the right function
export async function executeTool({ name, input }) {
  const map = { fetch_usaspending, fetch_cms, fetch_opencorporates, fetch_registrylookup, fetch_edgar, fetch_sam, fetch_opensanctions, fetch_gleif };
  const fn = map[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try { return await fn(input); }
  catch (e) { return { error: e.message }; }
}
