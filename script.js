const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS5dCln-zDV_zKmTvNwaNrttTBQaRjGPs5W6KjovG2_HZYjgYKciJrOcJv5jXBl6bfkOl_SSbi3cvs5/pub?gid=0&single=true&output=csv";

let FILMS = [];

(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const header = $("#siteHeader");
  const hero = $("#top");
  const grid = $("#movieGrid");
  const chipsBox = $("#genre");
  const navGenre = $("#navGenre");
  const emptyState = $("#emptyState");
  const emptyTitle = $("#emptyTitle");
  const emptyText = $("#emptyText");
  const resetButton = $("#resetFilter");
  const sectionTitle = $("#sectionTitle");
  const resultCount = $("#resultCount");
  const searchInput = $("#searchInput");
  const modal = $("#playerModal");
  const modalClose = $("#modalClose");
  const modalMeta = $("#modalMeta");
  const modalDesc = $("#modalDesc");
  const playerWrap = $("#playerWrap");
  const playerHost = $("#playerHost");
  const playerSurface = $("#playerSurface");
  const playerCover = $("#playerCover");
  const coverButton = $("#coverButton");
  const playerError = $("#playerError");
  const controls = $("#playerControls");
  const btnPlay = $("#btnPlay");
  const seekBar = $("#seekBar");
  const timeLabel = $("#timeLabel");
  const btnMute = $("#btnMute");
  const volumeBar = $("#volumeBar");
  const btnFullscreen = $("#btnFullscreen");

  const ALL_GENRES = "Semua";
  const TITLE_CACHE_PREFIX = "gemorcafilm_title_";
  const REQUEST_TIMEOUT_MS = 6000;
  const SEEK_STEP_SECONDS = 10;
  const VOLUME_STEP = 10;
  const AUTOPLAY_GRACE_MS = 1800;
  const PROGRESS_INTERVAL_MS = 250;
  const YT_ENDED = 0;
  const YT_PLAYING = 1;
  const YT_PAUSED = 2;
  const YT_BUFFERING = 3;
  const PLAY_ICON =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  const state = { query: "", genre: ALL_GENRES, loadFailed: false };
  const player = {
    yt: null,
    session: 0,
    ready: false,
    seeking: false,
    timer: null,
    graceTimer: null,
    film: null,
    driveCleanup: null
  };
  let lastFocused = null;
  let ytApiPromise = null;

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function splitGenre(text) {
    return String(text || "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
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
      return "";
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
    const col = (names) => head.findIndex((h) => names.includes(h));
    const idx = {
      video: col(["video", "link", "url", "videourl", "videoembedurl"]),
      judul: col(["judul", "title"]),
      genre: col(["genre"]),
      tahun: col(["tahun", "year"]),
      poster: col(["poster", "posterurl"]),
      deskripsi: col(["deskripsi", "sinopsis"]),
      unggulan: col(["unggulan", "featured"])
    };
    const val = (row, key) => (idx[key] >= 0 ? (row[idx[key]] || "").trim() : "");

    return rows
      .slice(1)
      .map((row, i) => {
        const video = val(row, "video");
        if (!video) return null;

        const ytId = youtubeId(video);
        const poster = val(row, "poster");
        const film = {
          id: i + 1,
          judul: val(row, "judul"),
          genre: val(row, "genre"),
          tahun: val(row, "tahun"),
          posterUrl: poster || (ytId ? "https://img.youtube.com/vi/" + ytId + "/hqdefault.jpg" : ""),
          videoEmbedUrl: video,
          deskripsi: val(row, "deskripsi"),
          unggulan: ["ya", "yes", "true", "1", "x"].includes(val(row, "unggulan").toLowerCase())
        };
        if (!poster && ytId) film.bannerUrl = "https://img.youtube.com/vi/" + ytId + "/maxresdefault.jpg";
        return film;
      })
      .filter(Boolean);
  }

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
      return;
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

  async function fillTitles(films) {
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

  async function loadFromSheet() {
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = (await res.text()).replace(/^\uFEFF/, "");
    return rowsToFilms(parseCSV(text));
  }

  function renderHero() {
    const film = FILMS.find((f) => f.unggulan) || FILMS[0];
    hero.hidden = false;
    document.body.classList.remove("no-hero");
    if (!film) {
      hero.hidden = true;
      document.body.classList.add("no-hero");
      return;
    }

    $("#heroTitle").textContent = film.judul;

    const heroDesc = $("#heroDesc");
    heroDesc.textContent = film.deskripsi || "";
    heroDesc.hidden = !film.deskripsi;

    const meta = $("#heroMeta");
    meta.textContent = "";
    splitGenre(film.genre).forEach((g) => meta.appendChild(makeEl("span", "tag", g)));
    if (film.tahun) meta.appendChild(makeEl("span", "", String(film.tahun)));

    const heroBg = $("#heroBg");
    const setBg = (src) => {
      heroBg.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
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

    $("#heroPlay").onclick = () => openModal(film);
  }

  function renderChips() {
    const hasGenres = FILMS.some((f) => splitGenre(f.genre).length > 0);
    chipsBox.hidden = !hasGenres;
    if (navGenre) navGenre.hidden = !hasGenres;
    chipsBox.textContent = "";
    if (!hasGenres) return;
    const genres = [ALL_GENRES, ...new Set(FILMS.flatMap((f) => splitGenre(f.genre)))];
    genres.forEach((g) => {
      const chip = makeEl("button", "chip", g);
      chip.type = "button";
      chip.dataset.genre = g;
      chip.setAttribute("aria-pressed", String(g === state.genre));
      chipsBox.appendChild(chip);
    });
  }

  function syncChips() {
    chipsBox.querySelectorAll(".chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.genre === state.genre));
    });
  }

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
    const playBtn = makeEl("span");
    playBtn.innerHTML = PLAY_ICON;
    play.appendChild(playBtn);
    poster.appendChild(play);

    const meta = makeEl("div", "card-meta");
    meta.appendChild(makeEl("span", "card-genre", film.genre || ""));
    if (film.tahun) meta.appendChild(makeEl("span", "card-year", String(film.tahun)));

    card.append(poster, makeEl("span", "card-title", film.judul), meta);
    return card;
  }

  function getFilteredFilms() {
    const q = state.query.trim().toLowerCase();
    return FILMS.filter((film) => {
      const genreOk =
        state.genre === ALL_GENRES || splitGenre(film.genre).includes(state.genre);
      const text = (film.judul + " " + film.genre + " " + (film.tahun || "")).toLowerCase();
      return genreOk && (!q || text.includes(q));
    });
  }

  function renderGrid() {
    const films = getFilteredFilms();

    grid.replaceChildren(...films.map(createCard));
    grid.hidden = films.length === 0;
    emptyState.hidden = films.length > 0;

    const noData = FILMS.length === 0;
    if (noData && state.loadFailed) {
      setText(emptyTitle, "Daftar film gagal dimuat");
      setText(emptyText, "Periksa koneksi internet, lalu muat ulang halaman.");
    } else if (noData) {
      setText(emptyTitle, "Belum ada film");
      setText(emptyText, "Isi kolom video di Google Sheet dengan link YouTube.");
    } else {
      setText(emptyTitle, "Film tidak ditemukan");
      setText(emptyText, "Coba kata kunci lain atau pilih genre berbeda.");
    }
    if (resetButton) resetButton.hidden = noData;

    const q = state.query.trim();
    if (q) sectionTitle.textContent = "Hasil untuk \u201C" + q + "\u201D";
    else if (state.genre !== ALL_GENRES) sectionTitle.textContent = state.genre;
    else sectionTitle.textContent = "Semua Film";

    resultCount.textContent = films.length + " film";
  }

  function resetFilter() {
    state.query = "";
    state.genre = ALL_GENRES;
    searchInput.value = "";
    syncChips();
    renderGrid();
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = String(total % 60).padStart(2, "0");
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + sec;
    return m + ":" + sec;
  }

  function setCover(name) {
    if (name === "hidden") {
      playerCover.hidden = true;
      return;
    }
    playerCover.hidden = false;
    playerCover.dataset.state = name;
  }

  function setCoverImage(film) {
    const apply = (src) => {
      playerCover.style.backgroundImage = src ? "url(" + JSON.stringify(src) + ")" : "";
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
    playerError.textContent = message;
    playerError.hidden = false;
    playerCover.hidden = true;
    controls.hidden = true;
    playerSurface.hidden = true;
  }

  function setPlaying(isPlaying) {
    playerWrap.classList.toggle("is-playing", isPlaying);
    btnPlay.setAttribute("aria-label", isPlaying ? "Jeda" : "Putar");
  }

  function updateProgress() {
    if (!player.ready || player.seeking) return;
    const current = player.yt.getCurrentTime() || 0;
    const duration = player.yt.getDuration() || 0;
    const ratio = duration > 0 ? Math.min(current / duration, 1) : 0;
    seekBar.value = String(Math.round(ratio * 1000));
    seekBar.style.setProperty("--progress", ratio * 100 + "%");
    timeLabel.textContent = formatTime(current) + " / " + formatTime(duration);
  }

  function syncVolume() {
    if (!player.ready) return;
    const muted = player.yt.isMuted();
    const volume = muted ? 0 : player.yt.getVolume();
    volumeBar.value = String(volume);
    volumeBar.style.setProperty("--progress", volume + "%");
    playerWrap.classList.toggle("is-muted", volume === 0);
    btnMute.setAttribute("aria-label", volume === 0 ? "Aktifkan suara" : "Bisukan");
  }

  function togglePlay() {
    if (!player.ready) return;
    const st = player.yt.getPlayerState();
    if (st === YT_PLAYING || st === YT_BUFFERING) {
      player.yt.pauseVideo();
      return;
    }
    if (st === YT_ENDED) player.yt.seekTo(0, true);
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
    syncVolume();
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
    syncVolume();
  }

  const requestFullscreenFn = playerWrap.requestFullscreen || playerWrap.webkitRequestFullscreen;
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
    const result = requestFullscreenFn.call(playerWrap);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

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

  function teardownPlayer() {
    player.session += 1;
    clearInterval(player.timer);
    clearTimeout(player.graceTimer);
    if (typeof player.driveCleanup === "function") {
      player.driveCleanup();
      player.driveCleanup = null;
    }
    if (player.yt && typeof player.yt.destroy === "function") {
      try {
        player.yt.destroy();
      } catch (e) {
        player.yt = null;
      }
    }
    player.yt = null;
    player.ready = false;
    player.seeking = false;
    player.film = null;
    playerHost.textContent = "";
    playerWrap.classList.remove("is-playing", "is-paused", "is-muted", "is-fallback");
    playerError.hidden = true;
    playerError.textContent = "";
    playerCover.hidden = true;
    playerSurface.hidden = false;
    controls.hidden = true;
    seekBar.value = "0";
    seekBar.style.setProperty("--progress", "0%");
    timeLabel.textContent = "0:00 / 0:00";
    btnPlay.setAttribute("aria-label", "Putar");
  }

  const DRIVE_VIRTUAL_W = 640;
  const DRIVE_VIRTUAL_H = 360;

  function mountDriveIframe(container, src, title) {
    const scaleWrap = document.createElement("div");
    scaleWrap.className = "drive-scale-wrap";
    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.title = title;
    iframe.width = String(DRIVE_VIRTUAL_W);
    iframe.height = String(DRIVE_VIRTUAL_H);
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = false;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    scaleWrap.appendChild(iframe);
    container.appendChild(scaleWrap);

    const applyScale = () => {
      const w = container.clientWidth;
      const scale = w > 0 ? w / DRIVE_VIRTUAL_W : 1;
      scaleWrap.style.transform = "scale(" + scale + ")";
    };
    applyScale();

    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(applyScale);
      ro.observe(container);
    } else {
      window.addEventListener("resize", applyScale);
    }

    return {
      iframe: iframe,
      cleanup: function () {
        if (ro) ro.disconnect();
        else window.removeEventListener("resize", applyScale);
      }
    };
  }

  function buildDriveShield() {
    const shield = makeEl("div", "player-shield");
    shield.addEventListener("contextmenu", (e) => e.preventDefault());
    if (requestFullscreenFn) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "drive-fs-btn";
      btn.setAttribute("aria-label", "Layar penuh");
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
      btn.addEventListener("click", toggleFullscreen);
      shield.appendChild(btn);
    }
    return shield;
  }

  function startFallback(film) {
    const src = buildEmbedUrl(film.videoEmbedUrl);
    if (!src) {
      showPlayerError("Link video tidak valid. Periksa kolom video di Google Sheet.");
      return;
    }
    controls.hidden = true;
    playerSurface.hidden = true;
    playerWrap.classList.add("is-fallback");
    setCoverImage(film);
    setCover("loading");

    const mounted = mountDriveIframe(playerHost, src, "Pemutar video: " + film.judul);
    player.driveCleanup = mounted.cleanup;

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      setCover("hidden");
    };
    mounted.iframe.addEventListener("load", reveal);
    setTimeout(reveal, 8000);

    playerHost.appendChild(buildDriveShield());
  }

  function onPlayerReady(session) {
    if (session !== player.session) return;
    player.ready = true;
    syncVolume();
    updateProgress();
    player.timer = setInterval(updateProgress, PROGRESS_INTERVAL_MS);
    player.yt.playVideo();
    player.graceTimer = setTimeout(() => {
      if (session !== player.session || !player.ready) return;
      const st = player.yt.getPlayerState();
      if (st !== YT_PLAYING && st !== YT_BUFFERING) setCover("idle");
    }, AUTOPLAY_GRACE_MS);
  }

  function onPlayerState(session, st) {
    if (session !== player.session) return;
    if (st === YT_PLAYING) {
      setCover("hidden");
      setPlaying(true);
      playerWrap.classList.remove("is-paused");
    } else if (st === YT_PAUSED) {
      setPlaying(false);
      playerWrap.classList.add("is-paused");
    } else if (st === YT_ENDED) {
      setPlaying(false);
      playerWrap.classList.remove("is-paused");
      setCover("ended");
    }
    updateProgress();
  }

  function onPlayerError(session, code) {
    if (session !== player.session) return;
    if (code === 100) {
      showPlayerError("Video tidak ditemukan atau bersifat privat.");
    } else if (code === 101 || code === 150) {
      showPlayerError("Pemilik video tidak mengizinkan video ini diputar di website lain.");
    } else {
      showPlayerError("Video tidak dapat diputar. Coba muat ulang halaman.");
    }
  }

  async function startYouTube(film, videoId, session) {
    setCover("loading");
    let api;
    try {
      api = await loadYouTubeApi();
    } catch (e) {
      if (session === player.session) startFallback(film);
      return;
    }
    if (session !== player.session) return;

    const target = document.createElement("div");
    playerHost.appendChild(target);
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
        onStateChange: (e) => onPlayerState(session, e.data),
        onError: (e) => onPlayerError(session, e.data)
      }
    });
  }

  function openModal(film) {
    lastFocused = document.activeElement;
    teardownPlayer();
    player.film = film;

    $("#modalTitle").textContent = film.judul;
    modalDesc.textContent = film.deskripsi || "";
    modalDesc.hidden = !film.deskripsi;
    const metaText = [film.genre, film.tahun].filter(Boolean).join(" \u2022 ");
    modalMeta.textContent = metaText;
    modalMeta.hidden = !metaText;

    modal.hidden = false;
    document.body.classList.add("no-scroll");

    const videoId = youtubeId(film.videoEmbedUrl);
    if (videoId) {
      controls.hidden = false;
      setCoverImage(film);
      startYouTube(film, videoId, player.session);
    } else {
      startFallback(film);
    }
    modalClose.focus();
  }

  function closeModal() {
    if (modal.hidden) return;
    exitFullscreen();
    teardownPlayer();
    modal.hidden = true;
    document.body.classList.remove("no-scroll");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function onPlayerKey(e) {
    if (modal.hidden || !player.ready) return;
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

  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const film = findFilm(card.dataset.id);
    if (film) openModal(film);
  });

  chipsBox.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.genre = chip.dataset.genre;
    syncChips();
    renderGrid();
  });

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    renderGrid();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#film").scrollIntoView({ behavior: "smooth" });
  });

  resetButton.addEventListener("click", resetFilter);

  document.querySelectorAll("[data-home]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      resetFilter();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    else onPlayerKey(e);
  });

  playerSurface.addEventListener("click", togglePlay);
  playerSurface.addEventListener("dblclick", toggleFullscreen);
  btnPlay.addEventListener("click", togglePlay);
  btnMute.addEventListener("click", toggleMute);
  btnFullscreen.addEventListener("click", toggleFullscreen);
  btnFullscreen.hidden = !requestFullscreenFn;

  coverButton.addEventListener("click", () => {
    if (!player.ready) return;
    if (player.yt.getPlayerState() === YT_ENDED) player.yt.seekTo(0, true);
    player.yt.playVideo();
  });

  seekBar.addEventListener("input", () => {
    player.seeking = true;
    const ratio = Number(seekBar.value) / 1000;
    seekBar.style.setProperty("--progress", ratio * 100 + "%");
    if (player.ready) {
      const duration = player.yt.getDuration() || 0;
      timeLabel.textContent = formatTime(duration * ratio) + " / " + formatTime(duration);
    }
  });

  seekBar.addEventListener("change", () => {
    if (player.ready) {
      const duration = player.yt.getDuration() || 0;
      player.yt.seekTo((duration * Number(seekBar.value)) / 1000, true);
    }
    player.seeking = false;
  });

  volumeBar.addEventListener("input", () => setVolume(Number(volumeBar.value)));

  const syncFullscreenClass = () => {
    playerWrap.classList.toggle("is-fullscreen", fullscreenElement() === playerWrap);
  };
  document.addEventListener("fullscreenchange", syncFullscreenClass);
  document.addEventListener("webkitfullscreenchange", syncFullscreenClass);

  document.addEventListener("focusin", (e) => {
    if (!modal.hidden && !modal.contains(e.target)) modalClose.focus();
  });

  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 20);
  window.addEventListener("scroll", onScroll, { passive: true });

  async function init() {
    $("#year").textContent = new Date().getFullYear();
    onScroll();

    if (SHEET_CSV_URL) {
      hero.hidden = true;
      document.body.classList.add("no-hero");
      resultCount.textContent = "Memuat film...";
      try {
        const films = await loadFromSheet();
        await fillTitles(films);
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