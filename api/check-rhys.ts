import { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiResponse } from '@/types';
import { RhysScraper } from '@/utils/scraper';
import { AlertService } from '@/utils/alerts';
import { PostStorage } from '@/utils/storage';

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
    const newPosts = await RhysScraper.scrapeNewPosts();

    if (newPosts.length > 0) {
      console.log(`🎉 Found ${newPosts.length} new posts!`);

      // Log the posts
      newPosts.forEach(post => {
        console.log(`📝 ${post.title}`);
        console.log(`📅 ${post.date}`);
        console.log(`🔗 ${post.link}\n`);
      });

      // Send alerts
      const alertResults = await AlertService.sendAlerts(newPosts);
      
      // Log alert results
      alertResults.forEach(result => {
        if (result.success) {
          console.log(`✅ ${result.type} alert sent successfully`);
        } else {
          console.error(`❌ ${result.type} alert failed: ${result.error}`);
        }
      });

      // Update seen posts
      await PostStorage.addSeenPosts(newPosts.map(p => p.link));

    } else {
      console.log('📭 No new posts found');
    }

    const response: ApiResponse = {
      success: true,
      timestamp,
      newPosts: newPosts.length,
      posts: newPosts,
      message: newPosts.length > 0 ? 'New posts found and alerts sent!' : 'No new posts'
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