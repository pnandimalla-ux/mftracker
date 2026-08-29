import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const { user, failed } = await getAuthedUser();

  if (failed) {
    redirect("/login?error=session");
  }

  if (!user) {
    redirect("/login");
  }

  return <DashboardClient userEmail={user.email ?? ""} />;
}
