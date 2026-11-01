//! A tiny HTTP health probe, so a container's health check needs no `curl` or shell.
//! `pictoe-api --healthcheck` runs this against the service's own port and exits 0 or 1.

use std::{net::SocketAddr, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};

/// True when `GET /health` at `addr` answers `200` within `limit`.
pub async fn health_probe(addr: SocketAddr, limit: Duration) -> bool {
    timeout(limit, async {
        let mut stream = TcpStream::connect(addr).await.ok()?;
        stream
            .write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .ok()?;
        let mut head = [0u8; 12];
        stream.read_exact(&mut head).await.ok()?;
        // "HTTP/1.1 200" (or 1.0)
        Some(head.starts_with(b"HTTP/1.") && &head[8..12] == b" 200")
    })
    .await
    .ok()
    .flatten()
    .unwrap_or(false)
}

/// The address to probe: the service's own listen address, with "any" (0.0.0.0) meaning localhost.
pub fn probe_target(listen: SocketAddr) -> SocketAddr {
    match listen {
        SocketAddr::V4(a) if a.ip().is_unspecified() => ([127, 0, 0, 1], a.port()).into(),
        SocketAddr::V6(a) if a.ip().is_unspecified() => {
            (std::net::Ipv6Addr::LOCALHOST, a.port()).into()
        }
        other => other,
    }
}
