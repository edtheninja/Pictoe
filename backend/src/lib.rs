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
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

pub use config::Config;
use error::{ApiError, ErrorBody};
use jobs::{CancelOutcome, JobStatus, JobStore};

/// Everything the job API recognises. This enum is the single source of truth for the names: the
/// handler parses with it and the OpenAPI spec lists it. Only `noop` runs today; the rest need a
/// real cloud model and are refused honestly until B3.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    /// Does nothing, for a moment. Exercises the job lifecycle (create, poll, cancel, expire).
    Noop,
    /// Cut out the main subject. Needs the cloud engine.
    SegmentSubject,
    /// Remove an object and fill in behind it. Needs the cloud engine.
    RemoveObject,
    /// Replace the sky. Needs the cloud engine.
    ReplaceSky,
    /// Extend the canvas past the photo's edges. Needs the cloud engine.
    ExpandCanvas,
}

#[derive(Clone)]
struct AppState {
    jobs: JobStore,
    noop_duration: Duration,
}

#[derive(Serialize, ToSchema)]
struct Health {
    #[schema(example = "ok")]
    status: &'static str,
    /// The service version.
    #[schema(example = "0.1.0")]
    version: &'static str,
}

#[derive(Serialize, ToSchema)]
struct JobView {
    id: Uuid,
    status: JobStatus,
}

#[derive(Deserialize, ToSchema)]
struct CreateJob {
    /// What to do. Parsed leniently so an unknown name gets a clear `unknown_operation` error
    /// instead of a generic JSON failure.
    #[schema(value_type = Operation)]
    operation: String,
}

/// The API contract. `backend/openapi.json` is generated from this and the editor's TypeScript
/// types are generated from that file, so Rust and TypeScript cannot drift apart silently.
#[derive(OpenApi)]
#[openapi(
    paths(health, create_job, get_job, cancel_job),
    components(schemas(
        Health,
        JobView,
        JobStatus,
        CreateJob,
        Operation,
        ErrorBody,
        error::ErrorDetail,
        error::ErrorCode
    )),
    modifiers(&ApiInfo),
    tags(
        (name = "service", description = "Is the service up?"),
        (name = "jobs", description = "Start, poll and cancel cloud jobs.")
    )
)]
pub struct ApiDoc;

struct ApiInfo;

impl utoipa::Modify for ApiInfo {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi.info.title = "Pictoe cloud gateway".into();
        openapi.info.version = env!("CARGO_PKG_VERSION").into();
        openapi.info.description = Some(
            "Optional cloud engine for Pictoe. The editor never depends on it: editing, undo and \
             export all run in the browser. Every error has the shape `{\"error\": {\"code\", \
             \"message\"}}`, except a `408` timeout, which has an empty body."
                .into(),
        );
    }
}

/// The OpenAPI document for this service.
pub fn openapi() -> utoipa::openapi::OpenApi {
    ApiDoc::openapi()
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
        .route("/openapi.json", get(|| async { Json(openapi()) }))
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

/// Is the service up?
#[utoipa::path(
    get,
    path = "/health",
    tag = "service",
    responses((status = 200, description = "The service is up.", body = Health))
)]
async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

fn parse_id(raw: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(raw).map_err(|_| ApiError::invalid_job_id())
}

/// Start a job. Returns at once with `202`; poll `GET /jobs/{id}` (see the `Location` header).
#[utoipa::path(
    post,
    path = "/jobs",
    tag = "jobs",
    request_body = CreateJob,
    responses(
        (status = 202, description = "Accepted. The job is queued.", body = JobView,
            headers(("Location" = String, description = "Where to poll: /jobs/{id}"))),
        (status = 400, description = "Not a JSON object with an `operation`, unreadable, or an unknown operation (`invalid_json`, `invalid_body`, `unknown_operation`).", body = ErrorBody),
        (status = 408, description = "The request took too long. Empty body."),
        (status = 413, description = "The request is too large (`payload_too_large`).", body = ErrorBody),
        (status = 501, description = "The operation needs the cloud engine, which isn't available yet (`cloud_engine_unavailable`).", body = ErrorBody),
        (status = 503, description = "Too many jobs are active (`too_many_jobs`). Retry after the number of seconds in `Retry-After`.", body = ErrorBody,
            headers(("Retry-After" = u32, description = "Seconds to wait before retrying")))
    )
)]
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

    // Parse with the enum so the names live in exactly one place.
    match serde_json::from_value::<Operation>(serde_json::Value::String(request.operation.clone()))
    {
        Ok(Operation::Noop) => {}
        Ok(_) => return Err(ApiError::cloud_engine_unavailable()),
        Err(_) => return Err(ApiError::unknown_operation(&request.operation)),
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

/// Check a job's status.
#[utoipa::path(
    get,
    path = "/jobs/{id}",
    tag = "jobs",
    params(("id" = Uuid, Path, description = "The job id returned by `POST /jobs`")),
    responses(
        (status = 200, description = "The job's current status.", body = JobView),
        (status = 400, description = "That isn't a valid job id (`invalid_job_id`).", body = ErrorBody),
        (status = 404, description = "No such job, or it has expired (`job_not_found`).", body = ErrorBody)
    )
)]
async fn get_job(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<JobView>, ApiError> {
    let id = parse_id(&raw)?;
    let status = state.jobs.status(id).ok_or_else(ApiError::job_not_found)?;
    Ok(Json(JobView { id, status }))
}

/// Cancel a job that hasn't finished.
#[utoipa::path(
    delete,
    path = "/jobs/{id}",
    tag = "jobs",
    params(("id" = Uuid, Path, description = "The job id returned by `POST /jobs`")),
    responses(
        (status = 204, description = "Cancelled."),
        (status = 400, description = "That isn't a valid job id (`invalid_job_id`).", body = ErrorBody),
        (status = 404, description = "No such job, or it has expired (`job_not_found`).", body = ErrorBody),
        (status = 409, description = "The job had already finished (`job_already_finished`).", body = ErrorBody)
    )
)]
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
