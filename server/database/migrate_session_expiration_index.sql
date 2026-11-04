-- LEGACY MYSQL ONLY: Do not run this migration against Supabase PostgreSQL.
USE sims_db;

DROP PROCEDURE IF EXISTS add_session_expiration_index;
DELIMITER //
CREATE PROCEDURE add_session_expiration_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'sessions'
      AND index_name = 'idx_sessions_expires'
  ) THEN
    ALTER TABLE sessions ADD KEY idx_sessions_expires (expires);
  END IF;
END//
DELIMITER ;

CALL add_session_expiration_index();
DROP PROCEDURE add_session_expiration_index;
