use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

/// Machine-readable error codes. This enum is the single source of truth: the JSON the service
/// sends, the OpenAPI spec and the editor's generated TypeScript type all come from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidJson,
    PayloadTooLarge,
    InvalidBody,
    UnknownOperation,
    CloudEngineUnavailable,
    InvalidJobId,
    JobNotFound,
    JobAlreadyFinished,
    TooManyJobs,
    NotFound,
}

impl ErrorCode {
    /// The wire name. A test checks this matches what serde writes, so the two cannot drift.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidJson => "invalid_json",
            Self::PayloadTooLarge => "payload_too_large",
            Self::InvalidBody => "invalid_body",
            Self::UnknownOperation => "unknown_operation",
            Self::CloudEngineUnavailable => "cloud_engine_unavailable",
            Self::InvalidJobId => "invalid_job_id",
            Self::JobNotFound => "job_not_found",
            Self::JobAlreadyFinished => "job_already_finished",
            Self::TooManyJobs => "too_many_jobs",
            Self::NotFound => "not_found",
        }
    }
}

/// What went wrong, for the editor to act on and for a person to read.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorDetail {
    pub code: ErrorCode,
    /// Plain-language explanation, safe to show to a user.
    pub message: String,
}

/// Every error leaves the service in this one shape: `{"error": {"code": "...", "message": "..."}}`.
/// Messages are written for people, in the same plain language as the editor.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: ErrorDetail,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: ErrorCode,
    message: String,
    retry_after_secs: Option<u32>,
}

impl ApiError {
    fn new(status: StatusCode, code: ErrorCode, message: impl Into<String>) -> Self {
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
            ErrorCode::InvalidJson,
            "That request wasn't valid JSON with an `operation` field.",
        )
    }

    pub fn payload_too_large() -> Self {
        Self::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::PayloadTooLarge,
            "That request is too large.",
        )
    }

    pub fn invalid_body() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidBody,
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
            ErrorCode::UnknownOperation,
            format!("Pictoe doesn't know the operation \"{shown}\"."),
        )
    }

    pub fn cloud_engine_unavailable() -> Self {
        Self::new(
            StatusCode::NOT_IMPLEMENTED,
            ErrorCode::CloudEngineUnavailable,
            "This tool needs Pictoe's cloud engine, which isn't available yet. Your current edits remain safe.",
        )
    }

    pub fn invalid_job_id() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidJobId,
            "That isn't a valid job id.",
        )
    }

    pub fn job_not_found() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            ErrorCode::JobNotFound,
            "That job doesn't exist or has expired.",
        )
    }

    pub fn job_already_finished() -> Self {
        Self::new(
            StatusCode::CONFLICT,
            ErrorCode::JobAlreadyFinished,
            "That job has already finished.",
        )
    }

    pub fn too_many_jobs() -> Self {
        let mut e = Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::TooManyJobs,
            "The cloud engine is busy. Try again in a moment. Your current edits remain safe.",
        );
        e.retry_after_secs = Some(5);
        e
    }

    pub fn not_found() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            ErrorCode::NotFound,
            "There's nothing at that address.",
        )
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn code(&self) -> &'static str {
        self.code.as_str()
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(ErrorBody {
            error: ErrorDetail {
                code: self.code,
                message: self.message,
            },
        });
        let mut response = (self.status, body).into_response();
        if let Some(secs) = self.retry_after_secs {
            if let Ok(value) = HeaderValue::from_str(&secs.to_string()) {
                response.headers_mut().insert(header::RETRY_AFTER, value);
            }
        }
        response
    }
}
