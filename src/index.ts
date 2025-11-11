import { httpServerHandler } from 'cloudflare:node';
import express from 'express';
import type { Request, Response } from 'express';
import worker from './handler';
import { env } from './env';
import pkg from '../package.json';

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
	const health = {
		status: 'ok',
		timestamp: new Date().toISOString(),
		version: pkg.version,
		environment: env.NODE_ENV || 'production',
		runtime: 'cloudflare-workers',
	};
	res.status(200).json(health);
});

// OAuth routes - delegate to the worker handler
const handleOAuth = async (req: Request, res: Response): Promise<void> => {
	try {
		const protocol = req.protocol;
		const host = req.get('host') || 'localhost';
		const url = `${protocol}://${host}${req.originalUrl}`;

		// Adapt Express headers to Fetch API Headers
		const headers = new Headers();
		Object.entries(req.headers).forEach(([key, value]) => {
			if (Array.isArray(value)) {
				value.forEach((v) => headers.append(key, v));
			} else if (value) {
				headers.set(key, String(value));
			}
		});

		// Create a Fetch API Request
		const request = new Request(url, {
			method: req.method,
			headers,
		});

		// Call the worker handler
		const response = await worker.fetch(request, env);

		// Copy response headers
		response.headers.forEach((value, key) => {
			res.set(key, value);
		});

		// Set status
		res.status(response.status);

		// Send body
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		res.send(buffer);
	} catch (error) {
		console.error('Error handling OAuth request:', error);
		res.status(500).send('Internal server error');
	}
};

// OAuth endpoints
app.get('/auth', handleOAuth);
app.get('/oauth/auth', handleOAuth);
app.get('/oauth/authorize', handleOAuth);
app.get('/callback', handleOAuth);
app.get('/oauth/redirect', handleOAuth);

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
	res.json({
		message: 'Cajuína CMS OAuth Server',
		version: pkg.version,
		runtime: 'cloudflare-workers',
		endpoints: {
			health: '/health',
			auth: '/auth',
			oauth: '/oauth',
			callback: '/callback',
		},
	});
});

// 404 handler
app.use((req: Request, res: Response) => {
	res.status(404).json({
		error: 'Not Found',
		path: req.path,
	});
});

// Start the server
const PORT = env.PORT || 3000;
app.listen(PORT);

// Export the Cloudflare Workers handler
export default httpServerHandler({ port: PORT });
