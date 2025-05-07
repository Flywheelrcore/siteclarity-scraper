const express = require("express");
const puppeteer = require("puppeteer");
const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });
  
  try {
    // Enhanced URL normalization
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    
    console.log(`🔍 Attempting to scrape: ${normalizedUrl}`);
    
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process"
      ]
    });
    
    const page = await browser.newPage();
    
    // More robust error handling
    page.on('error', err => {
      console.error('Page error:', err);
    });
    
    page.on('pageerror', err => {
      console.error('Page JS error:', err);
    });
    
    // Set up user agent, viewport, timeout
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36");
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(90000); // 90s timeout
    
    console.log(`⏱ Navigating to page...`);
    
    // Navigate with more robust error handling
    try {
      await page.goto(normalizedUrl, { 
        waitUntil: "domcontentloaded", 
        timeout: 60000 
      });
      console.log(`✅ Page loaded successfully`);
    } catch (navError) {
      console.error(`❌ Navigation error:`, navError.message);
      await browser.close();
      return res.status(500).json({ 
        success: false, 
        error: `Failed to load page: ${navError.message}` 
      });
    }
    
    // Wait for content to stabilize
    console.log(`⏲ Waiting for page content to stabilize...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Take desktop screenshot with error handling
    console.log(`📸 Taking desktop screenshot...`);
    let screenshotBase64;
    try {
      const desktopScreenshotBuffer = await page.screenshot({ fullPage: true });
      screenshotBase64 = desktopScreenshotBuffer.toString("base64");
      console.log(`✅ Desktop screenshot captured (${screenshotBase64.length} bytes)`);
    } catch (ssError) {
      console.error(`❌ Desktop screenshot error:`, ssError.message);
      screenshotBase64 = "";
    }
    
    // Set mobile viewport and take mobile screenshot
    console.log(`📱 Setting up mobile viewport...`);
    try {
      await page.setViewport({ 
        width: 390, 
        height: 844, 
        isMobile: true,
        hasTouch: true 
      });
      
      // Allow time for responsive layout to adjust
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log(`📱 Taking mobile screenshot...`);
      const mobileScreenshotBuffer = await page.screenshot({ fullPage: false });
      var mobileScreenshotBase64 = mobileScreenshotBuffer.toString("base64");
      console.log(`✅ Mobile screenshot captured (${mobileScreenshotBase64.length} bytes)`);
    } catch (mobileError) {
      console.error(`❌ Mobile screenshot error:`, mobileError.message);
      mobileScreenshotBase64 = "";
    }
    
    await browser.close();
    console.log(`✅ Browser closed, returning response`);
    
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
    console.error("❌ Scraping error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Add a simple healthcheck endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Scraper running on port ${PORT}`);
});
