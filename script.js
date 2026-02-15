const manifestInput = document.getElementById('manifestUrl');
const loadBtn = document.getElementById('loadBtn');
const photo = document.getElementById('photo') || document.getElementById('photo');
const displayImg = document.getElementById('photo') || document.getElementById('photo') || document.getElementById('photo');
const meta = document.getElementById('meta') || document.getElementById('meta');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
// Track the images length the user has been notified about / has seen.
// This prevents repeated nagging for the same new images until truly newer
// images arrive.
let lastNotifiedLen = 0;

let manifest = null;
let images = [];
let index = 0;
let baseUrl = '';

// Compute today's manifest URL in the format used by the archive
function computeManifestUrlForDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  // camera filename is known for this project
  return `https://archives.webcam-hd.com/${yyyy}/${mm}/${dd}/la-clusaz_balme.json`;
}

async function fetchManifest(url) {
  const res = await fetch(url, {cache: 'no-store'});
  if (!res.ok) throw new Error('Failed to load manifest');
  return res.json();
}

function resolveImagePath(manifestUrl, imageObj, size = 'src') {
  const val = imageObj && imageObj[size];
  if (!val) return '';
  // if value is absolute URL, return as-is
  if (/^https?:\/\//i.test(val) || /^\/\//.test(val)) return val;
  try {
    const u = new URL(manifestUrl);
    const folder = u.pathname.replace(/\/?[^/]*$/, '/');
    const cameraName = u.pathname.replace(/.*\//, '').replace(/\.json$/, '');
    const candidates = [];
    // common layouts to try (hour folder, camera name, html5)
    if (imageObj.hour_folder) {
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/${val}`);
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/${cameraName}/${val}`);
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/${cameraName}/html5/${val}`);
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/html5/${val}`);
    }
    // fallbacks
    candidates.push(`${u.origin}${folder}${cameraName}/${val}`);
    candidates.push(`${u.origin}${folder}${cameraName}/html5/${val}`);
    candidates.push(`${u.origin}${folder}${val}`);
    // only try candidates that include the html5 folder (others return 404)
    const html5Candidates = candidates.filter(c => c.includes('/html5/'));
    if (html5Candidates.length) return html5Candidates[0];
    return '';
  } catch (e) {
    return val;
  }
}

let probeToken = 0;
let userAction = false;
let boundaryCursor = null; // keeps the last boundary datetime for repeated shift-jumps
let boundaryMode = null; // '12h' or '24h' depending on last jump type
let boundaryCursorSetAt = 0; // epoch ms when boundaryCursor was set
function markUserAction() {
  userAction = true;
  
  setTimeout(() => { userAction = false; }, 350);
}
function showImage(i) {
  if (!images.length) return;
  // clamp index instead of wrapping
  const clamped = Math.max(0, Math.min(i, images.length - 1));
  // If there are pending images (newer manifest fetched) and the caller
  // is attempting to show the newest image while the user hasn't just
  // interacted, suppress this auto-jump so we don't change the user's
  // current view unexpectedly.
  if (pendingImages && clamped === images.length - 1 && !userAction) {
    
    return; // ignore non-user auto-jump to newest image
  }
  
  index = clamped;
  const img = images[index];
  // format hour (HHMM) to HH:MM when possible
  let displayHour = img.hour || '';
  if (/^\d{3,4}$/.test(displayHour)) {
    displayHour = displayHour.padStart(4, '0');
    displayHour = displayHour.slice(0,2) + ':' + displayHour.slice(2);
  }
  const label = (img.manifestLabel) ? img.manifestLabel : (manifest && manifest[0] && manifest[0].label) || '';
  // compute weekday abbreviation from manifestDate (expected YYYY-MM-DD)
  let weekday = '';
  const md = img.manifestDate || (manifest && manifest[0] && manifest[0].date) || '';
  if (md && /^\d{4}-\d{2}-\d{2}$/.test(md)) {
    const parts = md.split('-').map(p => parseInt(p, 10));
    // Month in Date constructor is 0-based
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    weekday = names[dt.getDay()];
  }
  meta.textContent = `${weekday ? weekday + ' ' : ''}${label} — ${displayHour}`;
  // show/hide navigation at bounds
  if (prevBtn) prevBtn.style.visibility = (index > 0) ? 'visible' : 'hidden';
  if (nextBtn) nextBtn.style.visibility = (index < images.length - 1) ? 'visible' : 'hidden';
  const token = ++probeToken;
  const baseForImage = img.manifestUrl || manifestInput.value;
  findFirstWorkingUrl(baseForImage, img, img.src_1080 ? 'src_1080' : 'src')
    .then(async (url) => {
      if (token !== probeToken) return; // stale
      if (!url) return;
      try {
        const processed = await cropAndJoinEdges(url, 840);
        photo.src = processed;
      } catch (e) {
        console.warn('Crop processing failed, falling back to original', e);
        photo.src = url;
      }
    })
    .catch(() => {});
  preload(index + 1);
  preload(index - 1);
  // If the user explicitly navigated to the newest image, consider them
  // up-to-date so the next animation only triggers for truly newer images.
  if (userAction && index === images.length - 1) {
    lastNotifiedLen = images.length;
    pendingImages = null;
    stopNextAnimation();
  }
}

function preload(i) {
  if (!images.length) return;
  const idx = (i + images.length) % images.length;
  const img = images[idx];
  // try to resolve working URL and let browser cache it
  const baseForImage = img.manifestUrl || manifestInput.value;
  findFirstWorkingUrl(baseForImage, img, 'src_1080')
    .then((url) => {
      if (!url) return findFirstWorkingUrl(baseForImage, img, 'src');
      const p = new Image();
      p.src = url;
    })
    .then((purl) => {
      if (purl) { const p = new Image(); p.src = purl; }
    })
    .catch(() => {});
}

function tryLoadImage(url, timeout = 3000) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, timeout);
    img.onload = () => { if (!settled) { settled = true; clearTimeout(t); resolve(true); } };
    img.onerror = () => { if (!settled) { settled = true; clearTimeout(t); resolve(false); } };
    img.src = url;
  });
}

async function findFirstWorkingUrl(manifestUrl, imageObj, size = 'src') {
  const val = imageObj && imageObj[size];
  if (!val) return '';
  if (/^https?:\/\//i.test(val) || /^\/\//.test(val)) return val;
  try {
    const u = new URL(manifestUrl);
    const folder = u.pathname.replace(/\/?[^/]*$/, '/');
    const cameraName = u.pathname.replace(/.*\//, '').replace(/\.json$/, '');
    const candidates = [];
    if (imageObj.hour_folder) {
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/${val}`);
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/${cameraName}/${val}`);
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/${cameraName}/html5/${val}`);
      candidates.push(`${u.origin}${folder}${imageObj.hour_folder}/html5/${val}`);
    }
    candidates.push(`${u.origin}${folder}${cameraName}/${val}`);
    candidates.push(`${u.origin}${folder}${cameraName}/html5/${val}`);
    candidates.push(`${u.origin}${folder}${val}`);

    // restrict to html5 variants only to avoid known 404s
    const html5Candidates = candidates.filter(c => c.includes('/html5/'));
    if (html5Candidates.length === 0) return '';
    for (const c of html5Candidates) {
      // try each until one loads
      // eslint-disable-next-line no-await-in-loop
      const ok = await tryLoadImage(c, 2500);
      if (ok) return c;
    }
    return '';
  } catch (e) {
    return val;
  }
}

async function load() {
  try {
    manifest = await fetchManifest(manifestInput.value);
    images = (manifest[0] && manifest[0].images) || [];
    // Tag each image with the manifest URL, manifest label and date it came from
    // so that image URL resolution and the displayed label use the
    // correct date folder when previous-day manifests are prepended.
    const currentLabel = (manifest[0] && manifest[0].label) || '';
    const currentDate = (manifest[0] && manifest[0].date) || '';
    images.forEach(img => { if (img) { img.manifestUrl = manifestInput.value; img.manifestLabel = currentLabel; img.manifestDate = currentDate; } });
    // default to last image
    
    boundaryCursor = null;
    // mark that the user is up-to-date with the currently loaded images
    lastNotifiedLen = images.length;
    showImage(images.length - 1);
    // poll manifest every 30s
    startPolling();
  } catch (e) {
    alert('Error loading manifest: ' + e.message);
  }
}

let pollTimer = null;
let pendingImages = null;
const nextButton = document.getElementById('next');
function startNextAnimation() {
  if (!nextButton) return;
  nextButton.classList.add('next-animate');
}
function stopNextAnimation() {
  if (!nextButton) return;
  nextButton.classList.remove('next-animate');
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    
    try {
      const latest = await fetchManifest(manifestInput.value);
      const latestImages = (latest[0] && latest[0].images) || [];
      
      if (latestImages.length !== images.length) {
        const oldLen = images.length;
        const added = latestImages.length - oldLen;
        // Ensure fetched images are tagged with the manifest URL and label
        const currentLabel = (latest[0] && latest[0].label) || '';
        const currentDate = (latest[0] && latest[0].date) || '';
        latestImages.forEach(img => { if (img) { img.manifestUrl = manifestInput.value; img.manifestLabel = currentLabel; img.manifestDate = currentDate; } });
        // If user is viewing the latest image (at or beyond the previous
        // last index), update immediately and show the newest image.
        // Note: do NOT compare `index` to `latestImages.length` because
        // `index` is an index into the combined `images` array, while
        // `latestImages` only contains the single-day manifest. Comparing
        // them caused incorrect immediate updates after prepending older
        // images. Only check against `oldLen - 1` (previous last index).
        if (index >= oldLen - 1) {
          images = latestImages;
          showImage(images.length - 1);
          pendingImages = null;
          // user is now up-to-date
          lastNotifiedLen = images.length;
          stopNextAnimation();
        } else {
          // User is browsing older images: store newly-fetched set in
          // `pendingImages`. Only animate if these are newer than the
          // last-notified count to avoid nagging repeatedly.
          pendingImages = latestImages;
          if (latestImages.length > lastNotifiedLen) startNextAnimation();
        }
      }
    } catch (e) {
      console.warn('Manifest poll failed', e);
    }
  }, 30000);
}

loadBtn.addEventListener('click', load);
prevBtn.addEventListener('click', async () => {
  markUserAction();
  boundaryCursor = null;
  if (index > 0) return showImage(index - 1);
  // at first image: try to load previous day's manifest and prepend images
  const added = await fetchAndPrependPreviousDay();
  if (added && added > 0) {
    // show the last image of the newly-prepended previous day
    markUserAction();
    boundaryCursor = null;
    showImage(added - 1);
  }
});
nextBtn.addEventListener('click', () => {
  markUserAction();
  // If we have pending images, promote them and navigate to newest
  if (pendingImages && Array.isArray(pendingImages)) {
    images = pendingImages;
    pendingImages = null;
    boundaryCursor = null;
    // user accepted/consumed the new images
    lastNotifiedLen = images.length;
    stopNextAnimation();
    return showImage(images.length - 1);
  }
  if (index < images.length - 1) showImage(index + 1);
});

// Crop is applied by default; no toggle required.

document.addEventListener('keydown', async (e) => {
  // debug: log key presses and modifiers
  try {
    const ctrlState = !!e.ctrlKey || (typeof e.getModifierState === 'function' && e.getModifierState('Control'));
    const curImg = (images && images.length && typeof index === 'number') ? images[index] : null;
    const curHour = curImg && curImg.hour ? curImg.hour : '';
    const msg = `keyDown: ${e.key} shift=${!!e.shiftKey} ctrl=${ctrlState} alt=${!!e.altKey} meta=${!!e.metaKey} index=${(typeof index==='number'?index:'-')} hour=${curHour}`;
    console.debug(msg);
  } catch (err) {
    // ignore logging errors
  }
  // Semantic jump behavior for shift+arrow:
  // - shift+Left: jump to the first image of the current image's day (or, if already at that day's first, fetch previous day and jump to its first)
  // - shift+Right: jump to the first afternoon image (hour >= 1200) of the current day; if none, jump to the first image of the next available day
  // Preserve single-step left/right otherwise.
  // Helper to find the first index in `images` matching a predicate
  function findFirstIndexFrom(startIdx, predicate) {
    for (let i = startIdx; i < images.length; i++) {
      if (predicate(images[i], i)) return i;
    }
    return -1;
  }

  // find the range (start index and end index) of images that share the same manifestDate as images[idx]
  function findDayRangeForIndex(idx) {
    if (!images.length || idx < 0 || idx >= images.length) return { start: 0, end: images.length - 1 };
    const day = images[idx].manifestDate || images[idx].manifestDate || '';
    let start = idx;
    while (start > 0 && images[start - 1].manifestDate === day) start--;
    let end = idx;
    while (end < images.length - 1 && images[end + 1].manifestDate === day) end++;
    return { start, end };
  }

  // Parse image datetime helper (used by both left and right handlers)
  function parseImageDateTime(img) {
    if (!img) return null;
    const md = img.manifestDate || '';
    let hour = String(img.hour || '0000').padStart(4, '0');
    if (!/^[0-9]{3,4}$/.test(hour)) hour = '0000';
    const hh = parseInt(hour.slice(0,2), 10);
    const mm = parseInt(hour.slice(2), 10);
    if (!/^\d{4}$/.test(hour) || !md) return null;
    const parts = md.split('-').map(p => parseInt(p,10));
    if (parts.length !== 3 || Number.isNaN(parts[0])) return null;
    return new Date(parts[0], parts[1]-1, parts[2], hh, mm, 0, 0);
  }

  function previous12hBoundary(dt) {
    const h = dt.getHours();
    const m = dt.getMinutes();
    const s = dt.getSeconds();
    let boundaryHour = Math.floor(h / 12) * 12;
    if (h % 12 === 0 && m === 0 && s === 0) boundaryHour -= 12;
    if (boundaryHour < 0) {
      const out = new Date(dt);
      out.setDate(dt.getDate() - 1);
      out.setHours(12, 0, 0, 0);
      return out;
    }
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), boundaryHour, 0, 0, 0);
  }

  function next12hBoundary(dt) {
    const h = dt.getHours();
    const m = dt.getMinutes();
    const s = dt.getSeconds();
    if (h % 12 === 0 && m === 0 && s === 0) {
      const out = new Date(dt);
      out.setHours(h + 12);
      if (out.getHours() >= 24) {
        out.setDate(out.getDate() + 1);
        out.setHours(0, 0, 0, 0);
      }
      return out;
    }
    const boundaryHour = Math.floor(h / 12) * 12 + 12;
    if (boundaryHour >= 24) {
      const out = new Date(dt);
      out.setDate(dt.getDate() + 1);
      out.setHours(0, 0, 0, 0);
      return out;
    }
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), boundaryHour, 0, 0, 0);
  }

  function previousOrSame12hBoundary(dt) {
    const h = dt.getHours();
    const m = dt.getMinutes();
    const s = dt.getSeconds();
    if (h % 12 === 0 && m === 0 && s === 0) return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), h, 0, 0, 0);
    return previous12hBoundary(dt);
  }

  function nextOrSame12hBoundary(dt) {
    const h = dt.getHours();
    const m = dt.getMinutes();
    const s = dt.getSeconds();
    if (h % 12 === 0 && m === 0 && s === 0) return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), h, 0, 0, 0);
    return next12hBoundary(dt);
  }

  function nearest12hBoundary(dt) {
    const prev = previousOrSame12hBoundary(dt);
    const next = nextOrSame12hBoundary(dt);
    if (!prev) return next;
    if (!next) return prev;
    const dPrev = Math.abs(dt - prev);
    const dNext = Math.abs(next - dt);
    return (dPrev <= dNext) ? prev : next;
  }

  function previous24hBoundary(dt) {
    const ref12 = nearest12hBoundary(dt);
    const out = new Date(ref12);
    out.setDate(out.getDate() - 1);
    return out;
  }

  function next24hBoundary(dt) {
    const ref12 = nearest12hBoundary(dt);
    const out = new Date(ref12);
    out.setDate(out.getDate() + 1);
    return out;
  }

  function findFirstIndexAtOrAfterDatetime(targetDt) {
    if (!targetDt || !images.length) return -1;
    for (let i = 0; i < images.length; i++) {
      const dt = parseImageDateTime(images[i]);
      if (!dt) continue;
      if (dt >= targetDt) return i;
    }
    return -1;
  }

  if (e.key === 'ArrowLeft') {
    if (e.shiftKey) {
      // Semantic backward jump: by default 12-hour boundary (midnight or noon).
      // When Ctrl is also pressed, jump to 24-hour boundary (midnight only).
      // Build current image datetime
      // use centralized datetime helpers

      const isCtrl = e.ctrlKey || (typeof e.getModifierState === 'function' && e.getModifierState('Control'));
      const desiredMode = isCtrl ? '24h' : '12h';
      const curDt = parseImageDateTime(images[index]) || new Date();
      // only reuse boundaryCursor if it matches desired mode and is close to current image time
      let baseDt;
      let usedCursor = false;
      const now = Date.now();
      const AGE_LIMIT = 2 * 60 * 1000; // 2 minutes
      if (boundaryCursor && boundaryMode === desiredMode && (now - (boundaryCursorSetAt || 0) <= AGE_LIMIT)) {
        baseDt = boundaryCursor; usedCursor = true;
      } else {
        baseDt = curDt;
      }
      console.debug(`Shift+Left start mode=${desiredMode} base_iso=${baseDt ? baseDt.toISOString() : 'null'} base_local=${baseDt ? baseDt.toLocaleString() : 'null'} index=${(typeof index==='number'?index:'-')} hour=${(images[index] && images[index].hour) ? images[index].hour : ''} usedCursor=${usedCursor}`);
      // Choose 24h or 12h target depending on Ctrl key
      let targetDt = isCtrl ? previous24hBoundary(baseDt) : previous12hBoundary(baseDt);
      // If the target is earlier than our earliest loaded image, try fetching previous days until we cover it or run out
      // Fetch previous days by date until the target datetime is covered
      // or no previous-day manifest can be found. This uses date arithmetic
      // and direct fetch to avoid depending on `fetchAndPrependPreviousDay`.
      let earliestDt = images.length ? parseImageDateTime(images[0]) : null;
      // Start cursorDate from the earliest known date if available, otherwise from currentDt
      let cursorDate = earliestDt ? new Date(earliestDt) : new Date(currentDt);
      // Safety: limit how many days we try to fetch to avoid infinite loops
      const MAX_BACK_DAYS = 30;
      let attempts = 0;
      while (true) {
        
        if (earliestDt && targetDt >= earliestDt) break;
        if (attempts++ >= MAX_BACK_DAYS) { break; }
        // step back one day from cursorDate
        cursorDate.setDate(cursorDate.getDate() - 1);
        const prevUrl = computeManifestUrlForDate(cursorDate);
        try {
          const prevManifest = await fetchManifest(prevUrl);
          const prevImages = (prevManifest[0] && prevManifest[0].images) || [];
          if (!prevImages.length) {
          
            continue; // try the day before
          }
          const prevLabel = (prevManifest[0] && prevManifest[0].label) || '';
          const prevDate = (prevManifest[0] && prevManifest[0].date) || '';
          prevImages.forEach(img => { if (img) { img.manifestUrl = prevUrl; img.manifestLabel = prevLabel; img.manifestDate = prevDate; } });
          images = prevImages.concat(images);
          
          earliestDt = parseImageDateTime(images[0]);
          // continue loop until earliestDt is earlier than or equal to targetDt
        } catch (err) {
          
          // try the previous day
          continue;
        }
      }
      let targetIdx = findFirstIndexAtOrAfterDatetime(targetDt);
      if (targetIdx === -1) targetIdx = 0;
      // update boundaryCursor and mode so repeated shift-left continues stepping with same mode
      boundaryCursor = targetDt;
      boundaryMode = desiredMode;
      boundaryCursorSetAt = Date.now();
      console.debug(`Shift+Left target mode=${desiredMode} target_iso=${targetDt ? targetDt.toISOString() : 'null'} target_local=${targetDt ? targetDt.toLocaleString() : 'null'} index=${targetIdx}`);
      markUserAction();
      return showImage(targetIdx);
    }
    // single step
    boundaryCursor = null;
    if (index > 0) { markUserAction(); return showImage(index - 1); }
    const added = await fetchAndPrependPreviousDay();
    console.debug(`Shift+Left at first image, fetched previous day added=${added} index=${(typeof index==='number'?index:'-')}`);
    if (added && added > 0) { markUserAction(); showImage(added - 1); }
    return;
  }

  if (e.key === 'ArrowRight') {
    if (e.shiftKey) {
      // Semantic forward jump: by default 12-hour boundary (noon or midnight).
      // When Ctrl is also pressed, jump to 24-hour boundary (midnight only).
      // use centralized datetime helpers

      const isCtrlR = e.ctrlKey || (typeof e.getModifierState === 'function' && e.getModifierState('Control'));
      const desiredModeR = isCtrlR ? '24h' : '12h';
      const curDtR = parseImageDateTime(images[index]) || new Date();
      let baseDtR;
      let usedCursorR = false;
      if (boundaryCursor && boundaryMode === desiredModeR) {
        const deltaR = Math.abs(curDtR - boundaryCursor);
        if (deltaR <= 15 * 60 * 1000) { baseDtR = boundaryCursor; usedCursorR = true; } else { baseDtR = curDtR; }
      } else { baseDtR = curDtR; }
      console.debug(`Shift+Right start mode=${desiredModeR} base_iso=${baseDtR ? baseDtR.toISOString() : 'null'} base_local=${baseDtR ? baseDtR.toLocaleString() : 'null'} index=${(typeof index==='number'?index:'-')} hour=${(images[index] && images[index].hour) ? images[index].hour : ''} usedCursor=${usedCursorR}`);
      // Choose 24h or 12h target depending on Ctrl key
      let targetDt = isCtrlR ? next24hBoundary(baseDtR) : next12hBoundary(baseDtR);
      // If target is beyond our last loaded image, try fetching next days until covered
      // We'll append next day's images using fetchAndAppendNextDay
      async function ensureTargetCovered(target) {
        if (!images.length) return;
        let lastDt = parseImageDateTime(images[images.length - 1]);
        while (lastDt && target > lastDt) {
          const added = await fetchAndAppendNextDay();
          if (!added || added === 0) break;
          lastDt = parseImageDateTime(images[images.length - 1]);
        }
      }

      await ensureTargetCovered(targetDt);
      let targetIdx = findFirstIndexAtOrAfterDatetime(targetDt);
      if (targetIdx === -1) targetIdx = images.length - 1;
      // update boundaryCursor and mode so repeated shift-right continues stepping with same mode
      boundaryCursor = targetDt;
      boundaryMode = desiredModeR;
      boundaryCursorSetAt = Date.now();
      console.debug(`Shift+Right target mode=${desiredModeR} target_iso=${targetDt ? targetDt.toISOString() : 'null'} target_local=${targetDt ? targetDt.toLocaleString() : 'null'} index=${targetIdx} usedCursor=${usedCursorR}`);
      markUserAction();
      return showImage(targetIdx);
    }
    boundaryCursor = null;
    if (index < images.length - 1) { markUserAction(); showImage(index + 1); }
  }
});

// Fetch and prepend previous day's manifest images based on current manifest input
async function fetchAndPrependPreviousDay() {
  try {
    // Determine the manifest URL representing the earliest-loaded day.
    // Use images[0].manifestUrl when available so repeated calls go back
    // further than the original manifest input.
    const earliest = (images && images.length && images[0].manifestUrl) ? images[0].manifestUrl : manifestInput.value;
    if (!earliest) return 0;
    const u = new URL(earliest);
    const parts = u.pathname.split('/').filter(Boolean);
    // expect /YYYY/MM/DD/name.json
    if (parts.length < 4) return 0;
    const yyyy = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10) - 1;
    const dd = parseInt(parts[2], 10);
    const d = new Date(yyyy, mm, dd);
    d.setDate(d.getDate() - 1);
    const prevUrl = computeManifestUrlForDate(d);
    // avoid loops: if prevUrl equals earliest manifest input, bail
    if (prevUrl === earliest) return 0;
    const prevManifest = await fetchManifest(prevUrl);
    const prevImages = (prevManifest[0] && prevManifest[0].images) || [];
    if (!prevImages.length) return 0;
    // Tag previous-day images with their manifest URL and label so
    // resolution and display use the correct YYYY/MM/DD folder/label.
    const prevLabel = (prevManifest[0] && prevManifest[0].label) || '';
    const prevDate = (prevManifest[0] && prevManifest[0].date) || '';
    prevImages.forEach(img => { if (img) { img.manifestUrl = prevUrl; img.manifestLabel = prevLabel; img.manifestDate = prevDate; } });
    // prepend so that chronological order remains: prevImages then existing images
    images = prevImages.concat(images);
    
    return prevImages.length;
  } catch (err) {
    console.warn('Failed to fetch previous day manifest', err);
    return 0;
  }
}

// Fetch and append next day's manifest images based on the latest manifest in `images`
async function fetchAndAppendNextDay() {
  try {
    // Determine the manifest URL representing the latest-loaded day.
    const latest = (images && images.length && images[images.length - 1].manifestUrl) ? images[images.length - 1].manifestUrl : manifestInput.value;
    if (!latest) return 0;
    const u = new URL(latest);
    const parts = u.pathname.split('/').filter(Boolean);
    // expect /YYYY/MM/DD/name.json
    if (parts.length < 4) return 0;
    const yyyy = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10) - 1;
    const dd = parseInt(parts[2], 10);
    const d = new Date(yyyy, mm, dd);
    d.setDate(d.getDate() + 1);
    const nextUrl = computeManifestUrlForDate(d);
    // avoid loops: if nextUrl equals latest manifest input, bail
    if (nextUrl === latest) return 0;
    const nextManifest = await fetchManifest(nextUrl);
    const nextImages = (nextManifest[0] && nextManifest[0].images) || [];
    if (!nextImages.length) return 0;
    const nextLabel = (nextManifest[0] && nextManifest[0].label) || '';
    const nextDate = (nextManifest[0] && nextManifest[0].date) || '';
    nextImages.forEach(img => { if (img) { img.manifestUrl = nextUrl; img.manifestLabel = nextLabel; img.manifestDate = nextDate; } });
    // append so chronological order remains
    images = images.concat(nextImages);
    
    return nextImages.length;
  } catch (err) {
    console.warn('Failed to fetch next day manifest', err);
    return 0;
  }
}

// Auto-load on open
window.addEventListener('load', () => {
  // if the manifest input is empty, populate with today's manifest URL
  try {
    if (manifestInput && !manifestInput.value) {
      manifestInput.value = computeManifestUrlForDate();
    }
  } catch (e) {
    // ignore
  }
  load();
});

// Crop-and-join helper: extracts rightmost and leftmost `stripWidth` pixels,
// swaps them and concatenates side-by-side. Returns a data URL.
// Default `stripWidth` is 840 to include an extra 50px on each side vs prior 740.
async function cropAndJoinEdges(imageUrl, stripWidth = 840) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const h = img.naturalHeight;
        const w = img.naturalWidth;
        const s = Math.min(stripWidth, Math.floor(w / 2));
        const canvas = document.createElement('canvas');
        canvas.width = s * 2;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // Left part comes from rightmost strip of source
        ctx.drawImage(img, w - s, 0, s, h, 0, 0, s, h);
        // Right part comes from leftmost strip of source
        ctx.drawImage(img, 0, 0, s, h, s, 0, s, h);

        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (e) => reject(new Error('Failed to load image for processing'));
    img.src = imageUrl;
  });
}

// Magnifier: circular lens over the image
const magnifier = document.getElementById('magnifier');
// Default magnification is 1.5× and magnifier is hidden until wheel used
let magnifierZoom = 1.5;
const zoomLabel = document.getElementById('zoomLabel');
let zoomLabelTimer = null;
let lastPointer = null;
let magnifierActive = false;
const magnifierTicks = document.getElementById('magnifierTicks');


// Help dialog elements
const helpBtn = document.getElementById('helpBtn');
const helpDialogOverlay = document.getElementById('helpDialog');
const helpCloseBtn = document.getElementById('helpCloseBtn');

function openHelp() {
  if (!helpDialogOverlay) return;
  helpDialogOverlay.hidden = false;
  // save previously focused element
  helpDialogOverlay._previouslyFocused = document.activeElement;
  // focus first focusable item inside dialog
  const focusable = helpDialogOverlay.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable) focusable.focus();
  // simple focus trap
  document.addEventListener('focus', trapFocus, true);
  document.addEventListener('keydown', onHelpKeydown);
}

function closeHelp() {
  if (!helpDialogOverlay) return;
  helpDialogOverlay.hidden = true;
  document.removeEventListener('focus', trapFocus, true);
  document.removeEventListener('keydown', onHelpKeydown);
  const prev = helpDialogOverlay._previouslyFocused;
  if (prev && typeof prev.focus === 'function') prev.focus();
}

function trapFocus(e) {
  if (!helpDialogOverlay || helpDialogOverlay.hidden) return;
  if (!helpDialogOverlay.contains(e.target)) {
    e.stopPropagation();
    helpDialogOverlay.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
  }
}

function onHelpKeydown(e) {
  if (e.key === 'Escape') { closeHelp(); }
}

if (helpBtn) helpBtn.addEventListener('click', openHelp);
if (helpCloseBtn) helpCloseBtn.addEventListener('click', closeHelp);
if (helpDialogOverlay) {
  helpDialogOverlay.addEventListener('click', (ev) => {
    if (ev.target === helpDialogOverlay) closeHelp();
  });
}

function drawGraduation(zoom) {
  if (!magnifierTicks || !magnifier) return;
  const wrapRect = photo.parentElement.getBoundingClientRect();
  const mw = magnifier.offsetWidth;
  const mh = magnifier.offsetHeight;
  // size canvas to pixel size for crisp rendering
  magnifierTicks.width = mw * devicePixelRatio;
  magnifierTicks.height = mh * devicePixelRatio;
  magnifierTicks.style.width = mw + 'px';
  magnifierTicks.style.height = mh + 'px';
  const ctx = magnifierTicks.getContext('2d');
  ctx.clearRect(0,0,magnifierTicks.width,magnifierTicks.height);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const cx = mw/2;
  const cy = mh/2;
  // If magnifier size is too small (or not yet measured), bail out to avoid negative radius.
  if (mw < 20 || mh < 20) {
    magnifierTicks.style.display = 'none';
    ctx.restore();
    return;
  }
  const radius = Math.min(mw, mh)/2 - 6; // inside border
  const clampedRadius = Math.max(4, radius);
  // subtle outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, clampedRadius + 3, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // draw progress arc only (no ticks)
  const maxZoom = 8;
  const frac = Math.max(0, Math.min(1, (zoom - 1) / (maxZoom - 1)));
  if (frac > 0) {
    ctx.beginPath();
    const start = -Math.PI/2;
    const end = start + frac * Math.PI * 2;
    // draw the arc slightly inward so it sits on top of the white magnifier border
    const arcRadius = Math.max(2, clampedRadius + 3);
    ctx.arc(cx, cy, arcRadius, start, end);
    ctx.strokeStyle = 'rgba(0,170,255,0.95)';
    // wider stroke so the blue visibly overlays the white border
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    // (Removed small knob/dot — it cluttered the UI)
  }

  // subtle inner glow proportional to zoom intensity
  const glowSize = Math.min(12, (zoom - 1) * 3);
  if (glowSize > 0) {
    const g = ctx.createRadialGradient(cx, cy, radius - 10, cx, cy, radius + 6);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.02 * glowSize) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 6, 0, Math.PI*2);
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
}
function updateMagnifier(e) {
  if (!magnifier || !photo.src) return;
  // Only update/display when magnifier has been activated by wheel
  if (!magnifierActive) return;
  if (!photo.complete || !photo.naturalWidth) { magnifier.style.display = 'none'; return; }
  const rect = photo.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
    hideMagnifier();
    return;
  }
  // show magnifier
  magnifier.style.display = 'block';

  const mw = magnifier.offsetWidth;
  const mh = magnifier.offsetHeight;

  // compute based on displayed size so magnifier reflects what user sees
  const dx = rect.width;
  const dy = rect.height;

  // position magnifier centered on cursor, but keep inside image bounds
  let left = e.clientX - mw / 2;
  let top = e.clientY - mh / 2;
  // clamp within imageWrap to avoid overflow
  const wrapRect = photo.parentElement.getBoundingClientRect();
  left = Math.max(wrapRect.left, Math.min(left, wrapRect.right - mw));
  top = Math.max(wrapRect.top, Math.min(top, wrapRect.bottom - mh));
  magnifier.style.left = (left - wrapRect.left) + 'px';
  magnifier.style.top = (top - wrapRect.top) + 'px';

  // position the ticks canvas on top of the magnifier so graduations follow
  if (magnifierTicks) {
    magnifierTicks.style.left = magnifier.style.left;
    magnifierTicks.style.top = magnifier.style.top;
    magnifierTicks.style.display = 'block';
    drawGraduation(magnifierZoom);
  }

  // compute background position: map cursor to displayed coordinates and apply zoom
  const bgPosX = -(x * magnifierZoom - mw / 2);
  const bgPosY = -(y * magnifierZoom - mh / 2);

  magnifier.style.backgroundImage = `url(${photo.src})`;
  magnifier.style.backgroundSize = `${dx * magnifierZoom}px ${dy * magnifierZoom}px`;
  magnifier.style.backgroundPosition = `${bgPosX}px ${bgPosY}px`;
}

if (photo && magnifier) {
  // Ensure magnifier is hidden initially
  magnifier.style.display = 'none';

  // Track pointer so we can position magnifier when activated by wheel
  photo.addEventListener('mousemove', (e) => { lastPointer = e; if (magnifierActive) { updateMagnifier(e); } });
  // Do not hide on mouseleave; magnifier visibility is controlled solely by zoom level
  photo.addEventListener('mouseleave', () => { if (magnifierZoom <= 1.0) hideMagnifier(); });

  // Show/adjust magnifier only when user uses the wheel over the photo
  photo.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    // Activate magnifier if not already
    if (!magnifierActive) {
      magnifierActive = true;
      // default zoom remains at magnifierZoom (1.5)
    }
    // adjust zoom based on wheel direction
    // Reach 8× from the default 1.5× in 8 wheel 'ticks'
    const ZOOM_STEP = (8 - 1.5) / 8; // 0.8125 per step
    const delta = ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    // allow zoom down to 1.0 (which hides the magnifier)
    magnifierZoom = Math.max(1.0, Math.min(8, magnifierZoom + delta));

    // show zoom label above magnifier
      // draw graduations around the magnifier instead of numeric label
      if (magnifierTicks) {
        // position canvas on top of magnifier
        const wrapRect = photo.parentElement.getBoundingClientRect();
        const mw = magnifier.offsetWidth;
        const mh = magnifier.offsetHeight;
        const leftPx = (magnifier.style.left) ? (wrapRect.left + parseFloat(magnifier.style.left)) : ev.clientX - mw/2;
        const topPx = (magnifier.style.top) ? (wrapRect.top + parseFloat(magnifier.style.top)) : ev.clientY - mh/2;
        magnifierTicks.style.left = (leftPx - wrapRect.left) + 'px';
        magnifierTicks.style.top = (topPx - wrapRect.top) + 'px';
        magnifierTicks.style.display = 'block';
        drawGraduation(magnifierZoom);
      }

    // update magnifier position/content using the wheel event coordinates
    // Some wheel events (touchpad, etc.) may not include clientX/clientY.
    // Synthesize an event-like object using the last known pointer or the image center.
    let pointerEvent = ev;
    if (typeof ev.clientX === 'undefined' || ev.clientX === null) {
      const wrapRect = photo.parentElement.getBoundingClientRect();
      const centerX = wrapRect.left + wrapRect.width / 2;
      const centerY = wrapRect.top + wrapRect.height / 2;
      pointerEvent = {
        clientX: lastPointer ? lastPointer.clientX : centerX,
        clientY: lastPointer ? lastPointer.clientY : centerY
      };
    }
    lastPointer = pointerEvent;
    // If zoom has been lowered to 1.0, consider magnifier deactivated and hide it
    if (magnifierZoom <= 1.0) {
      hideMagnifier();
    } else {
      if (!magnifierActive) magnifierActive = true;
      updateMagnifier(pointerEvent);
      if (magnifierTicks) drawGraduation(magnifierZoom);
    }
  }, { passive: false });
}

// Refresh magnifier content when the image finishes loading (e.g., after navigation)
if (photo) {
  photo.addEventListener('load', () => {
    if (lastPointer && magnifierActive) {
      // refresh magnifier when image finishes loading
      updateMagnifier(lastPointer);
    }
  });
}

function hideMagnifier() {
  if (!magnifier) return;
  magnifier.style.display = 'none';
  magnifierActive = false;
  if (zoomLabel) {
    zoomLabel.style.display = 'none';
    if (zoomLabelTimer) { clearTimeout(zoomLabelTimer); zoomLabelTimer = null; }
  }
  if (magnifierTicks) {
    magnifierTicks.style.display = 'none';
    const ctx = magnifierTicks.getContext && magnifierTicks.getContext('2d');
    if (ctx) ctx.clearRect(0,0,magnifierTicks.width || 0, magnifierTicks.height || 0);
  }
}

// ===== Touch gesture support for iPhone / mobile =====
(function setupTouchGestures() {
  if (!photo) return;
  const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!isTouchDevice) return;

  // --- Swipe to navigate ---
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let touchMoved = false;
  const SWIPE_THRESHOLD = 50;   // min px for a swipe
  const SWIPE_MAX_Y = 80;      // max vertical drift to still count as horizontal swipe
  const SWIPE_MAX_TIME = 400;   // ms

  // --- Pinch to zoom (magnifier) ---
  let pinchStartDist = 0;
  let pinchStartZoom = 1.5;
  let isPinching = false;

  function getTouchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getTouchCenter(t1, t2) {
    return {
      clientX: (t1.clientX + t2.clientX) / 2,
      clientY: (t1.clientY + t2.clientY) / 2
    };
  }

  photo.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      touchMoved = false;
    }
    if (e.touches.length === 2) {
      // Start pinch
      isPinching = true;
      pinchStartDist = getTouchDistance(e.touches[0], e.touches[1]);
      pinchStartZoom = magnifierZoom;
      e.preventDefault();
    }
  }, { passive: false });

  photo.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && isPinching) {
      e.preventDefault();
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      const scale = dist / pinchStartDist;
      magnifierZoom = Math.max(1.0, Math.min(8, pinchStartZoom * scale));

      // Activate and position magnifier at pinch center
      const center = getTouchCenter(e.touches[0], e.touches[1]);
      if (magnifierZoom > 1.0) {
        if (!magnifierActive) magnifierActive = true;
        updateMagnifier(center);
        if (magnifierTicks) drawGraduation(magnifierZoom);
      } else {
        hideMagnifier();
      }
      return;
    }

    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchMoved = true;
    }
  }, { passive: false });

  photo.addEventListener('touchend', (e) => {
    if (isPinching) {
      isPinching = false;
      // If zoom dropped to 1, hide magnifier
      if (magnifierZoom <= 1.0) hideMagnifier();
      return;
    }

    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const elapsed = Date.now() - touchStartTime;

    // Only handle swipe if it's a clear horizontal gesture
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_MAX_Y && elapsed < SWIPE_MAX_TIME) {
      markUserAction();
      boundaryCursor = null;
      if (dx < 0) {
        // Swipe left -> next image
        if (pendingImages && Array.isArray(pendingImages)) {
          images = pendingImages;
          pendingImages = null;
          lastNotifiedLen = images.length;
          stopNextAnimation();
          showImage(images.length - 1);
        } else if (index < images.length - 1) {
          showImage(index + 1);
        }
      } else {
        // Swipe right -> previous image
        if (index > 0) {
          showImage(index - 1);
        } else {
          fetchAndPrependPreviousDay().then((added) => {
            if (added && added > 0) {
              markUserAction();
              showImage(added - 1);
            }
          });
        }
      }
    }
  }, { passive: true });

  // Cancel pinch if touches go away unexpectedly
  photo.addEventListener('touchcancel', () => {
    isPinching = false;
  }, { passive: true });
})();
