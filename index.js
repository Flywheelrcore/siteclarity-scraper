const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

// Define common section types we want to identify
const SECTION_TYPES = [
  "Hero Section",
  "Problem Statement",
  "Features/Benefits",
  "Testimonials",
  "About Us",
  "Services",
  "Call to Action",
  "Footer"
];

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

    // New addition: Use GPT-4 Vision to analyze and identify sections
    let sectionAnalyses = [];
    if (process.env.OPENAI_API_KEY && screenshotBase64) {
      try {
        console.log("🧠 Using GPT-4 Vision to identify page sections...");
        
        // First identify the sections
        const sections = await identifySectionsWithGPT4Vision(`data:image/png;base64,${screenshotBase64}`);
        
        if (sections && sections.length > 0) {
          console.log(`✅ Identified ${sections.length} sections on the page`);
          
          // For each section, capture a screenshot and analyze it
          sectionAnalyses = await captureAndAnalyzeSections(page, sections);
          
          console.log(`✅ Completed analysis for ${sectionAnalyses.length} sections`);
        }
      } catch (visionError) {
        console.error("❌ Error during section analysis:", visionError.message);
        // Continue with basic scraping if section analysis fails
      }
    } else {
      console.log("⚠️ OpenAI API key not set or screenshot failed - skipping section analysis");
    }
    
    // Close browser
    if (browser) {
      await browser.close();
    }
    
    // Return what we have, even if incomplete
    return res.json({
      success: true,
      screenshotBase64,
      mobileScreenshotBase64,
      sectionAnalyses, // Include the section analyses in the response
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

// Function to identify sections using GPT-4 Vision
async function identifySectionsWithGPT4Vision(screenshotBase64) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o", // UPDATED: Using gpt-4o instead of gpt-4-vision-preview
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this website screenshot and identify the main sections.
                For each section you find, provide:
                1. section_type (choose from: Hero Section, Problem Statement, Features/Benefits, 
                   Testimonials, About Us, Services, Call to Action, Footer, or a more appropriate label if none fit)
                2. coordinates as percentages of the image (top, right, bottom, left)
                3. brief description of what the section contains

                Return the results as a valid JSON array with objects containing: 
                {
                  "type": "section type name",
                  "coordinates": {
                    "top": number,
                    "right": number,
                    "bottom": number,
                    "left": number
                  },
                  "description": "brief description"
                }`
              },
              {
                type: "image_url",
                image_url: { url: screenshotBase64 }
              }
            ]
          }
        ],
        max_tokens: 2000
      })
    });
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Unexpected GPT-4 Vision response format:", data);
      return SECTION_TYPES.map((type, index) => ({
        type,
        coordinates: { top: index * 10, right: 100, bottom: (index + 1) * 10, left: 0 },
        description: `Default ${type}`
      }));
    }
    
    const content = data.choices[0].message.content;
    console.log("GPT-4 Vision section identification response:", content.substring(0, 200) + "...");
    
    // Extract JSON from the response
    const jsonMatch = content.match(/```json([\s\S]*?)```/) || 
                     content.match(/\[([\s\S]*?)\]/);
                     
    if (jsonMatch) {
      try {
        // Clean up the JSON string
        const jsonContent = jsonMatch[0].replace(/```json|```/g, '');
        const sections = JSON.parse(jsonContent);
        return sections;
      } catch (e) {
        console.error("Failed to parse GPT-4 Vision JSON response:", e);
      }
    }
    
    // Fallback to default sections if parsing fails
    return SECTION_TYPES.map((type, index) => ({
      type,
      coordinates: { top: index * 10, right: 100, bottom: (index + 1) * 10, left: 0 },
      description: `Default ${type}`
    }));
  } catch (error) {
    console.error("Error identifying sections with GPT-4 Vision:", error);
    
    // Return default sections in case of error
    return SECTION_TYPES.map((type, index) => ({
      type,
      coordinates: { top: index * 10, right: 100, bottom: (index + 1) * 10, left: 0 },
      description: `Default ${type}`
    }));
  }
}

// Function to capture screenshots for sections and analyze them
async function captureAndAnalyzeSections(page, sections) {
  const sectionResults = [];
  
  // Handle viewport width/height for calculating coordinates
  const dimensions = await page.evaluate(() => {
    return {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    };
  });
  
  console.log(`Page dimensions: ${dimensions.width}x${dimensions.height}`);
  
  // For each identified section, capture a screenshot
  for (const section of sections) {
    try {
      console.log(`Processing section: ${section.type}`);
      
      // Convert percentage coordinates to pixels
      const clip = {
        x: Math.floor((section.coordinates.left * dimensions.width) / 100),
        y: Math.floor((section.coordinates.top * dimensions.height) / 100),
        width: Math.floor(((section.coordinates.right - section.coordinates.left) * dimensions.width) / 100),
        height: Math.floor(((section.coordinates.bottom - section.coordinates.top) * dimensions.height) / 100)
      };
      
      // Ensure valid clip dimensions (minimum 10x10 pixels)
      if (clip.width < 10) clip.width = 10;
      if (clip.height < 10) clip.height = 10;
      
      console.log(`Section clip: x=${clip.x}, y=${clip.y}, width=${clip.width}, height=${clip.height}`);
      
      // Take screenshot of just this section
      const sectionScreenshot = await page.screenshot({
        clip,
        encoding: 'base64'
      });
      
      console.log(`Captured screenshot for ${section.type}`);
      
      // Analyze the section with GPT-4 Vision
      const analysis = await analyzeSectionWithGPT4Vision(
        `data:image/png;base64,${sectionScreenshot}`, 
        section.type
      );
      
      sectionResults.push({
        type: section.type,
        description: section.description,
        screenshot: `data:image/png;base64,${sectionScreenshot}`,
        analysis
      });
      
    } catch (error) {
      console.error(`Error processing section ${section.type}:`, error.message);
    }
  }
  
  return sectionResults;
}

// Function to analyze a section with GPT-4 Vision
async function analyzeSectionWithGPT4Vision(screenshotBase64, sectionType) {
  try {
    console.log(`Analyzing ${sectionType} with GPT-4 Vision...`);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o", // UPDATED: Using gpt-4o instead of gpt-4-vision-preview
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this ${sectionType} of a website and provide detailed feedback on messaging clarity.
                
                Return your analysis in this exact JSON format:
                {
                  "whatWeFound": [
                    "Bullet point observations about the content",
                    "Another observation..."
                  ],
                  "whatsWorking": [
                    "First positive aspect",
                    "Second positive aspect",
                    "Third positive aspect"
                  ],
                  "improvements": [
                    "First suggested improvement",
                    "Second suggested improvement",
                    "Third suggested improvement"
                  ],
                  "bestPractices": [
                    {
                      "company": "Example Company Name",
                      "description": "Brief description of their good practice"
                    },
                    {
                      "company": "Another Company",
                      "description": "Brief description of their good practice"
                    }
                  ]
                }`
              },
              {
                type: "image_url",
                image_url: { url: screenshotBase64 }
              }
            ]
          }
        ],
        max_tokens: 1500
      })
    });
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error(`Unexpected GPT-4 Vision analysis response for ${sectionType}:`, data);
      return getDefaultAnalysis(sectionType);
    }
    
    const content = data.choices[0].message.content;
    console.log(`GPT-4 Vision analysis for ${sectionType}:`, content.substring(0, 100) + "...");
    
    // Extract JSON from the response
    const jsonMatch = content.match(/```json([\s\S]*?)```/) || 
                     content.match(/\{[\s\S]*\}/);
                     
    if (jsonMatch) {
      try {
        // Clean up the JSON string
        const jsonContent = jsonMatch[0].replace(/```json|```/g, '');
        const analysis = JSON.parse(jsonContent);
        return analysis;
      } catch (e) {
        console.error(`Failed to parse GPT-4 Vision analysis for ${sectionType}:`, e);
      }
    }
    
    return getDefaultAnalysis(sectionType);
  } catch (error) {
    console.error(`Error analyzing ${sectionType} with GPT-4 Vision:`, error);
    return getDefaultAnalysis(sectionType);
  }
}

// Helper function to generate default analysis if GPT-4 Vision fails
function getDefaultAnalysis(sectionType) {
  return {
    whatWeFound: [
      `This appears to be a ${sectionType}`,
      "Unable to perform detailed analysis",
      "Please try again later"
    ],
    whatsWorking: [
      "Section structure seems appropriate",
      "Layout appears consistent"
    ],
    improvements: [
      "Consider enhancing messaging clarity",
      "Make sure value proposition is clearly stated",
      "Ensure call-to-action is prominent"
    ],
    bestPractices: [
      {
        company: "Example Company",
        description: "Clear value proposition and engaging visuals"
      },
      {
        company: "Industry Leader",
        description: "Concise messaging with strong call-to-action"
      }
    ]
  };
}

// Add a simple healthcheck endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Scraper running on port ${PORT}`);
});
