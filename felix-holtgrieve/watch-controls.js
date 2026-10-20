function controlButton(label, action, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'video-control-button';
  button.dataset.videoAction = action;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function enhanceVideoPlayer(video) {
  if (!(video instanceof HTMLVideoElement) || video.dataset.controlsReady === 'true') return;

  video.dataset.controlsReady = 'true';
  video.controls = false;

  let shell = video.parentElement;
  if (!shell?.classList.contains('player-wrap')) {
    shell = document.createElement('div');
    shell.className = 'custom-video-shell';
    video.before(shell);
    shell.append(video);
  }
  shell.classList.add('custom-video-shell');

  const controls = document.createElement('div');
  controls.className = 'video-control-bar';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Video controls');

  const timeline = document.createElement('div');
  timeline.className = 'video-timeline';

  const seek = document.createElement('input');
  seek.className = 'video-seek';
  seek.type = 'range';
  seek.min = '0';
  seek.max = '0';
  seek.step = 'any';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Seek video');

  const time = document.createElement('span');
  time.className = 'video-time';
  time.textContent = '0:00 / 0:00';

  const playButton = controlButton('Play', 'play', () => {
    if (video.paused || video.ended) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });

  const audioButton = controlButton('Mute', 'mute', () => {
    video.muted = !video.muted;
  });

  const replayButton = controlButton('Replay', 'replay', () => {
    video.currentTime = 0;
    video.play().catch(() => {});
  });

  const captionsButton = controlButton('Captions', 'captions', () => {
    const tracks = [...video.textTracks];
    const showCaptions = !tracks.some((track) => track.mode === 'showing');
    tracks.forEach((track, index) => {
      track.mode = showCaptions && index === 0 ? 'showing' : 'disabled';
    });
    updateCaptionsState();
  });
  captionsButton.hidden = true;

  const fullscreenButton = controlButton('Fullscreen', 'fullscreen', () => {
    let fullscreenRequest;
    if (document.fullscreenElement) {
      fullscreenRequest = document.exitFullscreen?.();
    } else if (shell.requestFullscreen) {
      fullscreenRequest = shell.requestFullscreen();
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
    fullscreenRequest?.catch(() => {});
  });

  function updatePlaybackState() {
    playButton.textContent = !video.paused && !video.ended ? 'Pause' : 'Play';
  }

  function updateAudioState() {
    audioButton.textContent = video.muted || video.volume === 0 ? 'Unmute' : 'Mute';
  }

  function updateTimeline() {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    seek.max = String(duration);
    seek.value = String(Math.min(currentTime, duration));
    seek.disabled = duration === 0;
    seek.setAttribute('aria-valuetext', `${formatTime(currentTime)} of ${formatTime(duration)}`);
    time.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  }

  function updateCaptionsState() {
    const tracks = [...video.textTracks];
    captionsButton.hidden = tracks.length === 0;
    captionsButton.textContent = tracks.some((track) => track.mode === 'showing')
      ? 'Hide captions'
      : 'Captions';
  }

  seek.addEventListener('input', () => {
    video.currentTime = Number(seek.value);
    updateTimeline();
  });
  seek.addEventListener('keydown', (event) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const seekTimes = {
      ArrowDown: currentTime - 1,
      ArrowLeft: currentTime - 1,
      ArrowRight: currentTime + 1,
      ArrowUp: currentTime + 1,
      End: duration,
      Home: 0,
      PageDown: currentTime - 5,
      PageUp: currentTime + 5,
    };

    if (!(event.key in seekTimes)) return;
    event.preventDefault();
    video.currentTime = Math.max(0, Math.min(seekTimes[event.key], duration));
    updateTimeline();
  });
  video.addEventListener('click', () => playButton.click());
  video.addEventListener('play', updatePlaybackState);
  video.addEventListener('pause', updatePlaybackState);
  video.addEventListener('ended', updatePlaybackState);
  video.addEventListener('volumechange', updateAudioState);
  video.addEventListener('durationchange', updateTimeline);
  video.addEventListener('timeupdate', updateTimeline);
  video.addEventListener('emptied', updateTimeline);
  video.textTracks.addEventListener?.('addtrack', updateCaptionsState);
  video.textTracks.addEventListener?.('removetrack', updateCaptionsState);
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  });

  timeline.append(seek, time);
  controls.append(timeline, playButton, audioButton, replayButton, captionsButton, fullscreenButton);
  shell.append(controls);
  updatePlaybackState();
  updateAudioState();
  updateTimeline();
  updateCaptionsState();
}

document.querySelectorAll('video[data-custom-controls]').forEach(enhanceVideoPlayer);
