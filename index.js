const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });
  
  let browser = null;
  
  try {
    // Enhanced URL normalization
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    
    console.log(`🔍 Attempting to scrape: ${normalizedUrl}`);
    
    // Launch with stealth mode and additional arguments
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-site-isolation-trials",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu"
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36");
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    // Bypass common bot detection
    await page.evaluateOnNewDocument(() => {
      // Pass webdriver check
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Pass Chrome check
      window.chrome = {
        runtime: {},
      };
      
      // Pass notifications check
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });
    
    // Set request timeout to 2 minutes
    await page.setDefaultNavigationTimeout(120000);
    
    // Define a function to take screenshots with error handling
    const takeScreenshot = async (isMobile = false) => {
      try {
        // Set appropriate viewport
        if (isMobile) {
          await page.setViewport({ 
            width: 390, 
            height: 844, 
            isMobile: true,
            hasTouch: true 
          });
          
          // Wait for mobile layout to adjust
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          console.log("📱 Taking mobile screenshot...");
          const buffer = await page.screenshot({ fullPage: false });
          return buffer.toString("base64");
        } else {
          // Desktop screenshot
          console.log("📸 Taking desktop screenshot...");
          const buffer = await page.screenshot({ fullPage: true });
          return buffer.toString("base64");
        }
      } catch (error) {
        console.error(`Screenshot error (${isMobile ? 'mobile' : 'desktop'}):`, error.message);
        return ""; // Return empty string on error
      }
    };
    
    // Try to navigate to the page with retry logic
    let navigationSuccess = false;
    let attempts = 0;
    let maxAttempts = 3;
    
    while (!navigationSuccess && attempts < maxAttempts) {
      attempts++;
      try {
        console.log(`⏱ Navigation attempt ${attempts}/${maxAttempts}...`);
        
        await page.goto(normalizedUrl, { 
          waitUntil: "networkidle2", 
          timeout: 60000 
        });
        
        // Wait for content to stabilize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check if we have a real page (not an error page)
        const pageTitle = await page.title();
        console.log(`📄 Page title: "${pageTitle}"`);
        
        navigationSuccess = true;
      } catch (error) {
        console.error(`Navigation error (attempt ${attempts}/${maxAttempts}):`, error.message);
        
        if (attempts >= maxAttempts) {
          console.error("❌ All navigation attempts failed");
          break;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Take screenshots even if navigation wasn't completely successful
    const screenshotBase64 = await takeScreenshot(false); // Desktop
    const mobileScreenshotBase64 = await takeScreenshot(true); // Mobile
    
    // Close browser
    if (browser) {
      await browser.close();
    }
    
    // Return what we have, even if incomplete
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
    
    // Make sure browser is closed even on error
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("Error closing browser:", closeErr.message);
      }
    }
    
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
