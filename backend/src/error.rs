use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Every error leaves the service in one shape: `{"error": {"code": "...", "message": "..."}}`.
/// Messages are written for people, in the same plain language as the editor.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    retry_after_secs: Option<u32>,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            retry_after_secs: None,
        }
    }

    pub fn invalid_json() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "invalid_json",
            "That request wasn't valid JSON with an `operation` field.",
        )
    }

    pub fn payload_too_large() -> Self {
        Self::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
            "That request is too large.",
        )
    }

    pub fn invalid_body() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "invalid_body",
            "That request couldn't be read.",
        )
    }

    pub fn unknown_operation(requested: &str) -> Self {
        // Echo a short, printable slice only; never reflect arbitrary input back verbatim.
        let shown: String = requested
            .chars()
            .filter(|c| !c.is_control())
            .take(40)
            .collect();
        Self::new(
            StatusCode::BAD_REQUEST,
            "unknown_operation",
            format!("Pictoe doesn't know the operation \"{shown}\"."),
        )
    }

    pub fn cloud_engine_unavailable() -> Self {
        Self::new(
            StatusCode::NOT_IMPLEMENTED,
            "cloud_engine_unavailable",
            "This tool needs Pictoe's cloud engine, which isn't available yet. Your current edits remain safe.",
        )
    }

    pub fn invalid_job_id() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "invalid_job_id",
            "That isn't a valid job id.",
        )
    }

    pub fn job_not_found() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "job_not_found",
            "That job doesn't exist or has expired.",
        )
    }

    pub fn job_already_finished() -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "job_already_finished",
            "That job has already finished.",
        )
    }

    pub fn too_many_jobs() -> Self {
        let mut e = Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "too_many_jobs",
            "The cloud engine is busy. Try again in a moment. Your current edits remain safe.",
        );
        e.retry_after_secs = Some(5);
        e
    }

    pub fn not_found() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "There's nothing at that address.",
        )
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(json!({ "error": { "code": self.code, "message": self.message } }));
        let mut response = (self.status, body).into_response();
        if let Some(secs) = self.retry_after_secs {
            if let Ok(value) = HeaderValue::from_str(&secs.to_string()) {
                response.headers_mut().insert(header::RETRY_AFTER, value);
            }
        }
        response
    }
}
