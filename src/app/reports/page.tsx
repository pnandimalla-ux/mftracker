import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  const { user, failed } = await getAuthedUser();

  if (failed) {
    redirect("/login?error=session");
  }

  if (!user) {
    redirect("/login");
  }

  return <ReportsClient userEmail={user.email ?? ""} />;
}
