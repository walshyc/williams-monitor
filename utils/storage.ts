import { kv } from '@vercel/kv';

const SEEN_POSTS_KEY = 'seen_posts';

export class PostStorage {
    static async getSeenPosts(): Promise<string[]> {
        try {
            const seenPosts = await kv.get<string[]>(SEEN_POSTS_KEY);
            return seenPosts || [];
        } catch (error) {
            console.error('Error getting seen posts:', error);
            return [];
        }
    }

    static async addSeenPosts(newPostLinks: string[]): Promise<void> {
        try {
            const currentSeenPosts = await this.getSeenPosts();
            const updatedSeenPosts = [...currentSeenPosts, ...newPostLinks];
            await kv.set(SEEN_POSTS_KEY, updatedSeenPosts);
        } catch (error) {
            console.error('Error saving seen posts:', error);
        }
    }

    static async isPostSeen(link: string): Promise<boolean> {
        const seenPosts = await this.getSeenPosts();
        return seenPosts.includes(link);
    }
}