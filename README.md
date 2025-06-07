# cdn.artlu.xyz

A nearly trivial self-owned data store for image attachments on social media.

It becomes possible to share a post, pointing to my own url, in order to own its distribution. I can track views if I wish (I don't). I can delete things I've shared, and generally, links and caches will mostly respect the deletion.

## /uses

- Hono🔥 on Cloudflare Workers + R2 + KV

- TypeScript backend

- static JS frontend + htmx + AlpineJS + UnoCSS + DaisyUI

- <code>Sonyflake62</code>, my improvement on Sonyflake, which itself is a variation on Twitter's Snowflake algorithm

## Development

Install dependencies:

```bash
bun install
```

Check the id's provided in `wrangler.jsonc` for KV and R2 buckets

Start the development server with:

```bash
bun dev
```

Your application will be available at [http://localhost:8787](http://localhost:8787).

## Deployment

Deploy your project to Cloudflare Workers:

```bash
bun run deploy
```

### Inspirations

Inspired by Borodutch's [image-download](https://github.com/backmeupplz/image-download) 89-line backend (Bun Serve + Hono + sharp) for the [Colorino](https://github.com/backmeupplz/colorino) project , and Tony D'Addeo's elegant 128-line [quick-auth](https://github.com/farcasterxyz/quick-auth) server on Cloudflare Durable Objects.

### Sonyflake62

Twitter invented [Snowflake](https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake) ~ 2010, as a way to generate unique IDs in a distributed manner, as they were outgrowing MySQL and Cassandra. It allows distributed servers to generate unique IDs, and has the very nice property of being ***roughly sortable***, *i.e.,* loosely coordinated independent servers can generate ***K-sortable*** unique identifiers.

[Sonyflake](https://github.com/sony/sonyflake?tab=readme-ov-file) is a MIT licensed variation on Snowflake, making certain appealing tradeoffs, while still taking up 63 bits of information plus a checksum.

Both are numerical representations, which tend to be less human-readable, and for web purposes the serialisation is inefficient. A numerical digit takes up the same space as a full alphanumeric character, while only using 16% =~ 10 / (10 digits + 26 lowercase chars + 26 uppercase chars) of the information space.

Sonyflake62 is a base62 serialisation of the Sonyflake ID (shorter, URL-safe, still time-sortable, maintains uniqueness). It is more human-readable, and also more space-efficient, while preserving the uniqueness and time-sortability properties.
