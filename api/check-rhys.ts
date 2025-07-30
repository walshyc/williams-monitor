import { VercelRequest, VercelResponse } from "@vercel/node";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { kv } from "@vercel/kv";
import nodemailer from "nodemailer";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

interface Post {
    title: string;
    link: string;
    date: string;
    author: string;
    tips?: BettingTip[];
}

interface BettingTip {
    horseName: string;
    meetingLocation: string;
    time: string;
    suggestedPrice: string;
    points: string;
    betType: "win" | "e/w" | "each way";
}

interface ApiResponse {
    success: boolean;
    timestamp: string;
    newPosts: number;
    posts: Post[];
    message: string;
    error?: string;
    emailSent?: boolean;
    slackSent?: boolean;
}

const RSS_URL = "https://betting.betfair.com/index.xml";
const SEEN_POSTS_KEY = "seen_posts";
const USER_AGENT =
    "Mozilla/5.0 (compatible; RSS Reader; +https://your-domain.com)";

// Zod schema for betting tips extraction
const BettingTipSchema = z.object({
    horseName: z.string().describe("The name of the horse"),
    meetingLocation: z.string().describe("The racing venue/location"),
    time: z.string().describe("The race time"),
    suggestedPrice: z.string().describe("The minimum odds/price suggested"),
    points: z.string().describe("The points advised (e.g., 1pt, 0.5pt)"),
    betType: z
        .enum(["win", "e/w", "each way"])
        .describe("Type of bet - win or each way"),
});

const BettingTipsSchema = z.object({
    tips: z.array(BettingTipSchema),
});

async function extractTipsFromUrl(url: string): Promise<BettingTip[]> {
    try {
        console.log(`🤖 Extracting tips from: ${url}`);

        // Add delay to avoid being flagged as a bot
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Use more realistic browser headers
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Cache-Control": "max-age=0",
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch blog post: ${response.status}`);
        }

        const html = await response.text();

        // Check if we got a Cloudflare challenge page
        if (html.includes("Just a moment") || html.includes("cf-browser-verification")) {
            console.log("❌ Blocked by Cloudflare/bot protection");
            return [];
        }

        const dom = new JSDOM(html);
        const document = dom.window.document;

        // Rest of your extraction logic...
        const recommendedBetsDiv = document.getElementById("recommended_bets");

        if (!recommendedBetsDiv) {
            console.log("❌ No recommended_bets div found");
            return [];
        }

        const betsHTML = recommendedBetsDiv.innerHTML;
        console.log(`📝 Extracted betting HTML: ${betsHTML.substring(0, 500)}...`);

        if (!betsHTML || betsHTML.trim().length === 0) {
            console.log("❌ No content found in recommended_bets div");
            return [];
        }

        const result = await generateObject({
            model: openai("gpt-4o-mini"),
            schema: BettingTipsSchema,
            prompt: `
          Extract betting tips from this horse racing HTML content. The content contains betting recommendations with horse names, race times, venues, odds, and stake information.
  
          Look for patterns like:
          - "Back [Horse Name] in the [Time] at [Venue] [Stakes] [win/e/w] @ [Odds]"
          - Horse names (e.g., "Papa Barns", "Wakey Wakey Man")
          - Race times (e.g., "15:12", "16:50")
          - Venues (e.g., "Uttoxeter", "Kilbeggan", "Cork")
          - Stakes (e.g., "1pt", "0.5pt")
          - Bet types ("win" or "e/w"/"each way")
          - Odds (e.g., "15/4", "200/1", "10/1")
  
          HTML Content: ${betsHTML}
  
          Extract each betting tip as a separate object. If you see "e/w" treat it as "each way".
        `,
        });

        console.log(`✅ Extracted ${result.object.tips.length} tips using AI`);
        return result.object.tips;

    } catch (error) {
        console.error("❌ Error extracting tips:", error);
        return [];
    }
}
async function debugPageStructure(url: string): Promise<void> {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        });

        const html = await response.text();
        const dom = new JSDOM(html);
        const document = dom.window.document;

        console.log("🔍 Page debugging info:");
        console.log("- Page title:", document.title);
        console.log("- Page has recommended_bets div:", !!document.getElementById("recommended_bets"));

        const recommendedBetsDiv = document.getElementById("recommended_bets");
        if (recommendedBetsDiv) {
            console.log("- recommended_bets div class:", recommendedBetsDiv.className);
            console.log("- recommended_bets div content length:", recommendedBetsDiv.innerHTML.length);
            console.log("- recommended_bets div preview:", recommendedBetsDiv.innerHTML.substring(0, 200));
        }

        // Check for alternative selectors
        const cardDivs = document.querySelectorAll('.card');
        console.log("- Found .card divs:", cardDivs.length);

        const bettingLinks = document.querySelectorAll('a[href*="betfair.com"]');
        console.log("- Found betfair links:", bettingLinks.length);

    } catch (error) {
        console.error("Debug error:", error);
    }
}

async function getSeenPosts(): Promise<string[]> {
    try {
        const seenPosts = await kv.get<string[]>(SEEN_POSTS_KEY);
        return seenPosts || [];
    } catch (error) {
        console.error("Error getting seen posts:", error);
        return [];
    }
}

async function addSeenPosts(newPostLinks: string[]): Promise<void> {
    try {
        const currentSeenPosts = await getSeenPosts();
        const updatedSeenPosts = [...currentSeenPosts, ...newPostLinks];
        await kv.set(SEEN_POSTS_KEY, updatedSeenPosts);
    } catch (error) {
        console.error("Error saving seen posts:", error);
    }
}

async function sendEmailAlert(posts: Post[]): Promise<boolean> {
    try {
        const emailUser = process.env.EMAIL_USER;
        const emailPass = process.env.EMAIL_PASS;
        const emailTo = process.env.EMAIL_TO || emailUser;

        if (!emailUser || !emailPass) {
            console.log("📧 Email not configured, skipping email alert");
            return false;
        }

        console.log("📧 Sending email alert...");

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: emailUser,
                pass: emailPass,
            },
        });

        const subject = `🏇 New Rhys Williams Tips - ${posts.length} post(s)`;
        const body = formatEmailBody(posts);

        await transporter.sendMail({
            from: emailUser,
            to: emailTo,
            subject,
            text: body,
            html: formatEmailHTML(posts),
        });

        console.log("✅ Email sent successfully");
        return true;
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
        console.error("❌ Email error:", errorMessage);
        return false;
    }
}

async function sendSlackAlert(posts: Post[]): Promise<boolean> {
    try {
        const webhookUrl = process.env.SLACK_WEBHOOK;

        if (!webhookUrl) {
            console.log("💬 Slack not configured, skipping Slack alert");
            return false;
        }

        console.log("💬 Sending Slack alert...");

        const message = formatSlackMessage(posts);

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: message,
                username: "Rhys Williams Monitor",
                icon_emoji: ":horse_racing:",
            }),
        });

        if (response.ok) {
            console.log("✅ Slack alert sent successfully");
            return true;
        } else {
            const errorText = await response.text();
            console.error("❌ Slack response error:", response.status, errorText);
            return false;
        }
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
        console.error("❌ Slack error:", errorMessage);
        return false;
    }
}

function formatTipsText(tips: BettingTip[]): string {
    if (!tips || tips.length === 0) return "";

    let tipsText = "\n\n🎯 BETTING TIPS:\n";
    tips.forEach((tip, i) => {
        tipsText += `${i + 1}. ${tip.horseName} - ${tip.time} at ${tip.meetingLocation}\n`;
        tipsText += `   💰 ${tip.points} ${tip.betType} @ ${tip.suggestedPrice}\n`;
    });
    return tipsText;
}

function formatTipsHTML(tips: BettingTip[]): string {
    if (!tips || tips.length === 0) return "";

    let tipsHTML = "<h3>🎯 Betting Tips:</h3><ul>";
    tips.forEach((tip) => {
        tipsHTML += `
      <li style="margin-bottom: 10px;">
        <strong>${tip.horseName}</strong> - ${tip.time} at ${tip.meetingLocation}<br>
        <span style="color: #2e7d32;">💰 ${tip.points} ${tip.betType} @ ${tip.suggestedPrice}</span>
      </li>
    `;
    });
    tipsHTML += "</ul>";
    return tipsHTML;
}

function formatTipsSlack(tips: BettingTip[]): string {
    if (!tips || tips.length === 0) return "";

    let tipsText = "\n\n🎯 *BETTING TIPS:*\n";
    tips.forEach((tip, i) => {
        tipsText += `${i + 1}. *${tip.horseName}* - ${tip.time} at ${tip.meetingLocation}\n`;
        tipsText += `   💰 ${tip.points} ${tip.betType} @ *${tip.suggestedPrice}*\n`;
    });
    return tipsText;
}

function formatEmailBody(posts: Post[]): string {
    let body = `New horse racing tips from Rhys Williams (${posts.length} post(s)):\n\n`;

    posts.forEach((post, i) => {
        body += `${i + 1}. ${post.title}\n`;
        body += `   📅 ${new Date(post.date).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}\n`;
        body += `   🔗 ${post.link}`;
        body += formatTipsText(post.tips || []);
        body += "\n\n";
    });

    body += `Happy betting! 🐎\n`;
    body += `Alert sent at: ${new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}`;

    return body;
}

function formatEmailHTML(posts: Post[]): string {
    let html = `
    <h2>🏇 New Rhys Williams Tips</h2>
    <p>Found <strong>${posts.length}</strong> new post(s):</p>
  `;

    posts.forEach((post, i) => {
        html += `
      <div style="margin-bottom: 25px; padding: 15px; border-left: 4px solid #2e7d32;">
        <h3><a href="${post.link}" target="_blank">${post.title}</a></h3>
        <small>📅 ${post.date}</small>
        ${formatTipsHTML(post.tips || [])}
      </div>
    `;
    });

    html += `
    <p>Happy betting! 🐎</p>
    <p><small>Alert sent at: ${new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}</small></p>
  `;

    return html;
}

function formatSlackMessage(posts: Post[]): string {
    let message = `🏇 *New Rhys Williams Tips* (${posts.length} post${posts.length > 1 ? "s" : ""}): \n\n`;

    posts.forEach((post, i) => {
        message += `${i + 1}. *${post.title}*\n`;
        message += `   📅 ${post.date}\n`;
        message += `   🔗 <${post.link}|Read More>`;
        message += formatTipsSlack(post.tips || []);
        message += "\n\n";
    });

    message += `🤖 _Alert sent at ${new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}_`;

    return message;
}

function parseRSSDate(dateString: string): string {
    try {
        const date = new Date(dateString);
        return date.toLocaleString("en-IE", { timeZone: "Europe/Dublin" });
    } catch (error) {
        console.error("Error parsing date:", dateString, error);
        return new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" });
    }
}

async function scrapeNewPosts(): Promise<Post[]> {
    try {
        console.log("🔍 Fetching Betfair RSS feed...");

        const response = await fetch(RSS_URL, {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/rss+xml, application/xml, text/xml, */*",
            },
        });

        console.log(`📡 RSS Response status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const xmlText = await response.text();
        console.log(`📄 RSS XML length: ${xmlText.length} characters`);

        const dom = new JSDOM(xmlText, { contentType: "text/xml" });
        const document = dom.window.document;

        const items = document.querySelectorAll("item");
        const newPosts: Post[] = [];
        const seenPosts = await getSeenPosts();

        console.log(`Found ${items.length} items in RSS feed`);

        for (const item of items) {
            try {
                const titleElem = item.querySelector("title");
                const linkElem = item.querySelector("link");
                const dateElem = item.querySelector("pubDate");
                const categories = item.querySelectorAll("category");

                if (!titleElem || !linkElem) continue;

                const title = titleElem.textContent?.trim();
                const link = linkElem.textContent?.trim();
                const pubDate = dateElem?.textContent?.trim() || "";

                if (!title || !link) continue;

                const isRhysPost =
                    Array.from(categories).some((cat) =>
                        cat.textContent?.toLowerCase().includes("rhys williams")
                    ) || title.toLowerCase().includes("rhys williams");

                if (!isRhysPost) {
                    continue;
                }

                if (!seenPosts.includes(link)) {
                    console.log(`✨ New Rhys Williams post found: ${title}`);
                    // Add debugging (remove this after testing)
                    await debugPageStructure(link);

                    // Extract betting tips using AI
                    const tips = await extractTipsFromUrl(link);

                    const post: Post = {
                        title,
                        link,
                        date: parseRSSDate(pubDate),
                        author: "Rhys Williams",
                        tips,
                    };

                    newPosts.push(post);
                } else {
                    console.log(`👀 Already seen: ${title}`);
                }
            } catch (error) {
                console.error(`Error parsing RSS item:`, error);
            }
        }

        return newPosts;
    } catch (error) {
        console.error("Error fetching RSS feed:", error);
        throw new Error(
            `Failed to fetch RSS feed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.status(200).end();
        return;
    }

    const timestamp = new Date().toLocaleString("en-IE", {
        timeZone: "Europe/Dublin",
    });

    const path = req.url
        ? new URL(req.url, `http://${req.headers.host}`).pathname
        : "";

    if (path === "/favicon.ico" || path === "/favicon.png") {
        console.log(`ℹ️ Ignoring request for static asset: ${path}`);
        res.status(204).end();
        return;
    }

    try {
        console.log("🔍 Starting Rhys Williams RSS monitor check at:", timestamp);

        const newPosts = await scrapeNewPosts();
        let emailSent = false;
        let slackSent = false;

        if (newPosts.length > 0) {
            console.log(`🎉 Found ${newPosts.length} new Rhys Williams posts!`);

            newPosts.forEach((post) => {
                console.log(`📝 ${post.title}`);
                console.log(`📅 ${post.date}`);
                console.log(`🔗 ${post.link}`);
                if (post.tips && post.tips.length > 0) {
                    console.log(`🎯 ${post.tips.length} betting tips extracted`);
                }
                console.log("");
            });

            const [emailResult, slackResult] = await Promise.all([
                sendEmailAlert(newPosts),
                sendSlackAlert(newPosts),
            ]);

            emailSent = emailResult;
            slackSent = slackResult;

            await addSeenPosts(newPosts.map((p) => p.link));
        } else {
            console.log("📭 No new Rhys Williams posts found");
        }

        const response: ApiResponse = {
            success: true,
            timestamp,
            newPosts: newPosts.length,
            posts: newPosts,
            message:
                newPosts.length > 0
                    ? `Found ${newPosts.length} new Rhys Williams posts!`
                    : "No new Rhys Williams posts",
            emailSent,
            slackSent,
        };

        res.status(200).json(response);
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
        console.error("❌ Error:", errorMessage);

        const response: ApiResponse = {
            success: false,
            timestamp,
            newPosts: 0,
            posts: [],
            message: "Error occurred while checking RSS feed",
            error: errorMessage,
            emailSent: false,
            slackSent: false,
        };

        res.status(500).json(response);
    }
}