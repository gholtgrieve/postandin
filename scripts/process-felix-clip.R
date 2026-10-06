# Process one clip from one full-game video for /felix-holtgrieve/.
#
# This file uses base R only. Source it from R or RStudio, then call
# process_felix_clip() as shown in scripts/felix-clip-workflow.md.

felix_timestamp_seconds <- function(value) {
  if (is.numeric(value) && length(value) == 1L && is.finite(value) && value >= 0) {
    return(as.numeric(value))
  }

  if (!is.character(value) || length(value) != 1L || !nzchar(trimws(value))) {
    stop("Timestamp must be seconds or HH:MM:SS, MM:SS, or SS.", call. = FALSE)
  }

  parts <- strsplit(trimws(value), ":", fixed = TRUE)[[1L]]
  if (length(parts) > 3L || any(!grepl("^[0-9]+(?:\\.[0-9]+)?$", parts)) ||
      (length(parts) > 1L && any(!grepl("^[0-9]+$", head(parts, -1L))))) {
    stop(sprintf("Invalid timestamp: %s", value), call. = FALSE)
  }

  numbers <- as.numeric(parts)
  if (length(parts) >= 2L && tail(numbers, 1L) >= 60) {
    stop(sprintf("Seconds must be below 60 in timestamp: %s", value), call. = FALSE)
  }
  if (length(parts) == 3L && numbers[[2L]] >= 60) {
    stop(sprintf("Minutes must be below 60 in timestamp: %s", value), call. = FALSE)
  }

  multipliers <- switch(
    as.character(length(numbers)),
    "1" = 1,
    "2" = c(60, 1),
    "3" = c(3600, 60, 1)
  )
  sum(numbers * multipliers)
}

felix_js_string <- function(value) {
  value <- as.character(value)
  Encoding(value) <- "UTF-8"
  codepoints <- utf8ToInt(value)
  encoded <- vapply(codepoints, function(codepoint) {
    if (codepoint == 8L) return("\\b")
    if (codepoint == 9L) return("\\t")
    if (codepoint == 10L) return("\\n")
    if (codepoint == 12L) return("\\f")
    if (codepoint == 13L) return("\\r")
    if (codepoint == 34L) return("\\\"")
    if (codepoint == 92L) return("\\\\")
    if (codepoint >= 32L && codepoint <= 126L) return(intToUtf8(codepoint))
    if (codepoint <= 0xFFFF) return(sprintf("\\u%04X", codepoint))

    adjusted <- codepoint - 0x10000
    high <- 0xD800 + bitwShiftR(adjusted, 10L)
    low <- 0xDC00 + bitwAnd(adjusted, 0x3FF)
    sprintf("\\u%04X\\u%04X", high, low)
  }, character(1L))
  paste0('"', paste0(encoded, collapse = ""), '"')
}

felix_git_root_for_path <- function(path) {
  directory <- if (dir.exists(path)) path else dirname(path)
  arguments <- vapply(
    c("-C", directory, "rev-parse", "--show-toplevel"),
    shQuote,
    character(1L)
  )
  result <- suppressWarnings(system2(
    "git",
    arguments,
    stdout = TRUE,
    stderr = TRUE
  ))
  status <- attr(result, "status")
  if (!is.null(status)) {
    if (any(grepl("not a git repository", result, fixed = TRUE))) return(NULL)
    stop("Could not safely determine whether a media path is inside a Git repository.", call. = FALSE)
  }
  if (!length(result)) {
    stop("Git returned no repository path while checking media storage.", call. = FALSE)
  }
  normalizePath(result[[1L]], winslash = "/", mustWork = TRUE)
}

felix_is_inside <- function(path, directory) {
  path <- normalizePath(path, winslash = "/", mustWork = FALSE)
  directory <- normalizePath(directory, winslash = "/", mustWork = TRUE)
  identical(path, directory) || startsWith(path, paste0(directory, "/"))
}

felix_run_ffmpeg <- function(ffmpeg, arguments) {
  quoted <- vapply(arguments, shQuote, character(1L))
  status <- system2(ffmpeg, quoted, stdout = "", stderr = "")
  if (!identical(status, 0L)) {
    stop(sprintf("FFmpeg failed with status %s.", status), call. = FALSE)
  }
}

felix_find_command <- function(names, candidates) {
  available <- unname(Sys.which(names))
  available <- available[nzchar(available)]
  if (length(available)) return(available[[1L]])
  installed <- candidates[file.exists(candidates)]
  if (length(installed)) return(installed[[1L]])
  ""
}

felix_find_ffmpeg <- function() {
  ffmpeg <- felix_find_command(
    c("ffmpeg", "ffmpeg7"),
    c("/opt/local/bin/ffmpeg7", "/opt/local/bin/ffmpeg", "/usr/local/bin/ffmpeg")
  )
  if (!nzchar(ffmpeg)) {
    stop(
      paste(
        "FFmpeg is not installed.",
        "On an Intel Mac running macOS 13, use the Ventura MacPorts installer",
        "and then run `sudo port install ffmpeg7` in Terminal."
      ),
      call. = FALSE
    )
  }
  ffmpeg
}

felix_read_ppm <- function(path) {
  bytes <- readBin(path, what = "raw", n = file.info(path)$size)
  position <- 1L

  next_token <- function() {
    whitespace <- as.raw(c(9L, 10L, 13L, 32L))
    while (position <= length(bytes)) {
      if (bytes[[position]] %in% whitespace) {
        position <<- position + 1L
      } else if (identical(bytes[[position]], as.raw(35L))) {
        while (position <= length(bytes) && !identical(bytes[[position]], as.raw(10L))) {
          position <<- position + 1L
        }
      } else {
        break
      }
    }
    start <- position
    while (position <= length(bytes) && !(bytes[[position]] %in% whitespace)) {
      position <<- position + 1L
    }
    rawToChar(bytes[start:(position - 1L)])
  }

  magic <- next_token()
  width <- as.integer(next_token())
  height <- as.integer(next_token())
  maximum <- as.integer(next_token())
  if (!identical(magic, "P6") || !is.finite(width) || !is.finite(height) || maximum != 255L) {
    stop("Could not read the FFmpeg selection frame.", call. = FALSE)
  }

  if (identical(bytes[[position]], as.raw(13L)) && identical(bytes[[position + 1L]], as.raw(10L))) {
    position <- position + 2L
  } else {
    position <- position + 1L
  }
  expected <- width * height * 3L
  pixels <- as.integer(bytes[position:(position + expected - 1L)])
  if (length(pixels) != expected) stop("Selection frame pixel data is incomplete.", call. = FALSE)

  colors <- grDevices::rgb(
    pixels[seq.int(1L, expected, by = 3L)],
    pixels[seq.int(2L, expected, by = 3L)],
    pixels[seq.int(3L, expected, by = 3L)],
    maxColorValue = 255
  )
  list(
    width = width,
    height = height,
    raster = as.raster(matrix(colors, nrow = height, ncol = width, byrow = TRUE))
  )
}

choose_felix_position <- function(input, start) {
  ffmpeg <- felix_find_ffmpeg()
  input <- normalizePath(path.expand(input), winslash = "/", mustWork = TRUE)
  start_seconds <- felix_timestamp_seconds(start)
  frame_path <- tempfile("felix-position-", fileext = ".ppm")
  on.exit(unlink(frame_path), add = TRUE)

  felix_run_ffmpeg(ffmpeg, c(
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", sprintf("%.3f", start_seconds),
    "-i", input,
    "-frames:v", "1",
    "-vf", "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2",
    "-c:v", "ppm",
    "-update", "1",
    frame_path
  ))

  if (!file.exists(frame_path)) {
    hint <- if (start_seconds >= 6 * 3600) {
      paste0(
        " The timestamp resolves to ", round(start_seconds / 3600, 2),
        " hours. For 47 minutes and 39 seconds, use `47:39`, not `47:39:00`."
      )
    } else {
      " Check that the timestamp occurs before the end of the video."
    }
    stop(paste0("FFmpeg did not create the player-selection frame.", hint), call. = FALSE)
  }

  frame <- felix_read_ppm(frame_path)
  graphics::plot.new()
  graphics::plot.window(xlim = c(0, frame$width), ylim = c(frame$height, 0), asp = 1)
  graphics::rasterImage(frame$raster, 0, frame$height, frame$width, 0)
  graphics::title(main = "Click the center of Felix, once")
  point <- graphics::locator(1L)
  if (is.null(point)) stop("No player position was selected.", call. = FALSE)
  graphics::symbols(point$x, point$y, circles = 55, inches = FALSE, add = TRUE, fg = "#D6BC58", lwd = 4)

  position <- c(x = point$x / frame$width, y = point$y / frame$height)
  message(sprintf("Felix position selected: x = %.4f, y = %.4f", position[["x"]], position[["y"]]))
  position
}

felix_write_marker <- function(path, position, width = 1280, height = 720, radius = 0.09) {
  if (!is.numeric(position) || length(position) != 2L || any(!is.finite(position))) {
    stop("felix_position must be the result returned by choose_felix_position().", call. = FALSE)
  }
  if (is.null(names(position)) || !all(c("x", "y") %in% names(position))) {
    stop("felix_position must contain named x and y values.", call. = FALSE)
  }
  if (any(position[c("x", "y")] < 0) || any(position[c("x", "y")] > 1)) {
    stop("Felix position values must be between 0 and 1.", call. = FALSE)
  }

  center_x <- position[["x"]] * width
  center_y <- position[["y"]] * height
  circle_radius <- radius * height
  stroke <- max(6, round(height / 90))
  svg <- c(
    sprintf('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">', width, height, width, height),
    sprintf('  <circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="#D6BC58" stroke-width="%d"/>', center_x, center_y, circle_radius, stroke),
    "</svg>"
  )
  writeLines(svg, path, useBytes = TRUE)
}

felix_video_filter <- function(
  width,
  height,
  fps,
  highlight_seconds,
  secondary_highlight_time = NULL,
  secondary_highlight_seconds = NULL
) {
  scale_filter <- paste0(
    sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,", width, height),
    sprintf("pad=%d:%d:(ow-iw)/2:(oh-ih)/2,", width, height),
    sprintf("fps=%d,format=yuv420p,setpts=PTS-STARTPTS", fps)
  )
  opening_frames <- max(1, floor((highlight_seconds * fps) + 0.5))
  opening_duration <- opening_frames / fps

  if (is.null(secondary_highlight_time)) {
    return(paste0(
      "[0:v:0]", scale_filter, ",split=2[opening-source][play-source];",
      "[opening-source]trim=start_frame=0:end_frame=1,setpts=PTS-STARTPTS,",
      sprintf(
        "loop=loop=%d:size=1:start=0,setpts=N/(%d*TB)[opening];",
        opening_frames - 1,
        fps
      ),
      "[play-source]setpts=PTS-STARTPTS[play];",
      sprintf(
        "[opening][play]concat=n=2:v=1:a=0,fps=%d,settb=1/%d[joined];",
        fps,
        fps
      ),
      sprintf("[1:v:0]scale=%d:%d,format=rgba[marker];", width, height),
      sprintf("[joined][marker]overlay=0:0:enable='lt(t,%.6f)',format=yuv420p[v]", opening_duration)
    ))
  }

  secondary_frame <- floor((secondary_highlight_time * fps) + 0.5)
  secondary_frames <- max(1, floor((secondary_highlight_seconds * fps) + 0.5))
  secondary_frame_time <- secondary_frame / fps
  secondary_duration <- secondary_frames / fps
  secondary_start <- opening_duration + secondary_frame_time
  secondary_end <- secondary_start + secondary_duration

  paste0(
    "[0:v:0]", scale_filter, ",",
    "split=4[opening-source][before-source][freeze-source][after-source];",
    "[opening-source]trim=start_frame=0:end_frame=1,setpts=PTS-STARTPTS,",
    sprintf(
      "loop=loop=%d:size=1:start=0,setpts=N/(%d*TB)[opening];",
      opening_frames - 1,
      fps
    ),
    sprintf(
      "[before-source]trim=start_frame=0:end_frame=%d,setpts=PTS-STARTPTS[before];",
      secondary_frame
    ),
    sprintf(
      "[freeze-source]trim=start_frame=%d:end_frame=%d,setpts=PTS-STARTPTS,",
      secondary_frame,
      secondary_frame + 1
    ),
    sprintf(
      "loop=loop=%d:size=1:start=0,setpts=N/(%d*TB)[freeze];",
      secondary_frames - 1,
      fps
    ),
    sprintf(
      "[after-source]trim=start_frame=%d,setpts=PTS-STARTPTS[after];",
      secondary_frame
    ),
    sprintf(
      "[opening][before][freeze][after]concat=n=4:v=1:a=0,fps=%d,settb=1/%d[joined];",
      fps,
      fps
    ),
    sprintf("[1:v:0]scale=%d:%d,format=rgba[opening-marker];", width, height),
    sprintf("[2:v:0]scale=%d:%d,format=rgba[secondary-marker];", width, height),
    sprintf(
      "[joined][opening-marker]overlay=0:0:enable='lt(t,%.3f)'[opening-marked];",
      opening_duration
    ),
    sprintf(
      "[opening-marked][secondary-marker]overlay=0:0:enable='between(t,%.3f,%.3f)',format=yuv420p[v]",
      secondary_start,
      secondary_end
    )
  )
}

felix_audio_filter <- function(
  highlight_seconds,
  secondary_highlight_time = NULL,
  secondary_highlight_seconds = NULL
) {
  if (is.null(secondary_highlight_time)) {
    return(sprintf("[0:a:0]adelay=%d:all=1[a]", round(highlight_seconds * 1000)))
  }

  paste0(
    "[0:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:",
    "channel_layouts=stereo,asetpts=PTS-STARTPTS,",
    "asplit=2[before-audio-source][after-audio-source];",
    sprintf(
      "[before-audio-source]atrim=start=0:end=%.3f,asetpts=PTS-STARTPTS[before-audio];",
      secondary_highlight_time
    ),
    sprintf(
      "[after-audio-source]atrim=start=%.3f,asetpts=PTS-STARTPTS[after-audio];",
      secondary_highlight_time
    ),
    sprintf(
      "anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[opening-silence];",
      highlight_seconds
    ),
    sprintf(
      "anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[secondary-silence];",
      secondary_highlight_seconds
    ),
    "[opening-silence][before-audio][secondary-silence][after-audio]",
    "concat=n=4:v=0:a=1[a]"
  )
}

process_felix_clip <- function(
  input,
  start,
  end,
  id,
  title,
  categories,
  opponent,
  date,
  output_dir,
  felix_position,
  highlight_seconds = 1.75,
  secondary_highlight_time = NULL,
  secondary_felix_position = NULL,
  secondary_highlight_seconds = 1.25,
  overwrite = FALSE
) {
  ffmpeg <- felix_find_ffmpeg()
  ffprobe <- felix_find_command(
    c("ffprobe", "ffprobe7"),
    c("/opt/local/bin/ffprobe7", "/opt/local/bin/ffprobe", "/usr/local/bin/ffprobe")
  )

  input <- normalizePath(path.expand(input), winslash = "/", mustWork = TRUE)
  output_dir <- path.expand(output_dir)
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  output_dir <- normalizePath(output_dir, winslash = "/", mustWork = TRUE)
  input_repo_root <- felix_git_root_for_path(input)
  output_repo_root <- felix_git_root_for_path(output_dir)
  if ((!is.null(input_repo_root) && felix_is_inside(input, input_repo_root)) ||
      (!is.null(output_repo_root) && felix_is_inside(output_dir, output_repo_root))) {
    stop("Keep source and generated video files outside the public repository.", call. = FALSE)
  }

  valid_categories <- c("defensive", "offensive", "puck-movement", "special-teams")
  if (!is.character(categories) || !length(categories) || any(!categories %in% valid_categories)) {
    stop(sprintf("Categories must use one or more of: %s.", paste(valid_categories, collapse = ", ")), call. = FALSE)
  }
  if (anyDuplicated(categories)) {
    stop("Categories must not contain duplicates.", call. = FALSE)
  }
  if (!grepl("^[a-z0-9]+(?:-[a-z0-9]+)*$", id)) {
    stop("ID must use lowercase letters, numbers, and single hyphens.", call. = FALSE)
  }
  if (!grepl("^20[0-9]{2}-[0-9]{2}-[0-9]{2}$", date)) {
    stop("Date must use YYYY-MM-DD.", call. = FALSE)
  }
  valid_label <- function(value) {
    is.character(value) && length(value) == 1L && !is.na(value) && nzchar(trimws(value))
  }
  if (!valid_label(title) || !valid_label(opponent)) {
    stop("Title and opponent are required.", call. = FALSE)
  }
  if (!is.numeric(highlight_seconds) || length(highlight_seconds) != 1L ||
      !is.finite(highlight_seconds) || highlight_seconds <= 0 || highlight_seconds > 3) {
    stop("highlight_seconds must be greater than 0 and no more than 3.", call. = FALSE)
  }

  has_secondary_time <- !is.null(secondary_highlight_time)
  has_secondary_position <- !is.null(secondary_felix_position)
  if (xor(has_secondary_time, has_secondary_position)) {
    stop(
      "secondary_highlight_time and secondary_felix_position must be supplied together.",
      call. = FALSE
    )
  }
  if (!is.numeric(secondary_highlight_seconds) || length(secondary_highlight_seconds) != 1L ||
      !is.finite(secondary_highlight_seconds) || secondary_highlight_seconds <= 0 ||
      secondary_highlight_seconds > 3) {
    stop(
      "secondary_highlight_seconds must be greater than 0 and no more than 3.",
      call. = FALSE
    )
  }

  start_seconds <- felix_timestamp_seconds(start)
  end_seconds <- felix_timestamp_seconds(end)
  if (end_seconds <= start_seconds) {
    stop("End timestamp must be later than start timestamp.", call. = FALSE)
  }

  duration <- end_seconds - start_seconds
  if (duration > 60) {
    stop("Clip duration must be 60 seconds or less for an efficient hover preview.", call. = FALSE)
  }

  if (has_secondary_time) {
    secondary_highlight_time <- felix_timestamp_seconds(secondary_highlight_time)
    if (secondary_highlight_time <= 0 || secondary_highlight_time >= duration) {
      stop(
        "secondary_highlight_time must fall after the clip start and before the clip end.",
        call. = FALSE
      )
    }
  }

  preview_path <- file.path(output_dir, paste0(id, "-preview.mp4"))
  full_path <- file.path(output_dir, paste0(id, ".mp4"))
  poster_path <- file.path(output_dir, paste0(id, ".jpg"))
  entry_path <- file.path(output_dir, paste0(id, "-clip-entry.js"))
  outputs <- c(preview_path, full_path, poster_path, entry_path)
  if (!overwrite && any(file.exists(outputs))) {
    stop("An output file already exists. Choose a new ID or set overwrite = TRUE.", call. = FALSE)
  }

  common <- c("-hide_banner", "-loglevel", "warning", if (overwrite) "-y" else "-n")
  seek <- sprintf("%.3f", start_seconds)
  marker_path <- tempfile("felix-marker-", fileext = ".svg")
  secondary_marker_path <- NULL
  on.exit(unlink(c(marker_path, secondary_marker_path)), add = TRUE)
  felix_write_marker(marker_path, felix_position)
  if (has_secondary_time) {
    secondary_marker_path <- tempfile("felix-secondary-marker-", fileext = ".svg")
    felix_write_marker(secondary_marker_path, secondary_felix_position)
  }

  full_filter <- felix_video_filter(
    1280,
    720,
    30,
    highlight_seconds,
    secondary_highlight_time,
    secondary_highlight_seconds
  )
  preview_filter <- felix_video_filter(
    640,
    360,
    24,
    highlight_seconds,
    secondary_highlight_time,
    secondary_highlight_seconds
  )
  output_duration <- duration + highlight_seconds +
    if (has_secondary_time) secondary_highlight_seconds else 0
  preview_marker_inputs <- c("-loop", "1", "-framerate", "24", "-i", marker_path)
  full_marker_inputs <- c("-loop", "1", "-framerate", "30", "-i", marker_path)
  if (has_secondary_time) {
    preview_marker_inputs <- c(
      preview_marker_inputs,
      "-loop", "1", "-framerate", "24", "-i", secondary_marker_path
    )
    full_marker_inputs <- c(
      full_marker_inputs,
      "-loop", "1", "-framerate", "30", "-i", secondary_marker_path
    )
  }

  has_audio <- FALSE
  if (nzchar(ffprobe)) {
    probe_args <- vapply(c(
      "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index",
      "-of", "csv=p=0", input
    ), shQuote, character(1L))
    audio_probe <- suppressWarnings(system2(ffprobe, probe_args, stdout = TRUE, stderr = FALSE))
    has_audio <- length(audio_probe) > 0L && any(nzchar(audio_probe))
  }

  message("Creating full-play hover preview...")
  felix_run_ffmpeg(ffmpeg, c(
    common,
    "-ss", seek,
    "-t", sprintf("%.3f", duration),
    "-i", input,
    preview_marker_inputs,
    "-filter_complex", preview_filter,
    "-map", "[v]",
    "-an",
    "-t", sprintf("%.3f", output_duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "27",
    "-movflags", "+faststart",
    preview_path
  ))

  message("Creating full web clip...")
  full_arguments <- c(
    common,
    "-ss", seek,
    "-t", sprintf("%.3f", duration),
    "-i", input,
    full_marker_inputs
  )
  if (has_audio) {
    full_filter <- paste0(
      full_filter,
      ";",
      felix_audio_filter(
        highlight_seconds,
        secondary_highlight_time,
        secondary_highlight_seconds
      )
    )
  }
  full_arguments <- c(
    full_arguments,
    "-filter_complex", full_filter,
    "-map", "[v]",
    if (has_audio) c("-map", "[a]") else "-an",
    "-t", sprintf("%.3f", output_duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    full_path
  )
  felix_run_ffmpeg(ffmpeg, full_arguments)

  message("Creating poster image...")
  felix_run_ffmpeg(ffmpeg, c(
    common,
    "-ss", seek,
    "-i", input,
    "-i", marker_path,
    "-filter_complex",
    "[0:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[base];[1:v:0]scale=1280:720,format=rgba[marker];[base][marker]overlay=0:0[v]",
    "-map", "[v]",
    "-frames:v", "1",
    "-update", "1",
    "-q:v", "3",
    poster_path
  ))

  base_url <- "REPLACE_WITH_HTTPS_MEDIA_URL"

  entry <- c(
    "{",
    sprintf("  id: %s,", felix_js_string(id)),
    sprintf("  title: %s,", felix_js_string(title)),
    sprintf("  categories: [%s],", paste(vapply(categories, felix_js_string, character(1L)), collapse = ", ")),
    sprintf("  opponent: %s,", felix_js_string(opponent)),
    sprintf("  date: %s,", felix_js_string(date)),
    sprintf("  posterSrc: %s,", felix_js_string(paste0(base_url, "/", basename(poster_path)))),
    sprintf("  previewSrc: %s,", felix_js_string(paste0(base_url, "/", basename(preview_path)))),
    sprintf("  fullSrc: %s,", felix_js_string(paste0(base_url, "/", basename(full_path)))),
    "  captionsSrc: \"\",",
    "},"
  )
  writeLines(entry, entry_path, useBytes = TRUE)

  sizes_mb <- file.info(c(preview_path, full_path, poster_path))$size / 1024^2
  result <- data.frame(
    type = c("preview", "full", "poster"),
    path = c(preview_path, full_path, poster_path),
    size_mb = round(sizes_mb, 2),
    row.names = NULL
  )
  message(sprintf("Done. Page entry: %s", entry_path))
  result
}

felix_r2_object_exists <- function(wrangler, bucket, key) {
  check_path <- tempfile("felix-r2-check-")
  on.exit(unlink(check_path), add = TRUE)
  check_arguments <- vapply(c(
    "r2", "object", "get", paste(bucket, key, sep = "/"),
    "--file", check_path, "--remote"
  ), shQuote, character(1L))
  check_output <- suppressWarnings(system2(
    wrangler,
    check_arguments,
    stdout = TRUE,
    stderr = TRUE
  ))
  check_status <- attr(check_output, "status")
  if (is.null(check_status)) return(TRUE)
  if (any(grepl("The specified key does not exist.", check_output, fixed = TRUE))) {
    return(FALSE)
  }
  stop(
    "Could not safely check whether this R2 version already exists. Confirm Wrangler login and network access, then retry.",
    call. = FALSE
  )
}

publish_felix_clip <- function(
  output_dir,
  id,
  season,
  version,
  bucket = "postandin-media",
  public_domain = "media.postandin.com",
  overwrite = FALSE
) {
  wrangler <- felix_find_command(
    "wrangler",
    c("/usr/local/bin/wrangler", "/opt/homebrew/bin/wrangler")
  )
  if (!nzchar(wrangler)) {
    stop("Wrangler is not installed. Install and log in to Wrangler before publishing.", call. = FALSE)
  }
  if (!grepl("^[a-z0-9]+(?:-[a-z0-9]+)*$", id)) {
    stop("ID must use lowercase letters, numbers, and single hyphens.", call. = FALSE)
  }
  if (!grepl("^20[0-9]{2}-[0-9]{2}$", season)) {
    stop("Season must use YYYY-YY, for example 2026-27.", call. = FALSE)
  }
  if (!grepl("^v[1-9][0-9]*$", version)) {
    stop("Version must use v followed by a positive number, for example v1.", call. = FALSE)
  }
  if (!grepl("^[a-z0-9.-]+$", bucket) || !grepl("^[a-z0-9.-]+$", public_domain)) {
    stop("Bucket and public domain contain unsupported characters.", call. = FALSE)
  }

  output_dir <- normalizePath(path.expand(output_dir), winslash = "/", mustWork = TRUE)
  files <- c(
    poster = file.path(output_dir, paste0(id, ".jpg")),
    preview = file.path(output_dir, paste0(id, "-preview.mp4")),
    full = file.path(output_dir, paste0(id, ".mp4"))
  )
  missing <- files[!file.exists(files)]
  if (length(missing)) {
    stop(sprintf("Missing generated media: %s", paste(basename(missing), collapse = ", ")), call. = FALSE)
  }

  key_prefix <- paste("felix", season, id, version, sep = "/")
  public_base_url <- sprintf("https://%s/%s", public_domain, key_prefix)
  entry_path <- file.path(output_dir, paste0(id, "-clip-entry.js"))
  if (!file.exists(entry_path)) {
    stop("The generated clip-entry file is missing. Process the clip before publishing it.", call. = FALSE)
  }
  entry <- readLines(entry_path, warn = FALSE)
  media_lines <- c(
    posterSrc = paste0(public_base_url, "/", basename(files[["poster"]])),
    previewSrc = paste0(public_base_url, "/", basename(files[["preview"]])),
    fullSrc = paste0(public_base_url, "/", basename(files[["full"]]))
  )
  media_line_indexes <- vapply(names(media_lines), function(field) {
    matches <- grep(sprintf("^\\s*%s:\\s*.*,$", field), entry)
    if (length(matches) != 1L) {
      stop(sprintf("The generated clip entry must contain exactly one %s line.", field), call. = FALSE)
    }
    matches[[1L]]
  }, integer(1L))

  poster_key <- paste(key_prefix, basename(files[["poster"]]), sep = "/")
  if (!overwrite && felix_r2_object_exists(wrangler, bucket, poster_key)) {
    stop(
      sprintf("%s already exists. Use a new version so immutable cached media is never replaced.", version),
      call. = FALSE
    )
  }

  content_types <- c(poster = "image/jpeg", preview = "video/mp4", full = "video/mp4")
  for (type in names(files)) {
    key <- paste(key_prefix, basename(files[[type]]), sep = "/")
    message(sprintf("Uploading %s...", basename(files[[type]])))
    upload_arguments <- c(
      "r2", "object", "put", paste(bucket, key, sep = "/"),
      "--file", files[[type]],
      "--content-type", content_types[[type]],
      "--cache-control", "public, max-age=31536000, immutable",
      "--remote"
    )
    quoted <- vapply(upload_arguments, shQuote, character(1L))
    status <- system2(wrangler, quoted, stdout = "", stderr = "")
    if (!identical(status, 0L)) {
      stop(
        paste(
          "Cloudflare upload failed.",
          "The version may be partially uploaded; retry with overwrite = TRUE only for the same generated files."
        ),
        call. = FALSE
      )
    }
  }

  for (field in names(media_lines)) {
    entry[[media_line_indexes[[field]]]] <- sprintf(
      "  %s: %s,",
      field,
      felix_js_string(media_lines[[field]])
    )
  }
  writeLines(entry, entry_path, useBytes = TRUE)

  message(sprintf("Published. Page entry updated: %s", entry_path))
  invisible(list(
    base_url = public_base_url,
    entry_path = entry_path,
    object_keys = paste(key_prefix, basename(files), sep = "/")
  ))
}
