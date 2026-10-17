use std::{fmt, net::SocketAddr, time::Duration};

/// Everything the service needs to know about its environment.
#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    /// Browser origins allowed to call the API. An explicit list, never a wildcard.
    pub allowed_origins: Vec<String>,
    pub max_body_bytes: usize,
    pub request_timeout: Duration,
    /// Most jobs held at once; further requests are refused rather than queued without bound.
    pub max_jobs: usize,
    /// How long a finished job stays readable before it is forgotten.
    pub finished_job_ttl: Duration,
    /// How long the harmless `noop` operation pretends to work. Real operations replace this.
    pub noop_duration: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], 8787)),
            allowed_origins: vec!["http://localhost:8080".to_string()],
            max_body_bytes: 64 * 1024,
            request_timeout: Duration::from_secs(30),
            max_jobs: 1000,
            finished_job_ttl: Duration::from_secs(3600),
            noop_duration: Duration::from_millis(1500),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    InvalidAddr(String),
    InvalidOrigin(String),
    InvalidNumber { key: &'static str, value: String },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidAddr(v) => write!(f, "PICTOE_ADDR must look like 127.0.0.1:8787, got {v:?}"),
            Self::InvalidOrigin(v) => write!(
                f,
                "PICTOE_ALLOWED_ORIGINS needs explicit origins like https://app.example.com (no wildcard, path or trailing slash), got {v:?}"
            ),
            Self::InvalidNumber { key, value } => {
                write!(f, "{key} must be a positive whole number, got {value:?}")
            }
        }
    }
}

impl std::error::Error for ConfigError {}

fn number(
    lookup: &impl Fn(&str) -> Option<String>,
    key: &'static str,
    default: u64,
) -> Result<u64, ConfigError> {
    match lookup(key) {
        None => Ok(default),
        Some(raw) => match raw.trim().parse::<u64>() {
            Ok(n) if n > 0 => Ok(n),
            _ => Err(ConfigError::InvalidNumber { key, value: raw }),
        },
    }
}

fn valid_origin(origin: &str) -> bool {
    let rest = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"));
    match rest {
        Some(host) => !host.is_empty() && !host.contains(['/', '*', ' ', '?', '#']),
        None => false,
    }
}

impl Config {
    /// Reads settings through `lookup`: the process environment in `main`, a map in tests.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let mut config = Self::default();

        if let Some(raw) = lookup("PICTOE_ADDR") {
            config.addr = raw
                .trim()
                .parse()
                .map_err(|_| ConfigError::InvalidAddr(raw.clone()))?;
        }

        if let Some(raw) = lookup("PICTOE_ALLOWED_ORIGINS") {
            let origins: Vec<String> = raw.split(',').map(|o| o.trim().to_string()).collect();
            if let Some(bad) = origins.iter().find(|o| !valid_origin(o)) {
                return Err(ConfigError::InvalidOrigin(bad.clone()));
            }
            config.allowed_origins = origins;
        }

        config.max_body_bytes = number(
            &lookup,
            "PICTOE_MAX_BODY_BYTES",
            config.max_body_bytes as u64,
        )? as usize;
        config.request_timeout = Duration::from_secs(number(
            &lookup,
            "PICTOE_REQUEST_TIMEOUT_SECS",
            config.request_timeout.as_secs(),
        )?);
        config.max_jobs = number(&lookup, "PICTOE_MAX_JOBS", config.max_jobs as u64)? as usize;
        config.finished_job_ttl = Duration::from_secs(number(
            &lookup,
            "PICTOE_JOB_TTL_SECS",
            config.finished_job_ttl.as_secs(),
        )?);
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn from(pairs: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|key| map.get(key).cloned())
    }

    #[test]
    fn defaults_are_safe_and_local() {
        let c = from(&[]).unwrap();
        assert_eq!(c.addr.to_string(), "127.0.0.1:8787");
        assert_eq!(c.allowed_origins, vec!["http://localhost:8080"]);
        assert_eq!(c.max_body_bytes, 64 * 1024);
    }

    #[test]
    fn reads_overrides() {
        let c = from(&[
            ("PICTOE_ADDR", "0.0.0.0:9000"),
            (
                "PICTOE_ALLOWED_ORIGINS",
                "https://a.example, https://b.example:8443",
            ),
            ("PICTOE_MAX_JOBS", "5"),
            ("PICTOE_JOB_TTL_SECS", "60"),
        ])
        .unwrap();
        assert_eq!(c.addr.port(), 9000);
        assert_eq!(
            c.allowed_origins,
            vec!["https://a.example", "https://b.example:8443"]
        );
        assert_eq!(c.max_jobs, 5);
        assert_eq!(c.finished_job_ttl, Duration::from_secs(60));
    }

    #[test]
    fn rejects_a_bad_address() {
        assert!(matches!(
            from(&[("PICTOE_ADDR", "not-an-address")]),
            Err(ConfigError::InvalidAddr(_))
        ));
    }

    #[test]
    fn rejects_wildcards_paths_and_empty_origins() {
        for bad in [
            "*",
            "https://*.example.com",
            "https://a.example/",
            "a.example",
            "",
            "ftp://a",
        ] {
            assert!(
                matches!(
                    from(&[("PICTOE_ALLOWED_ORIGINS", bad)]),
                    Err(ConfigError::InvalidOrigin(_))
                ),
                "should reject {bad:?}"
            );
        }
        assert!(from(&[("PICTOE_ALLOWED_ORIGINS", "https://ok.example,*")]).is_err());
    }

    #[test]
    fn rejects_zero_and_non_numbers() {
        for bad in ["0", "-3", "ten", ""] {
            assert!(
                matches!(
                    from(&[("PICTOE_MAX_JOBS", bad)]),
                    Err(ConfigError::InvalidNumber { .. })
                ),
                "should reject {bad:?}"
            );
        }
    }
}
