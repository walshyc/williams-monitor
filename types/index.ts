export interface Post {
    title: string;
    link: string;
    date: string;
    author: string;
}

export interface ApiResponse {
    success: boolean;
    timestamp: string;
    newPosts: number;
    posts: Post[];
    message: string;
    error?: string;
}

export interface EmailConfig {
    user: string;
    pass: string;
    to: string;
}

export interface SlackConfig {
    webhookUrl: string;
}

export interface AlertResult {
    type: 'email' | 'slack';
    success: boolean;
    error?: string;
}