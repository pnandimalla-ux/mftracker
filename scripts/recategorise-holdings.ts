// One-off: re-run detectCategory over existing mf_holdings after the v2
// categoriser rules (Focused; defence / manufacturing / innovation / special
// opportunities → Sectoral/Thematic; multi asset → Hybrid).
//
// A holding is only changed when its stored category equals what the OLD (v1)
// rules produce for its name — i.e. it was auto-assigned, not chosen by the
// user — and the new rules give something different. Idempotent: once
// applied, stored = new ≠ old, so a re-run finds nothing.
//
// Dry run (default) prints the plan; `--apply` writes it and then runs the
// tier-3 peer sync for each affected real scheme code so its rank is
// recomputed within the new category.
//
//   npm run recategorise            # dry run
//   npm run recategorise -- --apply # apply
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(process.cwd(), ".env.local") });

interface HoldingRow {
  id: string;
  user_id: string;
  scheme_code: string;
  scheme_name: string;
  category: string;
}

interface Change {
  user_id: string;
  scheme_name: string;
  from: string;
  to: string;
  reason: string;
  ids: string[];
  scheme_codes: Set<string>;
}

async function main() {
  const apply = process.argv.includes("--apply");

  // Imported after dotenv so the service-role client sees the env vars.
  const { createServiceRoleClient } = await import("@/lib/supabase/serviceRoleClient");
  const { detectCategory, detectCategoryLegacy } = await import("@/lib/analysis/fundCategoriser");
  const { isRealSchemeCode } = await import("@/lib/peers/peerSync");
  const { syncNewFund } = await import("@/lib/peers/tier3Sync");

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("mf_holdings")
    .select("id, user_id, scheme_code, scheme_name, category");
  if (error) throw new Error(`Failed to read mf_holdings: ${error.message}`);
  const rows = (data ?? []) as HoldingRow[];

  // Grouped per user + scheme name + stored category: the same fund can carry
  // different categories if the user edited some lots and not others.
  const changes = new Map<string, Change>();
  let skippedUserEdited = 0;
  for (const r of rows) {
    const legacy = detectCategoryLegacy(r.scheme_name).category;
    const next = detectCategory(r.scheme_name);
    if (next.category === legacy) continue;
    if (r.category !== legacy) {
      skippedUserEdited++;
      continue;
    }
    const key = `${r.user_id}::${r.scheme_name}::${r.category}`;
    const c = changes.get(key) ?? {
      user_id: r.user_id,
      scheme_name: r.scheme_name,
      from: r.category,
      to: next.category,
      reason: next.reason,
      ids: [],
      scheme_codes: new Set<string>(),
    };
    c.ids.push(r.id);
    c.scheme_codes.add(r.scheme_code);
    changes.set(key, c);
  }

  const list = Array.from(changes.values()).sort((a, b) => a.scheme_name.localeCompare(b.scheme_name));
  console.log(`${rows.length} holdings scanned · ${list.length} fund(s) to recategorise · ${skippedUserEdited} lot(s) left alone (category differs from the old auto-detection, so treated as user-edited)\n`);
  for (const c of list) {
    console.log(`  ${c.scheme_name}\n    ${c.from} → ${c.to}  (${c.ids.length} lot${c.ids.length === 1 ? "" : "s"}; ${c.reason})`);
  }

  if (!apply) {
    console.log(list.length > 0 ? "\nDry run — re-run with --apply to write these changes." : "\nNothing to do.");
    return;
  }

  const affectedCodes = new Map<string, string>();
  for (const c of list) {
    const { error: updateErr } = await supabase
      .from("mf_holdings")
      .update({ category: c.to })
      .in("id", c.ids)
      .eq("category", c.from); // guard: never overwrite a concurrent edit
    if (updateErr) {
      console.error(`  FAILED ${c.scheme_name}: ${updateErr.message}`);
      continue;
    }
    console.log(`  updated ${c.scheme_name} → ${c.to}`);
    for (const code of Array.from(c.scheme_codes)) {
      if (isRealSchemeCode(code)) affectedCodes.set(code, c.to);
    }
  }

  // Tier-3 recomputes each fund's returns, peer_group and rank against its
  // (new) category's peers.
  for (const [code, category] of Array.from(affectedCodes.entries())) {
    try {
      await syncNewFund(code, category);
      console.log(`  peer sync ok: ${code} (${category})`);
    } catch (err) {
      console.error(`  peer sync FAILED for ${code}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nApplied ${list.length} change(s); peer-synced ${affectedCodes.size} scheme code(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
