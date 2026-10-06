import { categoryLabels, clips } from './clips.js';

const clipGrid = document.querySelector('#clipGrid');
const emptyLibrary = document.querySelector('#emptyLibrary');
const emptyTitle = emptyLibrary.querySelector('h3');
const emptyCopy = emptyLibrary.querySelector('p');
const seasonLabel = document.querySelector('.season-label');
const clipStatus = document.querySelector('#clipStatus');
const filterButtons = [...document.querySelectorAll('.filter-button')];
const clipDialog = document.querySelector('#clipDialog');
const dialogTitle = document.querySelector('#dialogTitle');
const dialogMeta = document.querySelector('#dialogMeta');
const dialogVideo = document.querySelector('#dialogVideo');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const supportsHover = window.matchMedia('(hover: hover)');

let activeCategory = 'all';
const previewTimers = new WeakMap();

const previewObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        ensurePreviewSource(entry.target);
        previewObserver.unobserve(entry.target);
      });
    }, { rootMargin: '400px 0px' })
  : null;

function displayDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function displayCategories(clip) {
  return clip.categories.map((category) => categoryLabels[category]).join(' · ');
}

function ensurePreviewSource(video) {
  if (prefersReducedMotion.matches || !supportsHover.matches || video.src || !video.dataset.src) return;
  video.src = video.dataset.src;
  video.preload = 'auto';
  video.load();
}

function startPreview(video) {
  if (prefersReducedMotion.matches) return;
  ensurePreviewSource(video);
  video.play().catch(() => {});
  clearTimeout(previewTimers.get(video));
  previewTimers.set(video, setTimeout(() => stopPreview(video), 5000));
}

function stopPreview(video) {
  clearTimeout(previewTimers.get(video));
  previewTimers.delete(video);
  video.pause();
  video.currentTime = 0;
}

function openFullClip(clip) {
  dialogTitle.textContent = clip.title;
  dialogMeta.textContent = `${displayCategories(clip)} · ${clip.opponent} · ${displayDate(clip.date)}`;
  dialogVideo.poster = clip.posterSrc || '';
  dialogVideo.src = clip.fullSrc;

  if (clip.captionsSrc) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = 'English';
    track.srclang = 'en';
    track.src = clip.captionsSrc;
    dialogVideo.append(track);
  }

  clipDialog.showModal();
  dialogVideo.play().catch(() => {});
}

function createClipCard(clip) {
  const card = document.createElement('article');
  card.className = 'clip-card';

  const preview = document.createElement('video');
  preview.className = 'clip-preview';
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = 'none';
  preview.poster = clip.posterSrc || '';
  preview.dataset.src = clip.previewSrc;
  preview.setAttribute('aria-hidden', 'true');
  previewObserver?.observe(preview);

  const details = document.createElement('div');
  details.className = 'clip-details';

  const category = document.createElement('p');
  category.className = 'clip-category';
  category.textContent = displayCategories(clip);

  const title = document.createElement('h3');
  title.className = 'clip-title';
  title.textContent = clip.title;

  const meta = document.createElement('p');
  meta.className = 'clip-meta';
  meta.textContent = `${clip.opponent} · ${displayDate(clip.date)}`;

  const watchButton = document.createElement('button');
  watchButton.className = 'watch-button';
  watchButton.type = 'button';
  watchButton.textContent = 'Watch full clip';
  watchButton.addEventListener('click', () => {
    stopPreview(preview);
    openFullClip(clip);
  });

  details.append(category, title, meta, watchButton);
  card.append(preview, details);

  card.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') startPreview(preview);
  });
  card.addEventListener('pointerleave', () => stopPreview(preview));
  card.addEventListener('focusin', (event) => {
    if (event.target.matches(':focus-visible')) startPreview(preview);
  });
  card.addEventListener('focusout', (event) => {
    if (!card.contains(event.relatedTarget)) stopPreview(preview);
  });

  return card;
}

function renderClips() {
  const visibleClips = activeCategory === 'all'
    ? clips
    : clips.filter((clip) => clip.categories.includes(activeCategory));

  clipGrid.querySelectorAll('.clip-preview').forEach((preview) => previewObserver?.unobserve(preview));
  clipGrid.replaceChildren(...visibleClips.map(createClipCard));
  emptyLibrary.hidden = visibleClips.length > 0;
  seasonLabel.textContent = clips.length
    ? `${clips.length} ${clips.length === 1 ? 'clip' : 'clips'}`
    : 'Clips coming soon';

  const categoryName = activeCategory === 'all' ? 'total' : categoryLabels[activeCategory].toLowerCase();
  clipStatus.textContent = visibleClips.length
    ? `Showing ${visibleClips.length} ${categoryName} ${visibleClips.length === 1 ? 'clip' : 'clips'}.`
    : activeCategory === 'all'
      ? 'No clips available yet.'
      : `No ${categoryName} clips available yet.`;

  if (!visibleClips.length && clips.length) {
    emptyTitle.textContent = `No ${categoryLabels[activeCategory]} clips yet.`;
    emptyCopy.textContent = 'Choose another play type or check back as the season develops.';
  } else if (!clips.length) {
    emptyTitle.textContent = 'The season starts here.';
    emptyCopy.textContent = 'Felix’s 2026–27 game clips will be added throughout the season, with each play labeled by date, opponent, and category.';
  }
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeCategory = button.dataset.category;
    filterButtons.forEach((candidate) => {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    });
    renderClips();
  });
});

clipDialog.addEventListener('close', () => {
  dialogVideo.pause();
  dialogVideo.removeAttribute('src');
  dialogVideo.replaceChildren();
  dialogVideo.load();
});

renderClips();
