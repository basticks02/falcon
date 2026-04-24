// All public API calls. No auth except SAM.gov.
// Each returns clean JSON – errors included as { error: string }

export async function fetch_usaspending({ keyword, date_range_start, date_range_end }) {
  const body = {
    filters: {
      keywords: [keyword],
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
  const url = npi
    ? `https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`
    : `https://npiregistry.cms.hhs.gov/api/?organization_name=${encodeURIComponent(company_name)}&version=2.1&limit=5`;
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
  let url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(company_name)}&per_page=5`;
  if (jurisdiction) url += `&jurisdiction_code=${jurisdiction}`;
  try {
    const res = await fetch(url);
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
        entity: h._source.entity_name,
        form_type: h._source.form_type,
        filed: h._source.file_date,
        period: h._source.period_of_report
      }))
    };
  } catch (e) { return { error: e.message }; }
}

export async function fetch_sam({ company_name, uei }) {
  const SAM_API_KEY = typeof process !== "undefined" ? process.env.SAM_API_KEY : window.SAM_API_KEY;
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

// Tool executor – maps Claude's tool_use name to the right function
export async function executeTool({ name, input }) {
  const map = { fetch_usaspending, fetch_cms, fetch_opencorporates, fetch_edgar, fetch_sam };
  const fn = map[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try { return await fn(input); }
  catch (e) { return { error: e.message }; }
}
