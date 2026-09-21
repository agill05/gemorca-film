(function () {
    "use strict";

    var WEBAPP_URL = "https://script.google.com/macros/s/AKfycbztuRzf8VwANcWukQkq9imZ2dSVcsUJ4Lz2z-5CbL0696Ij4OKitCJtMll-B2fDFZCb_A/exec";
    var REQUEST_TIMEOUT_MS = 20000;
    var MIN_YEAR = 1900;
    var TRUE_VALUES = ["ya", "yes", "true", "1", "x"];
    var VIEW_TITLES = { login: "adminLoginTitle", list: "adminListTitle", form: "adminFormTitle" };

    function byId(id) {
        return document.getElementById(id);
    }

    var modal = byId("adminModal");
    var panel = byId("adminPanel");
    var closeBtn = byId("adminClose");
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
    var addNewBtn = byId("adminAddNew");

    var form = byId("adminForm");
    var formTitle = byId("adminFormTitle");
    var rowInput = byId("adminRow");
    var submitBtn = byId("adminSubmit");
    var cancelBtn = byId("adminCancel");
    var videoInput = byId("adminVideo");
    var videoPreview = byId("adminVideoPreview");
    // var videoFrame = byId("adminVideoFrame");
    var judulInput = byId("adminJudul");
    var genreInput = byId("adminGenre");
    var genreEntry = byId("adminGenreEntry");
    var genreTagsBox = byId("adminGenreTags");
    var genreSuggest = byId("adminGenreSuggest");
    var tahunInput = byId("adminTahun");
    var posterInput = byId("adminPoster");
    var deskripsiInput = byId("adminDeskripsi");
    var unggulanInput = byId("adminUnggulan");
    var posterPreview = byId("adminPosterPreview");
    var posterImg = byId("adminPosterImg");

    var currentPin = "";
    var currentItems = [];
    var currentView = "login";
    var editingOriginal = null;
    var formSnapshot = "";
    var saving = false;
    var lastFocus = null;
    var previewTimer = null;
    var videoPreviewTimer = null;
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

    function dialogOpen() {
        if (!window.Swal || !window.Swal.isVisible()) return false;
        var popup = window.Swal.getPopup();
        return !(popup && popup.classList.contains("swal2-toast"));
    }

    function confirmDiscard() {
        return Dialog.fire({
            icon: "question",
            title: "Buang perubahan?",
            text: "Perubahan yang belum disimpan akan hilang.",
            showCancelButton: true,
            confirmButtonText: "Ya, buang",
            cancelButtonText: "Lanjut mengisi",
            focusCancel: true
        }).then(function (result) {
            return result.isConfirmed;
        });
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
                return res.json();
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

    function listUrl(pin) {
        return "?action=list&pin=" + encodeURIComponent(pin);
    }

    function setLoading(btn, isLoading, loadingText) {
        var label = btn.querySelector(".btn__label");
        if (!btn.hasAttribute("data-label")) btn.setAttribute("data-label", label.textContent);
        label.textContent = isLoading ? loadingText : btn.getAttribute("data-label");
        btn.disabled = isLoading;
        btn.classList.toggle("is-loading", isLoading);
        btn.setAttribute("aria-busy", isLoading ? "true" : "false");
    }

    function setLoginBusy(isBusy) {
        setLoading(loginSubmit, isBusy, "Memproses...");
        pinInput.disabled = isBusy;
        pinToggle.disabled = isBusy;
    }

    function setSaving(isSaving) {
        saving = isSaving;
        setLoading(submitBtn, isSaving, "Menyimpan...");
        cancelBtn.disabled = isSaving;
    }

    function showView(view) {
        currentView = view;
        loginForm.hidden = view !== "login";
        listView.hidden = view !== "list";
        form.hidden = view !== "form";
        modal.classList.toggle("is-wide", view !== "login");
        panel.setAttribute("aria-labelledby", VIEW_TITLES[view]);

        if (view === "login") {
            pinInput.focus();
            return;
        }
        var title = byId(VIEW_TITLES[view]);
        title.setAttribute("tabindex", "-1");
        title.focus({ preventScroll: true });
    }

    function focusables() {
        var selector =
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        return Array.prototype.filter.call(panel.querySelectorAll(selector), function (node) {
            return node.offsetParent !== null;
        });
    }

    function trapTab(e) {
        var nodes = focusables();
        if (!nodes.length) {
            e.preventDefault();
            panel.focus();
            return;
        }
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        var active = document.activeElement;
        if (!panel.contains(active)) {
            e.preventDefault();
            first.focus();
        } else if (e.shiftKey && active === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    }

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
        currentPin = "";
        currentItems = [];
        editingOriginal = null;
        pinInput.value = "";
        searchInput.value = "";
        setPinVisible(false);
        hideLoginMsg();
        loginSubmit.disabled = !Dialog;
        showView("login");
        if (!Dialog) showLoginMsg("Pustaka notifikasi gagal dimuat. Muat ulang halaman, lalu coba lagi.");
    }

    function closeAdmin() {
        modal.hidden = true;
        document.body.classList.remove("no-scroll");
        currentPin = "";
        pinInput.value = "";
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
        lastFocus = null;
    }

    function requestClose() {
        if (saving) return;
        if (currentView === "form" && isDirty()) {
            confirmDiscard().then(function (ok) {
                if (ok) closeAdmin();
            });
            return;
        }
        closeAdmin();
    }

    function renderLoading() {
        listBox.textContent = "";
        listBox.setAttribute("aria-busy", "true");
        countEl.textContent = "";
        for (var i = 0; i < 4; i++) listBox.appendChild(el("div", "admin-skeleton"));
    }

    function renderListError(message) {
        listBox.textContent = "";
        listBox.removeAttribute("aria-busy");
        countEl.textContent = "";
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
        img.referrerPolicy = "no-referrer";
        img.src = src;
        img.addEventListener("error", function () {
            img.replaceWith(el("span", "admin-thumb admin-thumb--empty"));
        });
        return img;
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
        if (isFeatured(item)) titleBox.appendChild(el("span", "admin-badge", "Unggulan"));
        tdTitle.appendChild(titleBox);
        tr.appendChild(tdTitle);

        tr.appendChild(el("td", "admin-list__cell-genre admin-list__muted", item.genre || ""));
        tr.appendChild(el("td", "admin-list__cell-year admin-list__muted", item.tahun || ""));

        var tdActions = el("td", "admin-list__cell-actions");
        var actions = el("div", "admin-list__actions");
        var editBtn = el("button", "btn btn-ghost admin-list__btn", "Ubah");
        editBtn.type = "button";
        editBtn.setAttribute("aria-label", "Ubah film " + name);
        editBtn.addEventListener("click", function () {
            openForm(item);
        });
        var delBtn = el("button", "btn btn-ghost admin-list__btn admin-list__btn--danger", "Hapus");
        delBtn.type = "button";
        delBtn.setAttribute("aria-label", "Hapus film " + name);
        delBtn.addEventListener("click", function () {
            deleteItem(item);
        });
        actions.append(editBtn, delBtn);
        tdActions.appendChild(actions);
        tr.appendChild(tdActions);

        return tr;
    }

    function renderList() {
        listBox.textContent = "";
        listBox.removeAttribute("aria-busy");

        var query = searchInput.value.trim().toLowerCase();
        var items = currentItems.filter(function (item) {
            if (!query) return true;
            return (String(item.judul || "") + " " + String(item.genre || "")).toLowerCase().indexOf(query) !== -1;
        });

        countEl.textContent = query
            ? items.length + " dari " + currentItems.length + " film"
            : currentItems.length + " film";

        if (!currentItems.length) {
            var empty = el("div", "admin-state");
            empty.appendChild(el("p", "", "Belum ada film. Tambahkan film pertama dengan tombol di bawah."));
            listBox.appendChild(empty);
            return;
        }
        if (!items.length) {
            var none = el("div", "admin-state");
            none.appendChild(el("p", "", "Tidak ada film yang cocok dengan \u201C" + searchInput.value.trim() + "\u201D."));
            listBox.appendChild(none);
            return;
        }

        var table = el("table", "admin-list__table");
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        [["Poster", true], ["Judul"], ["Genre"], ["Tahun"], ["Aksi", true]].forEach(function (col) {
            var th = document.createElement("th");
            th.scope = "col";
            if (col[1]) th.appendChild(el("span", "admin-sr", col[0]));
            else th.textContent = col[0];
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        items.forEach(function (item) {
            tbody.appendChild(makeRow(item));
        });
        table.appendChild(tbody);
        listBox.appendChild(table);
    }

    function loadList() {
        renderLoading();
        return request(listUrl(currentPin))
            .then(function (data) {
                if (!data.ok) throw serverFail(data.error || "Gagal memuat daftar film.");
                currentItems = data.items || [];
                renderList();
            })
            .catch(function (err) {
                renderListError(errMessage(err));
            });
    }

    function verifyRow(item) {
        return request(listUrl(currentPin)).then(function (data) {
            if (!data.ok) throw serverFail(data.error || "Gagal memeriksa data terbaru.");
            currentItems = data.items || [];
            var fresh = null;
            currentItems.forEach(function (candidate) {
                if (Number(candidate.row) === Number(item.row)) fresh = candidate;
            });
            return !!fresh && sameItem(fresh, item);
        });
    }

    function deleteItem(item) {
        var name = item.judul || "(tanpa judul)";
        var box = el("div");
        box.appendChild(document.createTextNode("Film "));
        box.appendChild(el("strong", "", name));
        box.appendChild(document.createTextNode(" akan dihapus dari Google Sheet. Tindakan ini tidak bisa dibatalkan."));

        Dialog.fire({
            icon: "warning",
            title: "Hapus film ini?",
            html: box,
            showCancelButton: true,
            confirmButtonText: "Ya, hapus",
            cancelButtonText: "Batal",
            focusCancel: true,
            showLoaderOnConfirm: true,
            allowOutsideClick: function () {
                return !window.Swal.isLoading();
            },
            preConfirm: function () {
                return verifyRow(item)
                    .then(function (ok) {
                        if (!ok) return { stale: true };
                        return request(null, { pin: currentPin, action: "delete", row: item.row }).then(function (data) {
                            if (!data.ok) throw serverFail(data.error || "Film gagal dihapus.");
                            return { done: true };
                        });
                    })
                    .catch(function (err) {
                        window.Swal.showValidationMessage(errMessage(err));
                    });
            }
        }).then(function (result) {
            if (!result.isConfirmed || !result.value) return;
            if (result.value.stale) {
                renderList();
                toast("warning", "Data sudah berubah", "Daftar dimuat ulang. Ulangi hapus jika film ini masih perlu dihapus.");
                return;
            }
            toast("success", "Film dihapus", "Beranda diperbarui dalam beberapa menit.");
            loadList();
        });
    }

    function readForm() {
        return {
            video: videoInput.value.trim(),
            judul: judulInput.value.trim(),
            genre: genreInput.value.trim(),
            tahun: tahunInput.value.trim(),
            poster: posterInput.value.trim(),
            deskripsi: deskripsiInput.value.trim(),
            unggulan: unggulanInput.checked ? "ya" : ""
        };
    }

    function serializeForm() {
        return JSON.stringify(readForm());
    }

    function isDirty() {
        return serializeForm() !== formSnapshot;
    }

    function updatePosterPreview() {
        var url = posterInput.value.trim();
        if (!isHttps(url)) {
            posterPreview.hidden = true;
            posterImg.removeAttribute("src");
            return;
        }
        posterImg.onload = function () {
            posterPreview.hidden = false;
        };
        posterImg.onerror = function () {
            posterPreview.hidden = true;
        };
        posterImg.src = url;
    }

    function updateVideoPreview() {
        var url = videoInput.value.trim();
        var api = window.GemorcaVideo;
        var embedUrl = api && typeof api.buildEmbedUrl === "function" ? api.buildEmbedUrl(url) : "";
        if (!embedUrl) {
            videoPreview.hidden = true;
            videoFrame.removeAttribute("src");
            return;
        }
        videoFrame.src = embedUrl;
        videoPreview.hidden = false;
    }

    function splitGenreText(text) {
        return String(text || "")
            .split(",")
            .map(function (g) {
                return g.trim();
            })
            .filter(Boolean);
    }

    function syncGenreHidden() {
        genreInput.value = genreTags.join(", ");
    }

    function renderGenreTags() {
        genreTagsBox.textContent = "";
        genreTags.forEach(function (tag) {
            var chip = el("span", "tag-chip");
            chip.appendChild(document.createTextNode(tag));
            var remove = el("button", "tag-chip__remove", "\u00d7");
            remove.type = "button";
            remove.setAttribute("aria-label", "Hapus genre " + tag);
            remove.dataset.tag = tag;
            chip.appendChild(remove);
            genreTagsBox.appendChild(chip);
        });
    }

    function setGenreTags(tags) {
        var seen = {};
        genreTags = tags.filter(function (tag) {
            var key = tag.toLowerCase();
            if (!tag || seen[key]) return false;
            seen[key] = true;
            return true;
        });
        renderGenreTags();
        syncGenreHidden();
    }

    function addGenreTag(raw) {
        var tag = String(raw || "").trim();
        if (!tag) return;
        var exists = genreTags.some(function (t) {
            return t.toLowerCase() === tag.toLowerCase();
        });
        if (!exists) setGenreTags(genreTags.concat(tag));
        genreEntry.value = "";
        closeGenreSuggestions();
    }

    function removeGenreTag(tag) {
        setGenreTags(
            genreTags.filter(function (t) {
                return t !== tag;
            })
        );
    }

    function collectKnownGenres() {
        var seen = {};
        var list = [];
        currentItems.forEach(function (item) {
            splitGenreText(item.genre).forEach(function (g) {
                var key = g.toLowerCase();
                if (!seen[key]) {
                    seen[key] = true;
                    list.push(g);
                }
            });
        });
        return list;
    }

    function closeGenreSuggestions() {
        genreSuggest.hidden = true;
        genreSuggest.textContent = "";
        genreSuggestIndex = -1;
    }

    function renderGenreSuggestions(query) {
        var q = query.trim().toLowerCase();
        genreSuggest.textContent = "";
        if (!q) {
            closeGenreSuggestions();
            return;
        }
        var used = {};
        genreTags.forEach(function (t) {
            used[t.toLowerCase()] = true;
        });
        var matches = collectKnownGenres()
            .filter(function (g) {
                return g.toLowerCase().indexOf(q) !== -1 && !used[g.toLowerCase()];
            })
            .slice(0, 6);
        if (!matches.length) {
            closeGenreSuggestions();
            return;
        }
        matches.forEach(function (g) {
            var li = el("li", "", g);
            li.setAttribute("role", "option");
            genreSuggest.appendChild(li);
        });
        genreSuggestIndex = -1;
        genreSuggest.hidden = false;
    }

    function openForm(item) {
        form.reset();
        posterPreview.hidden = true;
        posterImg.removeAttribute("src");
        videoPreview.hidden = true;
        videoFrame.removeAttribute("src");
        genreEntry.value = "";
        closeGenreSuggestions();
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
            editingOriginal = item;
            updatePosterPreview();
            updateVideoPreview();
        } else {
            formTitle.textContent = "Tambah Film";
            rowInput.value = "";
            setGenreTags([]);
        }
        formSnapshot = serializeForm();
        showView("form");
    }

    function leaveForm() {
        if (saving) return;
        if (!isDirty()) {
            showView("list");
            return;
        }
        confirmDiscard().then(function (ok) {
            if (ok) showView("list");
        });
    }

    function validateForm() {
        var values = readForm();
        if (!values.video) return { field: videoInput, message: "Isi URL video terlebih dahulu." };
        if (!isValidVideo(values.video)) {
            return {
                field: videoInput,
                message: "URL video harus tautan https dari YouTube atau Google Drive. Tautan lain tidak akan tampil di beranda."
            };
        }
        if (values.poster && !isHttps(values.poster)) {
            return { field: posterInput, message: "URL poster harus diawali https://." };
        }
        if (values.tahun) {
            var maxYear = new Date().getFullYear() + 1;
            var year = Number(values.tahun);
            if (!/^\d{4}$/.test(values.tahun) || year < MIN_YEAR || year > maxYear) {
                return { field: tahunInput, message: "Tahun harus 4 digit, antara " + MIN_YEAR + " dan " + maxYear + "." };
            }
        }
        return null;
    }

    function showSaveError(message) {
        Dialog.fire({
            icon: "error",
            title: "Film belum tersimpan",
            text: message,
            showCancelButton: true,
            confirmButtonText: "Coba lagi",
            cancelButtonText: "Tutup"
        }).then(function (result) {
            if (result.isConfirmed) submitBtn.click();
        });
    }

    function finishSave() {
        formSnapshot = serializeForm();
        showView("list");
        toast("success", "Film disimpan", "Beranda diperbarui dalam beberapa menit.");
        loadList();
    }

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (saving) return;

        var problem = validateForm();
        if (problem) {
            Dialog.fire({ icon: "warning", title: "Periksa kembali isian", text: problem.message }).then(function () {
                problem.field.focus();
            });
            return;
        }

        var payload = readForm();
        payload.pin = currentPin;
        payload.action = rowInput.value ? "update" : "create";
        if (rowInput.value) payload.row = Number(rowInput.value);

        setSaving(true);

        var job = rowInput.value
            ? verifyRow(editingOriginal).then(function (ok) {
                  return ok ? request(null, payload) : { stale: true };
              })
            : request(null, payload);

        job.then(function (data) {
            if (data.stale) {
                showView("list");
                renderList();
                Dialog.fire({
                    icon: "warning",
                    title: "Data sudah berubah",
                    text: "Film ini berubah di tempat lain, jadi perubahan Anda tidak disimpan. Daftar sudah dimuat ulang. Buka lagi film yang ingin diubah."
                });
                return;
            }
            if (data.ok) {
                finishSave();
                return;
            }
            showSaveError(data.error || "Server menolak permintaan. Coba lagi.");
        })
            .catch(function (err) {
                showSaveError(errMessage(err));
            })
            .finally(function () {
                setSaving(false);
            });
    });

    var clickCount = 0;
    var clickTimer = null;
    if (logo) {
        logo.addEventListener(
            "click",
            function (e) {
                clickCount++;
                if (clickCount === 1) {
                    clickTimer = setTimeout(function () {
                        clickCount = 0;
                    }, 2000);
                }
                if (clickCount >= 5) {
                    e.preventDefault();
                    e.stopPropagation();
                    clickCount = 0;
                    clearTimeout(clickTimer);
                    openAdmin();
                }
            },
            true
        );
    }

    closeBtn.addEventListener("click", requestClose);
    modal.addEventListener("click", function (e) {
        if (e.target.hasAttribute("data-admin-close")) requestClose();
    });
    document.addEventListener("keydown", function (e) {
        if (modal.hidden || dialogOpen()) return;
        if (e.key === "Escape") requestClose();
        else if (e.key === "Tab") trapTab(e);
    });

    pinToggle.addEventListener("click", function () {
        setPinVisible(pinInput.type === "password");
        pinInput.focus();
    });
    pinInput.addEventListener("input", hideLoginMsg);

    loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!Dialog) return;

        var pin = pinInput.value;
        hideLoginMsg();
        if (!pin) {
            showLoginMsg("Isi PIN terlebih dahulu.");
            pinInput.focus();
            return;
        }

        setLoginBusy(true);
        request(listUrl(pin))
            .then(function (data) {
                if (modal.hidden) return;
                if (data.ok) {
                    currentPin = pin;
                    currentItems = data.items || [];
                    searchInput.value = "";
                    renderList();
                    showView("list");
                } else {
                    showLoginMsg(data.error || "PIN salah. Periksa lalu coba lagi.");
                }
            })
            .catch(function (err) {
                if (!modal.hidden) showLoginMsg(errMessage(err));
            })
            .finally(function () {
                setLoginBusy(false);
                if (!modal.hidden && currentView === "login") {
                    pinInput.focus();
                    pinInput.select();
                }
            });
    });

    searchInput.addEventListener("input", function () {
        if (listBox.getAttribute("aria-busy") === "true") return;
        renderList();
    });
    addNewBtn.addEventListener("click", function () {
        openForm(null);
    });
    cancelBtn.addEventListener("click", leaveForm);

    posterInput.addEventListener("input", function () {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(updatePosterPreview, 350);
    });

    videoInput.addEventListener("input", function () {
        clearTimeout(videoPreviewTimer);
        videoPreviewTimer = setTimeout(updateVideoPreview, 350);
    });

    genreEntry.addEventListener("input", function () {
        renderGenreSuggestions(genreEntry.value);
    });

    genreEntry.addEventListener("keydown", function (e) {
        var items = genreSuggest.hidden ? [] : Array.prototype.slice.call(genreSuggest.children);
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (items.length && genreSuggestIndex >= 0 && items[genreSuggestIndex]) {
                addGenreTag(items[genreSuggestIndex].textContent);
            } else {
                addGenreTag(genreEntry.value);
            }
            return;
        }
        if (e.key === "Backspace" && !genreEntry.value && genreTags.length) {
            removeGenreTag(genreTags[genreTags.length - 1]);
            return;
        }
        if (e.key === "Escape") {
            closeGenreSuggestions();
            return;
        }
        if (!items.length) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            genreSuggestIndex = (genreSuggestIndex + 1) % items.length;
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            genreSuggestIndex = (genreSuggestIndex - 1 + items.length) % items.length;
        } else {
            return;
        }
        items.forEach(function (li, i) {
            li.classList.toggle("is-active", i === genreSuggestIndex);
        });
    });

    genreSuggest.addEventListener("click", function (e) {
        var li = e.target.closest("li");
        if (li) addGenreTag(li.textContent);
    });

    genreTagsBox.addEventListener("click", function (e) {
        var removeBtn = e.target.closest(".tag-chip__remove");
        if (removeBtn) removeGenreTag(removeBtn.dataset.tag);
    });

    document.addEventListener("click", function (e) {
        if (!e.target.closest("#adminGenreTagInput")) closeGenreSuggestions();
    });

    buildSwal();
})();