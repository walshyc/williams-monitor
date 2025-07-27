import fetch from 'node-fetch';
import { ApiResponse } from './types/index.js';

async function testLocal(): Promise<void> {
    try {
        console.log('🧪 Testing local endpoint...');

        const response = await fetch('http://localhost:3000/api/check-rhys');
        const data = await response.json() as ApiResponse;

        console.log('✅ Test result:', {
            success: data.success,
            newPosts: data.newPosts,
            message: data.message,
            timestamp: data.timestamp
        });

        if (data.posts.length > 0) {
            console.log('\n📝 Posts found:');
            data.posts.forEach((post, i) => {
                console.log(`${i + 1}. ${post.title}`);
                console.log(`   🔗 ${post.link}`);
            });
        }

    } catch (error) {
        console.error('❌ Test error:', error);
    }
}

testLocal()