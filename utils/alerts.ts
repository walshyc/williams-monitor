import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import { Post, EmailConfig, SlackConfig, AlertResult } from '@/types';

export class AlertService {
    static async sendAlerts(posts: Post[]): Promise<AlertResult[]> {
        const results: AlertResult[] = [];

        // Send email alert
        if (this.isEmailConfigured()) {
            const emailResult = await this.sendEmailAlert(posts);
            results.push(emailResult);
        } else {
            console.log('📧 Email not configured, skipping email alert');
        }

        // Send Slack alert
        if (this.isSlackConfigured()) {
            const slackResult = await this.sendSlackAlert(posts);
            results.push(slackResult);
        } else {
            console.log('💬 Slack not configured, skipping Slack alert');
        }

        return results;
    }

    private static isEmailConfigured(): boolean {
        return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
    }

    private static isSlackConfigured(): boolean {
        return !!process.env.SLACK_WEBHOOK;
    }

    private static async sendEmailAlert(posts: Post[]): Promise<AlertResult> {
        try {
            const config: EmailConfig = {
                user: process.env.EMAIL_USER!,
                pass: process.env.EMAIL_PASS!,
                to: process.env.EMAIL_TO || process.env.EMAIL_USER!
            };

            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: config.user,
                    pass: config.pass
                }
            });

            const subject = `🏇 New Rhys Williams Tips - ${posts.length} post(s)`;
            const body = this.formatEmailBody(posts);

            await transporter.sendMail({
                from: config.user,
                to: config.to,
                subject,
                text: body
            });

            console.log('✅ Email sent successfully');
            return { type: 'email', success: true };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('❌ Email error:', errorMessage);
            return { type: 'email', success: false, error: errorMessage };
        }
    }

    private static async sendSlackAlert(posts: Post[]): Promise<AlertResult> {
        try {
            const webhookUrl = process.env.SLACK_WEBHOOK!;
            const message = this.formatSlackMessage(posts);

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: message,
                    username: 'Rhys Williams Monitor',
                    icon_emoji: ':horse:'
                })
            });

            if (response.ok) {
                console.log('✅ Slack alert sent successfully');
                return { type: 'slack', success: true };
            } else {
                const errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                console.error('❌ Slack response error:', errorMessage);
                return { type: 'slack', success: false, error: errorMessage };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('❌ Slack error:', errorMessage);
            return { type: 'slack', success: false, error: errorMessage };
        }
    }

    private static formatEmailBody(posts: Post[]): string {
        let body = `New horse racing tips from Rhys Williams (${posts.length} post(s)):\n\n`;

        posts.forEach((post, i) => {
            body += `${i + 1}. ${post.title}\n`;
            body += `   📅 ${post.date}\n`;
            body += `   🔗 ${post.link}\n\n`;
        });

        body += `Happy betting! 🐎\n`;
        body += `Alert sent at: ${new Date().toLocaleString()}`;

        return body;
    }

    private static formatSlackMessage(posts: Post[]): string {
        let message = `🏇 *New Rhys Williams Tips* (${posts.length} post(s)):\n\n`;

        posts.forEach((post, i) => {
            message += `${i + 1}. *${post.title}*\n`;
            message += `   📅 ${post.date}\n`;
            message += `   🔗 <${post.link}|Read More>\n\n`;
        });

        message += `🤖 _Alert sent at ${new Date().toLocaleString()}_`;

        return message;
    }
}