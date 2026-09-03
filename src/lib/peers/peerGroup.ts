// Maps mfapi.in scheme_category to a clean peer_group string.
// For Sectoral/Thematic, extracts the sector from the fund name.
export function derivePeerGroup(mfApiCategory: string, fundName: string): string {
  const cat = mfApiCategory.toLowerCase();
  const name = fundName.toLowerCase();

  // Sectoral/Thematic — peer group is the sector, not the broad bucket
  if (cat.includes("sectoral") || cat.includes("thematic")) {
    if (name.includes("mnc")) return "Sectoral - MNC";
    if (name.includes("tech") || name.includes("digital") || name.includes("it fund")) return "Sectoral - Technology";
    if (name.includes("banking") || name.includes("financial services") || name.includes("bfsi") || name.includes("finserv")) return "Sectoral - Banking & Financial Services";
    if (name.includes("pharma") || name.includes("healthcare") || name.includes("hospital")) return "Sectoral - Healthcare & Pharma";
    if (name.includes("infra")) return "Sectoral - Infrastructure";
    if (name.includes("consumption") || name.includes("fmcg")) return "Sectoral - Consumption";
    if (name.includes("psu")) return "Sectoral - PSU";
    if (name.includes("energy") || name.includes("power")) return "Sectoral - Energy";
    if (name.includes("real estate") || name.includes("realty")) return "Sectoral - Real Estate";
    if (name.includes("commodit")) return "Sectoral - Commodities";
    if (name.includes("quant") && name.includes("bfsi")) return "Sectoral - Banking & Financial Services";
    // fallback: keep broad label
    return "Sectoral/Thematic";
  }

  // Map mfapi.in category strings to clean names
  if (cat.includes("focused")) return "Focused Fund";
  if (cat.includes("flexi cap")) return "Flexi Cap";
  if (cat.includes("multi cap")) return "Multi Cap";
  if (cat.includes("large & mid") || cat.includes("large and mid")) return "Large & Mid Cap";
  if (cat.includes("large cap")) return "Large Cap";
  if (cat.includes("mid cap")) return "Mid Cap";
  if (cat.includes("small cap")) return "Small Cap";
  if (cat.includes("elss") || cat.includes("tax saver")) return "ELSS";
  if (cat.includes("value") || cat.includes("contra")) return "Value";
  // These three are all technically "Hybrid Scheme - ..." per mfapi.in's own
  // category text, so they must be checked BEFORE the generic hybrid/balanced
  // catch-all below — otherwise an Arbitrage fund (market-neutral, low-risk)
  // would get grouped with a Balanced Advantage fund (equity-heavy, volatile)
  // just because both scheme_category strings contain the word "hybrid".
  if (cat.includes("arbitrage")) return "Arbitrage";
  if (cat.includes("aggressive hybrid")) return "Aggressive Hybrid";
  if (cat.includes("multi asset")) return "Multi Asset Allocation";
  if (cat.includes("hybrid") || cat.includes("balanced")) return "Hybrid";
  if (cat.includes("debt") || cat.includes("bond") || cat.includes("liquid") || cat.includes("money market")) return "Debt";
  if (cat.includes("index") || cat.includes("etf")) return "Index";
  if (cat.includes("international") || cat.includes("global") || cat.includes("overseas")) return "International";
  if (cat.includes("fund of fund")) return "Fund of Funds";
  if (cat.includes("gold") || cat.includes("silver")) return "Commodity";

  // Default: return the raw mfapi category cleaned up
  return mfApiCategory.replace(/^(Equity|Debt|Hybrid|Other) (Scheme|Schemes) - /i, "").trim();
}
