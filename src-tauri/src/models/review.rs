use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnnotation {
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub severity: Severity,
    pub message: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiReviewSummary {
    pub overall_assessment: String,
    pub risk_level: RiskLevel,
    pub findings: Vec<AiAnnotation>,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewPrompt {
    pub pr_title: String,
    pub pr_author: String,
    pub base_branch: String,
    pub head_branch: String,
    pub linear_context: Vec<String>,
    pub diffs: Vec<FileDiffContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffContext {
    pub path: String,
    pub patch: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_severity_serde() {
        let json = serde_json::to_string(&Severity::Critical).unwrap();
        assert_eq!(json, "\"critical\"");
        let deserialized: Severity = serde_json::from_str("\"warning\"").unwrap();
        assert!(matches!(deserialized, Severity::Warning));
    }

    #[test]
    fn test_risk_level_serde() {
        let json = serde_json::to_string(&RiskLevel::High).unwrap();
        assert_eq!(json, "\"high\"");
        let deserialized: RiskLevel = serde_json::from_str("\"low\"").unwrap();
        assert!(matches!(deserialized, RiskLevel::Low));
    }

    #[test]
    fn test_ai_review_summary_roundtrip() {
        let summary = AiReviewSummary {
            overall_assessment: "Code looks good overall".into(),
            risk_level: RiskLevel::Low,
            findings: vec![AiAnnotation {
                file_path: "src/auth.rs".into(),
                start_line: 10,
                end_line: 15,
                severity: Severity::Warning,
                message: "Missing error handling".into(),
                suggestion: Some("Add a match on the Result".into()),
            }],
            recommendations: vec!["Add tests for edge cases".into()],
        };
        let json = serde_json::to_string(&summary).unwrap();
        let deserialized: AiReviewSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.findings.len(), 1);
        assert_eq!(deserialized.recommendations.len(), 1);
    }

    #[test]
    fn test_review_prompt_roundtrip() {
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
        let json = serde_json::to_string(&prompt).unwrap();
        let deserialized: ReviewPrompt = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.diffs.len(), 1);
    }
}
