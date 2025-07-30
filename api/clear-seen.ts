import { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('Clearing seen_posts');
    const result = await kv.del('seen_posts');
    console.log('Delete result:', result);

    res.status(200).json({
      success: true,
      message: 'Cleared all seen posts',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing seen_posts:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}