const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (SiteClarityBot)");
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(30000);

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait a bit to ensure content loads
    await page.waitForTimeout(1000);

    // Take screenshot
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString("base64");

    await browser.close();

    return res.json({
      success: true,
      screenshotBase64
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
