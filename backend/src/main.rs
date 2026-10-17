use std::process::ExitCode;

use pictoe_api::{app, Config};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = match Config::from_lookup(|key| std::env::var(key).ok()) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("configuration error: {error}");
            return ExitCode::from(2);
        }
    };

    let listener = match TcpListener::bind(config.addr).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("couldn't listen on {}: {error}", config.addr);
            return ExitCode::from(1);
        }
    };

    tracing::info!(addr = %config.addr, origins = ?config.allowed_origins, "pictoe-api listening");

    match axum::serve(listener, app(config))
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        Ok(()) => {
            tracing::info!("shut down cleanly");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("server error: {error}");
            ExitCode::from(1)
        }
    }
}

/// Finish in-flight requests, then exit, on Ctrl-C or SIGTERM (what a container platform sends).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
