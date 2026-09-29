export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res
            .status(405)
            .json({ ok: false, error: "Metode tidak diizinkan." });
    }

    try {
        const body =
            typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
        const { pin } = body;
        const adminPin = process.env.ADMIN_PIN;

        if (!adminPin) {
            return res
                .status(500)
                .json({ ok: false, error: "ADMIN_PIN belum diatur di Vercel." });
        }

        if (String(pin).trim() === String(adminPin).trim()) {
            return res.status(200).json({ ok: true });
        } else {
            return res
                .status(401)
                .json({ ok: false, error: "PIN salah. Periksa lalu coba lagi." });
        }
    } catch (err) {
        return res
            .status(400)
            .json({ ok: false, error: "Format data tidak valid." });
    }
}
