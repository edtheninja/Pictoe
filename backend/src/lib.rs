//! Pictoe's optional cloud gateway (B0 spike).
//!
//! The editor never depends on this service: editing, undo and export all run in the browser.
//! This only exists for operations that cannot, behind a small job API. It deliberately contains
//! no fake AI. Cloud-only operations are recognised and refused with an honest message, exactly
//! as the editor's Intent Bar already does, and only the harmless `noop` operation exercises the
//! job lifecycle (create, poll, cancel, expire).

pub mod config;
pub mod error;
pub mod jobs;

use std::time::Duration;

use axum::{
    body::Bytes,
    extract::{rejection::BytesRejection, DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::{
    classify::ServerErrorsFailureClass,
    cors::{AllowOrigin, CorsLayer},
    timeout::TimeoutLayer,
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::Level;
use uuid::Uuid;

pub use config::Config;
use error::ApiError;
use jobs::{CancelOutcome, JobStatus, JobStore};

/// Operations that need a real cloud model. Recognised, but not available yet.
const CLOUD_ONLY: &[&str] = &[
    "segment_subject",
    "remove_object",
    "replace_sky",
    "expand_canvas",
];

#[derive(Clone)]
struct AppState {
    jobs: JobStore,
    noop_duration: Duration,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct JobView {
    id: Uuid,
    status: JobStatus,
}

#[derive(Deserialize)]
struct CreateJob {
    operation: String,
}

pub fn app(config: Config) -> Router {
    let origins: Vec<HeaderValue> = config
        .allowed_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE])
        .max_age(Duration::from_secs(600));

    // Method, path, status and timing are logged. Request bodies never are.
    let trace = TraceLayer::new_for_http()
        .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
        .on_response(DefaultOnResponse::new().level(Level::INFO))
        .on_failure(log_failure);

    let state = AppState {
        jobs: JobStore::new(config.max_jobs, config.finished_job_ttl),
        noop_duration: config.noop_duration,
    };

    Router::new()
        .route("/health", get(health))
        .route("/jobs", axum::routing::post(create_job))
        .route("/jobs/{id}", get(get_job).delete(cancel_job))
        .fallback(|| async { ApiError::not_found() })
        .layer(DefaultBodyLimit::max(config.max_body_bytes))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            config.request_timeout,
        ))
        // CORS sits outside everything so even error responses carry the right headers.
        .layer(cors)
        .layer(trace)
        .with_state(state)
}

/// 5xx responses are only errors worth paging on when they are *unexpected*. A refusal because
/// the cloud engine isn't available (501) or because the service is at capacity (503) is the API
/// working as designed, so those are warnings; anything else stays at ERROR.
fn log_failure(class: ServerErrorsFailureClass, latency: Duration, _span: &tracing::Span) {
    let ms = latency.as_millis();
    match class {
        ServerErrorsFailureClass::StatusCode(status)
            if status == StatusCode::NOT_IMPLEMENTED
                || status == StatusCode::SERVICE_UNAVAILABLE =>
        {
            tracing::warn!(%status, latency_ms = %ms, "request refused");
        }
        other => tracing::error!(classification = %other, latency_ms = %ms, "request failed"),
    }
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

fn parse_id(raw: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(raw).map_err(|_| ApiError::invalid_job_id())
}

async fn create_job(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Result<(StatusCode, HeaderMap, Json<JobView>), ApiError> {
    let bytes = body.map_err(|rejection| {
        if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::payload_too_large()
        } else {
            ApiError::invalid_body()
        }
    })?;
    // Require a JSON object. Serde would otherwise also fill the struct from a bare list like
    // ["noop"], which is not what this API means to accept.
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| ApiError::invalid_json())?;
    if !value.is_object() {
        return Err(ApiError::invalid_json());
    }
    let request: CreateJob = serde_json::from_value(value).map_err(|_| ApiError::invalid_json())?;

    match request.operation.as_str() {
        "noop" => {}
        op if CLOUD_ONLY.contains(&op) => return Err(ApiError::cloud_engine_unavailable()),
        other => return Err(ApiError::unknown_operation(other)),
    }

    let id = state
        .jobs
        .create(state.noop_duration)
        .map_err(|_| ApiError::too_many_jobs())?;

    let mut headers = HeaderMap::new();
    if let Ok(location) = HeaderValue::from_str(&format!("/jobs/{id}")) {
        headers.insert(header::LOCATION, location);
    }
    Ok((
        StatusCode::ACCEPTED,
        headers,
        Json(JobView {
            id,
            status: JobStatus::Queued,
        }),
    ))
}

async fn get_job(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<JobView>, ApiError> {
    let id = parse_id(&raw)?;
    let status = state.jobs.status(id).ok_or_else(ApiError::job_not_found)?;
    Ok(Json(JobView { id, status }))
}

async fn cancel_job(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<StatusCode, ApiError> {
    match state.jobs.cancel(parse_id(&raw)?) {
        CancelOutcome::Cancelled => Ok(StatusCode::NO_CONTENT),
        CancelOutcome::AlreadyFinished => Err(ApiError::job_already_finished()),
        CancelOutcome::NotFound => Err(ApiError::job_not_found()),
    }
}
