use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use serde::Serialize;
use tokio::{task::AbortHandle, time::Instant};
use utoipa::ToSchema;
use uuid::Uuid;

/// Where a job is in its life. `done` and `cancelled` are final.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Cancelled,
}

impl JobStatus {
    pub fn is_finished(self) -> bool {
        matches!(self, Self::Done | Self::Cancelled)
    }
}

struct Record {
    status: JobStatus,
    finished_at: Option<Instant>,
    abort: Option<AbortHandle>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CancelOutcome {
    Cancelled,
    AlreadyFinished,
    NotFound,
}

/// Too many jobs are already active.
#[derive(Debug, PartialEq, Eq)]
pub struct StoreFull;

/// In-memory job lifecycle. Nothing here is persisted and nothing holds image data: a job is an
/// id and a status. Real operations will replace the simulated `noop` work, behind the same API.
#[derive(Clone)]
pub struct JobStore {
    jobs: Arc<Mutex<HashMap<Uuid, Record>>>,
    max_jobs: usize,
    ttl: Duration,
}

type Jobs = HashMap<Uuid, Record>;

impl JobStore {
    pub fn new(max_jobs: usize, ttl: Duration) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            max_jobs,
            ttl,
        }
    }

    /// A panic elsewhere must not take the whole service down, so recover a poisoned lock.
    fn lock(&self) -> MutexGuard<'_, Jobs> {
        self.jobs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn expired(record: &Record, ttl: Duration) -> bool {
        record.finished_at.is_some_and(|at| at.elapsed() >= ttl)
    }

    fn purge_expired(jobs: &mut Jobs, ttl: Duration) {
        jobs.retain(|_, record| !Self::expired(record, ttl));
    }

    /// Starts a simulated job that takes `work` to finish. Only *active* jobs count against the
    /// limit; finished ones are forgotten after the TTL, or sooner if memory needs the room.
    pub fn create(&self, work: Duration) -> Result<Uuid, StoreFull> {
        let mut jobs = self.lock();
        Self::purge_expired(&mut jobs, self.ttl);

        let active = jobs.values().filter(|r| !r.status.is_finished()).count();
        if active >= self.max_jobs {
            return Err(StoreFull);
        }
        while jobs.len() >= self.max_jobs {
            let oldest = jobs
                .iter()
                .filter_map(|(id, r)| r.finished_at.map(|at| (*id, at)))
                .min_by_key(|(_, at)| *at)
                .map(|(id, _)| id);
            match oldest {
                Some(id) => {
                    jobs.remove(&id);
                }
                None => break,
            }
        }

        let id = Uuid::new_v4();
        jobs.insert(
            id,
            Record {
                status: JobStatus::Queued,
                finished_at: None,
                abort: None,
            },
        );

        let store = self.clone();
        let task = tokio::spawn(async move {
            store.start(id);
            tokio::time::sleep(work).await;
            store.complete(id);
        });
        if let Some(record) = jobs.get_mut(&id) {
            record.abort = Some(task.abort_handle());
        }
        Ok(id)
    }

    fn start(&self, id: Uuid) {
        if let Some(record) = self.lock().get_mut(&id) {
            if record.status == JobStatus::Queued {
                record.status = JobStatus::Running;
            }
        }
    }

    fn complete(&self, id: Uuid) {
        if let Some(record) = self.lock().get_mut(&id) {
            if !record.status.is_finished() {
                record.status = JobStatus::Done;
                record.finished_at = Some(Instant::now());
                record.abort = None;
            }
        }
    }

    pub fn status(&self, id: Uuid) -> Option<JobStatus> {
        let mut jobs = self.lock();
        if jobs.get(&id).is_some_and(|r| Self::expired(r, self.ttl)) {
            jobs.remove(&id);
        }
        jobs.get(&id).map(|r| r.status)
    }

    pub fn cancel(&self, id: Uuid) -> CancelOutcome {
        let mut jobs = self.lock();
        if jobs.get(&id).is_some_and(|r| Self::expired(r, self.ttl)) {
            jobs.remove(&id);
        }
        match jobs.get_mut(&id) {
            None => CancelOutcome::NotFound,
            Some(record) if record.status.is_finished() => CancelOutcome::AlreadyFinished,
            Some(record) => {
                if let Some(handle) = &record.abort {
                    handle.abort();
                }
                record.status = JobStatus::Cancelled;
                record.finished_at = Some(Instant::now());
                CancelOutcome::Cancelled
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl JobStore {
        /// Background tasks that are still running. Lets tests prove cancel really stops work.
        fn tasks_in_flight(&self) -> usize {
            self.lock()
                .values()
                .filter(|r| r.abort.as_ref().is_some_and(|handle| !handle.is_finished()))
                .count()
        }
    }

    async fn settle() {
        for _ in 0..5 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn cancelling_stops_the_underlying_work() {
        let store = JobStore::new(10, Duration::from_secs(60));
        let id = store.create(Duration::from_secs(10)).unwrap();
        settle().await;
        assert_eq!(store.tasks_in_flight(), 1);

        assert_eq!(store.cancel(id), CancelOutcome::Cancelled);
        settle().await;
        assert_eq!(
            store.tasks_in_flight(),
            0,
            "the work must stop, not just be hidden"
        );
        assert_eq!(store.status(id), Some(JobStatus::Cancelled));
    }

    #[tokio::test(start_paused = true)]
    async fn finished_work_leaves_nothing_running() {
        let store = JobStore::new(10, Duration::from_secs(60));
        store.create(Duration::from_millis(100)).unwrap();
        settle().await;
        tokio::time::advance(Duration::from_millis(150)).await;
        settle().await;
        assert_eq!(store.tasks_in_flight(), 0);
    }
}
