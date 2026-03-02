import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type { AssignedPullRequest } from "@/types";

interface UseAssignedPrsReturn {
  prs: AssignedPullRequest[];
  loading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
}

export function useAssignedPrs(): UseAssignedPrsReturn {
  const [prs, setPrs] = useState<AssignedPullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<AssignedPullRequest[]>("list_assigned_prs");
      setPrs(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { prs, loading, error, fetch };
}
