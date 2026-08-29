// Static mapping of category -> the most widely held scheme codes in that
// category. This is the universe the peer comparison engine ranks a held
// fund against — not an exhaustive list of every fund in India.

export const CATEGORY_UNIVERSE: Record<string, string[]> = {
  "Large Cap": [
    "118989", // Mirae Asset Large Cap
    "112386", // Axis Bluechip
    "100033", // HDFC Top 100
    "100068", // SBI Bluechip
    "101834", // Canara Robeco Bluechip
    "120465", // Kotak Bluechip
    "120586", // ICICI Pru Bluechip
    "101806", // Nippon India Large Cap
    "100018", // DSP Top 100
    "135781", // Edelweiss Large Cap
    "100122", // Tata Large Cap
    "100038", // Franklin India Bluechip
  ],
  "Mid Cap": [
    "100029", // HDFC Mid-Cap Opportunities
    "131597", // Kotak Emerging Equity
    "101808", // Nippon India Growth
    "112386", // Axis Midcap
    "100016", // DSP Midcap
    "147622", // Motilal Oswal Midcap
    "135800", // Edelweiss Mid Cap
    "100119", // Tata Mid Cap Growth
    "100051", // SBI Magnum Midcap
    "100037", // Franklin India Prima
  ],
  "Small Cap": [
    "100068", // SBI Small Cap
    "125354", // Axis Small Cap
    "100025", // HDFC Small Cap
    "118778", // Nippon India Small Cap
    "120464", // Kotak Small Cap
    "100017", // DSP Small Cap
    "145740", // Tata Small Cap
    "141328", // Canara Robeco Small Cap
    "145362", // Union Small Cap
  ],
  "Flexi Cap": [
    "122639", // Parag Parikh Flexi Cap
    "120828", // Quant Flexi Cap
    "100021", // HDFC Flexi Cap
    "100163", // UTI Flexi Cap
    "101835", // Canara Robeco Flexi Cap
    "100014", // DSP Flexi Cap
    "125497", // SBI Flexi Cap
    "125358", // Axis Flexi Cap
  ],
  ELSS: [
    "118990", // Mirae Asset ELSS
    "112385", // Axis Long Term Equity
    "120832", // Quant ELSS
    "100021", // DSP Tax Saver
    "101833", // Canara Robeco ELSS
    "120466", // Kotak ELSS
    "100058", // SBI Long Term Equity
    "100026", // HDFC ELSS
    "100036", // Franklin India ELSS
    "147623", // Motilal Oswal ELSS
  ],
  Hybrid: [
    "100022", // HDFC Balanced Advantage
    "120594", // ICICI Pru Balanced Advantage
    "120467", // Kotak Balanced Advantage
    "135783", // Edelweiss Balanced Advantage
    "100055", // SBI Equity Hybrid
    "101831", // Canara Robeco Equity Hybrid
    "100015", // DSP Equity & Bond
  ],
  Debt: [
    "100024", // HDFC Corporate Bond
    "120462", // Kotak Bond
    "100052", // SBI Magnum Medium Duration
    "120588", // ICICI Pru Corporate Bond
    "101812", // Nippon India Short Term
    "125355", // Axis Corporate Debt
  ],
};

export function getCategoryForScheme(scheme_code: string): string | null {
  for (const [category, codes] of Object.entries(CATEGORY_UNIVERSE)) {
    if (codes.includes(scheme_code)) {
      return category;
    }
  }
  return null;
}

export function getPeersForScheme(scheme_code: string): string[] {
  const category = getCategoryForScheme(scheme_code);
  if (!category) return [];
  return CATEGORY_UNIVERSE[category].filter((code) => code !== scheme_code);
}
