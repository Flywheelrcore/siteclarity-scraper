const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const { url, sectionIds = [] } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(30000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const sections = {};

    for (const section of sectionIds) {
      const selector = getSelectorForSection(section);
      if (!selector) continue;

      const elementHandle = await page.$(selector);
      if (!elementHandle) {
        sections[section] = { found: false, text: null, html: null };
        continue;
      }

      const text = await page.evaluate(el => el.innerText, elementHandle);
      const html = await page.evaluate(el => el.outerHTML, elementHandle);

      sections[section] = {
        found: true,
        text,
        html
      };
    }

    // 📸 Add Screenshot Capture BEFORE closing browser
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const base64Screenshot = screenshotBuffer.toString("base64");

    await browser.close();

    return res.json({
      success: true,
      sections,
      screenshot: `data:image/png;base64,${base64Screenshot}`
    });
  } catch (err) {
    console.error("Scraping error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

function getSelectorForSection(sectionId) {
  const map = {
    hero: "header, .hero, #hero, .banner",
    services: "#services, .services, section.services",
    trust: ".trust-strip, .social-proof, .logos",
    caseStudies: "#case-studies, .case-studies",
    cta: "footer .cta, .call-to-action",
    footer: "footer"
  };
  return map[sectionId] || null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Scraper running on port ${PORT}`);
});
