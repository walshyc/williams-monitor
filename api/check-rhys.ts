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

const AUTHOR_URL = 'https://betting.betfair.com/authors/rhys-williams/';
const SEEN_POSTS_KEY = 'seen_posts';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

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

// Replace the scrapeNewPosts function with this enhanced version:
async function scrapeNewPosts(): Promise<Post[]> {
    try {
        console.log('🔍 Fetching Rhys Williams author page...');

        const response = await fetch(AUTHOR_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const dom = new JSDOM(html);
        const document = dom.window.document;

        const articles = document.querySelectorAll('.entry_summary');
        const newPosts: Post[] = [];
        const seenPosts = await getSeenPosts();

        console.log(`Found ${articles.length} articles on page`);

        for (let i = 0; i < Math.min(articles.length, 5); i++) {
            const article = articles[i];

            try {
                const titleElem = article.querySelector('h2.title a') as HTMLAnchorElement;
                const timeElem = article.querySelector('time') as HTMLTimeElement;

                if (!titleElem) continue;

                const title = titleElem.textContent?.trim();
                const link = titleElem.href;
                const date = timeElem?.getAttribute('datetime') || 'Unknown';

                if (!title || !link) continue;

                const post: Post = {
                    title,
                    link,
                    date,
                    author: 'Rhys Williams'
                };

                if (!seenPosts.includes(link)) {
                    newPosts.push(post);
                    console.log(`✨ New post found: ${post.title}`);
                } else {
                    console.log(`👀 Already seen: ${post.title}`);
                }
            } catch (error) {
                console.error(`Error parsing article ${i}:`, error);
            }
        }

        return newPosts;

    } catch (error) {
        console.error('Error scraping page:', error);
        throw new Error(`Failed to scrape posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const timestamp = new Date().toISOString();

    try {
        console.log('🔍 Starting Rhys Williams monitor check at:', timestamp);

        // Scrape for new posts
        const newPosts = await scrapeNewPosts();

        if (newPosts.length > 0) {
            console.log(`🎉 Found ${newPosts.length} new posts!`);

            // Log the posts
            newPosts.forEach(post => {
                console.log(`📝 ${post.title}`);
                console.log(`📅 ${post.date}`);
                console.log(`🔗 ${post.link}\n`);
            });

            // Update seen posts
            await addSeenPosts(newPosts.map(p => p.link));
        } else {
            console.log('📭 No new posts found');
        }

        const response: ApiResponse = {
            success: true,
            timestamp,
            newPosts: newPosts.length,
            posts: newPosts,
            message: newPosts.length > 0 ? 'New posts found!' : 'No new posts'
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
            message: 'Error occurred while checking for posts',
            error: errorMessage
        };

        res.status(500).json(response);
    }
}