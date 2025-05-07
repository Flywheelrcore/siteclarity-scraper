const express = require("express");
const puppeteer = require("puppeteer");
const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });
  
  try {
    // Better URL normalization
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    
    console.log(`🔍 Scraping normalized URL: ${normalizedUrl}`);
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    
    const page = await browser.newPage();
    
    // Set up user agent, viewport, timeout
    await page.setUserAgent("Mozilla/5.0 (compatible; SiteClarityBot/1.0)");
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(60000); // 60s overall timeout
    
    // Navigate to the page
    await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 40000 });
    
    // Wait extra time if needed for late assets to load
    await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5s buffer
    
    // Take full page screenshot
    console.log("📸 Taking desktop screenshot...");
    const desktopScreenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshotBase64 = desktopScreenshotBuffer.toString("base64");
    
    // Set mobile viewport and take mobile screenshot
    console.log("📱 Taking mobile screenshot...");
    await page.setViewport({ 
      width: 390, 
      height: 844, 
      isMobile: true,
      hasTouch: true 
    });
    
    // Allow time for responsive layout to adjust
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Take mobile screenshot
    const mobileScreenshotBuffer = await page.screenshot({ fullPage: false });
    const mobileScreenshotBase64 = mobileScreenshotBuffer.toString("base64");
    
    await browser.close();
    
    return res.json({
      success: true,
      screenshotBase64,
      mobileScreenshotBase64,
      extracted_content: {
        headline: "",
        subheadline: "",
        cta_text: "",
        supporting_text: []
      }
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
