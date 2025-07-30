import { VercelRequest, VercelResponse } from "@vercel/node";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { kv } from "@vercel/kv";
import nodemailer from "nodemailer";

interface Post {
    title: string;
    link: string;
    date: string;
    author: string;
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
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
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
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("❌ Slack error:", errorMessage);
        return false;
    }
}

function formatEmailBody(posts: Post[]): string {
    let body = `New horse racing tips from Rhys Williams (${posts.length} post(s)):\n\n`;

    posts.forEach((post, i) => {
        body += `${i + 1}. ${post.title}\n`;
        body += `   📅 ${new Date(post.date).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}\n`;
        body += `   🔗 ${post.link}\n\n`;
    });

    body += `Happy betting! 🐎\n`;
    body += `Alert sent at: ${new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}`;

    return body;
}

function formatEmailHTML(posts: Post[]): string {
    let html = `
    <h2>🏇 New Rhys Williams Tips</h2>
    <p>Found <strong>${posts.length}</strong> new post(s):</p>
    <ul>
    `;

    posts.forEach((post, i) => {
        html += `
        <li style="margin-bottom: 15px;">
            <strong><a href="${post.link}" target="_blank">${post.title}</a></strong><br>
            <small>📅 ${new Date(post.date).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}</small>
        </li>
        `;
    });

    html += `
    </ul>
    <p>Happy betting! 🐎</p>
    <p><small>Alert sent at: ${new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}</small></p>
    `;

    return html;
}

function formatSlackMessage(posts: Post[]): string {
    let message = `🏇 *New Rhys Williams Tips* (${posts.length} post${posts.length > 1 ? "s" : ""}):\n\n`;

    posts.forEach((post, i) => {
        message += `${i + 1}. *${post.title}*\n`;
        message += `   📅 ${post.date}\n`;
        message += `   🔗 <${post.link}|Read More>\n\n`;
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
                        cat.textContent?.toLowerCase().includes("rhys williams"),
                    ) || title.toLowerCase().includes("rhys williams");

                if (!isRhysPost) {
                    continue;
                }

                const post: Post = {
                    title,
                    link,
                    date: parseRSSDate(pubDate),
                    author: "Rhys Williams",
                };

                if (!seenPosts.includes(link)) {
                    newPosts.push(post);
                    console.log(`✨ New Rhys Williams post found: ${post.title}`);
                } else {
                    console.log(`👀 Already seen: ${post.title}`);
                }
            } catch (error) {
                console.error(`Error parsing RSS item:`, error);
            }
        }

        return newPosts;
    } catch (error) {
        console.error("Error fetching RSS feed:", error);
        throw new Error(
            `Failed to fetch RSS feed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
    }
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse,
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

    // Check if the request path is for a known static asset like favicon
    const path = req.url
        ? new URL(req.url, `http://${req.headers.host}`).pathname
        : "";

    if (path === "/favicon.ico" || path === "/favicon.png") {
        console.log(`ℹ️ Ignoring request for static asset: ${path}`);
        res.status(204).end(); // 204 No Content, indicates success but no response body
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
                console.log(`🔗 ${post.link}\n`);
            });

            // Send alerts
            const [emailResult, slackResult] = await Promise.all([
                sendEmailAlert(newPosts),
                sendSlackAlert(newPosts),
            ]);

            emailSent = emailResult;
            slackSent = slackResult;

            // Update seen posts
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
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
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