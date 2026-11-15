# Process and publish reviewed Seattle Junior goal clips from the private database.
# Full-game videos and generated media remain outside this public repository.

mets_find_command <- function(name, candidates = character()) {
  found <- Sys.which(name)
  if (nzchar(found)) return(unname(found))
  existing <- candidates[file.exists(candidates)]
  if (length(existing)) normalizePath(existing[[1]], winslash = "/", mustWork = TRUE) else ""
}

mets_timestamp_seconds <- function(value) {
  if (!is.character(value) || length(value) != 1L || !grepl("^[0-9]{2}:[0-9]{2}:[0-9]{2}$", value)) {
    stop(sprintf("Invalid HH:MM:SS timestamp: %s", value), call. = FALSE)
  }
  pieces <- as.numeric(strsplit(value, ":", fixed = TRUE)[[1]])
  pieces[[1]] * 3600 + pieces[[2]] * 60 + pieces[[3]]
}

mets_run <- function(command, arguments, label) {
  quoted <- vapply(arguments, shQuote, character(1L))
  output <- suppressWarnings(system2(command, quoted, stdout = TRUE, stderr = TRUE))
  status <- attr(output, "status")
  if (!is.null(status) && status != 0L) {
    stop(sprintf("%s failed.\n%s", label, paste(output, collapse = "\n")), call. = FALSE)
  }
  output
}

mets_clip_rows <- function(database_path, status = "ready") {
  sqlite <- mets_find_command("sqlite3", c("/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3"))
  if (!nzchar(sqlite)) stop("sqlite3 is required.", call. = FALSE)
  allowed <- c("ready", "published")
  if (!status %in% allowed) stop("Status must be ready or published.", call. = FALSE)
  columns <- c(
    "goal_video_clip_id", "goal_id", "source_video_filename", "anchor_timestamp",
    "clip_start_timestamp", "clip_end_timestamp", "version", "media_key", "poster_key"
  )
  query <- paste(
    "SELECT goal_video_clip_id,goal_id,source_video_filename,anchor_timestamp,",
    "clip_start_timestamp,clip_end_timestamp,version,media_key,poster_key",
    "FROM goal_video_clips",
    sprintf("WHERE publication_status='%s'", status),
    "ORDER BY goal_video_clip_id;"
  )
  output <- mets_run(sqlite, c("-header", "-separator", "\t", database_path, query), "Clip query")
  if (!length(output) || !any(nzchar(output))) {
    empty <- as.data.frame(setNames(rep(list(character()), length(columns)), columns), stringsAsFactors = FALSE)
    return(empty)
  }
  read.delim(text = paste(output, collapse = "\n"), sep = "\t", check.names = FALSE, stringsAsFactors = FALSE)
}

mets_validate_media_keys <- function(row) {
  stem <- sprintf("goal-%s", row$goal_id)
  prefix <- sprintf(
    "^mets/2026-27/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*/%s/v%s/%s",
    stem, row$version, stem
  )
  if (!grepl(paste0(prefix, "\\.mp4$"), row$media_key) ||
      !grepl(paste0(prefix, "\\.jpg$"), row$poster_key)) {
    stop(sprintf("Invalid versioned media key for goal %s.", row$goal_id), call. = FALSE)
  }
  invisible(TRUE)
}

process_mets_goal_clips <- function(database_path, videos_dir, output_dir, overwrite = FALSE) {
  ffmpeg <- mets_find_command("ffmpeg", c("/opt/local/bin/ffmpeg7", "/opt/homebrew/bin/ffmpeg"))
  if (!nzchar(ffmpeg)) stop("FFmpeg is required.", call. = FALSE)
  database_path <- normalizePath(path.expand(database_path), winslash = "/", mustWork = TRUE)
  videos_dir <- normalizePath(path.expand(videos_dir), winslash = "/", mustWork = TRUE)
  output_dir <- normalizePath(path.expand(output_dir), winslash = "/", mustWork = FALSE)
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

  rows <- mets_clip_rows(database_path, "ready")
  if (!nrow(rows)) {
    message("No ready clips.")
    return(invisible(rows))
  }
  results <- vector("list", nrow(rows))
  for (index in seq_len(nrow(rows))) {
    row <- rows[index, ]
    mets_validate_media_keys(row)
    source <- file.path(videos_dir, row$source_video_filename)
    if (!file.exists(source)) stop(sprintf("Missing source video: %s", source), call. = FALSE)
    start_seconds <- mets_timestamp_seconds(row$clip_start_timestamp)
    end_seconds <- mets_timestamp_seconds(row$clip_end_timestamp)
    anchor_seconds <- mets_timestamp_seconds(row$anchor_timestamp)
    duration <- end_seconds - start_seconds
    if (duration <= 0 || duration > 60) stop(sprintf("Invalid duration for goal %s.", row$goal_id), call. = FALSE)
    if (anchor_seconds < start_seconds || anchor_seconds > end_seconds) {
      stop(sprintf("Anchor timestamp falls outside goal %s clip.", row$goal_id), call. = FALSE)
    }

    clip_path <- file.path(output_dir, row$media_key)
    poster_path <- file.path(output_dir, row$poster_key)
    dir.create(dirname(clip_path), recursive = TRUE, showWarnings = FALSE)
    dir.create(dirname(poster_path), recursive = TRUE, showWarnings = FALSE)
    if (!overwrite && (file.exists(clip_path) || file.exists(poster_path))) {
      stop(sprintf("Generated media already exists for goal %s.", row$goal_id), call. = FALSE)
    }

    message(sprintf("Processing goal %s (%s to %s)...", row$goal_id, row$clip_start_timestamp, row$clip_end_timestamp))
    mets_run(ffmpeg, c(
      "-hide_banner", "-loglevel", "error", "-ss", row$clip_start_timestamp,
      "-i", source, "-t", sprintf("%.3f", duration),
      "-map", "0:v:0", "-map", "0:a?",
      "-vf", "scale=-2:720:force_original_aspect_ratio=decrease",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart", "-y", clip_path
    ), sprintf("Goal %s video encoding", row$goal_id))
    mets_run(ffmpeg, c(
      "-hide_banner", "-loglevel", "error", "-ss", row$anchor_timestamp,
      "-i", source, "-frames:v", "1",
      "-vf", "scale=-2:720:force_original_aspect_ratio=decrease",
      "-q:v", "2", "-y", poster_path
    ), sprintf("Goal %s poster encoding", row$goal_id))

    results[[index]] <- data.frame(
      goal_id = row$goal_id,
      clip_path = clip_path,
      poster_path = poster_path,
      media_key = row$media_key,
      poster_key = row$poster_key,
      duration_seconds = duration,
      clip_size_mb = round(file.info(clip_path)$size / 1024^2, 2),
      stringsAsFactors = FALSE
    )
  }
  result <- do.call(rbind, results)
  manifest <- file.path(output_dir, "mets-goal-clips.tsv")
  write.table(result, manifest, sep = "\t", quote = FALSE, row.names = FALSE)
  message(sprintf("Processed %s clips. Manifest: %s", nrow(result), manifest))
  result
}

mets_files_match <- function(left, right) {
  identical(file.info(left)$size, file.info(right)$size) &&
    identical(unname(tools::md5sum(left)), unname(tools::md5sum(right)))
}

mets_r2_object_state <- function(wrangler, bucket, key, local_path) {
  check_path <- tempfile("mets-r2-check-")
  on.exit(unlink(check_path), add = TRUE)
  output <- suppressWarnings(system2(
    wrangler,
    vapply(c("r2", "object", "get", paste(bucket, key, sep = "/"), "--file", check_path, "--remote"), shQuote, character(1L)),
    stdout = TRUE,
    stderr = TRUE
  ))
  status <- attr(output, "status")
  if (is.null(status)) {
    return(if (mets_files_match(check_path, local_path)) "matching" else "different")
  }
  if (any(grepl("The specified key does not exist.", output, fixed = TRUE))) return("missing")
  stop("Could not verify the R2 object state. Confirm Wrangler login and network access.", call. = FALSE)
}

publish_mets_goal_clips <- function(output_dir, bucket = "postandin-media") {
  wrangler <- mets_find_command("wrangler", c("/usr/local/bin/wrangler", "/opt/homebrew/bin/wrangler"))
  if (!nzchar(wrangler)) stop("Wrangler is required.", call. = FALSE)
  output_dir <- normalizePath(path.expand(output_dir), winslash = "/", mustWork = TRUE)
  manifest_path <- file.path(output_dir, "mets-goal-clips.tsv")
  if (!file.exists(manifest_path)) stop("Process clips before publishing.", call. = FALSE)
  rows <- read.delim(manifest_path, sep = "\t", check.names = FALSE, stringsAsFactors = FALSE)

  for (index in seq_len(nrow(rows))) {
    row <- rows[index, ]
    for (kind in c("poster", "clip")) {
      local_path <- if (kind == "poster") row$poster_path else row$clip_path
      key <- if (kind == "poster") row$poster_key else row$media_key
      content_type <- if (kind == "poster") "image/jpeg" else "video/mp4"
      state <- mets_r2_object_state(wrangler, bucket, key, local_path)
      if (state == "matching") {
        message(sprintf("Already uploaded; skipping %s", key))
        next
      }
      if (state == "different") {
        stop(sprintf("R2 object differs from local file; refusing overwrite: %s", key), call. = FALSE)
      }
      message(sprintf("Uploading %s...", key))
      mets_run(wrangler, c(
        "r2", "object", "put", paste(bucket, key, sep = "/"),
        "--file", local_path, "--content-type", content_type,
        "--cache-control", "public, max-age=31536000, immutable", "--remote"
      ), sprintf("Upload for goal %s", row$goal_id))
    }
  }
  invisible(rows)
}
