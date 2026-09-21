(function () {
    "use strict";

    var WEBAPP_URL = "https://script.google.com/macros/s/AKfycbztuRzf8VwANcWukQkq9imZ2dSVcsUJ4Lz2z-5CbL0696Ij4OKitCJtMll-B2fDFZCb_A/exec";

    var modal = document.getElementById("adminModal");
    var closeBtn = document.getElementById("adminClose");
    var logo = document.querySelector(".logo[data-home]");

    var loginForm = document.getElementById("adminLoginForm");
    var loginMsg = document.getElementById("adminLoginMsg");
    var loginSubmit = document.getElementById("adminLoginSubmit");
    var pinInput = document.getElementById("adminPin");

    var listView = document.getElementById("adminListView");
    var listBox = document.getElementById("adminList");
    var addNewBtn = document.getElementById("adminAddNew");

    var form = document.getElementById("adminForm");
    var formTitle = document.getElementById("adminFormTitle");
    var rowInput = document.getElementById("adminRow");
    var msg = document.getElementById("adminMsg");
    var submitBtn = document.getElementById("adminSubmit");
    var cancelBtn = document.getElementById("adminCancel");

    var currentPin = "";
    var currentItems = [];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function showView(view) {
        loginForm.hidden = view !== "login";
        listView.hidden = view !== "list";
        form.hidden = view !== "form";
    }

    function openAdmin() {
        modal.hidden = false;
        document.body.classList.add("no-scroll");
        currentPin = "";
        pinInput.value = "";
        loginMsg.hidden = true;
        showView("login");
    }

    function closeAdmin() {
        modal.hidden = true;
        document.body.classList.remove("no-scroll");
    }

    var params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "300505") openAdmin();

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

    closeBtn.addEventListener("click", closeAdmin);
    modal.addEventListener("click", function (e) {
        if (e.target.hasAttribute("data-admin-close")) closeAdmin();
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !modal.hidden) closeAdmin();
    });

    function fetchApi(query, payload) {
        if (payload) {
            return fetch(WEBAPP_URL, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            }).then(function (res) {
                return res.json();
            });
        }
        return fetch(WEBAPP_URL + query).then(function (res) {
            return res.json();
        });
    }

    function loadList() {
        listBox.textContent = "Memuat...";
        fetchApi("?action=list&pin=" + encodeURIComponent(currentPin))
            .then(function (data) {
                if (!data.ok) {
                    listBox.textContent = data.error || "Gagal memuat daftar.";
                    return;
                }
                currentItems = data.items || [];
                renderList();
            })
            .catch(function () {
                listBox.textContent = "Gagal terhubung ke server.";
            });
    }

    function renderList() {
        listBox.textContent = "";
        if (!currentItems.length) {
            listBox.appendChild(el("p", "admin-list__empty", "Belum ada film."));
            return;
        }
        var table = document.createElement("table");
        table.className = "admin-list__table";
        currentItems.forEach(function (item) {
            var tr = document.createElement("tr");
            tr.appendChild(el("td", "", item.judul || "(tanpa judul)"));
            tr.appendChild(el("td", "", item.genre || ""));
            tr.appendChild(el("td", "", item.tahun || ""));

            var actions = document.createElement("td");
            var editBtn = el("button", "btn btn-ghost admin-list__btn", "Ubah");
            editBtn.type = "button";
            editBtn.addEventListener("click", function () {
                openForm(item);
            });
            var delBtn = el("button", "btn btn-ghost admin-list__btn", "Hapus");
            delBtn.type = "button";
            delBtn.addEventListener("click", function () {
                deleteItem(item);
            });
            actions.append(editBtn, delBtn);
            tr.appendChild(actions);

            table.appendChild(tr);
        });
        listBox.appendChild(table);
    }

    function openForm(item) {
        msg.hidden = true;
        form.reset();
        if (item) {
            formTitle.textContent = "Ubah Film";
            rowInput.value = item.row;
            document.getElementById("adminVideo").value = item.video || "";
            document.getElementById("adminJudul").value = item.judul || "";
            document.getElementById("adminGenre").value = item.genre || "";
            document.getElementById("adminTahun").value = item.tahun || "";
            document.getElementById("adminPoster").value = item.poster || "";
            document.getElementById("adminDeskripsi").value = item.deskripsi || "";
            document.getElementById("adminUnggulan").checked =
                ["ya", "yes", "true", "1", "x"].indexOf(String(item.unggulan || "").toLowerCase()) !== -1;
        } else {
            formTitle.textContent = "Tambah Film";
            rowInput.value = "";
        }
        showView("form");
    }

    function deleteItem(item) {
        if (!window.confirm('Hapus film "' + (item.judul || "ini") + '"?')) return;
        fetchApi(null, { pin: currentPin, action: "delete", row: item.row })
            .then(function (data) {
                if (data.ok) loadList();
                else window.alert(data.error || "Gagal menghapus.");
            })
            .catch(function () {
                window.alert("Gagal terhubung ke server.");
            });
    }

    loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        loginSubmit.disabled = true;
        loginMsg.hidden = true;
        var pin = pinInput.value;
        fetchApi("?action=list&pin=" + encodeURIComponent(pin))
            .then(function (data) {
                if (data.ok) {
                    currentPin = pin;
                    currentItems = data.items || [];
                    renderList();
                    showView("list");
                } else {
                    loginMsg.hidden = false;
                    loginMsg.textContent = data.error || "PIN salah.";
                    loginMsg.className = "admin-modal__msg is-error";
                }
            })
            .catch(function () {
                loginMsg.hidden = false;
                loginMsg.textContent = "Gagal terhubung ke server.";
                loginMsg.className = "admin-modal__msg is-error";
            })
            .finally(function () {
                loginSubmit.disabled = false;
            });
    });

    addNewBtn.addEventListener("click", function () {
        openForm(null);
    });
    cancelBtn.addEventListener("click", function () {
        showView("list");
    });

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitBtn.disabled = true;
        msg.hidden = true;

        var payload = {
            pin: currentPin,
            action: rowInput.value ? "update" : "create",
            video: document.getElementById("adminVideo").value,
            judul: document.getElementById("adminJudul").value,
            genre: document.getElementById("adminGenre").value,
            tahun: document.getElementById("adminTahun").value,
            poster: document.getElementById("adminPoster").value,
            deskripsi: document.getElementById("adminDeskripsi").value,
            unggulan: document.getElementById("adminUnggulan").checked ? "ya" : ""
        };
        if (rowInput.value) payload.row = Number(rowInput.value);

        fetchApi(null, payload)
            .then(function (data) {
                if (data.ok) {
                    showView("list");
                    loadList();
                } else {
                    msg.hidden = false;
                    msg.textContent = data.error || "Gagal menyimpan.";
                    msg.className = "admin-modal__msg is-error";
                }
            })
            .catch(function () {
                msg.hidden = false;
                msg.textContent = "Gagal terhubung ke server.";
                msg.className = "admin-modal__msg is-error";
            })
            .finally(function () {
                submitBtn.disabled = false;
            });
    });
})();