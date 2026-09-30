(function () {
    "use strict";

    var WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwP7ElTDIvhOxf4mhPycll22n2XbjoiUrxvh0GLjx1HJVC8ERKylaXe_osbmu-tqfL1bw/exec";
    var REQUEST_TIMEOUT_MS = 45000;
    var MIN_YEAR = 1900;
    var TRUE_VALUES = ["ya", "yes", "true", "1", "x"];
    var VIEW_TITLES = { login: "adminLoginTitle", list: "adminListTitle", form: "adminFormTitle", settings: "adminSettingsTitle" };
    var SESSION_PIN_KEY = "gemorcafilm_admin_pin";
    var ITEMS_PER_PAGE = 10;

    function byId(id) {
        return document.getElementById(id);
    }

    var modal = byId("adminModal");
    var panel = byId("adminPanel");
    var closeBtn = byId("adminClose");
    var logoutBtn = byId("adminLogout");
    var navTabs = byId("adminNavTabs");
    var logo = document.querySelector(".logo[data-home]");

    var loginForm = byId("adminLoginForm");
    var loginMsg = byId("adminLoginMsg");
    var loginSubmit = byId("adminLoginSubmit");
    var pinInput = byId("adminPin");
    var pinToggle = byId("adminPinToggle");

    var listView = byId("adminListView");
    var listBox = byId("adminList");
    var countEl = byId("adminCount");
    var searchInput = byId("adminSearch");
    var refreshCacheBtn = byId("adminRefreshCache");
    var addNewBtn = byId("adminAddNew");
    var paginationBox = byId("adminPagination");

    var settingsView = byId("adminSettingsView");
    var cfgMaintenance = byId("cfgMaintenance");
    var cfgPesan = byId("cfgPesan");
    var cfgEstimasi = byId("cfgEstimasi");
    var cfgPengumuman = byId("cfgPengumuman");
    var cfgSubmit = byId("cfgSubmit");

    var form = byId("adminForm");
    var formTitle = byId("adminFormTitle");
    var rowInput = byId("adminRow");
    var submitBtn = byId("adminSubmit");
    var cancelBtn = byId("adminCancel");
    var videoInput = byId("adminVideo");
    var judulInput = byId("adminJudul");
    var genreInput = byId("adminGenre");
    var genreEntry = byId("adminGenreEntry");
    var genreTagsBox = byId("adminGenreTags");
    var genreSuggest = byId("adminGenreSuggest");
    var tahunInput = byId("adminTahun");
    var posterInput = byId("adminPoster");
    var deskripsiInput = byId("adminDeskripsi");
    var unggulanInput = byId("adminUnggulan");
    var statusInput = byId("adminStatus");
    var rilisInput = byId("adminRilis");
    var posterPreview = byId("adminPosterPreview");
    var posterImg = byId("adminPosterImg");

    var currentPin = "";
    var currentItems = [];
    var currentView = "login";
    var currentFilter = "all";
    var currentPage = 1;
    var editingOriginal = null;
    var formSnapshot = "";
    var saving = false;
    var lastFocus = null;
    var previewTimer = null;
    var genreTags = [];
    var genreSuggestIndex = -1;

    var Dialog = null;
    var Toast = null;

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function cssVar(name, fallback) {
        var value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    }

    function isHttps(value) {
        try {
            return new URL(String(value).trim()).protocol === "https:";
        } catch (err) {
            return false;
        }
    }

    function isValidVideo(value) {
        var api = window.GemorcaVideo;
        if (api && typeof api.buildEmbedUrl === "function") return !!api.buildEmbedUrl(value);
        return isHttps(value);
    }

    function isSoon(item) {
        return String(item.status || "").trim().toLowerCase() === "segera";
    }

    function isFeatured(item) {
        return TRUE_VALUES.indexOf(String(item.unggulan || "").trim().toLowerCase()) !== -1;
    }

    function sameItem(a, b) {
        return String(a.judul || "") === String(b.judul || "") && String(a.video || "") === String(b.video || "");
    }

    function thumbFor(item) {
        var poster = String(item.poster || "").trim();
        if (isHttps(poster)) return poster;
        var api = window.GemorcaVideo;
        var id = api && typeof api.youtubeId === "function" ? api.youtubeId(String(item.video || "")) : "";
        return id ? "https://img.youtube.com/vi/" + id + "/hqdefault.jpg" : "";
    }

    function isPastEstimate(val) {
        var s = String(val || "").trim();
        if (!s) return false;
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
            s = s.replace(" ", "T") + "+08:00";
        }
        var t = Date.parse(s);
        return !isNaN(t) && t <= Date.now();
    }

    function isMaintenanceOn(cfg) {
        return !!cfg && cfg.maintenance === true && !isPastEstimate(cfg.estimasi);
    }

    function formatForPicker(val) {
        if (!val) return "";
        var s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
            return s.replace(" ", "T").slice(0, 16);
        }
        return "";
    }

    function buildSwal() {
        if (!window.Swal) return;
        var base = {
            background: cssVar("--surface", "#171a20"),
            color: cssVar("--text", "#f3f4f6"),
            confirmButtonColor: cssVar("--accent", "#d62839"),
            cancelButtonColor: cssVar("--surface-2", "#20242c"),
            heightAuto: false
        };
        Dialog = window.Swal.mixin(
            Object.assign({}, base, {
                reverseButtons: true,
                customClass: { popup: "admin-swal" }
            })
        );
        Toast = window.Swal.mixin(
            Object.assign({}, base, {
                toast: true,
                position: "top",
                showConfirmButton: false,
                timer: 3200,
                timerProgressBar: true,
                customClass: { popup: "admin-swal" },
                didOpen: function (node) {
                    node.addEventListener("mouseenter", window.Swal.stopTimer);
                    node.addEventListener("mouseleave", window.Swal.resumeTimer);
                }
            })
        );
    }

    function toast(icon, title, text) {
        Toast.fire({ icon: icon, title: title, text: text });
    }

    function serverFail(message) {
        var err = new Error(message);
        err.isServer = true;
        return err;
    }

    function errMessage(err) {
        if (err && err.name === "AbortError") return "Server terlalu lama merespons. Periksa koneksi lalu coba lagi.";
        if (err && err.isServer) return err.message;
        return "Gagal terhubung ke server. Periksa koneksi lalu coba lagi.";
    }

    function request(query, payload) {
        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = controller
            ? setTimeout(function () {
                controller.abort();
            }, REQUEST_TIMEOUT_MS)
            : null;
        var options = controller ? { signal: controller.signal } : {};
        var url = WEBAPP_URL;

        if (payload) {
            options.method = "POST";
            options.headers = { "Content-Type": "text/plain;charset=utf-8" };
            options.body = JSON.stringify(payload);
        } else {
            url += query;
        }

        return fetch(url, options)
            .then(function (res) {
                return res.text().then(function (text) {
                    try {
                        return JSON.parse(text);
                    } catch (e) {
                        var err = serverFail("Server balas format tak terduga. Coba lagi.");
                        err.badFormat = true;
                        throw err;
                    }
                });
            })
            .then(
                function (data) {
                    clearTimeout(timer);
                    return data;
                },
                function (err) {
                    clearTimeout(timer);
                    throw err;
                }
            );
    }

    var RETRY_MAX = 3;
    var RETRY_DELAY_MS = 900;

    function requestRetry(query, payload) {
        var attempt = 0;
        function run() {
            attempt++;
            return request(query, payload).catch(function (err) {
                var transient = err && (err.badFormat || err.name === "TypeError");
                if (!transient || attempt >= RETRY_MAX) throw err;
                return new Promise(function (resolve) {
                    setTimeout(resolve, RETRY_DELAY_MS * attempt);
                }).then(run);
            });
        }
        return run();
    }

    function listRequest(pin) {
        return requestRetry(null, { action: "list", pin: pin });
    }

    function setLoading(btn, isLoading, loadingText) {
        var label = btn.querySelector(".btn__label");
        if (!btn.hasAttribute("data-label")) btn.setAttribute("data-label", label.textContent);
        label.textContent = isLoading ? loadingText : btn.getAttribute("data-label");
        btn.disabled = isLoading;
        btn.classList.toggle("is-loading", isLoading);
        btn.setAttribute("aria-busy", isLoading ? "true" : "false");
    }

    function showView(view) {
        currentView = view;
        loginForm.hidden = view !== "login";
        listView.hidden = view !== "list";
        settingsView.hidden = view !== "settings";
        form.hidden = view !== "form";

        logoutBtn.hidden = view === "login";
        navTabs.hidden = view === "login" || view === "form";

        modal.classList.toggle("is-wide", view !== "login");
        panel.setAttribute("aria-labelledby", VIEW_TITLES[view]);

        if (view === "login") {
            pinInput.focus();
            return;
        }

        navTabs.querySelectorAll(".admin-tab").forEach(function (tab) {
            tab.classList.toggle("is-active", tab.dataset.tab === view);
        });

        if (view === "settings") loadSettingsView();
    }

    function logoutAdmin() {
        currentPin = "";
        try {
            sessionStorage.removeItem(SESSION_PIN_KEY);
        } catch (e) { }
        currentItems = [];
        showView("login");
        toast("info", "Berhasil keluar", "Sesi admin telah diakhiri.");
    }

    logoutBtn.addEventListener("click", logoutAdmin);

    navTabs.addEventListener("click", function (e) {
        var tab = e.target.closest(".admin-tab");
        if (tab) showView(tab.dataset.tab);
    });

    function showLoginMsg(message) {
        loginMsg.hidden = false;
        loginMsg.textContent = message;
        loginMsg.className = "admin-modal__msg is-error";
        pinInput.setAttribute("aria-invalid", "true");
    }

    function hideLoginMsg() {
        loginMsg.hidden = true;
        loginMsg.textContent = "";
        pinInput.removeAttribute("aria-invalid");
    }

    function setPinVisible(visible) {
        pinInput.type = visible ? "text" : "password";
        pinToggle.setAttribute("aria-pressed", visible ? "true" : "false");
        pinToggle.setAttribute("aria-label", visible ? "Sembunyikan PIN" : "Tampilkan PIN");
        pinToggle.classList.toggle("is-on", visible);
    }

    function openAdmin() {
        lastFocus = document.activeElement;
        modal.hidden = false;
        document.body.classList.add("no-scroll");

        try {
            var savedPin = sessionStorage.getItem(SESSION_PIN_KEY);
            if (savedPin) {
                currentPin = savedPin;
                currentItems = [];
                searchInput.value = "";
                showView("list");
                loadList();
                return;
            }
        } catch (e) { }

        currentPin = "";
        currentItems = [];
        showView("login");
    }

    function closeAdmin() {
        modal.hidden = true;
        document.body.classList.remove("no-scroll");
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
        lastFocus = null;
    }

    function renderLoading() {
        listBox.textContent = "";
        listBox.setAttribute("aria-busy", "true");
        countEl.textContent = "";
        paginationBox.textContent = "";
        for (var i = 0; i < 4; i++) listBox.appendChild(el("div", "admin-skeleton"));
    }

    function renderListError(message) {
        listBox.textContent = "";
        listBox.removeAttribute("aria-busy");
        countEl.textContent = "";
        paginationBox.textContent = "";
        var box = el("div", "admin-state");
        box.appendChild(el("p", "", message));
        var retry = el("button", "btn btn-ghost", "Muat ulang");
        retry.type = "button";
        retry.addEventListener("click", loadList);
        box.appendChild(retry);
        listBox.appendChild(box);
    }

    function makeThumb(item) {
        var src = thumbFor(item);
        if (!src) return el("span", "admin-thumb admin-thumb--empty");
        var img = document.createElement("img");
        img.className = "admin-thumb";
        img.alt = "";
        img.loading = "lazy";
        img.src = src;
        img.addEventListener("error", function () {
            img.replaceWith(el("span", "admin-thumb admin-thumb--empty"));
        });
        return img;
    }

    function quickToggle(item, key, newValue, btn) {
        btn.disabled = true;
        var payload = Object.assign({}, item, { pin: currentPin, action: "update" });
        payload[key] = newValue;

        request(null, payload)
            .then(function (data) {
                if (!data.ok) throw serverFail(data.error || "Gagal memperbarui.");
                toast("success", "Berhasil diubah", "Status film diperbarui.");
                loadList();
            })
            .catch(function (err) {
                toast("error", "Gagal mengubah", errMessage(err));
                btn.disabled = false;
            });
    }

    function makeRow(item) {
        var name = item.judul || "(tanpa judul)";
        var tr = document.createElement("tr");

        var tdThumb = el("td", "admin-list__cell-thumb");
        tdThumb.appendChild(makeThumb(item));
        tr.appendChild(tdThumb);

        var tdTitle = el("td", "admin-list__cell-title");
        var titleBox = el("div", "admin-list__titlebox");
        titleBox.appendChild(el("span", "admin-list__title", name));

        var featBtn = el("button", "admin-quick-btn" + (isFeatured(item) ? " is-active" : ""), "★ Unggulan");
        featBtn.type = "button";
        featBtn.addEventListener("click", function () {
            quickToggle(item, "unggulan", isFeatured(item) ? "" : "ya", featBtn);
        });
        titleBox.appendChild(featBtn);

        var statusBtn = el("button", "admin-quick-btn" + (isSoon(item) ? " is-active" : ""), isSoon(item) ? "⚡ Segera" : "Tayang");
        statusBtn.type = "button";
        statusBtn.addEventListener("click", function () {
            quickToggle(item, "status", isSoon(item) ? "" : "segera", statusBtn);
        });
        titleBox.appendChild(statusBtn);

        tdTitle.appendChild(titleBox);
        tr.appendChild(tdTitle);

        tr.appendChild(el("td", "admin-list__cell-genre admin-list__muted", item.genre || ""));
        tr.appendChild(el("td", "admin-list__cell-year admin-list__muted", item.tahun || ""));

        var tdActions = el("td", "admin-list__cell-actions");
        var actions = el("div", "admin-list__actions");
        var editBtn = el("button", "btn btn-ghost admin-list__btn", "Ubah");
        editBtn.type = "button";
        editBtn.addEventListener("click", function () { openForm(item); });
        var delBtn = el("button", "btn btn-ghost admin-list__btn admin-list__btn--danger", "Hapus");
        delBtn.type = "button";
        delBtn.addEventListener("click", function () { deleteItem(item); });
        actions.append(editBtn, delBtn);
        tdActions.appendChild(actions);
        tr.appendChild(tdActions);

        return tr;
    }

    function renderPagination(totalItems) {
        paginationBox.textContent = "";
        var totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
        if (totalPages <= 1) return;

        var prevBtn = el("button", "admin-page-btn", "«");
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener("click", function () {
            currentPage--;
            renderList();
        });
        paginationBox.appendChild(prevBtn);

        for (var i = 1; i <= totalPages; i++) {
            (function (p) {
                var btn = el("button", "admin-page-btn" + (p === currentPage ? " is-active" : ""), String(p));
                btn.addEventListener("click", function () {
                    currentPage = p;
                    renderList();
                });
                paginationBox.appendChild(btn);
            })(i);
        }

        var nextBtn = el("button", "admin-page-btn", "»");
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.addEventListener("click", function () {
            currentPage++;
            renderList();
        });
        paginationBox.appendChild(nextBtn);
    }

    function renderList() {
        listBox.textContent = "";
        listBox.removeAttribute("aria-busy");

        var query = searchInput.value.trim().toLowerCase();
        var items = currentItems.filter(function (item) {
            var matchQuery = !query || (String(item.judul || "") + " " + String(item.genre || "")).toLowerCase().indexOf(query) !== -1;
            var matchStatus = true;
            if (currentFilter === "featured") matchStatus = isFeatured(item);
            else if (currentFilter === "soon") matchStatus = isSoon(item);
            return matchQuery && matchStatus;
        });

        countEl.textContent = items.length + " film";

        if (!items.length) {
            var empty = el("div", "admin-state");
            empty.appendChild(el("p", "", "Tidak ada film ditemukan."));
            listBox.appendChild(empty);
            paginationBox.textContent = "";
            return;
        }

        var start = (currentPage - 1) * ITEMS_PER_PAGE;
        var paginatedItems = items.slice(start, start + ITEMS_PER_PAGE);

        var table = el("table", "admin-list__table");
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        [["Poster", true], ["Judul"], ["Genre"], ["Tahun"], ["Aksi", true]].forEach(function (col) {
            var th = document.createElement("th");
            if (col[1]) th.appendChild(el("span", "admin-sr", col[0]));
            else th.textContent = col[0];
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        paginatedItems.forEach(function (item) {
            tbody.appendChild(makeRow(item));
        });
        table.appendChild(tbody);
        listBox.appendChild(table);

        renderPagination(items.length);
    }

    document.querySelectorAll(".admin-chip").forEach(function (chip) {
        chip.addEventListener("click", function () {
            document.querySelectorAll(".admin-chip").forEach(function (c) { c.classList.remove("is-active"); });
            chip.classList.add("is-active");
            currentFilter = chip.dataset.filter;
            currentPage = 1;
            renderList();
        });
    });

    function forceRefreshCache() {
        try {
            sessionStorage.removeItem("gemorcafilm_sheet_cache");
            localStorage.removeItem("gemorcafilm_status");
        } catch (e) { }
        toast("info", "Cache dibersihkan", "Memuat ulang data terbaru...");
        loadList();
    }

    refreshCacheBtn.addEventListener("click", forceRefreshCache);

    function loadList() {
        renderLoading();
        return listRequest(currentPin)
            .then(function (data) {
                if (!data.ok) throw serverFail(data.error || "Gagal memuat daftar film.");
                currentItems = data.items || [];
                renderList();
            })
            .catch(function (err) {
                renderListError(errMessage(err));
            });
    }

    function deleteItem(item) {
        var name = item.judul || "(tanpa judul)";
        Dialog.fire({
            icon: "warning",
            title: "Hapus film ini?",
            text: "Film " + name + " akan dihapus permanen.",
            showCancelButton: true,
            confirmButtonText: "Ya, hapus",
            cancelButtonText: "Batal"
        }).then(function (result) {
            if (!result.isConfirmed) return;
            request(null, { pin: currentPin, action: "delete", row: item.row })
                .then(function (data) {
                    if (!data.ok) throw serverFail(data.error || "Gagal menghapus.");
                    toast("success", "Film dihapus", "Daftar diperbarui.");
                    loadList();
                })
                .catch(function (err) {
                    toast("error", "Gagal menghapus", errMessage(err));
                });
        });
    }

    function loadSettingsView() {
        requestRetry(null, { action: "config", pin: currentPin })
            .then(function (data) {
                if (!data.ok) throw serverFail(data.error);
                var cfg = data.config || {};
                cfgMaintenance.checked = isMaintenanceOn(cfg);
                cfgPesan.value = cfg.pesan || "";
                cfgEstimasi.value = formatForPicker(cfg.estimasi);
                cfgPengumuman.value = cfg.pengumuman || "";
            })
            .catch(function (err) {
                toast("error", "Gagal memuat pengaturan", errMessage(err));
            });
    }

    settingsView.addEventListener("submit", function (e) {
        e.preventDefault();
        var payload = {
            pin: currentPin,
            action: "setconfig",
            maintenance: cfgMaintenance.checked,
            pesan: cfgPesan.value.trim(),
            estimasi: cfgEstimasi.value.trim(),
            pengumuman: cfgPengumuman.value.trim()
        };

        setLoading(cfgSubmit, true, "Menyimpan...");
        requestRetry(null, payload)
            .then(function (data) {
                if (!data.ok) throw serverFail(data.error);
                toast("success", "Pengaturan disimpan", "Pengunjung melihat perubahan dalam 1 menit.");
            })
            .catch(function (err) {
                toast("error", "Gagal menyimpan", errMessage(err));
            })
            .finally(function () {
                setLoading(cfgSubmit, false, "Simpan Pengaturan");
            });
    });

    function readForm() {
        return {
            video: videoInput.value.trim(),
            judul: judulInput.value.trim(),
            genre: genreInput.value.trim(),
            tahun: tahunInput.value.trim(),
            poster: posterInput.value.trim(),
            deskripsi: deskripsiInput.value.trim(),
            unggulan: unggulanInput.checked ? "ya" : "",
            status: statusInput.value === "segera" ? "segera" : "",
            rilis: rilisInput.value.trim()
        };
    }

    function splitGenreText(text) {
        return String(text || "").split(",").map(function (g) { return g.trim(); }).filter(Boolean);
    }

    function renderGenreTags() {
        genreTagsBox.textContent = "";
        genreTags.forEach(function (tag) {
            var chip = el("span", "tag-chip");
            chip.appendChild(document.createTextNode(tag));
            var remove = el("button", "tag-chip__remove", "×");
            remove.type = "button";
            remove.addEventListener("click", function () {
                genreTags = genreTags.filter(function (t) { return t !== tag; });
                renderGenreTags();
                genreInput.value = genreTags.join(", ");
            });
            chip.appendChild(remove);
            genreTagsBox.appendChild(chip);
        });
    }

    function setGenreTags(tags) {
        genreTags = tags;
        renderGenreTags();
        genreInput.value = genreTags.join(", ");
    }

    function openForm(item) {
        form.reset();
        posterPreview.hidden = true;
        editingOriginal = null;

        if (item) {
            formTitle.textContent = "Ubah Film";
            rowInput.value = item.row;
            videoInput.value = item.video || "";
            judulInput.value = item.judul || "";
            setGenreTags(splitGenreText(item.genre));
            tahunInput.value = item.tahun || "";
            posterInput.value = item.poster || "";
            deskripsiInput.value = item.deskripsi || "";
            unggulanInput.checked = isFeatured(item);
            statusInput.value = isSoon(item) ? "segera" : "";
            rilisInput.value = formatForPicker(item.rilis);
            editingOriginal = item;
        } else {
            formTitle.textContent = "Tambah Film";
            rowInput.value = "";
            setGenreTags([]);
        }
        showView("form");
    }

    cancelBtn.addEventListener("click", function () { showView("list"); });

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        var payload = readForm();
        payload.pin = currentPin;
        payload.action = rowInput.value ? "update" : "create";
        if (rowInput.value) payload.row = Number(rowInput.value);

        setLoading(submitBtn, true, "Menyimpan...");
        request(null, payload)
            .then(function (data) {
                if (!data.ok) throw serverFail(data.error);
                try { sessionStorage.removeItem("gemorcafilm_sheet_cache"); } catch (e) { }
                showView("list");
                toast("success", "Film disimpan", "Beranda berhasil diperbarui.");
                loadList();
            })
            .catch(function (err) {
                toast("error", "Gagal menyimpan", errMessage(err));
            })
            .finally(function () {
                setLoading(submitBtn, false, "Simpan");
            });
    });

    closeBtn.addEventListener("click", closeAdmin);
    pinToggle.addEventListener("click", function () { setPinVisible(pinInput.type === "password"); });
    pinInput.addEventListener("input", hideLoginMsg);

    loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var pin = pinInput.value.trim();
        if (!pin) return showLoginMsg("Isi PIN terlebih dahulu.");

        setLoading(loginSubmit, true, "Memproses...");
        fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: pin })
        })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.ok) {
                    currentPin = pin;
                    try { sessionStorage.setItem(SESSION_PIN_KEY, pin); } catch (e) { }
                    showView("list");
                    loadList();
                } else {
                    showLoginMsg(data.error || "PIN salah.");
                }
            })
            .catch(function () { showLoginMsg("Gagal terhubung ke server."); })
            .finally(function () { setLoading(loginSubmit, false, "Masuk"); });
    });

    searchInput.addEventListener("input", function () { currentPage = 1; renderList(); });
    addNewBtn.addEventListener("click", function () { openForm(null); });

    if (logo) {
        var clickCount = 0, clickTimer = null;
        logo.addEventListener("click", function (e) {
            clickCount++;
            if (clickCount === 1) clickTimer = setTimeout(function () { clickCount = 0; }, 2000);
            if (clickCount >= 5) {
                e.preventDefault();
                clickCount = 0;
                clearTimeout(clickTimer);
                openAdmin();
            }
        }, true);
    }

    buildSwal();
})();