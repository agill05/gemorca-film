// Gemorca Film — data is pulled live from a published Google Sheet (CSV).
// Sheet columns expected: video, judul, genre, tahun, poster, deskripsi, unggulan.
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS5dCln-zDV_zKmTvNwaNrttTBQaRjGPs5W6KjovG2_HZYjgYKciJrOcJv5jXBl6bfkOl_SSbi3cvs5/pub?gid=0&single=true&output=csv";

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const ALL_GENRES = "Semua";
  const TITLE_CACHE_PREFIX = "gemorcafilm_title_";
  const REQUEST_TIMEOUT_MS = 6000;
  const SEEK_STEP_SECONDS = 10;
  const VOLUME_STEP = 10;
  const AUTOPLAY_GRACE_MS = 1800;
  const PROGRESS_INTERVAL_MS = 250;
  const YT = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 };
  const PLAY_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  // ---- elements -----------------------------------------------------

  const els = {
    header: $("#header"),
    hero: $("#top"),
    heroBg: $("#heroBg"),
    heroYear: $("#heroYear"),
    heroTitle: $("#heroTitle"),
    heroTags: $("#heroTags"),
    heroDesc: $("#heroDesc"),
    heroPlay: $("#heroPlay"),
    grid: $("#movieGrid"),
    chipsBox: $("#genre-filter"),
    navGenre: $("#navGenre"),
    emptyState: $("#emptyState"),
    emptyTitle: $("#emptyTitle"),
    emptyText: $("#emptyText"),
    resetButton: $("#resetFilter"),
    catalogTitle: $("#catalogTitle"),
    resultCount: $("#resultCount"),
    searchInput: $("#searchInput"),
    modal: $("#playerModal"),
    modalClose: $("#modalClose"),
    modalTitle: $("#modalTitle"),
    modalMeta: $("#modalMeta"),
    modalDesc: $("#modalDesc"),
    player: $("#player"),
    playerHost: $("#playerHost"),
    playerSurface: $("#playerSurface"),
    playerCover: $("#playerCover"),
    coverButton: $("#coverButton"),
    playerError: $("#playerError"),
    controls: $("#playerControls"),
    btnPlay: $("#btnPlay"),
    seekBar: $("#seekBar"),
    timeLabel: $("#timeLabel"),
    btnMute: $("#btnMute"),
    volumeBar: $("#volumeBar"),
    btnFullscreen: $("#btnFullscreen")
  };

  let FILMS = [];
  const state = { query: "", genre: ALL_GENRES, loadFailed: false };
  const player = { yt: null, session: 0, ready: false, seeking: false, timer: null, graceTimer: null, film: null };
  let lastFocused = null;
  let ytApiPromise = null;

  // ---- small helpers --------------------------------------------------

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function splitGenre(text) {
    return String(text || "").split(",").map((g) => g.trim()).filter(Boolean);
  }

  function findFilm(id) {
    return FILMS.find((f) => String(f.id) === String(id));
  }

  function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h > 0 ? h + ":" + String(m).padStart(2, "0") + ":" + s : m + ":" + s;
  }

  // ---- video URL parsing -----------------------------------------------

  function youtubeId(raw) {
    const valid = (v) => (/^[\w-]{11}$/.test(v || "") ? v : "");
    try {
      const u = new URL(String(raw).trim());
      const host = u.hostname.replace(/^(www|m)\./, "");
      if (host === "youtu.be") return valid(u.pathname.slice(1));
      if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (u.pathname === "/watch") return valid(u.searchParams.get("v"));
        const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
        return m ? valid(m[1]) : "";
      }
    } catch (e) {
      /* not a URL */
    }
    return "";
  }

  function buildEmbedUrl(raw) {
    let url;
    try {
      url = new URL(String(raw).trim());
    } catch (e) {
      return "";
    }
    if (url.protocol !== "https:") return "";

    const id = youtubeId(url.href);
    if (id) {
      const embed = new URL("https://www.youtube.com/embed/" + id);
      embed.searchParams.set("autoplay", "1");
      embed.searchParams.set("rel", "0");
      return embed.toString();
    }

    if (url.hostname.replace(/^www\./, "") === "drive.google.com") {
      url.pathname = url.pathname.replace(/\/(view|edit)$/, "/preview");
      return url.toString();
    }
    return "";
  }

  // ---- CSV parsing & mapping --------------------------------------------

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function rowsToFilms(rows) {
    if (rows.length < 2) return [];

    const head = rows[0].map((h) => h.trim().toLowerCase());
    const colIndex = (names) => head.findIndex((h) => names.includes(h));
    const columns = {
      video: colIndex(["video", "link", "url", "videourl", "videoembedurl"]),
      judul: colIndex(["judul", "title"]),
      genre: colIndex(["genre"]),
      tahun: colIndex(["tahun", "year"]),
      poster: colIndex(["poster", "posterurl"]),
      deskripsi: colIndex(["deskripsi", "sinopsis"]),
      unggulan: colIndex(["unggulan", "featured"])
    };
    const cell = (row, key) => (columns[key] >= 0 ? (row[columns[key]] || "").trim() : "");

    return rows
      .slice(1)
      .map((row, i) => {
        const video = cell(row, "video");
        if (!video) return null;

        const ytId = youtubeId(video);
        const poster = cell(row, "poster");
        const film = {
          id: i + 1,
          judul: cell(row, "judul"),
          genre: cell(row, "genre"),
          tahun: cell(row, "tahun"),
          posterUrl: poster || (ytId ? "https://img.youtube.com/vi/" + ytId + "/hqdefault.jpg" : ""),
          videoEmbedUrl: video,
          deskripsi: cell(row, "deskripsi"),
          unggulan: ["ya", "yes", "true", "1", "x"].includes(cell(row, "unggulan").toLowerCase())
        };
        if (!poster && ytId) film.bannerUrl = "https://img.youtube.com/vi/" + ytId + "/maxresdefault.jpg";
        return film;
      })
      .filter(Boolean);
  }

  async function loadFromSheet() {
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = (await res.text()).replace(/^\uFEFF/, "");
    return rowsToFilms(parseCSV(text));
  }

  // ---- fill in missing titles from YouTube oEmbed -----------------------

  function readCachedTitle(id) {
    try {
      return localStorage.getItem(TITLE_CACHE_PREFIX + id) || "";
    } catch (e) {
      return "";
    }
  }

  function writeCachedTitle(id, title) {
    try {
      localStorage.setItem(TITLE_CACHE_PREFIX + id, title);
    } catch (e) {
      /* storage unavailable, ignore */
    }
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchYoutubeTitle(id) {
    const watchUrl = "https://www.youtube.com/watch?v=" + id;
    const endpoints = [
      "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watchUrl),
      "https://noembed.com/embed?url=" + encodeURIComponent(watchUrl)
    ];
    for (const endpoint of endpoints) {
      try {
        const data = await fetchJson(endpoint);
        if (data && data.title) return String(data.title).trim();
      } catch (e) {
        continue;
      }
    }
    return "";
  }

  async function fillMissingTitles(films) {
    await Promise.all(
      films.map(async (film) => {
        if (film.judul) return;
        const id = youtubeId(film.videoEmbedUrl);
        let title = id ? readCachedTitle(id) : "";
        if (id && !title) {
          title = await fetchYoutubeTitle(id);
          if (title) writeCachedTitle(id, title);
        }
        film.judul = title || "Film " + film.id;
      })
    );
  }

  // ---- rendering: hero ---------------------------------------------------

  function renderHero() {
    const film = FILMS.find((f) => f.unggulan) || FILMS[0];
    if (!film) {
      els.hero.hidden = true;
      document.body.classList.add("no-hero");
      return;
    }
    els.hero.hidden = false;
    document.body.classList.remove("no-hero");

    setText(els.heroTitle, film.judul);
    setText(els.heroYear, film.tahun ? String(film.tahun) : "");
    els.heroYear.hidden = !film.tahun;

    els.heroDesc.textContent = film.deskripsi || "";
    els.heroDesc.hidden = !film.deskripsi;

    els.heroTags.textContent = "";
    splitGenre(film.genre).forEach((g) => els.heroTags.appendChild(makeEl("span", "tag", g)));

    applyBackdrop(els.heroBg, film);
    els.heroPlay.onclick = () => openModal(film);
  }

  function applyBackdrop(target, film) {
    const setBg = (src) => {
      target.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
    };
    const base = film.posterUrl || film.bannerUrl;
    if (base) setBg(base);
    if (film.bannerUrl && film.bannerUrl !== base) {
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth > 320) setBg(film.bannerUrl);
      };
      probe.src = film.bannerUrl;
    }
  }

  // ---- rendering: genre chips ---------------------------------------------

  function renderChips() {
    const hasGenres = FILMS.some((f) => splitGenre(f.genre).length > 0);
    els.chipsBox.hidden = !hasGenres;
    els.navGenre.hidden = !hasGenres;
    els.chipsBox.textContent = "";
    if (!hasGenres) return;

    const genres = [ALL_GENRES, ...new Set(FILMS.flatMap((f) => splitGenre(f.genre)))];
    genres.forEach((g) => {
      const chip = makeEl("button", "chip", g);
      chip.type = "button";
      chip.dataset.genre = g;
      chip.setAttribute("aria-pressed", String(g === state.genre));
      els.chipsBox.appendChild(chip);
    });
  }

  function syncChips() {
    els.chipsBox.querySelectorAll(".chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.genre === state.genre));
    });
  }

  // ---- rendering: film grid ------------------------------------------------

  function createCard(film) {
    const card = makeEl("button", "card");
    card.type = "button";
    card.dataset.id = film.id;
    card.setAttribute("aria-label", "Tonton " + film.judul);

    const poster = makeEl("div", "card-poster");
    if (film.posterUrl) {
      const img = new Image();
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = film.posterUrl;
      img.addEventListener("error", () => {
        img.remove();
        poster.prepend(makeEl("span", "poster-fallback", film.judul));
      });
      poster.appendChild(img);
    } else {
      poster.appendChild(makeEl("span", "poster-fallback", film.judul));
    }

    const play = makeEl("div", "card-play");
    play.innerHTML = PLAY_ICON_SVG;
    poster.appendChild(play);

    const meta = makeEl("div", "card-meta");
    if (film.genre) meta.appendChild(makeEl("span", "card-genre", splitGenre(film.genre)[0]));
    if (film.tahun) meta.appendChild(makeEl("span", "card-year", String(film.tahun)));

    card.append(poster, makeEl("span", "card-title", film.judul), meta);
    return card;
  }

  function getFilteredFilms() {
    const q = state.query.trim().toLowerCase();
    return FILMS.filter((film) => {
      const genreOk = state.genre === ALL_GENRES || splitGenre(film.genre).includes(state.genre);
      const haystack = (film.judul + " " + film.genre + " " + (film.tahun || "")).toLowerCase();
      return genreOk && (!q || haystack.includes(q));
    });
  }

  function renderGrid() {
    const films = getFilteredFilms();

    els.grid.replaceChildren(...films.map(createCard));
    els.grid.hidden = films.length === 0;
    els.emptyState.hidden = films.length > 0;

    const noData = FILMS.length === 0;
    if (noData && state.loadFailed) {
      setText(els.emptyTitle, "Daftar film gagal dimuat");
      setText(els.emptyText, "Periksa koneksi internet, lalu muat ulang halaman.");
    } else if (noData) {
      setText(els.emptyTitle, "Belum ada film");
      setText(els.emptyText, "Isi kolom video di Google Sheet dengan link YouTube.");
    } else {
      setText(els.emptyTitle, "Film tidak ditemukan");
      setText(els.emptyText, "Coba kata kunci lain atau pilih genre berbeda.");
    }
    els.resetButton.hidden = noData;

    const q = state.query.trim();
    if (q) els.catalogTitle.textContent = "Hasil untuk \u201C" + q + "\u201D";
    else if (state.genre !== ALL_GENRES) els.catalogTitle.textContent = state.genre;
    else els.catalogTitle.textContent = "Semua Film";

    els.resultCount.textContent = films.length + " film";
  }

  function resetFilter() {
    state.query = "";
    state.genre = ALL_GENRES;
    els.searchInput.value = "";
    syncChips();
    renderGrid();
  }

  // ---- player: shared UI state --------------------------------------------

  function setCover(mode) {
    if (mode === "hidden") {
      els.playerCover.hidden = true;
      return;
    }
    els.playerCover.hidden = false;
    els.playerCover.dataset.state = mode;
  }

  function setCoverImage(film) {
    const apply = (src) => {
      els.playerCover.style.backgroundImage = src ? "url(" + JSON.stringify(src) + ")" : "";
    };
    apply(film.posterUrl || film.bannerUrl);
    if (film.bannerUrl && film.bannerUrl !== film.posterUrl) {
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth > 320 && player.film === film) apply(film.bannerUrl);
      };
      probe.src = film.bannerUrl;
    }
  }

  function showPlayerError(message) {
    els.playerError.textContent = message;
    els.playerError.hidden = false;
    els.playerCover.hidden = true;
    els.controls.hidden = true;
    els.playerSurface.hidden = true;
  }

  function setPlayingUI(isPlaying) {
    els.player.classList.toggle("is-playing", isPlaying);
    els.btnPlay.setAttribute("aria-label", isPlaying ? "Jeda" : "Putar");
  }

  function updateProgress() {
    if (!player.ready || player.seeking) return;
    const current = player.yt.getCurrentTime() || 0;
    const duration = player.yt.getDuration() || 0;
    const ratio = duration > 0 ? Math.min(current / duration, 1) : 0;
    els.seekBar.value = String(Math.round(ratio * 1000));
    els.seekBar.style.setProperty("--progress", ratio * 100 + "%");
    els.timeLabel.textContent = formatTime(current) + " / " + formatTime(duration);
  }

  function syncVolumeUI() {
    if (!player.ready) return;
    const muted = player.yt.isMuted();
    const volume = muted ? 0 : player.yt.getVolume();
    els.volumeBar.value = String(volume);
    els.volumeBar.style.setProperty("--progress", volume + "%");
    els.player.classList.toggle("is-muted", volume === 0);
    els.btnMute.setAttribute("aria-label", volume === 0 ? "Aktifkan suara" : "Bisukan");
  }

  function togglePlay() {
    if (!player.ready) return;
    const st = player.yt.getPlayerState();
    if (st === YT.PLAYING || st === YT.BUFFERING) {
      player.yt.pauseVideo();
      return;
    }
    if (st === YT.ENDED) player.yt.seekTo(0, true);
    player.yt.playVideo();
  }

  function seekBy(delta) {
    if (!player.ready) return;
    const current = player.yt.getCurrentTime() || 0;
    const duration = player.yt.getDuration() || 0;
    const target = Math.max(0, current + delta);
    player.yt.seekTo(duration > 0 ? Math.min(target, duration) : target, true);
    updateProgress();
  }

  function setVolume(value) {
    if (!player.ready) return;
    const volume = Math.min(100, Math.max(0, value));
    player.yt.setVolume(volume);
    if (volume > 0 && player.yt.isMuted()) player.yt.unMute();
    if (volume === 0) player.yt.mute();
    syncVolumeUI();
  }

  function toggleMute() {
    if (!player.ready) return;
    const silent = player.yt.isMuted() || player.yt.getVolume() === 0;
    if (silent) {
      player.yt.unMute();
      if (player.yt.getVolume() === 0) player.yt.setVolume(50);
    } else {
      player.yt.mute();
    }
    syncVolumeUI();
  }

  // ---- player: fullscreen --------------------------------------------------

  const requestFullscreenFn = els.player.requestFullscreen || els.player.webkitRequestFullscreen;
  const exitFullscreenFn = document.exitFullscreen || document.webkitExitFullscreen;

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function exitFullscreen() {
    if (!fullscreenElement() || !exitFullscreenFn) return;
    const result = exitFullscreenFn.call(document);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  function toggleFullscreen() {
    if (!requestFullscreenFn) return;
    if (fullscreenElement()) {
      exitFullscreen();
      return;
    }
    const result = requestFullscreenFn.call(els.player);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  // ---- player: YouTube API ---------------------------------------------------

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (!ytApiPromise) {
      ytApiPromise = new Promise((resolve, reject) => {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof previous === "function") previous();
          resolve(window.YT);
        };
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => {
          ytApiPromise = null;
          reject(new Error("Gagal memuat YouTube API"));
        };
        document.head.appendChild(tag);
      });
    }
    return ytApiPromise;
  }

  function onPlayerReady(session) {
    if (session !== player.session) return;
    player.ready = true;
    syncVolumeUI();
    updateProgress();
    player.timer = setInterval(updateProgress, PROGRESS_INTERVAL_MS);
    player.yt.playVideo();
    player.graceTimer = setTimeout(() => {
      if (session !== player.session || !player.ready) return;
      const st = player.yt.getPlayerState();
      if (st !== YT.PLAYING && st !== YT.BUFFERING) setCover("idle");
    }, AUTOPLAY_GRACE_MS);
  }

  function onPlayerStateChange(session, st) {
    if (session !== player.session) return;
    if (st === YT.PLAYING) {
      setCover("hidden");
      setPlayingUI(true);
      els.player.classList.remove("is-paused");
    } else if (st === YT.PAUSED) {
      setPlayingUI(false);
      els.player.classList.add("is-paused");
    } else if (st === YT.ENDED) {
      setPlayingUI(false);
      els.player.classList.remove("is-paused");
      setCover("ended");
    }
    updateProgress();
  }

  function onPlayerError(session, code) {
    if (session !== player.session) return;
    if (code === 100) showPlayerError("Video tidak ditemukan atau bersifat privat.");
    else if (code === 101 || code === 150) showPlayerError("Pemilik video tidak mengizinkan video ini diputar di website lain.");
    else showPlayerError("Video tidak dapat diputar. Coba muat ulang halaman.");
  }

  async function startYouTube(videoId, session) {
    setCover("loading");
    let api;
    try {
      api = await loadYouTubeApi();
    } catch (e) {
      if (session === player.session) startFallback(player.film);
      return;
    }
    if (session !== player.session) return;

    const target = document.createElement("div");
    els.playerHost.appendChild(target);
    const vars = {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      iv_load_policy: 3,
      rel: 0,
      playsinline: 1,
      modestbranding: 1
    };
    if (/^https?:$/.test(window.location.protocol)) vars.origin = window.location.origin;

    player.yt = new api.Player(target, {
      videoId: videoId,
      playerVars: vars,
      events: {
        onReady: () => onPlayerReady(session),
        onStateChange: (e) => onPlayerStateChange(session, e.data),
        onError: (e) => onPlayerError(session, e.data)
      }
    });
  }

  // ---- player: non-YouTube fallback (e.g. Google Drive) -----------------------

  function buildDriveLinkBlocker() {
    const blocker = makeEl("div", "drive-link-blocker");
    blocker.setAttribute("aria-hidden", "true");
    blocker.addEventListener("contextmenu", (e) => e.preventDefault());
    return blocker;
  }

  function startFallback(film) {
    const src = buildEmbedUrl(film.videoEmbedUrl);
    if (!src) {
      showPlayerError("Link video tidak valid. Periksa kolom video di Google Sheet.");
      return;
    }
    els.controls.hidden = true;
    els.playerSurface.hidden = true;
    els.playerCover.hidden = true;

    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.title = "Pemutar video: " + film.judul;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";

    els.playerHost.appendChild(iframe);
    els.playerHost.appendChild(buildDriveLinkBlocker());
  }

  // ---- player: lifecycle ----------------------------------------------------

  function teardownPlayer() {
    player.session += 1;
    clearInterval(player.timer);
    clearTimeout(player.graceTimer);
    if (player.yt && typeof player.yt.destroy === "function") {
      try {
        player.yt.destroy();
      } catch (e) {
        /* already gone */
      }
    }
    player.yt = null;
    player.ready = false;
    player.seeking = false;
    player.film = null;

    els.playerHost.textContent = "";
    els.player.classList.remove("is-playing", "is-paused", "is-muted");
    els.playerError.hidden = true;
    els.playerError.textContent = "";
    els.playerCover.hidden = true;
    els.playerSurface.hidden = false;
    els.controls.hidden = true;
    els.seekBar.value = "0";
    els.seekBar.style.setProperty("--progress", "0%");
    els.timeLabel.textContent = "0:00 / 0:00";
    els.btnPlay.setAttribute("aria-label", "Putar");
  }

  function openModal(film) {
    lastFocused = document.activeElement;
    teardownPlayer();
    player.film = film;

    els.modalTitle.textContent = film.judul;
    els.modalDesc.textContent = film.deskripsi || "";
    els.modalDesc.hidden = !film.deskripsi;
    const metaText = [film.genre, film.tahun].filter(Boolean).join(" \u2022 ");
    els.modalMeta.textContent = metaText;
    els.modalMeta.hidden = !metaText;

    els.modal.hidden = false;
    document.body.classList.add("no-scroll");

    const videoId = youtubeId(film.videoEmbedUrl);
    if (videoId) {
      els.controls.hidden = false;
      setCoverImage(film);
      startYouTube(videoId, player.session);
    } else {
      startFallback(film);
    }
    els.modalClose.focus();
  }

  function closeModal() {
    if (els.modal.hidden) return;
    exitFullscreen();
    teardownPlayer();
    els.modal.hidden = true;
    document.body.classList.remove("no-scroll");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function onPlayerKeydown(e) {
    if (els.modal.hidden || !player.ready) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (e.key === " ") {
      if (tag === "BUTTON" || tag === "INPUT") return;
      e.preventDefault();
      togglePlay();
      return;
    }
    if (tag === "INPUT" && e.key.startsWith("Arrow")) return;

    const key = e.key.toLowerCase();
    if (key === "arrowleft") seekBy(-SEEK_STEP_SECONDS);
    else if (key === "arrowright") seekBy(SEEK_STEP_SECONDS);
    else if (key === "arrowup") setVolume((player.yt.isMuted() ? 0 : player.yt.getVolume()) + VOLUME_STEP);
    else if (key === "arrowdown") setVolume((player.yt.isMuted() ? 0 : player.yt.getVolume()) - VOLUME_STEP);
    else if (key === "m") toggleMute();
    else if (key === "f") toggleFullscreen();
    else if (key === "k") togglePlay();
    else return;
    e.preventDefault();
  }

  // ---- wire up events ---------------------------------------------------

  els.grid.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const film = findFilm(card.dataset.id);
    if (film) openModal(film);
  });

  els.chipsBox.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.genre = chip.dataset.genre;
    syncChips();
    renderGrid();
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    renderGrid();
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#katalog").scrollIntoView({ behavior: "smooth" });
  });

  els.resetButton.addEventListener("click", resetFilter);

  document.querySelectorAll("[data-home]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      resetFilter();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  els.modalClose.addEventListener("click", closeModal);
  els.modal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    else onPlayerKeydown(e);
  });

  els.playerSurface.addEventListener("click", togglePlay);
  els.playerSurface.addEventListener("dblclick", toggleFullscreen);
  els.btnPlay.addEventListener("click", togglePlay);
  els.btnMute.addEventListener("click", toggleMute);
  els.btnFullscreen.addEventListener("click", toggleFullscreen);
  els.btnFullscreen.hidden = !requestFullscreenFn;

  els.coverButton.addEventListener("click", () => {
    if (!player.ready) return;
    if (player.yt.getPlayerState() === YT.ENDED) player.yt.seekTo(0, true);
    player.yt.playVideo();
  });

  els.seekBar.addEventListener("input", () => {
    player.seeking = true;
    const ratio = Number(els.seekBar.value) / 1000;
    els.seekBar.style.setProperty("--progress", ratio * 100 + "%");
    if (player.ready) {
      const duration = player.yt.getDuration() || 0;
      els.timeLabel.textContent = formatTime(duration * ratio) + " / " + formatTime(duration);
    }
  });

  els.seekBar.addEventListener("change", () => {
    if (player.ready) {
      const duration = player.yt.getDuration() || 0;
      player.yt.seekTo((duration * Number(els.seekBar.value)) / 1000, true);
    }
    player.seeking = false;
  });

  els.volumeBar.addEventListener("input", () => setVolume(Number(els.volumeBar.value)));

  const syncFullscreenClass = () => {
    els.player.classList.toggle("is-fullscreen", fullscreenElement() === els.player);
  };
  document.addEventListener("fullscreenchange", syncFullscreenClass);
  document.addEventListener("webkitfullscreenchange", syncFullscreenClass);

  document.addEventListener("focusin", (e) => {
    if (!els.modal.hidden && !els.modal.contains(e.target)) els.modalClose.focus();
  });

  window.addEventListener(
    "scroll",
    () => els.header.classList.toggle("is-scrolled", window.scrollY > 20),
    { passive: true }
  );

  // ---- boot ---------------------------------------------------------------

  async function init() {
    $("#year").textContent = new Date().getFullYear();
    els.header.classList.toggle("is-scrolled", window.scrollY > 20);

    if (SHEET_CSV_URL) {
      els.resultCount.textContent = "Memuat film...";
      try {
        const films = await loadFromSheet();
        await fillMissingTitles(films);
        FILMS = films;
      } catch (err) {
        state.loadFailed = true;
        console.warn("Gagal memuat Google Sheet.", err);
      }
    }

    renderHero();
    renderChips();
    renderGrid();
  }

  init();
})();