//! Keeps the API contract honest. `openapi.json` is generated from the Rust types and the editor's
//! TypeScript types are generated from that file, so these tests make sure the file is current
//! and that what the service really does matches what the file says.

use std::{collections::BTreeSet, time::Duration};

use axum::{
    body::Body,
    http::{header, HeaderMap, Method, Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use pictoe_api::{app, error::ErrorCode, openapi, Config};
use serde_json::Value;
use tower::ServiceExt;

fn spec() -> Value {
    serde_json::to_value(openapi()).expect("the spec serializes")
}

/// Every `ErrorCode`. The `match` makes the compiler complain if a variant is added and not listed.
fn all_error_codes() -> Vec<ErrorCode> {
    use ErrorCode::*;
    let _exhaustive = |c: ErrorCode| match c {
        InvalidJson
        | PayloadTooLarge
        | InvalidBody
        | UnknownOperation
        | CloudEngineUnavailable
        | InvalidJobId
        | JobNotFound
        | JobAlreadyFinished
        | TooManyJobs
        | NotFound => (),
    };
    vec![
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
    ]
}

fn strings(v: &Value) -> BTreeSet<String> {
    v.as_array()
        .expect("an array of strings")
        .iter()
        .map(|s| s.as_str().expect("a string").to_string())
        .collect()
}

#[test]
fn the_committed_spec_is_up_to_date() {
    let committed: Value = serde_json::from_str(include_str!("../openapi.json"))
        .expect("backend/openapi.json is valid JSON");
    assert!(
        committed == spec(),
        "backend/openapi.json is out of date. Regenerate it with:\n    \
         cd backend && cargo run --example openapi > openapi.json\n\
         then regenerate the editor's types with `npm run api:types`."
    );
}

#[tokio::test]
async fn the_running_service_serves_the_same_spec() {
    let router = app(Config::default());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), spec());
}

#[test]
fn error_code_names_match_what_serde_writes() {
    for code in all_error_codes() {
        assert_eq!(
            serde_json::to_value(code).unwrap(),
            Value::String(code.as_str().to_string())
        );
    }
}

#[test]
fn the_spec_lists_exactly_the_error_codes_the_service_can_send() {
    let spec = spec();
    let listed = strings(&spec["components"]["schemas"]["ErrorCode"]["enum"]);
    let real: BTreeSet<String> = all_error_codes()
        .into_iter()
        .map(|c| c.as_str().to_string())
        .collect();
    assert_eq!(listed, real);
}

// ---- What the service really does, checked against what the spec documents ----

async fn call(router: &Router, request: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    let bytes = body.collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (parts.status, parts.headers, json)
}

fn req(method: Method, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Sends real requests and checks every (method, path, status) that comes back is documented,
/// that every documented status was seen (so the spec doesn't over-promise), that error bodies
/// have the documented shape with a documented code, and that the documented headers are present.
/// `408` (request timeout) is documented but not provoked here.
#[tokio::test(start_paused = true)]
async fn the_service_behaves_as_the_spec_says() {
    let router = app(Config {
        max_jobs: 1,
        max_body_bytes: 64,
        noop_duration: Duration::from_millis(200),
        ..Config::default()
    });
    let spec = spec();
    let codes = strings(&spec["components"]["schemas"]["ErrorCode"]["enum"]);
    let random = "7d1f1f6e-6a58-4a5e-9a6b-0d5b0f8d3c11";

    // Start a job first so later requests can refer to it.
    let (status, headers, body) = call(
        &router,
        req(Method::POST, "/jobs", r#"{"operation":"noop"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let id = body["id"].as_str().unwrap().to_string();
    assert_eq!(headers[header::LOCATION], format!("/jobs/{id}").as_str());
    let job_path = format!("/jobs/{id}");

    let oversized = format!(r#"{{"operation":"{}"}}"#, "x".repeat(100));
    // (method, spec path, request path, body)
    let cases: Vec<(Method, &str, String, String)> = vec![
        (Method::GET, "/health", "/health".into(), String::new()),
        (
            Method::POST,
            "/jobs",
            "/jobs".into(),
            r#"{"operation":"noop"}"#.into(),
        ), // 503: cap is 1
        (Method::POST, "/jobs", "/jobs".into(), "not json".into()),
        (
            Method::POST,
            "/jobs",
            "/jobs".into(),
            r#"{"operation":"bogus"}"#.into(),
        ),
        (
            Method::POST,
            "/jobs",
            "/jobs".into(),
            r#"{"operation":"remove_object"}"#.into(),
        ),
        (Method::POST, "/jobs", "/jobs".into(), oversized),
        (Method::GET, "/jobs/{id}", job_path.clone(), String::new()),
        (
            Method::GET,
            "/jobs/{id}",
            "/jobs/not-a-uuid".into(),
            String::new(),
        ),
        (
            Method::GET,
            "/jobs/{id}",
            format!("/jobs/{random}"),
            String::new(),
        ),
        (
            Method::DELETE,
            "/jobs/{id}",
            job_path.clone(),
            String::new(),
        ), // 204
        (
            Method::DELETE,
            "/jobs/{id}",
            job_path.clone(),
            String::new(),
        ), // 409
        (
            Method::DELETE,
            "/jobs/{id}",
            "/jobs/not-a-uuid".into(),
            String::new(),
        ),
        (
            Method::DELETE,
            "/jobs/{id}",
            format!("/jobs/{random}"),
            String::new(),
        ),
    ];

    // The first POST above already produced a 202.
    let mut seen: BTreeSet<(String, String, u16)> =
        BTreeSet::from([("post".into(), "/jobs".into(), 202)]);

    for (method, spec_path, path, body) in cases {
        let (status, headers, json) = call(&router, req(method.clone(), &path, &body)).await;
        let key = (
            method.as_str().to_lowercase(),
            spec_path.to_string(),
            status.as_u16(),
        );
        let documented = &spec["paths"][spec_path][&key.0]["responses"][status.as_str()];
        assert!(
            !documented.is_null(),
            "{} {} answered {} but the spec does not document that",
            method,
            spec_path,
            status
        );

        // Documented error bodies: the standard shape, with a documented code.
        let schema_ref = documented["content"]["application/json"]["schema"]["$ref"].as_str();
        if schema_ref == Some("#/components/schemas/ErrorBody") {
            let code = json["error"]["code"].as_str().unwrap_or_default();
            assert!(
                codes.contains(code),
                "{} {} sent undocumented code {:?}",
                method,
                spec_path,
                code
            );
            assert!(
                json["error"]["message"]
                    .as_str()
                    .is_some_and(|m| !m.is_empty()),
                "{} {} sent no message",
                method,
                spec_path
            );
        }
        // Documented headers are really sent.
        if let Some(documented_headers) = documented["headers"].as_object() {
            for name in documented_headers.keys() {
                assert!(
                    headers.contains_key(name.to_lowercase().as_str()),
                    "{} {} {} is missing documented header {}",
                    method,
                    spec_path,
                    status,
                    name
                );
            }
        }
        seen.insert(key);
    }

    // Everything documented was observed, except the timeout.
    let mut missing = Vec::new();
    for (path, ops) in spec["paths"].as_object().unwrap() {
        for (method, op) in ops.as_object().unwrap() {
            for status in op["responses"].as_object().unwrap().keys() {
                let code: u16 = status.parse().unwrap();
                if code != 408 && !seen.contains(&(method.clone(), path.clone(), code)) {
                    missing.push(format!("{} {} {}", method, path, code));
                }
            }
        }
    }
    assert!(
        missing.is_empty(),
        "documented but never produced: {missing:?}"
    );
}
