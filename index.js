const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

// Define standardized section types aligned with the audit framework
const SECTION_TYPES = [
  "Hero Section",
  "Problem Statement",
  "Solution/Services",
  "Trust/Proof Elements",
  "Case Studies",
  "Call to Action",
  "Thought Leadership",
  "Footer"
];

app.post("/scrape", async (req, res) => {
  const { url, analysisMode = "summary" } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });
  
  let browser = null;
  
  try {
    // Enhanced URL normalization
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    
    console.log(`🔍 Attempting to scrape: ${normalizedUrl} with analysis mode: ${analysisMode}`);
    
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
    
    // Define a function to take screenshots with error handling and retries
    const takeScreenshot = async (isMobile = false, maxRetries = 3) => {
      let attempts = 0;
      let screenshot = "";
      
      while (attempts < maxRetries) {
        try {
          attempts++;
          
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
            
            console.log(`📱 Taking mobile screenshot (attempt ${attempts}/${maxRetries})...`);
            const buffer = await page.screenshot({ fullPage: false });
            return buffer.toString("base64");
          } else {
            // Desktop screenshot
            console.log(`📸 Taking desktop screenshot (attempt ${attempts}/${maxRetries})...`);
            const buffer = await page.screenshot({ fullPage: true });
            return buffer.toString("base64");
          }
        } catch (error) {
          console.error(`Screenshot error (${isMobile ? 'mobile' : 'desktop'}) attempt ${attempts}/${maxRetries}:`, error.message);
          
          if (attempts >= maxRetries) {
            console.error(`All ${maxRetries} screenshot attempts failed for ${isMobile ? 'mobile' : 'desktop'}`);
            return ""; // Return empty string after all retries fail
          }
          
          // Wait before retry (increasing delay with each attempt)
          const delay = attempts * 1000;
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      return screenshot;
    };
    
    // Take section screenshot with retries
    const takeSectionScreenshot = async (clip, sectionType, maxRetries = 3) => {
      let attempts = 0;
      
      while (attempts < maxRetries) {
        try {
          attempts++;
          console.log(`Taking screenshot for ${sectionType} (attempt ${attempts}/${maxRetries})...`);
          
          // Ensure clip is valid
          if (clip.width < 10) clip.width = 10;
          if (clip.height < 10) clip.height = 10;
          
          // Take screenshot of just this section
          const buffer = await page.screenshot({
            clip,
            encoding: 'base64'
          });
          
          console.log(`✅ Successfully captured screenshot for ${sectionType}`);
          return buffer;
        } catch (error) {
          console.error(`Section screenshot error for ${sectionType} (attempt ${attempts}/${maxRetries}):`, error.message);
          
          if (attempts >= maxRetries) {
            console.error(`❌ All ${maxRetries} section screenshot attempts failed for ${sectionType}`);
            return null; // Return null after all retries fail
          }
          
          // Wait before retry (increasing delay with each attempt)
          const delay = attempts * 1000;
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      return null;
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
    const screenshotBase64 = await takeScreenshot(false, 3); // Desktop with retries
    const mobileScreenshotBase64 = await takeScreenshot(true, 3); // Mobile with retries

    // PHASE 1: Identify logical sections from full page screenshot
    let identifiedSections = [];
    let sectionAnalyses = [];
    let failedSections = []; // New array to track failed sections
    
    if (process.env.OPENAI_API_KEY && screenshotBase64) {
      try {
        console.log("🧠 Using GPT-4 Vision to identify logical page sections...");
        
        // Identify sections with human-like perception
        identifiedSections = await identifyLogicalSectionsWithGPT4Vision(`data:image/png;base64,${screenshotBase64}`);
        
        if (identifiedSections && identifiedSections.length > 0) {
          console.log(`✅ Identified ${identifiedSections.length} logical sections on the page`);
          
          // Handle duplicate section types
          const sectionsByType = {};
          identifiedSections.forEach((section, index) => {
            const sectionType = section.type;
            if (sectionsByType[sectionType]) {
              // If this type already exists, append index to make unique
              section.type = `${sectionType} ${index + 1}`;
            } else {
              sectionsByType[sectionType] = true;
            }
          });
          
          // Calculate viewport width/height for coordinates
          const dimensions = await page.evaluate(() => {
            return {
              width: document.documentElement.scrollWidth,
              height: document.documentElement.scrollHeight
            };
          });
          
          console.log(`Page dimensions: ${dimensions.width}x${dimensions.height}`);
          
          // PHASE 2: Based on analysis mode, perform appropriate level of analysis
          if (analysisMode === "summary") {
            // For summary mode: Perform lightweight analysis for quick results
            const { analyses, failed } = await performLightweightAnalysis(page, identifiedSections, dimensions, takeSectionScreenshot);
            sectionAnalyses = analyses;
            failedSections = failed;
          } else if (analysisMode === "detailed") {
            // For detailed mode: Perform comprehensive analysis with full audit framework
            const { analyses, failed } = await performDetailedAnalysis(page, identifiedSections, dimensions, takeSectionScreenshot);
            sectionAnalyses = analyses;
            failedSections = failed;
          } else {
            // Default to summary if mode is unknown
            const { analyses, failed } = await performLightweightAnalysis(page, identifiedSections, dimensions, takeSectionScreenshot);
            sectionAnalyses = analyses;
            failedSections = failed;
          }
          
          console.log(`✅ Completed ${analysisMode} analysis for ${sectionAnalyses.length} sections`);
          console.log(`⚠️ Failed to analyze ${failedSections.length} sections`);
        }
      } catch (visionError) {
        console.error("❌ Error during section analysis:", visionError.message);
        // Continue with basic data if analysis fails
      }
    } else {
      console.log("⚠️ OpenAI API key not set or screenshot failed - skipping section analysis");
    }
    
    // Close browser
    if (browser) {
      await browser.close();
    }
    
    // Format section analyses to match frontend expectations
    const formattedSectionAnalyses = sectionAnalyses.map(section => {
      // Convert section type to a valid section_id in lowercase with hyphens
      const section_id = section.type
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      
      // Format analysis data to match expected structure
      const analysis = section.analysis || {};
      
      return {
        section_id,
        section_name: section.type,
        screenshot_url: section.screenshot, 
        extracted_content: {
          headline: analysis.pulledQuote || "",
          subheadline: "",
          cta_text: section.type.includes("Call to Action") ? analysis.pulledQuote || "" : "",
          supporting_text: analysis.whatWeFound || []
        },
        content: {
          description: section.description || `Analysis of your ${section.type}`,
          found: analysis.whatWeFound || [],
          working: analysis.whatsWorking || [],
          improvements: analysis.improvements || [],
          examples: analysis.bestPractices || [],
          pulledQuote: analysis.pulledQuote || "",
          buyerInsight: analysis.buyerInsight || ""
        }
      };
    });
    
    // Add failed sections with appropriate format
    const formattedFailedSections = failedSections.map(failedSection => {
      const section_id = failedSection
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
        
      return {
        section_id,
        section_name: failedSection,
        screenshot_url: "", 
        extraction_failed: true,
        extracted_content: {
          headline: "",
          subheadline: "",
          cta_text: "",
          supporting_text: [`Could not analyze ${failedSection} section`]
        },
        content: {
          description: `We couldn't fully analyze this ${failedSection} section.`,
          found: [`Section identified but couldn't capture screenshot`],
          working: ["Unable to determine what's working"],
          improvements: ["Make this section easier to analyze by using standard HTML structure"],
          examples: [
            {
              company: "Example Company",
              description: "Clear structure with standard HTML elements"
            }
          ],
          extractionFailed: true
        }
      };
    });
    
    // Combine successful and failed sections
    const allSectionAnalyses = [...formattedSectionAnalyses, ...formattedFailedSections];
    
    // Return what we have, with mode information and extraction stats
    return res.json({
      success: true,
      analysisMode,
      screenshotBase64,
      mobileScreenshotBase64,
      sectionAnalyses: allSectionAnalyses,
      fullPageScreenshotUrl: `data:image/png;base64,${screenshotBase64}`,
      fullPageMobileScreenshotUrl: `data:image/png;base64,${mobileScreenshotBase64}`,
      extractionStats: {
        totalSections: identifiedSections.length,
        successfulSections: formattedSectionAnalyses.length,
        failedSections: formattedFailedSections.map(s => s.section_id)
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

// Modified function for lightweight analysis (summary mode) with retry logic
async function performLightweightAnalysis(page, sections, dimensions, takeSectionScreenshot) {
  const sectionResults = [];
  const failedSections = [];
  
  for (const section of sections) {
    try {
      console.log(`Processing section for summary analysis: ${section.type}`);
      
      // Convert percentage coordinates to pixels
      const clip = {
        x: Math.floor((section.coordinates.left * dimensions.width) / 100),
        y: Math.floor((section.coordinates.top * dimensions.height) / 100),
        width: Math.floor(((section.coordinates.right - section.coordinates.left) * dimensions.width) / 100),
        height: Math.floor(((section.coordinates.bottom - section.coordinates.top) * dimensions.height) / 100)
      };
      
      // Try to take screenshot with retries
      const sectionScreenshot = await takeSectionScreenshot(clip, section.type, 3);
      
      if (sectionScreenshot) {
        // Perform lightweight analysis for quick scoring
        const analysis = await performLightweightSectionAnalysis(
          `data:image/png;base64,${sectionScreenshot}`, 
          section.type
        );
        
        sectionResults.push({
          type: section.type,
          description: section.description,
          screenshot: `data:image/png;base64,${sectionScreenshot}`,
          analysis,
          coordinates: section.coordinates
        });
      } else {
        console.log(`⚠️ Adding ${section.type} to failed sections list`);
        failedSections.push(section.type);
      }
    } catch (error) {
      console.error(`Error processing section ${section.type}:`, error.message);
      failedSections.push(section.type);
    }
  }
  
  return { analyses: sectionResults, failed: failedSections };
}

// Modified function for detailed analysis with retry logic
async function performDetailedAnalysis(page, sections, dimensions, takeSectionScreenshot) {
  const sectionResults = [];
  const failedSections = [];
  
  for (const section of sections) {
    try {
      console.log(`Processing section for detailed analysis: ${section.type}`);
      
      // Convert percentage coordinates to pixels
      const clip = {
        x: Math.floor((section.coordinates.left * dimensions.width) / 100),
        y: Math.floor((section.coordinates.top * dimensions.height) / 100),
        width: Math.floor(((section.coordinates.right - section.coordinates.left) * dimensions.width) / 100),
        height: Math.floor(((section.coordinates.bottom - section.coordinates.top) * dimensions.height) / 100)
      };
      
      // Try to take screenshot with retries
      const sectionScreenshot = await takeSectionScreenshot(clip, section.type, 3);
      
      if (sectionScreenshot) {
        // Use the full audit framework for detailed analysis
        const analysis = await analyzeSectionWithGPT4Vision(
          `data:image/png;base64,${sectionScreenshot}`, 
          section.type
        );
        
        sectionResults.push({
          type: section.type,
          description: section.description,
          screenshot: `data:image/png;base64,${sectionScreenshot}`,
          analysis,
          coordinates: section.coordinates
        });
      } else {
        console.log(`⚠️ Adding ${section.type} to failed sections list`);
        failedSections.push(section.type);
      }
    } catch (error) {
      console.error(`Error processing section ${section.type}:`, error.message);
      failedSections.push(section.type);
    }
  }
  
  return { analyses: sectionResults, failed: failedSections };
}

// New function to identify logical sections using a human-like approach
async function identifyLogicalSectionsWithGPT4Vision(screenshotBase64) {
  try {
    const sectionIdentificationPrompt = `You are a website consultant analyzing a full webpage. Your task is to divide this page into logical, meaningful sections as a human business analyst would.

1. Start from the top and work your way down
2. Identify where each distinct section begins and ends
3. Name each section based on its apparent purpose (not technical structure)

For each section you identify, provide:
1. A descriptive name that matches how a business user would describe it (e.g., "Hero Section", "Customer Testimonials", "Pricing Plans")
2. Coordinates as percentages of the full image (top, right, bottom, left)
3. Brief description of what this section accomplishes

Guidelines:
- A section typically represents a complete thought or purpose
- Sections generally span the full width of the page
- Look for visual breaks (background changes, large spaces, horizontal rules)
- Consider user attention span - what would a user perceive as a complete unit?
- Identify 5-10 main sections, not every small element

Preferred section types (use when applicable, but don't force if not present):
- Hero Section
- Trust/Proof Elements (logos, testimonials)
- Problem Statement 
- Solution/Services
- Case Studies/Examples
- How It Works/Process
- Pricing/Plans
- Team/About
- Call to Action
- Footer

Return results as a valid JSON array:
[
  {
    "type": "Hero Section",
    "coordinates": {"top": 0, "right": 100, "bottom": 30, "left": 0},
    "description": "Main value proposition with headline and CTA buttons"
  },
  ...
]`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: sectionIdentificationPrompt
              },
              {
                type: "image_url",
                image_url: { url: screenshotBase64 }
              }
            ]
          }
        ],
        max_tokens: 2500
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

// Function for lightweight analysis prompt (summary mode)
async function performLightweightSectionAnalysis(screenshotBase64, sectionType) {
  try {
    console.log(`Performing lightweight analysis for ${sectionType}...`);
    
    const lightweightPrompt = `Analyze this ${sectionType} screenshot for a quick assessment.

Focus only on the essential elements to provide a brief analysis:

1. What are the most noticeable text elements and content?
2. What is the main purpose of this section?
3. What is working well (1-2 points only)?
4. What could be improved (1-2 points only)?

Return your analysis in this JSON format:
{
  "whatWeFound": [
    "Key observation 1",
    "Key observation 2"
  ],
  "whatsWorking": [
    "One positive aspect"
  ],
  "improvements": [
    "One improvement suggestion"
  ],
  "pulledQuote": "The main headline or key text from this section",
  "buyerInsight": "Brief assessment of section effectiveness for target buyers"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: lightweightPrompt
              },
              {
                type: "image_url",
                image_url: { url: screenshotBase64 }
              }
            ]
          }
        ],
        max_tokens: 1000 // Reduced for lightweight analysis
      })
    });
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error(`Unexpected lightweight analysis response for ${sectionType}:`, data);
      return getDefaultLightweightAnalysis(sectionType);
    }
    
    const content = data.choices[0].message.content;
    
    // Extract JSON from the response
    const jsonMatch = content.match(/```json([\s\S]*?)```/) || 
                      content.match(/\{[\s\S]*\}/);
                     
    if (jsonMatch) {
      try {
        // Clean up the JSON string
        const jsonContent = jsonMatch[0].replace(/```json|```/g, '');
        const analysis = JSON.parse(jsonContent);
        
        // Add placeholder for bestPractices to maintain compatibility
        analysis.bestPractices = [
          {
            company: "Example Company",
            description: "See detailed analysis for best practices"
          }
        ];
        
        return analysis;
      } catch (e) {
        console.error(`Failed to parse lightweight analysis for ${sectionType}:`, e);
      }
    }
    
    return getDefaultLightweightAnalysis(sectionType);
  } catch (error) {
    console.error(`Error in lightweight analysis for ${sectionType}:`, error);
    return getDefaultLightweightAnalysis(sectionType);
  }
}

// Helper function for default lightweight analysis
function getDefaultLightweightAnalysis(sectionType) {
  return {
    whatWeFound: [
      `This appears to be a ${sectionType}`,
      "Basic content is visible but detailed analysis is available in full mode"
    ],
    whatsWorking: [
      "Section layout appears organized"
    ],
    improvements: [
      "See detailed analysis for specific improvements"
    ],
    pulledQuote: "Key text unavailable in summary mode",
    buyerInsight: "See detailed analysis for buyer insights",
    bestPractices: [
      {
        company: "Example Company",
        description: "See detailed analysis for best practices"
      }
    ]
  };
}

// Existing analysis function (kept for detailed mode)
async function analyzeSectionWithGPT4Vision(screenshotBase64, sectionType) {
  try {
    console.log(`Analyzing ${sectionType} with GPT-4 Vision...`);
    
    // Get section-specific prompt based on the audit framework
    const analysisPrompt = getSectionAnalysisPrompt(sectionType);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: analysisPrompt
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

// Function to generate section-specific prompts based on the audit framework
function getSectionAnalysisPrompt(sectionType) {
  // Base prompt for all section types
  const basePrompt = `Analyze this ${sectionType} of a website using the SiteClarity audit framework. 
  
Evaluate the section based on these key criteria:
1. Messaging Clarity: Is it clear what they do, who it's for, and the value?
2. Conversion Potential: Does it guide users toward meaningful action?
3. Audience Alignment: Is it tailored to a specific ICP (e.g., CIO, CTO)?
4. Visual & UX Integrity: Is the design modern, clean, and intuitive?
5. CTA & SEO Effectiveness: Are CTAs value-focused and content optimized?

Return your analysis in this exact JSON format:
{
  "whatWeFound": [
    "Detailed observation about the content and layout",
    "Specific elements, text, and visuals present"
  ],
  "whatsWorking": [
    "Positive aspect related to messaging clarity",
    "Positive aspect related to audience targeting",
    "Positive aspect related to visual design"
  ],
  "improvements": [
    "Specific improvement suggestion with reasoning",
    "Another improvement with clear rationale",
    "Actionable suggestion to enhance effectiveness"
  ],`;

  // Add section-specific criteria based on type
  let sectionSpecificPrompt = '';
  
  if (sectionType.includes('Hero')) {
    sectionSpecificPrompt = `
  "buyerInsight": "An assessment of how this hero section would be perceived by your target buyer",
  "pulledQuote": "The main headline or key message from this section",`;
  } 
  else if (sectionType.includes('Trust') || sectionType.includes('Case Studies') || sectionType.includes('Proof') || sectionType.includes('Testimonial')) {
    sectionSpecificPrompt = `
  "buyerInsight": "How effectively this builds credibility with your target audience",
  "pulledQuote": "A key claim or statement from this section",`;
  }
  else if (sectionType.includes('Call to Action') || sectionType.includes('CTA')) {
    sectionSpecificPrompt = `
  "buyerInsight": "How compelling this CTA would be to your target buyer",
  "pulledQuote": "The exact CTA text or button label",`;
  }
  else {
    sectionSpecificPrompt = `
  "buyerInsight": "How this section contributes to overall messaging effectiveness",
  "pulledQuote": "A key phrase or message from this section",`;
  }

  // Complete the prompt with best practices
  const completionPrompt = `
  "bestPractices": [
    {
      "company": "Example Company Name",
      "description": "How they excel at this type of section"
    },
    {
      "company": "Another Company",
      "description": "Their effective approach to this section type"
    }
  ]
}`;

  return basePrompt + sectionSpecificPrompt + completionPrompt;
}

// Helper function to generate default analysis if GPT-4 Vision fails
function getDefaultAnalysis(sectionType) {
  // Create more specific default analyses based on section type
  const baseAnalysis = {
    whatWeFound: [
      `This appears to be a ${sectionType}`,
      "Content and structure are visible but detailed analysis failed"
    ],
    whatsWorking: [
      "Section layout appears organized",
      "Visual elements are present"
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
  
  // Add default buyerInsight and pulledQuote
  baseAnalysis.buyerInsight = "Analysis could not determine audience targeting effectiveness";
  baseAnalysis.pulledQuote = "Unable to extract key message";
  
  return baseAnalysis;
}

// Add a simple healthcheck endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Scraper running on port ${PORT}`);
});
