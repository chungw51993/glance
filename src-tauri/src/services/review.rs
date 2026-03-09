use crate::models::github::PullRequest;
use crate::models::review::{FileDiffContext, ReviewPrompt};
use crate::services::tickets::Ticket;

const MAX_DIFF_CHARS: usize = 100_000;

/// Build a ReviewPrompt from a PullRequest, collecting diffs from non-merge commits.
/// Truncates total diff content at MAX_DIFF_CHARS to stay within AI context limits.
pub fn build_review_prompt(pr: &PullRequest, tickets: &[Ticket]) -> ReviewPrompt {
    let mut diffs = Vec::new();
    let mut total_chars = 0usize;

    for commit in &pr.commits {
        if commit.is_trunk_merge {
            continue;
        }
        for file in &commit.files {
            if let Some(patch) = &file.patch {
                if total_chars + patch.len() > MAX_DIFF_CHARS {
                    break;
                }
                total_chars += patch.len();
                diffs.push(FileDiffContext {
                    path: file.path.clone(),
                    patch: patch.clone(),
                });
            }
        }
        if total_chars >= MAX_DIFF_CHARS {
            break;
        }
    }

    let ticket_context: Vec<String> = tickets
        .iter()
        .map(|t| {
            let desc = t.description.as_deref().unwrap_or("(no description)");
            format!("[{}] {}: {}\n{}", t.provider, t.identifier, t.title, desc)
        })
        .collect();

    ReviewPrompt {
        pr_title: pr.title.clone(),
        pr_author: pr.author.clone(),
        base_branch: pr.base_branch.clone(),
        head_branch: pr.head_branch.clone(),
        ticket_context,
        diffs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::github::{Commit, FileDiff, FileStatus};

    fn make_commit(message: &str, is_merge: bool, files: Vec<FileDiff>) -> Commit {
        Commit {
            sha: "abc123".into(),
            message: message.into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["p1".into()],
            is_trunk_merge: is_merge,
            ticket_prefix: None,
            files,
        }
    }

    fn make_file(path: &str, patch: &str) -> FileDiff {
        FileDiff {
            path: path.into(),
            status: FileStatus::Modified,
            additions: 1,
            deletions: 0,
            patch: Some(patch.into()),
        }
    }

    #[test]
    fn test_build_prompt_skips_merge_commits() {
        let pr = PullRequest {
            number: 1,
            title: "Test PR".into(),
            body: None,
            author: "dev".into(),
            base_branch: "main".into(),
            head_branch: "feature".into(),
            state: "open".into(),
            created_at: "".into(),
            updated_at: "".into(),
            commits: vec![
                make_commit("feat: add login", false, vec![make_file("a.rs", "+code")]),
                make_commit("Merge branch 'main'", true, vec![make_file("b.rs", "+merge")]),
            ],
            linear_tickets: vec![],
        };
        let prompt = build_review_prompt(&pr, &[]);
        assert_eq!(prompt.diffs.len(), 1);
        assert_eq!(prompt.diffs[0].path, "a.rs");
    }

    #[test]
    fn test_build_prompt_truncates_at_limit() {
        let big_patch = "x".repeat(MAX_DIFF_CHARS + 1);
        let pr = PullRequest {
            number: 1,
            title: "Big PR".into(),
            body: None,
            author: "dev".into(),
            base_branch: "main".into(),
            head_branch: "feature".into(),
            state: "open".into(),
            created_at: "".into(),
            updated_at: "".into(),
            commits: vec![
                make_commit("c1", false, vec![make_file("small.rs", "+ok")]),
                make_commit("c2", false, vec![make_file("big.rs", &big_patch)]),
            ],
            linear_tickets: vec![],
        };
        let prompt = build_review_prompt(&pr, &[]);
        assert_eq!(prompt.diffs.len(), 1);
        assert_eq!(prompt.diffs[0].path, "small.rs");
    }
}
