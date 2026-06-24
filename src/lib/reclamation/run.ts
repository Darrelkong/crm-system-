import { getDb } from "@/lib/db";
import {
  runReclamationCheck,
  type ReclamationRunResult,
} from "./engine";

export async function runReclamationJob(
  now?: Date,
): Promise<ReclamationRunResult> {
  const db = getDb();
  return runReclamationCheck(db, now ?? new Date());
}

export { runReclamationCheck, type ReclamationRunResult };
