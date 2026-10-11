import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { LadderTier } from "./types";

/** Name of the leaderboard division the user is currently in, e.g. "Intern". Null while loading. */
export function useCurrentLeague(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("league_ladder").then(({ data }) => {
      setName(((data as LadderTier[] | null) ?? []).find((t) => t.is_current)?.name ?? null);
    });
  }, []);
  return name;
}
