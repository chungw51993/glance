use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub default_branch: String,
    pub open_pr_count: u32,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub author: String,
    pub base_branch: String,
    pub head_branch: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub commits: Vec<Commit>,
    pub linear_tickets: Vec<crate::services::tickets::Ticket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
    pub parents: Vec<String>,
    pub is_trunk_merge: bool,
    pub ticket_prefix: Option<String>,
    pub files: Vec<FileDiff>,
}

impl Commit {
    pub fn has_multiple_parents(&self) -> bool {
        self.parents.len() > 1
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub patch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Removed,
    Renamed,
}

impl FileStatus {
    pub fn as_str(&self) -> &str {
        match self {
            FileStatus::Added => "added",
            FileStatus::Modified => "modified",
            FileStatus::Removed => "removed",
            FileStatus::Renamed => "renamed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssignmentSource {
    Direct,
    Team,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignedPullRequest {
    pub repo_owner: String,
    pub repo_name: String,
    pub repo_full_name: String,
    pub number: u64,
    pub title: String,
    pub author: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub assignment_source: AssignmentSource,
    pub team_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commit_has_multiple_parents() {
        let commit = Commit {
            sha: "abc123".into(),
            message: "Merge branch 'main' into feature".into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["parent1".into(), "parent2".into()],
            is_trunk_merge: false,
            ticket_prefix: None,
            files: vec![],
        };
        assert!(commit.has_multiple_parents());
    }

    #[test]
    fn test_commit_single_parent() {
        let commit = Commit {
            sha: "abc123".into(),
            message: "feat: add login".into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["parent1".into()],
            is_trunk_merge: false,
            ticket_prefix: None,
            files: vec![],
        };
        assert!(!commit.has_multiple_parents());
    }

    #[test]
    fn test_file_status_display() {
        assert_eq!(FileStatus::Added.as_str(), "added");
        assert_eq!(FileStatus::Modified.as_str(), "modified");
        assert_eq!(FileStatus::Removed.as_str(), "removed");
        assert_eq!(FileStatus::Renamed.as_str(), "renamed");
    }

    #[test]
    fn test_repo_serde_roundtrip() {
        let repo = Repo {
            owner: "acme".into(),
            name: "widget".into(),
            full_name: "acme/widget".into(),
            default_branch: "main".into(),
            open_pr_count: 3,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&repo).unwrap();
        let deserialized: Repo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.full_name, "acme/widget");
        assert_eq!(deserialized.open_pr_count, 3);
    }

    #[test]
    fn test_file_status_serde() {
        let diff = FileDiff {
            path: "src/main.rs".into(),
            status: FileStatus::Added,
            additions: 10,
            deletions: 0,
            patch: Some("+fn main() {}".into()),
        };
        let json = serde_json::to_string(&diff).unwrap();
        assert!(json.contains("\"added\""));
        let deserialized: FileDiff = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.path, "src/main.rs");
    }
}
