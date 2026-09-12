import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Owner = "praveen" | "geetha";
type OwnerFilter = "all" | Owner;

interface TransactionRow {
  owner: Owner;
  scheme_code: string | null;
  scheme_name: string;
  transaction_type: "BUY" | "SELL";
  lot_type: "sip" | "lumpsum" | null;
  amount: number;
  trade_date: string;
}

interface MonthlyRow {
  month: string;
  month_label: string;
  sip: number;
  lumpsum: number;
  total_invested: number;
  redeemed: number;
  net: number;
}

interface FundRow {
  key: string;
  scheme_name: string;
  owner: Owner;
  sip: number;
  lumpsum: number;
  total_invested: number;
  redeemed: number;
  net: number;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export async function GET(request: Request) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const ownerParam = searchParams.get("owner") as OwnerFilter | null;
    const ownerFilter: OwnerFilter =
      ownerParam === "praveen" || ownerParam === "geetha" ? ownerParam : "all";

    let query = supabase
      .from("mf_transactions")
      .select("owner, scheme_code, scheme_name, transaction_type, lot_type, amount, trade_date")
      .eq("user_id", user.id);

    if (ownerFilter !== "all") {
      query = query.eq("owner", ownerFilter);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const transactions = (data ?? []) as TransactionRow[];

    let total_invested = 0;
    let sip_invested = 0;
    let lumpsum_invested = 0;
    let total_redeemed = 0;

    const monthlyMap = new Map<string, MonthlyRow>();
    const fundMap = new Map<string, FundRow>();

    for (const t of transactions) {
      const amount = Number(t.amount) || 0;
      const month = t.trade_date.slice(0, 7); // "YYYY-MM"
      const fundKey = `${t.owner}::${t.scheme_code ?? t.scheme_name}`;

      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, {
          month,
          month_label: monthLabel(month),
          sip: 0,
          lumpsum: 0,
          total_invested: 0,
          redeemed: 0,
          net: 0,
        });
      }
      const monthRow = monthlyMap.get(month)!;

      if (!fundMap.has(fundKey)) {
        fundMap.set(fundKey, {
          key: fundKey,
          scheme_name: t.scheme_name,
          owner: t.owner,
          sip: 0,
          lumpsum: 0,
          total_invested: 0,
          redeemed: 0,
          net: 0,
        });
      }
      const fundRow = fundMap.get(fundKey)!;

      if (t.transaction_type === "BUY") {
        total_invested += amount;
        monthRow.total_invested += amount;
        fundRow.total_invested += amount;
        if (t.lot_type === "sip") {
          sip_invested += amount;
          monthRow.sip += amount;
          fundRow.sip += amount;
        } else {
          lumpsum_invested += amount;
          monthRow.lumpsum += amount;
          fundRow.lumpsum += amount;
        }
      } else {
        total_redeemed += amount;
        monthRow.redeemed += amount;
        fundRow.redeemed += amount;
      }
    }

    for (const row of Array.from(monthlyMap.values())) {
      row.net = row.total_invested - row.redeemed;
    }
    for (const row of Array.from(fundMap.values())) {
      row.net = row.total_invested - row.redeemed;
    }

    const monthly = Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month));
    const per_fund = Array.from(fundMap.values()).sort((a, b) => b.total_invested - a.total_invested);

    return NextResponse.json({
      summary: {
        total_invested,
        sip_invested,
        lumpsum_invested,
        total_redeemed,
        net_invested: total_invested - total_redeemed,
      },
      monthly,
      per_fund,
    });
  } catch (err) {
    console.error("GET /api/mf/reports failed:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
