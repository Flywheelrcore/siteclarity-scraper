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
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Capture desktop screenshot
    const desktopBuffer = await page.screenshot({ fullPage: true });
    const desktopBase64 = desktopBuffer.toString("base64");

    // Simulate mobile view
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const mobileBuffer = await page.screenshot({ fullPage: true });
    const mobileBase64 = mobileBuffer.toString("base64");

    await browser.close();

    return res.json({
      success: true,
      screenshotDesktopBase64: desktopBase64,
      screenshotMobileBase64: mobileBase64
    });
  } catch (err) {
    console.error("Scraping error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Scraper running on port ${PORT}`);
});
