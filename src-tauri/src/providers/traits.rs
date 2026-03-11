use crate::models::provider::AiModelInfo;
use crate::models::review::{AiReviewSummary, ReviewPrompt};
use async_trait::async_trait;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AiError {
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("API error: {status} -- {message}")]
    Api { status: u16, message: String },
    #[error("Failed to parse AI response: {0}")]
    Parse(String),
    #[error("Auth failed -- check your API key")]
    Unauthorized,
}

impl serde::Serialize for AiError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn review(&self, prompt: &ReviewPrompt) -> Result<AiReviewSummary, AiError>;
    async fn test_connection(&self) -> Result<(), AiError>;
    fn list_models(&self) -> Vec<AiModelInfo>;
    fn max_context_tokens(&self) -> usize;
    fn name(&self) -> &str;
}

/// Build the system prompt used by all AI providers for code review.
pub fn review_system_prompt() -> String {
    r#"You are a Staff Engineer performing a production code review. This code will ship to real users. Your review carries the weight and responsibility of a senior technical leader who owns the quality bar for the entire engineering organization.

## Your Review Process

Before writing any findings, you MUST follow this process:

### Step 1: Absorb All Context
- Read EVERY ticket context entry provided. Understand the requirements, acceptance criteria, and intent behind the change before looking at code.
- Understand the PR title, branch names, and author to infer the scope and purpose of the change.

### Step 2: Deep Code Analysis
- Read through ALL file diffs completely before forming any opinions. Do not review file-by-file in isolation.
- Trace the data flow and control flow across files. Understand how the changes interact with each other.
- Consider what the code does at runtime, not just what it looks like statically.
- Look for what is NOT in the diff — missing error handling, missing validation, missing tests, missing edge cases.

### Step 3: Evaluate Against Production Standards
- **Correctness**: Does this code actually do what the ticket/PR description says? Are there logic errors, off-by-one mistakes, or race conditions?
- **Security**: SQL injection, XSS, CSRF, auth bypass, secrets exposure, insecure deserialization, SSRF. Flag anything that could be exploited.
- **Reliability**: What happens when things fail? Network errors, null/undefined values, disk full, timeout, concurrent access. Is error handling comprehensive or will failures cascade silently?
- **Performance**: N+1 queries, unbounded loops, missing pagination, large allocations, blocking the main thread, unnecessary re-renders.
- **Maintainability**: Will the next engineer understand this code in 6 months? Are abstractions appropriate (not too clever, not too verbose)?
- **Data integrity**: Are database operations atomic where needed? Can partial failures leave data in an inconsistent state?

### Step 4: Calibrate Severity Honestly
- **critical**: Will cause data loss, security vulnerability, crash in production, or silent corruption. Must be fixed before merge.
- **warning**: Likely to cause bugs under certain conditions, performance degradation at scale, or significant maintenance burden. Should be fixed before merge.
- **info**: Style improvements, minor refactors, or suggestions that would improve the code but are not blocking.

Do NOT inflate severity to seem thorough. Do NOT deflate severity to be polite. Be accurate.

## Output Format

Respond in this exact JSON format:
{
  "overall_assessment": "A concise but substantive summary (3-5 sentences). State whether this PR is ready to merge, needs minor fixes, or needs significant rework. Reference specific concerns.",
  "risk_level": "low|medium|high|critical",
  "findings": [
    {
      "file_path": "string",
      "start_line": 0,
      "end_line": 0,
      "severity": "info|warning|critical",
      "message": "Clear description of the issue with enough context that the author understands WHY it matters, not just WHAT is wrong.",
      "suggestion": "Concrete fix or approach. Show code when helpful. Null only if the fix is obvious from the message."
    }
  ],
  "recommendations": ["Prioritized list of actions. Most important first. Be specific — not 'add tests' but 'add a test for the case where X is null and Y has already been committed'."]
}

Only output valid JSON. No markdown fences."#
        .into()
}

/// Build the user message from a ReviewPrompt.
pub fn build_review_user_message(prompt: &ReviewPrompt) -> String {
    let mut msg = format!(
        "## Pull Request\nTitle: {}\nAuthor: {}\nBranch: {} <- {}\n\n",
        prompt.pr_title, prompt.pr_author, prompt.base_branch, prompt.head_branch
    );

    if !prompt.ticket_context.is_empty() {
        msg.push_str("## Ticket Context\n");
        for ctx in &prompt.ticket_context {
            msg.push_str(&format!("- {ctx}\n"));
        }
        msg.push('\n');
    }

    msg.push_str("## File Diffs\n\n");
    for diff in &prompt.diffs {
        msg.push_str(&format!("### {}\n```\n{}\n```\n\n", diff.path, diff.patch));
    }

    msg
}

/// Strip markdown code fences if the AI response is wrapped in them.
/// LLMs frequently ignore "no markdown fences" instructions, so we
/// handle it defensively at the parsing layer.
pub fn strip_markdown_fences(s: &str) -> &str {
    let trimmed = s.trim();
    let without_prefix = if let Some(rest) = trimmed.strip_prefix("```json") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("```") {
        rest
    } else {
        return trimmed;
    };
    let without_suffix = without_prefix
        .trim()
        .strip_suffix("```")
        .unwrap_or(without_prefix.trim());
    without_suffix.trim()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::review::FileDiffContext;

    #[test]
    fn test_system_prompt_contains_required_keywords() {
        let prompt = review_system_prompt();
        assert!(prompt.contains("code review"));
        assert!(prompt.contains("JSON"));
        assert!(prompt.contains("risk_level"));
        assert!(prompt.contains("Staff Engineer"));
        assert!(prompt.contains("ticket context"));
        assert!(prompt.contains("production"));
    }

    #[test]
    fn test_build_user_message_includes_all_sections() {
        let prompt = ReviewPrompt {
            pr_title: "Fix login".into(),
            pr_author: "dev".into(),
            base_branch: "main".into(),
            head_branch: "feature/login".into(),
            ticket_context: vec!["[Linear] CPT-123: Fix SSO login".into()],
            diffs: vec![FileDiffContext {
                path: "src/auth.rs".into(),
                patch: "+ fn login() {}".into(),
            }],
        };
        let msg = build_review_user_message(&prompt);
        assert!(msg.contains("Fix login"));
        assert!(msg.contains("[Linear] CPT-123"));
        assert!(msg.contains("src/auth.rs"));
        assert!(msg.contains("+ fn login() {}"));
    }

    #[test]
    fn test_strip_markdown_fences_json() {
        let input = "```json\n{\"key\": \"value\"}\n```";
        assert_eq!(strip_markdown_fences(input), "{\"key\": \"value\"}");
    }

    #[test]
    fn test_strip_markdown_fences_plain() {
        let input = "```\n{\"key\": \"value\"}\n```";
        assert_eq!(strip_markdown_fences(input), "{\"key\": \"value\"}");
    }

    #[test]
    fn test_strip_markdown_fences_none() {
        let input = "{\"key\": \"value\"}";
        assert_eq!(strip_markdown_fences(input), "{\"key\": \"value\"}");
    }

    #[test]
    fn test_build_user_message_without_ticket_context() {
        let prompt = ReviewPrompt {
            pr_title: "Refactor".into(),
            pr_author: "dev".into(),
            base_branch: "main".into(),
            head_branch: "refactor/cleanup".into(),
            ticket_context: vec![],
            diffs: vec![],
        };
        let msg = build_review_user_message(&prompt);
        assert!(!msg.contains("Ticket Context"));
    }
}
