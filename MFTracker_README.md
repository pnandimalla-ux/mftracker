# MFTracker

**Family Mutual Fund Analysis Platform**
Praveen Viswanath Nandimalla · Accounts: YE7266 (Praveen) · WKT509 (Geetha)
*Last updated: 2026-09-02*

---

## What is MFTracker?

MFTracker is a dedicated family mutual fund tracking and analysis platform, completely separate from StockSense-AI. It tracks, analyses, and provides AI-powered recommendations for mutual fund portfolios of both Praveen and Geetha under a single login.

Single login → Praveen logs in → sees both portfolios with a Family / Praveen / Geetha toggle.

---

## Live URLs

| Resource | URL |
|---|---|
| Production app | https://mftracker-nv.vercel.app |
| GitHub repo | https://github.com/pnandimalla-ux/mftracker |
| Supabase project | https://yuitbdizosjajgwuttjl.supabase.co |
| Vercel project | https://vercel.com/praveens/mftracker |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Backend | Next.js API routes (serverless) |
| Database | Supabase — shared with StockSense-AI, `mf_` prefixed tables only |
| Auth | Supabase Auth — reuses existing users table |
| AI Engine | Claude API — `claude-sonnet-4-6` |
| NAV Data | mfapi.in — free, no auth required |
| Holdings Data | AMFI monthly portfolio disclosure (planned) |
| Holdings Import | Zerodha Coin order history CSV (primary) |
| Hosting | Vercel (Hobby plan) |
| Version Control | GitHub — pnandimalla-ux/mftracker |

**Monthly running cost:** ~₹400/month (Claude API only). Everything else is free.

---

## Key Design Decisions

- **Single login** — Praveen logs in, sees both Praveen and Geetha portfolios
- **Owner column** — every `mf_holdings` row has `owner` = `'praveen'` or `'geetha'`
- **Shared Supabase** — same project as StockSense-AI, all MFTracker tables have `mf_` prefix
- **No Zerodha Coin API** — Coin mutual funds have no public API; data comes from Coin CSV export
- **No ETFs** — ETFs are excluded from MFTracker; track them in StockSense-AI instead
- **Direct Plan only** — peer comparisons use Direct Plan Growth funds only (correct comparison)
- **Prompt-driven development** — all code written by Claude Code; Praveen provides prompts

---

## Supabase Schema

All tables use `mf_` prefix. Zero changes to existing StockSense-AI tables.

### `mf_holdings`
Stores each purchase lot as a separate row. Same fund bought on multiple dates = multiple rows, grouped in the UI.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | Primary key |
| user_id | uuid FK | Praveen's auth user ID — all rows share this |
| owner | text | `'praveen'` or `'geetha'` |
| scheme_code | text | AMFI scheme code — links to nav_cache and peer_data |
| scheme_name | text | Full fund name |
| category | text | SEBI category — Large Cap, Mid Cap, Flexi Cap, ELSS, etc. |
| amc | text | AMC name |
| units | numeric | Units held in this lot |
| avg_nav | numeric | NAV on purchase date for this lot |
| invested_amount | numeric | Amount invested in this lot (₹) |
| as_on_date | date | Purchase date |
| kyc_status | text | `'ok'`, `'pending'`, `'not_ok'` |
| created_at | timestamptz | Auto-generated |

### `mf_nav_cache`
Stores latest NAV per scheme. Refreshed daily by cron.

| Column | Type | Description |
|---|---|---|
| scheme_code | text PK | AMFI scheme code |
| scheme_name | text | Fund name |
| nav | numeric | Latest NAV |
| nav_date | date | Date of the NAV |
| nav_history | jsonb | Full 5-year NAV history (cached to avoid re-fetching) |
| fetched_at | timestamptz | When last fetched |

### `mf_peer_data`
Stores returns and peer ranks per fund. Updated weekly (Tier 1) and monthly (Tier 2).

| Column | Type | Description |
|---|---|---|
| scheme_code | text PK | AMFI scheme code |
| fund_name | text | Fund name |
| amc | text | AMC name |
| category | text | SEBI category |
| r6m | numeric | 6-month return % |
| r1y | numeric | 1-year return % |
| r3y | numeric | 3-year CAGR % |
| r5y | numeric | 5-year CAGR % |
| expense_ratio | numeric | Annual expense ratio % |
| aum_cr | numeric | AUM in crores |
| peer_rank_6m | integer | Rank within category for 6M |
| peer_rank_1y | integer | Rank within category for 1Y |
| peer_rank_3y | integer | Rank within category for 3Y |
| peer_rank_5y | integer | Rank within category for 5Y |
| peer_count | integer | Total funds in this category |
| tier | text | `'tier1'` or `'tier2'` |
| updated_at | timestamptz | Last sync timestamp |

### `mf_category_stats`
Stores category-level intelligence for AI recommendations.

| Column | Type | Description |
|---|---|---|
| category | text PK | SEBI category |
| avg_r6m / avg_r1y / avg_r3y / avg_r5y | numeric | Category averages |
| best_fund_code / best_fund_name / best_fund_r1y | — | Top fund in category |
| worst_fund_code / worst_fund_name / worst_fund_r1y | — | Bottom fund |
| benchmark_r1y | numeric | Nifty 50 1Y return for comparison |
| category_vs_benchmark | numeric | Category avg minus benchmark |
| trend | text | `'outperforming'`, `'underperforming'`, `'neutral'` |
| fund_count | integer | Number of funds in category |
| updated_at | timestamptz | Last sync timestamp |

### `mf_fund_holdings`
AMFI monthly portfolio disclosure — underlying stocks per fund. Updated on 11th of each month.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | — |
| scheme_code | text | Fund scheme code |
| stock_name | text | Underlying stock name |
| isin | text | Stock ISIN |
| allocation_pct | numeric | % allocation in the fund |
| market_value_cr | numeric | Market value in crores |
| as_of_month | date | Month-end date of disclosure |

### `mf_ai_recommendations`
Stores Claude-generated recommendations per fund.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid | FK to users |
| owner | text | `'praveen'` or `'geetha'` |
| scheme_code | text | Fund analysed |
| action | text | `'HOLD'`, `'SWITCH'`, `'REBALANCE'`, `'EXIT'` |
| reason | text | Claude-generated reasoning |
| suggested_fund | text | Specific alternative fund name |
| ltcg_note | text | Tax implication note |
| generated_at | timestamptz | When Claude generated this |

### `mf_sip_schedules`
Manual SIP schedule — entered once, powers the SIP calendar.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid | FK to users |
| owner | text | `'praveen'` or `'geetha'` |
| scheme_code | text | Fund scheme code |
| scheme_name | text | Fund name |
| category | text | Fund category |
| amount | numeric | Monthly SIP amount (₹) |
| sip_date | integer | Day of month (1–31) |
| frequency | text | `'monthly'` or `'quarterly'` |
| start_date | date | SIP start date |
| end_date | date | SIP end date (null = ongoing) |
| is_active | boolean | Active / paused |
| notify_email | boolean | Per-SIP email notification preference (default `true`) |
| notify_sms | boolean | Per-SIP SMS notification preference (default `false`) |
| created_at | timestamptz | — |

### `mf_cas_imports`
Import history log.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid | — |
| owner | text | `'praveen'` or `'geetha'` |
| filename | text | Uploaded filename |
| imported_at | timestamptz | Import timestamp |
| status | text | `'success'`, `'partial'`, `'failed'` |
| rows_imported | integer | Lots created |

### `mf_sync_log`
Cron job execution log.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | — |
| cron_name | text | e.g. `'tier1-weekly'`, `'mf-daily'` |
| status | text | `'success'`, `'partial'`, `'failed'` |
| rows_updated | integer | Records updated |
| error_message | text | Error detail if failed |
| run_at | timestamptz | When cron ran |

---

## Environment Variables

Set in Vercel → Settings → Environment Variables AND in local `.env.local`.

| Variable | Type | Where to get |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Config** | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Config** | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Supabase → Settings → API → service_role secret key |
| `ANTHROPIC_API_KEY` | Secret | console.anthropic.com → API Keys |
| `CRON_SECRET` | Secret | Random string — generate once and store safely |
| `NEXT_PUBLIC_APP_URL` | **Config** | `https://mftracker-nv.vercel.app` |

> ⚠️ `NEXT_PUBLIC_*` variables **must** be set as **Config** type in Vercel, NOT Secret.
> Setting them as Secret breaks the build — Next.js cannot inline Secret variables at build time.

---

## Data Sources

### mfapi.in (NAV and returns)
- Free, no authentication
- `GET https://api.mfapi.in/mf/{scheme_code}` → full NAV history
- `GET https://api.mfapi.in/mf/{scheme_code}/latest` → latest NAV only
- `GET https://api.mfapi.in/mf/search?q={name}` → search by name
- Date format returned: `DD-MM-YYYY` — **never use `new Date()` directly on this format**
- Use the custom date parser: `parseMFDate(dateStr)` in `src/lib/peers/peerSync.ts`

### Zerodha Coin CSV (holdings import)
- Export from coin.zerodha.com → Orders → Order History → Download CSV
- Contains: client_id, isin, scheme_name, trade_date, amount, units, nav, status, tag
- `tag = 'coiniossip'` → SIP order; `tag = 'coinios'` → manual iOS purchase
- Only import rows where `status = 'COMPLETE'` and `units > 0`
- ETFs excluded automatically by scheme_name keyword filter
- Owner auto-detected: `YE7266 = praveen`, `WKT509 = geetha`

### AMFI monthly disclosure (stock holdings — planned)
- Published by 10th of each month at amfiindia.com
- Covers all schemes — stock name, ISIN, allocation %, market value
- Fetched by monthly cron on 11th of each month
- Powers stock overlap analysis and portfolio quality scoring

---

## API Routes

### Holdings
| Route | Method | Description |
|---|---|---|
| `/api/mf/holdings` | GET | All holdings for user, enriched with current NAV and P&L |
| `/api/mf/holdings` | POST | Add single holding manually |
| `/api/mf/holdings/[id]` | PUT | Update owner, invested_amount, as_on_date, category |
| `/api/mf/holdings/[id]` | DELETE | Delete a single lot |

### Import
| Route | Method | Description |
|---|---|---|
| `/api/mf/import/coin` | POST | Parse Coin CSV — returns preview, no DB write |
| `/api/mf/import/coin/confirm` | POST | Confirm import — bulk inserts into mf_holdings |
| `/api/mf/import/cas` | POST | Parse CAMS CAS PDF import |
| `/api/mf/import/[id]` | DELETE | Delete an import record and its associated holdings |

### NAV
| Route | Method | Description |
|---|---|---|
| `/api/mf/nav/sync` | POST | Manual NAV sync for current user's holdings |
| `/api/mf/nav/[scheme_code]` | GET | NAV for a scheme, optional `?date=YYYY-MM-DD` |

### Peers
| Route | Method | Description |
|---|---|---|
| `/api/mf/peers/sync` | POST | Sync peer data for one category `{ category: string }` |
| `/api/mf/peers/[scheme_code]` | GET | Peer comparison data for a fund |
| `/api/mf/peers/seed` | POST | Returns list of categories to sync |
| `/api/mf/peers/clear` | DELETE | Clears mf_peer_data for re-sync |
| `/api/mf/peers/category-stats` | GET | Category-level stats for AI engine |

### SIP
| Route | Method | Description |
|---|---|---|
| `/api/mf/sip` | GET | All SIP schedules for user |
| `/api/mf/sip` | POST | Add new SIP |
| `/api/mf/sip/[id]` | PATCH | Toggle active/paused, update notify_email/notify_sms |
| `/api/mf/sip/[id]` | DELETE | Remove SIP |
| `/api/mf/sip/bulk` | POST | Bulk-create SIPs (used by Coin import auto-detect) |

### AI (planned — Prompt 6, not yet built)
| Route | Method | Description |
|---|---|---|
| `/api/mf/ai/recommendations` | POST | Generate switch/hold/rebalance recs via Claude |
| `/api/mf/ai/lumpsum` | POST | Lumpsum parking recommendation |
| `/api/mf/ai/consolidation` | POST | Portfolio overlap and consolidation analysis |
| `/api/mf/alternatives/[scheme_code]` | GET | Better-ranked peer funds for a given holding — **live** |

### Cron (protected by CRON_SECRET header)
| Route | Schedule | Description |
|---|---|---|
| `/api/cron/mf-daily` | 8 PM IST weekdays | NAV sync for all users |
| `/api/cron/mf-weekly` | 6:30 AM IST Sunday | Tier 1 peer sync (held categories) |
| `/api/cron/mf-monthly` | 7:30 AM IST 1st of month | Tier 2 peer sync (all categories) |

---

## Peer Data Sync — 3-Tier Architecture

### Tier 1 — Fast sync (weekly, held categories only)
- Syncs only categories the user actually holds funds in
- Fetches NAV history for 20–25 funds (not all 70)
- Limits history to last 5 years + 30 day buffer
- Target: under 30 seconds
- Powers: dashboard peer ranks, 1Y/3Y/5Y return columns

### Tier 2 — Category intelligence (monthly, all categories)
- Syncs all 10 categories regardless of holdings
- Calculates category averages and trends
- Updates `mf_category_stats` table
- Powers: AI cross-category recommendations, lumpsum suggestions

### Tier 3 — On-demand (immediate, when fund is added)
- Triggered in background after each new holding is added
- Fetches NAV history for just that one fund
- Calculates its returns and peer rank within category
- Result: peer rank shows immediately after adding a fund

---

## Category Universe

Peer comparison uses Direct Plan — Growth funds only. 10 categories:

| Category | Funds in universe |
|---|---|
| Large Cap | Mirae, Axis, HDFC, SBI, Canara Robeco, Kotak, ICICI Pru, Nippon |
| Mid Cap | HDFC, Kotak Emerging, Nippon, Axis, DSP, Motilal, SBI, Tata |
| Small Cap | SBI, Axis, HDFC, Nippon, Kotak, DSP, Canara Robeco |
| Flexi Cap | Parag Parikh, Quant, HDFC, UTI, Canara Robeco, SBI, Axis, Motilal, Invesco |
| ELSS | Mirae, Axis, Quant, Canara Robeco, Kotak, SBI, HDFC, Motilal |
| Hybrid | HDFC BAF, ICICI BAF, Kotak BAF, SBI Equity Hybrid, Canara Robeco, DSP |
| Debt | HDFC Corporate Bond, Kotak, SBI, ICICI Pru, Nippon, Axis |
| Large & Mid Cap | Kotak, Mirae, Canara Robeco, SBI, DSP, HDFC, Axis |
| Sectoral/Thematic | Kotak MNC, Nippon Pharma, ICICI Tech, SBI Healthcare, Quant BFSI, Tata Digital, Mirae Banking |
| Value | Quant Value, ICICI Value Discovery, Templeton, Kotak Contra, UTI Value, Nippon Value, HDFC Capital Builder |

> Benchmark for all categories: UTI Nifty 50 Index Fund — Direct — Growth

---

## ISIN Mapping (Praveen's funds)

Known ISINs from Zerodha Coin CSV — used to avoid mfapi.in search during import:

| ISIN | Fund | Category |
|---|---|---|
| INF174KA1TG9 | Kotak MNC Fund - Direct - Growth | Sectoral/Thematic |
| INF174K01LF9 | Kotak Large & Mid Cap Fund - Direct - Growth | Large & Mid Cap |
| INF205KA1213 | Invesco India Focused Fund - Direct - Growth | Flexi Cap |
| INF769K01GX9 | Mirae Asset Banking & Fin Serv Fund - Direct | Sectoral/Thematic |
| INF769K01FA9 | Mirae Asset Midcap Fund - Direct | Mid Cap |
| INF247L01502 | Motilal Oswal Flexi Cap Fund - Direct - Growth | Flexi Cap |
| INF740K01QD1 | DSP Small Cap Fund - Direct - Growth | Small Cap |
| INF109K01Z48 | ICICI Pru Technology Fund - Direct - Growth | Sectoral/Thematic |

---

## Pages and Navigation

| Page | Description |
|---|---|
| `/login` | Email + password login |
| `/dashboard` | Family view — KPIs, holdings table, peer ranks |
| `/dashboard?owner=praveen` | Filtered to Praveen's holdings |
| `/dashboard?owner=geetha` | Filtered to Geetha's holdings |
| `/fund/[scheme_code]` | Fund detail — NAV chart, peer comparison bar chart, full peer table |
| `/sip` | Confluence-style monthly SIP calendar — auto-detected SIPs from Coin import, per-SIP notification prefs, chip delete |
| `/import` | Coin CSV / CAS import, import history with delete, manual add fund form |
| `/settings` | Peer data sync (per-category status, manual sync), NAV sync, recent sync history |
| `/recommendations` | Placeholder page — "AI recommendations are coming soon" (Prompt 6 not yet built) |
| `/lumpsum` | Not yet built (Prompt 10 — planned) |
| `/consolidation` | Not yet built (Prompt 9 — planned) |

---

## Praveen's Actual Portfolio (as of Aug 2026)

> ⚠️ This is a point-in-time snapshot from initial import. SIPs began September 2026 and further Coin imports have run since — treat `/dashboard` as the source of truth for current holdings, not this table.

All holdings are Demat (via Zerodha Coin / CDSL). No SoA folios.

| Fund | ISIN | Invested | Units | Category | Owner |
|---|---|---|---|---|---|
| Kotak MNC Fund - Direct | INF174KA1TG9 | ₹39,000 | 3,004.935 | Sectoral/Thematic | Praveen |
| Invesco India Focused Fund - Direct | INF205KA1213 | ₹32,500 | 1,007.184 | Flexi Cap | Praveen |
| Motilal Oswal Flexi Cap - Direct | INF247L01502 | ₹30,000 | 421.178 | Flexi Cap | Praveen |
| ICICI Pru Technology Fund - Direct | INF109K01Z48 | ₹15,000 | 72.254 | Sectoral/Thematic | Praveen |
| Mirae Asset Midcap Fund - Direct | INF769K01FA9 | ₹14,000 | 315.919 | Mid Cap | Praveen |
| Kotak Large & Mid Cap - Direct | INF174K01LF9 | ₹13,000 | 31.206 | Large & Mid Cap | Praveen |
| Mirae Asset Banking & Fin Serv - Direct | INF769K01GX9 | ₹12,100 | 512.839 | Sectoral/Thematic | Praveen |
| DSP Small Cap Fund - Direct | INF740K01QD1 | ₹11,000 | 43.853 | Small Cap | Praveen |

**Total invested: ₹1,66,600**

> Note: SIPs started September 2026. All August 2026 purchases are lumpsum.
> Invesco folio 31011462344 has KYC: NOT OK — resolve with Zerodha support.
> ETFs (ICICI Nifty Metal, Motilal Nasdaq 100, Motilal Nasdaq Q50, DSP TIGER) are excluded — track in StockSense-AI.

---

## Zerodha Coin Import Format

Coin order history CSV columns:
```
client_id, isin, scheme_name, plan, transaction_mode, settlement_id,
trade_date, ordered_at, folio_number, amount, units, nav, status,
exchange_order_id, remarks, tag
```

**Parsing rules:**
- Import only: `status = 'COMPLETE'` AND `units > 0` AND `transaction_mode = 'BUY'`
- Skip: `REJECTED`, `CANCELLED` orders
- Tag parsing: `coiniossip` = SIP, `coinios` = manual iOS, empty = web
- Date format: `D/M/YYYY` or `DD/MM/YYYY` (inconsistent — handle both)
- Owner: `YE7266 = praveen`, `WKT509 = geetha`
- ETF filter: exclude scheme_name containing ETF, BeES, NASDAQ, Nifty Metal, Gold, Silver, T.I.G.E.R, INDEX

---

## Return Calculation Formulas

```typescript
// Simple return (6M, 1Y)
return_pct = ((nav_today - nav_start) / nav_start) * 100

// CAGR (3Y, 5Y)
cagr = ((nav_today / nav_start) ^ (1 / years) - 1) * 100

// Date parsing from mfapi.in DD-MM-YYYY format
function parseMFDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
  // Never use: new Date("29-08-2026") — returns Invalid Date
}

// P&L per holding
current_value = units × current_nav  // current_nav from mf_nav_cache
pnl = current_value - invested_amount
pnl_pct = (pnl / invested_amount) * 100
```

---

## SIP Calendar

Confluence-style full monthly grid. Features:
- Blue chips = Praveen's SIPs
- Amber chips = Geetha's SIPs  
- Weekend dates show "→ next trading day" indicator
- Today's cell highlighted with blue ring border
- Summary bar: total monthly outflow + per-owner split + next SIP countdown
- Owner filter toggle: All / Praveen / Geetha
- Add / Pause / Delete SIP inline

**SIP data is manual** — Zerodha Coin has no API for SIP schedules. Enter once, stays forever.

---

## AI Recommendations Engine (Planned — Prompt 6)

Claude API (`claude-sonnet-4-6`) analyses three layers:

**Layer 1 — Past performance:**
Fund's 6M/1Y/3Y/5Y returns vs category peer average and rank.

**Layer 2 — Portfolio holdings quality:**
AMFI monthly data — underlying stock exposure vs peers.
Flags heavy allocation to underperforming stocks.

**Layer 3 — Expense ratio:**
Within-category comparison. Flags funds with >0.3% higher expense ratio than top peer.

**Recommendation types:**
- `HOLD` — top 25% rank, above category avg → no action
- `WATCH` — 26–50% rank, within 3% of category avg → monitor
- `SWITCH` — bottom 50%, significantly below avg → specific alternative fund suggested
- `EXIT` — structural underperformance across all periods

**Tax notes always included:**
- Units held > 1 year → 10% LTCG above ₹1L (equity funds)
- Units held < 1 year → 15% STCG (equity funds)
- ELSS lock-in 3 years — switching before 3Y not allowed, flagged explicitly

**Lumpsum recommendation inputs:**
- Amount (₹)
- Time horizon (1Y / 3Y / 5Y+)
- Risk appetite (Conservative / Moderate / Aggressive)

Claude checks 80C shortfall first (ELSS), then allocation gap vs ideal model, then peer performance.

---

## Better Alternatives Side Panel

Click any fund name in dashboard → side panel slides in from right.

Sections:
1. **Your fund** — full metrics (6M/1Y/3Y/5Y, peer rank per period)
2. **Funds ranked above you** — with return diff table (Theirs vs Yours)
3. **Top 3 in category** — regardless of your rank
4. **Should you switch?** signal — Green (Hold) / Amber (Watch) / Red (Consider switching)

Signal dots on every dashboard row at a glance:
- 🟢 Green = top 25%
- 🟡 Amber = 26–50%
- 🔴 Red = bottom 50%

---

## Known Issues and Watchouts

### Vercel Timeout (10 seconds)
Serverless functions timeout at 10 seconds on Hobby plan. Peer sync is broken into one category per request to stay within limit. Never try to sync all categories in one API call.

### Supabase RLS for Writes
`mf_peer_data`, `mf_nav_cache`, `mf_sync_log` have read-only RLS for authenticated users. All write operations (sync jobs) must use the service role client — never the anon client.

```typescript
// Use for sync API routes (server-side only)
import { createServiceClient } from '@/lib/supabase/service'

// Never use for writes to peer/nav tables:
import { createClient } from '@/lib/supabase/client'  // anon client — reads only
```

### mfapi.in Date Format
Returns dates as `DD-MM-YYYY`. Never pass directly to `new Date()` — it returns Invalid Date.
Always use the custom parser:
```typescript
function parseMFDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}
```

### NEXT_PUBLIC Variables in Vercel
Must be set as **Config** type, not Secret. Secret type variables are not available at build time — causes the app to crash with a server-side exception.

### Zerodha Coin — No MF API
Zerodha Kite API covers stocks only. Coin mutual funds have no API. Data entry is via Coin CSV export or manual entry. SIP schedules must be entered manually.

### CAMS vs KFintech
CAMS CAS covers only CAMS-registered AMCs. Quant, Motilal Oswal, PPFAS, Invesco, DSP are KFintech-registered. Use MFCentral (mfcentral.com) for both, or use Zerodha Coin CSV which covers all.

### Expense Ratio Data
mfapi.in does not provide expense ratios. Currently shows "—" in the UI. Will be seeded from AMFI data quarterly (expense ratios change infrequently).

### LTCG Grandfathering
For equity fund gains before Jan 31 2018, cost basis is the higher of actual cost or Jan 31 2018 NAV. Complex to implement — note this caveat in AI recommendations.

### Invesco KYC Issue
Folio 31011462344 — Invesco India Focused Fund shows KYC: NOT OK in MFCentral CAS. Resolve with Zerodha support or visit kra.com.in.

---

## Build Progress

| Prompt | Feature | Status |
|---|---|---|
| 1 | Next.js setup, auth, login page, dashboard shell | ✅ Done |
| 2 | Login page redesign (dark split layout) | ✅ Done |
| 3 | Supabase schema (8 tables), SIP calendar, SIP CRUD API | ✅ Done |
| 4 | CAMS CAS importer, manual add fund, holdings API, dashboard real data | ✅ Done |
| 5 | Live NAV sync, peer comparison 6M/1Y/3Y/5Y, fund detail page | ✅ Done |
| 5b | 3-tier peer sync architecture, category universe rebuild | ✅ Done |
| 5c | Better Alternatives side panel | ✅ Done |
| 5d | Zerodha Coin CSV importer (primary import method) | ✅ Done |
| 5e | Grouped holdings table, inline edit, add/delete lots | ✅ Done |
| 5f | Smart fund auto-categorisation, fix fund names in peer table | ✅ Done |
| 5g | Dashboard infinite-loading fix — parallel fetches, timeout, progressive render, N+1 query fix | ✅ Done |
| 5h | P&L calc fix (current NAV), peer category mismatch fix, scheme_code lookup fix | ✅ Done |
| 5i | Coin CSV importer hardening — SIP/lumpsum tagging, import delete, precise peer grouping, Settings page | ✅ Done |
| 5j | Auto-detect active SIPs from Coin import, per-SIP notification prefs, calendar chip delete | ✅ Done |
| 5k | Coin CSV import timeout fix for funds with many unknown ISINs | ✅ Done |
| 6 | Claude AI recommendations (switch/hold/rebalance + LTCG) | 🔄 Next — `/recommendations` page exists as a placeholder, no `/api/mf/ai/*` routes built yet |
| 7 | AMFI holdings parser, stock overlap analysis | ⏳ Planned |
| 8 | Expense ratio comparison layer | ⏳ Planned |
| 9 | Portfolio consolidation analysis, overlap score | ⏳ Planned |
| 10 | Lumpsum parking recommendation | ⏳ Planned |
| 11 | Cron jobs, final deploy, polish | ⏳ Planned |

---

## Monthly Maintenance Checklist

| When | Task |
|---|---|
| After any buy/sell | Export Coin CSV → Import in MFTracker → verify holdings |
| Any time | Enter new SIP details in SIP calendar if SIP added/changed |
| Weekly (auto) | NAV sync runs automatically at 8 PM IST weekdays |
| Weekly (auto) | Peer sync runs automatically at 6:30 AM IST Sunday |
| Monthly (auto) | Full category sync runs on 1st of every month |
| 12th of month | Check mf_sync_log that AMFI holdings sync completed |
| Quarterly | Review and update expense ratios if any fund changed TER |
| Annually (April) | Update LTCG calculation baseline for new financial year |
| Annually | Rotate API keys (Supabase service role + Anthropic) |

---

## Local Development Setup

```bash
# Clone repo
git clone https://github.com/pnandimalla-ux/mftracker.git
cd mftracker

# Install dependencies
npm install

# Create .env.local (fill in real values)
cp .env.example .env.local

# Run development server
npm run dev
# Opens at http://localhost:3001
```

**.env.local template:**
```env
NEXT_PUBLIC_SUPABASE_URL=https://yuitbdizosjajgwuttjl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
CRON_SECRET=your_random_string_here
NEXT_PUBLIC_APP_URL=https://mftracker-nv.vercel.app
```

---

## Deployment

Push to `main` → Vercel auto-deploys within ~60 seconds.

```bash
git add .
git commit -m "Your change description"
git push origin main
```

Vercel build logs: https://vercel.com/praveens/mftracker/deployments

---

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — never use in client-side code
- `ANTHROPIC_API_KEY` is server-side only — never prefix with `NEXT_PUBLIC_`
- All cron routes protected by `CRON_SECRET` Authorization header
- RLS enabled on all `mf_` tables — users can only see their own data
- `.env.local` is gitignored — never commit real keys to GitHub
- Store all keys in a password manager (Bitwarden locked notes)

---

*MFTracker — Personal use only. Not SEBI-registered financial advice.*
*Built with Next.js · Supabase · Claude API · mfapi.in · AMFI public data*
