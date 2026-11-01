//! The container health probe: healthy only when the service really answers `200` on `/health`.

use std::{net::SocketAddr, time::Duration};

use pictoe_api::{
    app,
    probe::{health_probe, probe_target},
    Config,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const LIMIT: Duration = Duration::from_secs(2);

async fn serve_real_app() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app(Config::default())).await.unwrap() });
    addr
}

/// A server that answers every connection with the given raw bytes.
async fn serve_raw(response: &'static [u8]) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 512];
            let _ = socket.read(&mut buffer).await;
            let _ = socket.write_all(response).await;
        }
    });
    addr
}

#[tokio::test]
async fn a_running_service_is_healthy() {
    assert!(health_probe(serve_real_app().await, LIMIT).await);
}

#[tokio::test]
async fn nothing_listening_is_unhealthy() {
    let closed = {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        listener.local_addr().unwrap() // dropped here, so the port is free
    };
    assert!(!health_probe(closed, LIMIT).await);
}

#[tokio::test]
async fn an_error_status_is_unhealthy() {
    let addr = serve_raw(b"HTTP/1.1 500 Internal Server Error\r\n\r\n").await;
    assert!(!health_probe(addr, LIMIT).await);
    let addr = serve_raw(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
    assert!(!health_probe(addr, LIMIT).await);
}

#[tokio::test]
async fn garbage_is_unhealthy() {
    assert!(!health_probe(serve_raw(b"not http at all, just words").await, LIMIT).await);
    assert!(!health_probe(serve_raw(b"").await, LIMIT).await);
}

#[tokio::test]
async fn a_server_that_never_answers_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _held = listener.accept().await; // accept, then say nothing
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    let started = std::time::Instant::now();
    assert!(!health_probe(addr, Duration::from_millis(300)).await);
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn listening_on_any_address_is_probed_on_localhost() {
    let any: SocketAddr = "0.0.0.0:8787".parse().unwrap();
    assert_eq!(probe_target(any), "127.0.0.1:8787".parse().unwrap());
    let v6: SocketAddr = "[::]:8787".parse().unwrap();
    assert_eq!(probe_target(v6), "[::1]:8787".parse().unwrap());
    let specific: SocketAddr = "10.1.2.3:9000".parse().unwrap();
    assert_eq!(probe_target(specific), specific);
}
