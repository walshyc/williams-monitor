import { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { kv } from '@vercel/kv';

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
}

const RSS_URL = 'https://betting.betfair.com/index.xml';
const SEEN_POSTS_KEY = 'seen_posts';
const USER_AGENT = 'Mozilla/5.0 (compatible; RSS Reader; +https://your-domain.com)';

async function getSeenPosts(): Promise<string[]> {
    try {
        const seenPosts = await kv.get<string[]>(SEEN_POSTS_KEY);
        return seenPosts || [];
    } catch (error) {
        console.error('Error getting seen posts:', error);
        return [];
    }
}

async function addSeenPosts(newPostLinks: string[]): Promise<void> {
    try {
        const currentSeenPosts = await getSeenPosts();
        const updatedSeenPosts = [...currentSeenPosts, ...newPostLinks];
        await kv.set(SEEN_POSTS_KEY, updatedSeenPosts);
    } catch (error) {
        console.error('Error saving seen posts:', error);
    }
}

function parseRSSDate(dateString: string): string {
    try {
        // RSS dates are in format: "Wed, 30 Jul 2025 10:56:00 +0100"
        const date = new Date(dateString);
        return date.toISOString();
    } catch (error) {
        console.error('Error parsing date:', dateString, error);
        return new Date().toISOString();
    }
}

async function scrapeNewPosts(): Promise<Post[]> {
    try {
        console.log('🔍 Fetching Betfair RSS feed...');

        const response = await fetch(RSS_URL, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
            }
        });

        console.log(`📡 RSS Response status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const xmlText = await response.text();
        console.log(`📄 RSS XML length: ${xmlText.length} characters`);

        // Parse XML using JSDOM
        const dom = new JSDOM(xmlText, { contentType: 'text/xml' });
        const document = dom.window.document;

        const items = document.querySelectorAll('item');
        const newPosts: Post[] = [];
        const seenPosts = await getSeenPosts();

        console.log(`Found ${items.length} items in RSS feed`);

        for (const item of items) {
            try {
                const titleElem = item.querySelector('title');
                const linkElem = item.querySelector('link');
                const dateElem = item.querySelector('pubDate');
                const categories = item.querySelectorAll('category');

                if (!titleElem || !linkElem) continue;

                const title = titleElem.textContent?.trim();
                const link = linkElem.textContent?.trim();
                const pubDate = dateElem?.textContent?.trim() || '';

                if (!title || !link) continue;

                // Check if this post is by Rhys Williams
                const isRhysPost = Array.from(categories).some(cat =>
                    cat.textContent?.toLowerCase().includes('rhys williams')
                ) || title.toLowerCase().includes('rhys williams');

                if (!isRhysPost) {
                    continue; // Skip posts not by Rhys Williams
                }

                const post: Post = {
                    title,
                    link,
                    date: parseRSSDate(pubDate),
                    author: 'Rhys Williams'
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
        console.error('Error fetching RSS feed:', error);
        throw new Error(`Failed to fetch RSS feed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const timestamp = new Date().toISOString();

    try {
        console.log('🔍 Starting Rhys Williams RSS monitor check at:', timestamp);

        const newPosts = await scrapeNewPosts();

        if (newPosts.length > 0) {
            console.log(`🎉 Found ${newPosts.length} new Rhys Williams posts!`);

            newPosts.forEach(post => {
                console.log(`📝 ${post.title}`);
                console.log(`📅 ${post.date}`);
                console.log(`🔗 ${post.link}\n`);
            });

            await addSeenPosts(newPosts.map(p => p.link));
        } else {
            console.log('📭 No new Rhys Williams posts found');
        }

        const response: ApiResponse = {
            success: true,
            timestamp,
            newPosts: newPosts.length,
            posts: newPosts,
            message: newPosts.length > 0 ? `Found ${newPosts.length} new Rhys Williams posts!` : 'No new Rhys Williams posts'
        };

        res.status(200).json(response);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ Error:', errorMessage);

        const response: ApiResponse = {
            success: false,
            timestamp,
            newPosts: 0,
            posts: [],
            message: 'Error occurred while checking RSS feed',
            error: errorMessage
        };

        res.status(500).json(response);
    }
}