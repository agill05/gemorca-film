(function () {
    "use strict";

    var WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzAIcPwpRX9R05KCjzhermc_AOwrR2XYp_WA5N0DCXA_gX2aW3N8G1mkixXCTInwfBEqQ/exec";

    var modal = document.getElementById("adminModal");
    var form = document.getElementById("adminForm");
    var closeBtn = document.getElementById("adminClose");
    var msg = document.getElementById("adminMsg");
    var submitBtn = document.getElementById("adminSubmit");
    var logo = document.querySelector(".logo[data-home]");

    function openAdmin() {
        modal.hidden = false;
        document.body.classList.add("no-scroll");
    }

    function closeAdmin() {
        modal.hidden = true;
        document.body.classList.remove("no-scroll");
        msg.hidden = true;
    }

    var params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "1") openAdmin();

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

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitBtn.disabled = true;
        msg.hidden = true;

        var payload = {
            pin: document.getElementById("adminPin").value,
            video: document.getElementById("adminVideo").value,
            judul: document.getElementById("adminJudul").value,
            genre: document.getElementById("adminGenre").value,
            tahun: document.getElementById("adminTahun").value,
            poster: document.getElementById("adminPoster").value,
            deskripsi: document.getElementById("adminDeskripsi").value,
            unggulan: document.getElementById("adminUnggulan").checked
        };

        fetch(WEBAPP_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        })
            .then(function (res) {
                return res.json();
            })
            .then(function (data) {
                msg.hidden = false;
                if (data.ok) {
                    msg.textContent = "Film tersimpan. Muat ulang halaman untuk lihat perubahan.";
                    msg.className = "admin-modal__msg is-success";
                    form.reset();
                } else {
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