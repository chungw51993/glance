use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearTicket {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub labels: Vec<String>,
    pub url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_ticket_serde_roundtrip() {
        let ticket = LinearTicket {
            id: "uuid-123".into(),
            identifier: "CPT-1234".into(),
            title: "Fix login bug".into(),
            description: Some("Users cannot log in with SSO".into()),
            state: "In Progress".into(),
            labels: vec!["bug".into(), "auth".into()],
            url: "https://linear.app/team/issue/CPT-1234".into(),
        };
        let json = serde_json::to_string(&ticket).unwrap();
        let deserialized: LinearTicket = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.identifier, "CPT-1234");
        assert_eq!(deserialized.labels.len(), 2);
    }

    #[test]
    fn test_linear_ticket_optional_description() {
        let ticket = LinearTicket {
            id: "uuid-456".into(),
            identifier: "DATA-567".into(),
            title: "Add dashboard".into(),
            description: None,
            state: "Todo".into(),
            labels: vec![],
            url: "https://linear.app/team/issue/DATA-567".into(),
        };
        let json = serde_json::to_string(&ticket).unwrap();
        let deserialized: LinearTicket = serde_json::from_str(&json).unwrap();
        assert!(deserialized.description.is_none());
    }
}
