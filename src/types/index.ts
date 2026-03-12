export interface Repo {
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  open_pr_count: number;
  updated_at: string;
}

export type AssignmentSource = "direct" | "team";

export interface AssignedPullRequest {
  repo_owner: string;
  repo_name: string;
  repo_full_name: string;
  number: number;
  title: string;
  author: string;
  state: string;
  created_at: string;
  updated_at: string;
  assignment_source: AssignmentSource;
  team_name: string | null;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  base_branch: string;
  head_branch: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  parents: string[];
  is_trunk_merge: boolean;
  ticket_prefix: string | null;
  files: FileDiff[];
}

export interface FileDiff {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface Ticket {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  url: string;
  provider: string;
}

export interface PullRequestDetail {
  number: number;
  title: string;
  body: string | null;
  author: string;
  base_branch: string;
  head_branch: string;
  state: string;
  created_at: string;
  updated_at: string;
  commits: Commit[];
  linear_tickets: Ticket[];
}

export interface AiAnnotation {
  file_path: string;
  start_line: number;
  end_line: number;
  severity: "info" | "warning" | "critical";
  message: string;
  suggestion: string | null;
}

export interface AiReviewSummary {
  overall_assessment: string;
  risk_level: "low" | "medium" | "high" | "critical";
  findings: AiAnnotation[];
  recommendations: string[];
}

export type AiProviderType = "anthropic" | "openai" | "ollama";

export interface AiModelInfo {
  id: string;
  name: string;
  max_context_tokens: number;
}

export interface ProviderConfig {
  provider_type: AiProviderType;
  model_id: string;
}

export interface DraftComment {
  id: string;
  file_path: string;
  line: number;
  start_line?: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface PrReviewSubmission {
  event: ReviewEvent;
  body: string;
  comments: DraftComment[];
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
}

export interface CombinedCheckStatus {
  state: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  checks: CheckRun[];
}

export type MergeMethod = "merge" | "squash" | "rebase";

export interface MergeStatus {
  mergeable: boolean;
  mergeable_state: string;
}
