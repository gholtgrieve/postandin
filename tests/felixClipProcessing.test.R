source("scripts/process-felix-clip.R")

assert_close <- function(actual, expected, tolerance = 1e-8) {
  stopifnot(length(actual) == length(expected))
  stopifnot(all(abs(actual - expected) <= tolerance))
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

invalid_crop_failed <- tryCatch({
  felix_validate_crop(c(x = 0.9, y = 0, width = 0.2, height = 1))
  FALSE
}, error = function(error) TRUE)
stopifnot(invalid_crop_failed)

message("Felix clip processing tests passed.")
