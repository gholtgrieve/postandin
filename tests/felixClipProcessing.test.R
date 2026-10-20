source("scripts/process-felix-clip.R")

assert_close <- function(actual, expected, tolerance = 1e-8) {
  stopifnot(length(actual) == length(expected))
  stopifnot(all(abs(actual - expected) <= tolerance))
}

expect_error <- function(expression, pattern) {
  message <- tryCatch({
    force(expression)
    ""
  }, error = function(error) conditionMessage(error))
  stopifnot(grepl(pattern, message, fixed = TRUE))
}

full_frame <- felix_crop_from_points(c(0, 1920), c(0, 1080), 1920, 1080)
assert_close(full_frame, c(x = 0, y = 0, width = 1, height = 1))

clamped_edges <- felix_crop_from_points(c(-100, 2020), c(-100, 1180), 1920, 1080)
assert_close(clamped_edges, c(x = 0, y = 0, width = 1, height = 1))

four_by_three <- felix_crop_from_points(c(0, 960), c(0, 720), 960, 720)
assert_close(four_by_three, c(x = 0, y = 0.125, width = 1, height = 0.75))

edge_crop <- felix_crop_from_points(c(700, 1000), c(400, 700), 960, 540)
felix_validate_crop(edge_crop)
stopifnot(edge_crop[["x"]] + edge_crop[["width"]] <= 1)
stopifnot(edge_crop[["y"]] + edge_crop[["height"]] <= 1)

rounded_edge <- felix_crop_from_points(c(39.59, 720), c(10, 400), 720, 405)
felix_validate_crop(rounded_edge)

crop_filter <- felix_crop_filter(four_by_three)
stopifnot(grepl("trunc\\(iw\\*1.00000000/2\\)\\*2", crop_filter))
stopifnot(grepl("trunc\\(ih\\*0.75000000/2\\)\\*2", crop_filter))

video_filter <- felix_video_filter(1280, 720, 30, 1.75, crop = four_by_three)
stopifnot(grepl("scale=1280:720,setsar=1,fps=30", video_filter, fixed = TRUE))
stopifnot(!grepl("force_original_aspect_ratio", video_filter, fixed = TRUE))

stacked_filter <- felix_stacked_video_filter(
  1280,
  720,
  30,
  2,
  primary_crop = four_by_three,
  secondary_crop = full_frame
)
stopifnot(grepl("[0:v:0]", stacked_filter, fixed = TRUE))
stopifnot(grepl("[1:v:0]", stacked_filter, fixed = TRUE))
stopifnot(grepl("loop=loop=59:size=1:start=0", stacked_filter, fixed = TRUE))
stopifnot(grepl("enable='lt(t,2.000000)'", stacked_filter, fixed = TRUE))
stopifnot(grepl("[primary-joined][marker]overlay", stacked_filter, fixed = TRUE))
stopifnot(!grepl("[secondary-joined][marker]", stacked_filter, fixed = TRUE))
stopifnot(grepl(
  "[primary-marked][secondary-joined]vstack=inputs=2",
  stacked_filter,
  fixed = TRUE
))

felix_validate_source_range(10, 5, 15, "secondary")
expect_error(
  felix_validate_source_range(10, 5.2, 15, "secondary"),
  "secondary source ends before the requested clip range is complete"
)

invalid_crop_failed <- tryCatch({
  felix_validate_crop(c(x = 0.9, y = 0, width = 0.2, height = 1))
  FALSE
}, error = function(error) TRUE)
stopifnot(invalid_crop_failed)

test_primary <- tempfile(fileext = ".mp4")
test_secondary <- tempfile(fileext = ".mp4")
invisible(file.create(test_primary, test_secondary))
on.exit(unlink(c(test_primary, test_secondary)), add = TRUE)
stacked_arguments <- list(
  primary_input = test_primary,
  secondary_input = test_secondary,
  start = "00:01",
  end = "00:02",
  secondary_start = "00:01",
  id = "test-stacked-clip",
  title = "Test clip",
  categories = "offensive",
  opponent = "Test opponent",
  date = "2026-10-20",
  output_dir = tempdir(),
  felix_position = c(x = 0.5, y = 0.5),
  highlight_seconds = 2
)

invalid_categories <- stacked_arguments
invalid_categories$categories <- "invalid"
expect_error(
  do.call(process_felix_stacked_clip, invalid_categories),
  "Categories must use one or more of"
)

invalid_highlight <- stacked_arguments
invalid_highlight$highlight_seconds <- 3.1
expect_error(
  do.call(process_felix_stacked_clip, invalid_highlight),
  "highlight_seconds must be greater than 0 and no more than 3"
)

inside_repository <- stacked_arguments
inside_repository$primary_input <- "scripts/process-felix-clip.R"
expect_error(
  do.call(process_felix_stacked_clip, inside_repository),
  "Keep source and generated video files outside the public repository"
)

message("Felix clip processing tests passed.")
