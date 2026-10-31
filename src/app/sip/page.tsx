import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import SIPCalendarClient, {
  type LumpsumEntry,
  type PendingOrderEntry,
  type SellEntry,
  type SipLotEntry,
} from "./SIPCalendarClient";
import type { MFSIPSchedule, Owner } from "@/types/mf";

function SIPPageError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-700">{message}</p>
        <p className="mt-2 text-xs text-slate-400">
          Please try again shortly, or contact support if this continues.
        </p>
      </div>
    </div>
  );
}

export default async function SIPPage() {
  const { supabase, user, failed } = await getAuthedUser();

  if (failed || !supabase) {
    return (
      <SIPPageError message="Unable to connect to the database right now." />
    );
  }

  if (!user) {
    redirect("/login");
  }

  let sips: MFSIPSchedule[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_sip_schedules")
      .select("*")
      .eq("user_id", user.id)
      .order("sip_date", { ascending: true });

    if (error) throw error;
    sips = (data ?? []) as MFSIPSchedule[];
  } catch (err) {
    console.error("SIP page: failed to load SIP schedules", err);
    sips = [];
  }

  let lumpsums: LumpsumEntry[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_holdings")
      .select("as_on_date, amount:invested_amount, scheme_name, owner")
      .eq("user_id", user.id)
      .eq("lot_type", "lumpsum")
      .order("as_on_date", { ascending: false });

    if (error) throw error;
    lumpsums = (data ?? []).map((row) => ({
      trade_date: row.as_on_date as string,
      amount: row.amount as number,
      scheme_name: row.scheme_name as string,
      owner: row.owner as Owner,
    }));
  } catch (err) {
    console.error("SIP page: failed to load lumpsum holdings", err);
    lumpsums = [];
  }

  let sells: SellEntry[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_sell_transactions")
      .select("trade_date, amount, units, scheme_name, owner")
      .eq("user_id", user.id)
      .order("trade_date", { ascending: false });

    if (error) throw error;
    sells = (data ?? []).map((row) => ({
      trade_date: row.trade_date as string,
      amount: row.amount as number,
      units: row.units as number,
      scheme_name: row.scheme_name as string,
      owner: row.owner as Owner,
    }));
  } catch (err) {
    console.error("SIP page: failed to load sell transactions", err);
    sells = [];
  }

  let sipLots: SipLotEntry[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_holdings")
      .select("as_on_date, invested_amount, units, scheme_code, scheme_name, owner")
      .eq("user_id", user.id)
      .eq("lot_type", "sip")
      .order("as_on_date", { ascending: false });

    if (error) throw error;
    sipLots = (data ?? []).map((row) => ({
      trade_date: row.as_on_date as string,
      amount: Number(row.invested_amount),
      units: Number(row.units),
      scheme_code: (row.scheme_code as string | null) ?? null,
      scheme_name: row.scheme_name as string,
      owner: row.owner as Owner,
    }));
  } catch (err) {
    console.error("SIP page: failed to load SIP lots", err);
    sipLots = [];
  }

  let pendingOrders: PendingOrderEntry[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_pending_orders")
      .select("trade_date, amount, scheme_code, scheme_name, owner, lot_type, ordered_at, remarks")
      .eq("user_id", user.id)
      .order("trade_date", { ascending: false });

    if (error) throw error;
    pendingOrders = (data ?? []).map((row) => ({
      trade_date: String(row.trade_date).slice(0, 10),
      amount: Number(row.amount),
      scheme_code: (row.scheme_code as string | null) ?? null,
      scheme_name: row.scheme_name as string,
      owner: row.owner as Owner,
      lot_type: row.lot_type === "sip" ? "sip" : "lumpsum",
      ordered_at: (row.ordered_at as string | null) ?? null,
      remarks: (row.remarks as string | null) ?? null,
    }));
  } catch (err) {
    console.error("SIP page: failed to load pending orders", err);
    pendingOrders = [];
  }

  return (
    <SIPCalendarClient
      userEmail={user.email ?? ""}
      initialSips={sips}
      initialLumpsums={lumpsums}
      initialSells={sells}
      initialSipLots={sipLots}
      initialPendingOrders={pendingOrders}
    />
  );
}
