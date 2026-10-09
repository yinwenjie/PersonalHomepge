import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { FeedError } from "../rss-proxy/contract.ts";
import { cleanText, decodeEntities, parseFeed, prepareXml } from "../rss-proxy/feed-parser.ts";

const FEED_URL = new URL("https://example.com/blog/feed.xml");

const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example &amp; Co Blog</title>
    <link>https://example.com/</link>
    <atom:link href="https://example.com/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <item>
      <title><![CDATA[Older <b>post</b>]]></title>
      <link>/blog/older</link>
      <guid>older-guid</guid>
      <pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate>
      <description>&lt;p&gt;Hello &lt;em&gt;world&lt;/em&gt;&lt;/p&gt;</description>
    </item>
    <item>
      <title>Newer post</title>
      <link>https://example.com/blog/newer</link>
      <pubDate>Thu, 08 Oct 2026 12:30:00 +0800</pubDate>
      <content:encoded><![CDATA[<p>Rich <script>alert(1)</script>body</p>]]></content:encoded>
    </item>
    <item>
      <title>Bad link</title>
      <link>javascript:alert(1)</link>
    </item>
    <item>
      <title>No date</title>
      <link>https://example.com/blog/undated</link>
      <pubDate>sometime</pubDate>
    </item>
  </channel>
</rss>`;

Deno.test("parses RSS 2.0, resolves links, drops non-http links and sorts by date", async () => {
  const feed = await parseFeed(RSS2, FEED_URL);
  assertEquals(feed.title, "Example & Co Blog");
  assertEquals(feed.siteUrl, "https://example.com/");
  assertEquals(feed.items.map((item) => item.title), ["Newer post", "Older post", "No date"]);
  assertEquals(feed.items[0].publishedAt, "2026-10-08T04:30:00.000Z");
  assertEquals(feed.items[0].summary, "Rich body");
  assertEquals(feed.items[1].link, "https://example.com/blog/older");
  assertEquals(feed.items[1].summary, "Hello world");
  assertEquals(feed.items[2].publishedAt, null);
  assert(feed.items.every((item) => /^[0-9a-f]{24}$/.test(item.id)));
});

Deno.test("parses RSS 1.0 (RDF)", async () => {
  const feed = await parseFeed(
    `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.org/"><title>RDF Site</title><link>https://example.org/</link></channel>
  <item rdf:about="https://example.org/a"><title>A</title><link>https://example.org/a</link><dc:date>2026-10-01T00:00:00Z</dc:date></item>
  <item rdf:about="https://example.org/b"><title>B</title><link>https://example.org/b</link><dc:date>2026-10-02T00:00:00Z</dc:date></item>
</rdf:RDF>`,
    FEED_URL,
  );
  assertEquals(feed.title, "RDF Site");
  assertEquals(feed.items.map((item) => item.title), ["B", "A"]);
});

Deno.test("parses Atom with alternate links and xhtml content", async () => {
  const feed = await parseFeed(
    `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom Feed</title>
  <link rel="self" href="https://example.net/atom.xml"/>
  <link href="https://example.net/"/>
  <entry>
    <title type="html">Release &lt;b&gt;1.0&lt;/b&gt;</title>
    <link rel="replies" href="https://example.net/1#comments"/>
    <link rel="alternate" href="https://example.net/1"/>
    <id>tag:example.net,2026:1</id>
    <updated>2026-10-07T10:00:00Z</updated>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>First <b>release</b></p></div></content>
  </entry>
</feed>`,
    FEED_URL,
  );
  assertEquals(feed.title, "Atom Feed");
  assertEquals(feed.siteUrl, "https://example.net/");
  assertEquals(feed.items.length, 1);
  assertEquals(feed.items[0].link, "https://example.net/1");
  assertEquals(feed.items[0].publishedAt, "2026-10-07T10:00:00.000Z");
  assertEquals(feed.items[0].summary, "First release");
  // Atom type="html" titles arrive entity-escaped; the markup is removed after decoding.
  assertEquals(feed.items[0].title, "Release 1.0");
});

Deno.test("rejects documents that are not feeds", async () => {
  for (
    const text of [
      "<html><body>hi</body></html>",
      '{"items":[]}',
      "",
      "<rss><nochannel/></rss>",
    ]
  ) {
    const error = await assertRejects(() => parseFeed(text, FEED_URL), FeedError);
    assertEquals(error.code, "not_feed");
  }
});

Deno.test("rejects entity declarations and internal DTD subsets (entity bombs)", async () => {
  const bomb = `<?xml version="1.0"?>
<!DOCTYPE rss [
  <!ENTITY a "aaaaaaaaaa">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
]>
<rss><channel><title>&c;</title></channel></rss>`;
  const error = await assertRejects(() => parseFeed(bomb, FEED_URL), FeedError);
  assertEquals(error.code, "not_feed");
});

Deno.test("strips an external DOCTYPE without loading it", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = () => {
    fetched = true;
    return Promise.reject(new Error("no network in parser"));
  };
  try {
    const feed = await parseFeed(
      `<?xml version="1.0"?>
<!DOCTYPE rss PUBLIC "-//Netscape Communications//DTD RSS 0.91//EN" "http://169.254.169.254/rss-0.91.dtd">
<rss version="0.91"><channel><title>Old</title><link>https://old.example/</link>
<item><title>Legacy &amp; item</title><link>https://old.example/1</link></item></channel></rss>`,
      FEED_URL,
    );
    assertEquals(feed.items[0].title, "Legacy & item");
    assertEquals(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(prepareXml('<!DOCTYPE rss SYSTEM "x.dtd"><rss/>'), "<rss/>");
});

Deno.test("unknown entities stay literal and are never expanded", async () => {
  const feed = await parseFeed(
    `<rss><channel><title>T</title><item><title>&custom; &amp;amp; &#x1F600; &#0;</title><link>https://e.com/1</link></item></channel></rss>`,
    FEED_URL,
  );
  assertEquals(feed.items[0].title, "&custom; &amp; 😀");
});

Deno.test("limits item count, text length and serialized size", async () => {
  const items = Array.from(
    { length: 40 },
    (_, index) =>
      `<item><title>${"T".repeat(500)}${index}</title><link>https://e.com/${index}</link>
     <description>${"word ".repeat(400)}</description>
     <pubDate>${new Date(Date.UTC(2026, 0, 1 + index)).toUTCString()}</pubDate></item>`,
  ).join(
    "",
  );
  const feed = await parseFeed(
    `<rss><channel><title>Big</title>${items}</channel></rss>`,
    FEED_URL,
  );
  assertEquals(feed.items.length, 20);
  assert(feed.items.every((item) => Array.from(item.title).length <= 200));
  assert(feed.items.every((item) => Array.from(item.summary).length <= 240));
  assert(new TextEncoder().encode(JSON.stringify(feed.items)).byteLength <= 64 * 1024);
  // Newest first: index 39 is the latest date.
  assertEquals(feed.items[0].link, "https://e.com/39");
});

Deno.test("cleanText removes markup, control characters and bidi overrides", () => {
  assertEquals(
    cleanText("<p>Hi‮ there</p><style>p{}</style>\u0007 &lt;b&gt;x&lt;/b&gt;", 240, true),
    "Hi there x",
  );
  assertEquals(decodeEntities("&lt;&#60;&#x3C;&LT;"), "<<<<");
});
