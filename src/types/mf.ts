export type Owner = "praveen" | "geetha";

export type LotType = "sip" | "lumpsum";

export interface MFHolding {
  id: string;
  user_id: string;
  owner: Owner;
  scheme_code: string;
  scheme_name: string;
  category: string;
  amc: string | null;
  units: number;
  avg_nav: number;
  invested_amount: number;
  as_on_date: string;
  lot_type: LotType;
  import_id: string | null;
  mf_api_category: string | null;
  peer_group: string | null;
  created_at: string;
}

export interface EnrichedMFHolding extends MFHolding {
  current_nav: number;
  nav_date: string | null;
  current_value: number;
  pnl: number;
  pnl_pct: number;
}

export interface MFNavCache {
  scheme_code: string;
  scheme_name: string | null;
  nav: number | null;
  nav_date: string | null;
  fetched_at: string;
}

export interface MFPeerData {
  scheme_code: string;
  category: string | null;
  mf_api_category: string | null;
  peer_group: string | null;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  expense_ratio: number | null;
  aum_cr: number | null;
  peer_rank_6m: number | null;
  peer_rank_1y: number | null;
  peer_rank_3y: number | null;
  peer_rank_5y: number | null;
  peer_count: number | null;
  updated_at: string;
}

export interface MFFundHolding {
  id: string;
  scheme_code: string;
  stock_name: string;
  isin: string | null;
  allocation_pct: number | null;
  market_value_cr: number | null;
  as_of_month: string;
  created_at: string;
}

export type AIAction = "HOLD" | "SWITCH" | "REBALANCE" | "EXIT";

export interface MFAIRecommendation {
  id: string;
  user_id: string;
  owner: Owner;
  scheme_code: string | null;
  action: AIAction;
  reason: string | null;
  suggested_fund: string | null;
  ltcg_note: string | null;
  generated_at: string;
}

export type CASImportStatus = "success" | "partial" | "failed";

export interface MFCASImport {
  id: string;
  user_id: string;
  owner: Owner;
  filename: string | null;
  imported_at: string;
  status: CASImportStatus | null;
  rows_imported: number;
}

export type SIPFrequency = "monthly" | "quarterly";

export interface MFSIPSchedule {
  id: string;
  user_id: string;
  owner: Owner;
  scheme_code: string | null;
  scheme_name: string;
  category: string | null;
  amount: number;
  sip_date: number;
  frequency: SIPFrequency;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  notify_email: boolean;
  notify_sms: boolean;
  created_at: string;
}

export type SyncStatus = "success" | "partial" | "failed";

export interface MFSyncLog {
  id: string;
  cron_name: string;
  status: SyncStatus | null;
  rows_updated: number;
  error_message: string | null;
  run_at: string;
}
