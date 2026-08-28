import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(process.cwd(), ".env.local") });

import { runMigrations } from "./migrate";

runMigrations()
  .then(() => {
    console.log("Migration complete — all 8 mf_* tables are ready.");
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("Migration failed.\n");
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
