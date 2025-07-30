import { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        const seenPosts = await kv.get<string[]>('seen_posts');

        res.status(200).json({
            success: true,
            seenPostsCount: seenPosts?.length || 0,
            seenPosts: seenPosts || [],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}