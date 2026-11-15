source("scripts/process-mets-goal-clips.R")

valid_row <- data.frame(
  goal_id = 117,
  version = 1,
  media_key = "mets/2026-27/2026-11-08-portland/goal-117/v1/goal-117.mp4",
  poster_key = "mets/2026-27/2026-11-08-portland/goal-117/v1/goal-117.jpg",
  stringsAsFactors = FALSE
)
stopifnot(isTRUE(mets_validate_media_keys(valid_row)))

invalid_row <- valid_row
invalid_row$media_key <- sub("/v1/", "/v2/", invalid_row$media_key, fixed = TRUE)
invalid_result <- try(mets_validate_media_keys(invalid_row), silent = TRUE)
stopifnot(inherits(invalid_result, "try-error"))

left <- tempfile("mets-left-")
right <- tempfile("mets-right-")
writeBin(charToRaw("same clip"), left)
writeBin(charToRaw("same clip"), right)
stopifnot(mets_files_match(left, right))
writeBin(charToRaw("different clip"), right)
stopifnot(!mets_files_match(left, right))
unlink(c(left, right))

sqlite <- mets_find_command("sqlite3", c("/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3"))
stopifnot(nzchar(sqlite))
database <- tempfile("mets-empty-clips-", fileext = ".sqlite")
status <- system2(sqlite, c(database, shQuote(paste(
  "CREATE TABLE goal_video_clips (",
  "goal_video_clip_id INTEGER, goal_id INTEGER, source_video_filename TEXT,",
  "anchor_timestamp TEXT, clip_start_timestamp TEXT, clip_end_timestamp TEXT,",
  "publication_status TEXT, version INTEGER, media_key TEXT, poster_key TEXT);"
))))
stopifnot(status == 0L)
empty_rows <- mets_clip_rows(database, "ready")
stopifnot(nrow(empty_rows) == 0L)
unlink(database)

cat("mets goal clip processing tests passed\n")
