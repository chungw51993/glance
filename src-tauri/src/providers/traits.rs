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
    r#"You are a senior code reviewer. Analyze the pull request and provide:
1. An overall assessment of code quality, correctness, and maintainability
2. A risk level (low, medium, high, critical)
3. Specific findings pinned to file paths and line numbers
4. Actionable recommendations

For each finding, specify:
- file_path: the file
- start_line / end_line: approximate line range in the diff
- severity: info, warning, or critical
- message: what the issue is
- suggestion: how to fix it (optional)

Respond in this exact JSON format:
{
  "overall_assessment": "string",
  "risk_level": "low|medium|high|critical",
  "findings": [
    {
      "file_path": "string",
      "start_line": 0,
      "end_line": 0,
      "severity": "info|warning|critical",
      "message": "string",
      "suggestion": "string or null"
    }
  ],
  "recommendations": ["string"]
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

    if !prompt.linear_context.is_empty() {
        msg.push_str("## Linear Tickets\n");
        for ctx in &prompt.linear_context {
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
    }

    #[test]
    fn test_build_user_message_includes_all_sections() {
        let prompt = ReviewPrompt {
            pr_title: "Fix login".into(),
            pr_author: "dev".into(),
            base_branch: "main".into(),
            head_branch: "feature/login".into(),
            linear_context: vec!["CPT-123: Fix SSO login".into()],
            diffs: vec![FileDiffContext {
                path: "src/auth.rs".into(),
                patch: "+ fn login() {}".into(),
            }],
        };
        let msg = build_review_user_message(&prompt);
        assert!(msg.contains("Fix login"));
        assert!(msg.contains("CPT-123"));
        assert!(msg.contains("src/auth.rs"));
        assert!(msg.contains("+ fn login() {}"));
    }

    #[test]
    fn test_build_user_message_without_linear_context() {
        let prompt = ReviewPrompt {
            pr_title: "Refactor".into(),
            pr_author: "dev".into(),
            base_branch: "main".into(),
            head_branch: "refactor/cleanup".into(),
            linear_context: vec![],
            diffs: vec![],
        };
        let msg = build_review_user_message(&prompt);
        assert!(!msg.contains("Linear Tickets"));
    }
}
