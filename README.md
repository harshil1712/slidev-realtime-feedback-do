
# Slidev Realtime Feedback Server

This project enhances presentations by allowing real-time audience feedback using Cloudflare Workers and Durable Objects, for the presentations built with [Slidev](https://sli.dev/).

## Features

- Real-time audience reactions and feedback
- WebSocket-based communication for instant updates
- Persistent storage of presentation data and feedback using SQLite
- Scalable architecture using Cloudflare Workers and Durable Objects

## Technical Stack

- TypeScript
- Cloudflare Workers
- Durable Objects
- WebSockets
- SQLite (via Cloudflare's SqlStorage)
- Hono (lightweight web framework for Cloudflare Workers)

## Key Components

1. `Presentation` class: Stores all the presentation data
2. `Slide` class: Stores the feedback for individual slides. Also handles WebSocket connections and broadcasts
3. A UI to view the stats

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/harshil1712/slidev-realtime-feedback-do)

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Deploy to Cloudflare Workers: `npm run deploy`

## Usage

Checkout the [Slidev Realtime Add-on](https://github.com/harshil1712/slidev-realtime-feedback-addon) for more details.

## API Endpoints

- `GET /api/presentations`: Retrieve all presentations
- `GET /api/feedback/:slide`: Get feedback for the mentioned presentations' slides

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
