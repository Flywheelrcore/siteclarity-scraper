const express = require("express");
const puppeteer = require("puppeteer");
const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    const buffer = await page.screenshot({ fullPage: true });

    await browser.close();

    // Return base64 for now — for visual confirmation
    return res.json({
      success: true,
      screenshot_base64: buffer.toString("base64")
    });
  } catch (err) {
    console.error("Screenshot error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🖼️ Scraper running on port ${PORT}`);
});
