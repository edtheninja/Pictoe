//! Integration tests: the real router, driven in-process. Time is paused, so job durations and
//! expiry are exact and the suite is fast and never flaky.

use std::time::Duration;

use axum::{
    body::Body,
    http::{header, HeaderMap, Method, Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use pictoe_api::{app, Config};
use serde_json::Value;
use tower::ServiceExt;

const ORIGIN: &str = "http://localhost:8080";

fn config() -> Config {
    Config {
        noop_duration: Duration::from_millis(200),
        allowed_origins: vec![ORIGIN.to_string()],
        ..Config::default()
    }
}

async fn call(app: &Router, request: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    let bytes = body.collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (parts.status, parts.headers, json)
}

fn post_job(body: &str) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri("/jobs")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn noop() -> Request<Body> {
    post_job(r#"{"operation":"noop"}"#)
}

fn request(method: Method, uri: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .body(Body::empty())
        .unwrap()
}

async fn create(app: &Router) -> String {
    let (status, _, body) = call(app, noop()).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    body["id"].as_str().unwrap().to_string()
}

async fn status_of(app: &Router, id: &str) -> (StatusCode, Value) {
    let (status, _, body) = call(app, request(Method::GET, &format!("/jobs/{id}"))).await;
    (status, body)
}

/// Lets spawned job tasks run, then moves the paused clock forward.
async fn pass(ms: u64) {
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(ms)).await;
    tokio::task::yield_now().await;
}

fn code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or_default()
}

#[tokio::test]
async fn health_reports_ok_and_a_version() {
    let app = app(config());
    let (status, _, body) = call(&app, request(Method::GET, "/health")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert!(body["version"].as_str().is_some_and(|v| !v.is_empty()));
}

#[tokio::test(start_paused = true)]
async fn a_job_goes_from_queued_to_running_to_done() {
    let app = app(config());
    let (status, headers, body) = call(&app, noop()).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["status"], "queued");
    let id = body["id"].as_str().unwrap().to_string();
    assert_eq!(headers[header::LOCATION], format!("/jobs/{id}"));

    tokio::task::yield_now().await;
    assert_eq!(status_of(&app, &id).await.1["status"], "running");

    pass(250).await;
    let (status, body) = status_of(&app, &id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "done");
}

#[tokio::test(start_paused = true)]
async fn cancelling_a_running_job_stops_it_for_good() {
    let app = app(config());
    let id = create(&app).await;
    tokio::task::yield_now().await;

    let (status, _, _) = call(&app, request(Method::DELETE, &format!("/jobs/{id}"))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(status_of(&app, &id).await.1["status"], "cancelled");

    pass(1000).await; // the aborted work must not flip it to "done"
    assert_eq!(status_of(&app, &id).await.1["status"], "cancelled");
}

#[tokio::test(start_paused = true)]
async fn a_finished_job_cannot_be_cancelled() {
    let app = app(config());
    let id = create(&app).await;
    pass(250).await;

    let (status, _, body) = call(&app, request(Method::DELETE, &format!("/jobs/{id}"))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(code(&body), "job_already_finished");
    assert_eq!(status_of(&app, &id).await.1["status"], "done");
}

#[tokio::test]
async fn unknown_and_malformed_job_ids_are_handled() {
    let app = app(config());
    let missing = "00000000-0000-4000-8000-000000000000";
    for method in [Method::GET, Method::DELETE] {
        let (status, _, body) = call(&app, request(method, &format!("/jobs/{missing}"))).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(code(&body), "job_not_found");
    }
    let (status, _, body) = call(&app, request(Method::GET, "/jobs/not-a-uuid")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(code(&body), "invalid_job_id");
}

#[tokio::test]
async fn cloud_only_operations_are_refused_honestly() {
    let app = app(config());
    for op in [
        "segment_subject",
        "remove_object",
        "replace_sky",
        "expand_canvas",
    ] {
        let (status, _, body) = call(&app, post_job(&format!(r#"{{"operation":"{op}"}}"#))).await;
        assert_eq!(status, StatusCode::NOT_IMPLEMENTED, "{op}");
        assert_eq!(code(&body), "cloud_engine_unavailable");
        assert!(body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("edits remain safe"));
    }
}

#[tokio::test]
async fn bad_requests_get_a_clear_error() {
    let app = app(config());

    let (status, _, body) = call(&app, post_job(r#"{"operation":"make_it_pop"}"#)).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "unknown_operation")
    );

    for broken in ["", "not json", "{}", r#"{"operation": 5}"#, r#"["noop"]"#] {
        let (status, _, body) = call(&app, post_job(broken)).await;
        assert_eq!(
            (status, code(&body)),
            (StatusCode::BAD_REQUEST, "invalid_json"),
            "{broken:?}"
        );
    }
}

#[tokio::test]
async fn an_unknown_operation_name_is_never_reflected_unsafely() {
    let app = app(config());
    let nasty = format!("a\u{7}b\u{1b}[31m{}", "x".repeat(500));
    let body = serde_json::json!({ "operation": nasty }).to_string();
    let (_, _, response) = call(&app, post_job(&body)).await;
    let message = response["error"]["message"].as_str().unwrap();
    assert!(message.len() < 120, "message was {} bytes", message.len());
    assert!(!message.chars().any(|c| c.is_control()));
}

#[tokio::test]
async fn oversized_requests_are_rejected_with_the_standard_error() {
    let app = app(Config {
        max_body_bytes: 1024,
        ..config()
    });
    let big = format!(r#"{{"operation":"noop","padding":"{}"}}"#, "x".repeat(2000));
    let (status, _, body) = call(&app, post_job(&big)).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(code(&body), "payload_too_large");
}

#[tokio::test]
async fn unknown_routes_use_the_standard_error_shape() {
    let app = app(config());
    let (status, _, body) = call(&app, request(Method::GET, "/nope")).await;
    assert_eq!((status, code(&body)), (StatusCode::NOT_FOUND, "not_found"));
    assert!(body["error"]["message"].is_string());
}

#[tokio::test]
async fn only_listed_origins_get_cors_headers() {
    let app = app(config());

    let allowed = Request::builder()
        .uri("/health")
        .header(header::ORIGIN, ORIGIN)
        .body(Body::empty())
        .unwrap();
    let (_, headers, _) = call(&app, allowed).await;
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], ORIGIN);

    let stranger = Request::builder()
        .uri("/health")
        .header(header::ORIGIN, "https://evil.example")
        .body(Body::empty())
        .unwrap();
    let (status, headers, _) = call(&app, stranger).await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
}

#[tokio::test]
async fn preflight_is_answered_for_listed_origins_only() {
    let app = app(config());
    let preflight = |origin: &str| {
        Request::builder()
            .method(Method::OPTIONS)
            .uri("/jobs")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
            .body(Body::empty())
            .unwrap()
    };

    let (status, headers, _) = call(&app, preflight(ORIGIN)).await;
    assert!(status.is_success());
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], ORIGIN);
    assert!(headers[header::ACCESS_CONTROL_ALLOW_METHODS]
        .to_str()
        .unwrap()
        .contains("POST"));

    let (_, headers, _) = call(&app, preflight("https://evil.example")).await;
    assert!(headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
}

#[tokio::test]
async fn errors_carry_cors_headers_too() {
    let app = app(config());
    let request = Request::builder()
        .method(Method::GET)
        .uri("/jobs/not-a-uuid")
        .header(header::ORIGIN, ORIGIN)
        .body(Body::empty())
        .unwrap();
    let (status, headers, _) = call(&app, request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], ORIGIN);
}

#[tokio::test(start_paused = true)]
async fn the_active_job_limit_is_enforced_and_frees_up() {
    let app = app(Config {
        max_jobs: 2,
        ..config()
    });
    let first = create(&app).await;
    create(&app).await;

    let (status, headers, body) = call(&app, noop()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(code(&body), "too_many_jobs");
    assert_eq!(headers[header::RETRY_AFTER], "5");

    // Cancelling one frees a slot straight away.
    call(&app, request(Method::DELETE, &format!("/jobs/{first}"))).await;
    create(&app).await;
}

#[tokio::test(start_paused = true)]
async fn finished_jobs_do_not_block_new_work() {
    let app = app(Config {
        max_jobs: 2,
        ..config()
    });
    create(&app).await;
    create(&app).await;
    pass(300).await; // both done
    for _ in 0..5 {
        create(&app).await; // would hit the limit if finished jobs counted against it
        pass(300).await;
    }
}

#[tokio::test(start_paused = true)]
async fn finished_jobs_are_forgotten_after_the_ttl() {
    let app = app(Config {
        finished_job_ttl: Duration::from_secs(1),
        ..config()
    });
    let id = create(&app).await;
    pass(250).await;
    assert_eq!(status_of(&app, &id).await.0, StatusCode::OK);

    pass(2000).await;
    let (status, body) = status_of(&app, &id).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(code(&body), "job_not_found");
}
