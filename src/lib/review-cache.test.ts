import { describe, expect, it, beforeEach } from "vitest";
import { getReviewCache, updateReviewCache, getActiveReviewKey } from "./review-cache";

describe("review-cache", () => {
  beforeEach(() => {
    // Reset cache by writing a new entry with a throwaway key
    updateReviewCache({ prKey: "__reset__" });
  });

  it("returns null for non-matching key", () => {
    updateReviewCache({ prKey: "owner/repo/1" });
    expect(getReviewCache("owner/repo/999")).toBeNull();
  });

  it("returns entry for matching key", () => {
    updateReviewCache({ prKey: "owner/repo/1", selectedCommitIndex: 5 });
    const cached = getReviewCache("owner/repo/1");
    expect(cached).not.toBeNull();
    expect(cached!.selectedCommitIndex).toBe(5);
  });

  it("merges partial updates when key matches", () => {
    updateReviewCache({ prKey: "owner/repo/1", selectedCommitIndex: 3 });
    updateReviewCache({ prKey: "owner/repo/1", linearError: "oops" });
    const cached = getReviewCache("owner/repo/1");
    expect(cached!.selectedCommitIndex).toBe(3);
    expect(cached!.linearError).toBe("oops");
  });

  it("resets to defaults when key changes", () => {
    updateReviewCache({ prKey: "owner/repo/1", selectedCommitIndex: 5 });
    updateReviewCache({ prKey: "owner/repo/2" });
    const cached = getReviewCache("owner/repo/2");
    expect(cached!.selectedCommitIndex).toBe(0);
    expect(cached!.pr).toBeNull();
    expect(cached!.aiReview).toBeNull();
  });

  it("getActiveReviewKey returns current key", () => {
    updateReviewCache({ prKey: "owner/repo/42" });
    expect(getActiveReviewKey()).toBe("owner/repo/42");
  });
});
