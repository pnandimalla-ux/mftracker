import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SIPCalendarClient from "./SIPCalendarClient";
import type { MFSIPSchedule, Owner, SIPFrequency } from "@/types/mf";

const SAMPLE_SIPS: {
  owner: Owner;
  scheme_name: string;
  category: string;
  amount: number;
  sip_date: number;
  frequency: SIPFrequency;
  start_date: string;
}[] = [
  {
    owner: "praveen",
    scheme_name: "Mirae Asset Large Cap Fund",
    category: "Large Cap",
    amount: 5000,
    sip_date: 5,
    frequency: "monthly",
    start_date: "2025-01-05",
  },
  {
    owner: "praveen",
    scheme_name: "HDFC Mid-Cap Opportunities Fund",
    category: "Mid Cap",
    amount: 3000,
    sip_date: 10,
    frequency: "monthly",
    start_date: "2025-01-10",
  },
  {
    owner: "geetha",
    scheme_name: "Axis Bluechip Fund",
    category: "Large Cap",
    amount: 3000,
    sip_date: 7,
    frequency: "monthly",
    start_date: "2025-01-07",
  },
  {
    owner: "geetha",
    scheme_name: "Kotak Emerging Equity Fund",
    category: "Mid Cap",
    amount: 2000,
    sip_date: 15,
    frequency: "monthly",
    start_date: "2025-01-15",
  },
];

export default async function SIPPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { count } = await supabase
    .from("mf_sip_schedules")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (!count) {
    await supabase.from("mf_sip_schedules").insert(
      SAMPLE_SIPS.map((sip) => ({ ...sip, user_id: user.id }))
    );
  }

  const { data } = await supabase
    .from("mf_sip_schedules")
    .select("*")
    .eq("user_id", user.id)
    .order("sip_date", { ascending: true });

  return (
    <SIPCalendarClient
      userEmail={user.email ?? ""}
      initialSips={(data ?? []) as MFSIPSchedule[]}
    />
  );
}
