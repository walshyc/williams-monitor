import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Post } from '@/types';
import { PostStorage } from './storage';

export class RhysScraper {
    private static readonly AUTHOR_URL = 'https://betting.betfair.com/authors/rhys-williams/';
    private static readonly MAX_POSTS_TO_CHECK = 5;
    private static readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

    static async scrapeNewPosts(): Promise<Post[]> {
        try {
            console.log('🔍 Fetching Rhys Williams author page...');

            const response = await fetch(this.AUTHOR_URL, {
                headers: {
                    'User-Agent': this.USER_AGENT
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

            console.log(`Found ${articles.length} articles on page`);

            for (let i = 0; i < Math.min(articles.length, this.MAX_POSTS_TO_CHECK); i++) {
                const article = articles[i];

                try {
                    const post = await this.parseArticle(article);
                    if (post && !(await PostStorage.isPostSeen(post.link))) {
                        newPosts.push(post);
                        console.log(`✨ New post found: ${post.title}`);
                    } else if (post) {
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

    private static async parseArticle(article: Element): Promise<Post | null> {
        const titleElem = article.querySelector('h2.title a') as HTMLAnchorElement;
        const timeElem = article.querySelector('time') as HTMLTimeElement;

        if (!titleElem) {
            return null;
        }

        const title = titleElem.textContent?.trim();
        const link = titleElem.href;
        const date = timeElem?.getAttribute('datetime') || 'Unknown';

        if (!title || !link) {
            return null;
        }

        return {
            title,
            link,
            date,
            author: 'Rhys Williams'
        };
    }
}