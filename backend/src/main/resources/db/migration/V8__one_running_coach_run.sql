-- One running coach job per learner, enforced by the database. The check in
-- CoachRunner.start alone is not enough: under READ COMMITTED two concurrent
-- starts each miss the other's uncommitted row and both insert.

-- Flyway runs before the app's own cleanup of interrupted runs, so do the same
-- here: a leftover 'running' row would otherwise block the index.
UPDATE coach_runs SET status = 'failed', error = 'Der Server wurde während des Laufs neu gestartet.',
  finished_at = now() WHERE status = 'running';

CREATE UNIQUE INDEX coach_runs_one_running_idx ON coach_runs (user_id) WHERE status = 'running';
