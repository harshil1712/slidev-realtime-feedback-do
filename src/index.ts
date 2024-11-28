import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

type FeedbackType = 'okay' | 'good' | 'great' | 'mindBlown';

enum SendType {
	REACTIONS = 'reactions',
	SLIDEUPDATE = 'slideupdate',
}

interface SlideUpdateState {
	mtype: SendType.SLIDEUPDATE;
	page: number | string;
	click: number;
	type: 'broadcast';
}

interface ReactionState {
	mtype: SendType.REACTIONS;
	emoji: string;
	type: 'broadcast';
	page: number | string;
	slideTitle: string;
	feedback: FeedbackType;
}

export class Presentation extends DurableObject {
	sql: SqlStorage;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.sql = this.ctx.storage.sql;

		// create table to store presentation title and the presentation id
		this.sql.exec(`CREATE TABLE IF NOT EXISTS presentation (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, presentation_id TEXT)`);
	}
	getAllEntries() {
		const result = this.sql.exec('SELECT * FROM presentation');
		return result.toArray();
	}
	addEntry(title: string, presentation_id: string) {
		const exists = this.sql.exec('SELECT * FROM presentation WHERE presentation_id = ?', presentation_id);
		if (exists.toArray()[0]) return 'Presentation already exists';
		return this.sql.exec('INSERT INTO presentation (title, presentation_id) VALUES (?, ?)', title, presentation_id).toArray();
	}
}

export class Slide extends DurableObject {
	session: Map<WebSocket, any>;
	sql: SqlStorage;
	env: Env;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.session = new Map();
		this.sql = this.ctx.storage.sql;
		this.ctx.getWebSockets().forEach((ws) => this.session.set(ws, { ...ws.deserializeAttachment() }));
		this.env = env;

		this.sql.exec(
			`CREATE TABLE IF NOT EXISTS slide (id INTEGER PRIMARY KEY AUTOINCREMENT, slide_id INTEGER, slide_title TEXT, feedback_okay INTEGER DEFAULT 0, feedback_good INTEGER DEFAULT 0, feedback_great INTEGER DEFAULT 0, feedback_mindBlown INTEGER DEFAULT 0)`
		);
	}

	getFeedback() {
		// order by slide_id
		const result = this.sql.exec('SELECT * FROM slide ORDER BY slide_id');
		return result.toArray();
	}

	private addSlide(id: number, title: string) {
		const exists = this.sql.exec('SELECT * FROM slide WHERE slide_id = ?', id);
		if (exists.toArray()[0]) return 'Slide already exists';
		return this.sql.exec('INSERT INTO slide (slide_id, slide_title) VALUES (?, ?)', id, title).toArray();
	}

	private drop() {
		const result = this.sql.exec('DROP TABLE slide');
		return result.toArray();
	}

	private addFeedback(id: number, title: string, feedback: FeedbackType) {
		const exists = this.sql.exec('SELECT * FROM slide WHERE slide_id = ?', id);

		try {
			if (!exists.toArray()[0]) {
				console.log('Slide does not exist');
				this.addSlide(id, title);
			}
			const feedbackColumn = `feedback_${feedback}`;
			const query = `UPDATE slide SET ${feedbackColumn} = ${feedbackColumn} + 1 WHERE slide_id = ?`;

			return this.sql.exec(query, id).toArray();
		} catch (error) {
			console.log(error);
		}
	}

	async fetch(request: Request): Promise<Response> {
		// Creates two ends of a WebSocket connection.
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		this.ctx.acceptWebSocket(server);
		// Add the new WebSocket to the list of active WebSockets.
		this.session.set(server, {});

		let url = new URL(request.url);
		const title = decodeURIComponent(url.pathname.split('/').pop() as string);
		const id = title.toLowerCase().replaceAll(/\s/g, '-');

		const presentationStub = this.env.PRESENTATION.get(this.env.PRESENTATION.idFromName('presentation'));
		await presentationStub.addEntry(title, id);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
		const session = this.session.get(ws);
		if (!session.id) {
			session.id = crypto.randomUUID();
			ws.serializeAttachment({ ...ws.deserializeAttachment(), id: session.id });
			ws.send(JSON.stringify({ type: 'connected', id: session.id }));
		}
		const receivedMessage: ReactionState | SlideUpdateState = JSON.parse(typeof message === 'string' ? message : '');

		const { page, type, mtype } = receivedMessage;

		console.log('message received of mtype', mtype);

		if (type === 'broadcast' && mtype === 'reactions') {
			const { slideTitle, feedback } = receivedMessage;
			this.addFeedback(Number(page), slideTitle, feedback);
			this.broadcast(ws, receivedMessage);
		}
		if (type === 'broadcast' && mtype === 'slideupdate') {
			this.broadcast(ws, receivedMessage);
		}
	}
	private broadcast(sender: WebSocket, message: {}) {
		const id = this.session.get(sender).id;

		for (let [ws] of this.session) {
			if (sender === ws) continue;
			ws.send(JSON.stringify({ ...message, id }));
		}
	}

	private close(ws: WebSocket) {
		const session = this.session.get(ws);
		if (!session?.id) return;
		this.session.delete(ws);
	}
	webSocketClose(ws: WebSocket) {
		this.close(ws);
	}
	webSocketError(ws: WebSocket) {
		this.close(ws);
	}
}

const app = new Hono<{ Bindings: Env }>();

app.use(logger());

app.get('/ws/:title', async (c) => {
	// Get URL
	const url = new URL(c.req.url);
	const title = c.req.param('title');

	const id = title.toLowerCase().replaceAll(/\s/g, '-');

	const slideId = c.env.SLIDE.idFromName(id);
	const slideStub = c.env.SLIDE.get(slideId);

	return slideStub.fetch(c.req.raw);
});

app.get('/api/presentations', async (c) => {
	const id = c.env.PRESENTATION.idFromName('presentation');
	const stub = c.env.PRESENTATION.get(id);
	const result = await stub.getAllEntries();

	const formattedResult = result.map((entry) => {
		return {
			'No.': entry.id,
			Title: entry.title,
			Slug: entry.presentation_id,
		};
	});

	return new Response(JSON.stringify(formattedResult));
});

app.get('/api/feedback/:slideId', async (c) => {
	const slideId = c.req.param('slideId') as string;
	const id = c.env.SLIDE.idFromName(slideId.toLowerCase().replaceAll(/\s/g, '-'));
	const stub = c.env.SLIDE.get(id);
	const result = await stub.getFeedback();

	const formattedResult = result.map((entry) => {
		return {
			'Slide No.': entry.slide_id,
			Title: entry.slide_title,
			Okay: entry.feedback_okay,
			Good: entry.feedback_good,
			Great: entry.feedback_great,
			'Mind Blown': entry.feedback_mindBlown,
		};
	});

	return new Response(JSON.stringify(formattedResult));
});

export default app;
