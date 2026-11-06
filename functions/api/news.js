function xmlText(xml, tag) {
  const match = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
  if (!match) return "";
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function scoreHeadline(title) {
  const text = title.toLowerCase();
  const positive = ["rally","surge","jumps","soars","safe haven demand","geopolitical tensions","war risk","easing inflation","rate cut","cuts rates","dovish","weak dollar","dollar falls","yields fall","gold rises","bullish"];
  const negative = ["slump","falls","drops","tumbles","selloff","sell-off","strong dollar","dollar rises","yields rise","rate hike","higher rates","hawkish","inflation heats","gold falls","bearish"];
  let score = 0;
  for (const word of positive) if (text.includes(word)) score += 1;
  for (const word of negative) if (text.includes(word)) score -= 1;
  const label = score > 0 ? "BULLISH" : score < 0 ? "BEARISH" : "NEUTRAL";
  const impactWords = ["fed","fomc","interest rate","cpi","inflation","pce","nfp","payroll","unemployment","powell","central bank","war","sanction","tariff"];
  const impact = impactWords.some(word => text.includes(word)) ? "HIGH" : (text.includes("gold") || text.includes("xau") || text.includes("dollar") ? "MEDIUM" : "LOW");
  return {label, impact, score};
}

function parseFeed(xml, provider) {
  const matches = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 20);
  return matches.map(match => {
    const item = match[1];
    const title = xmlText(item, "title");
    const link = xmlText(item, "link") || xmlText(item, "guid");
    const published = xmlText(item, "pubDate") || xmlText(item, "published");
    const source = xmlText(item, "source") || provider;
    return {title, link, published, source, ...scoreHeadline(title)};
  }).filter(article => article.title && /^https?:\/\//i.test(article.link));
}

export async function onRequestGet() {
  const q = encodeURIComponent("gold XAUUSD Federal Reserve US inflation US dollar");
  const feeds = [
    {
      provider: "Bing News RSS",
      url: "https://www.bing.com/news/search?q=" + q + "&format=rss"
    },
    {
      provider: "Google News RSS",
      url: "https://news.google.com/rss/search?q=" + encodeURIComponent("gold OR XAUUSD OR Federal Reserve OR US inflation OR US dollar") + "&hl=en-US&gl=US&ceid=US:en"
    }
  ];

  const failures = [];
  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MarketNewsDashboard/1.0)",
          "Accept": "application/rss+xml, application/xml, text/xml"
        },
        signal: AbortSignal.timeout(9000),
        cf: {cacheTtl: 180, cacheEverything: true}
      });
      if (!response.ok) {
        failures.push(feed.provider + " returned HTTP " + response.status);
        continue;
      }

      const xml = await response.text();
      const articles = parseFeed(xml, feed.provider);
      if (!articles.length) {
        failures.push(feed.provider + " returned no usable articles");
        continue;
      }

      const counts = articles.reduce((acc, item) => {
        acc[item.label.toLowerCase()]++;
        return acc;
      }, {bullish: 0, bearish: 0, neutral: 0});
      const net = counts.bullish - counts.bearish;
      const overall = net > 1 ? "BULLISH" : net < -1 ? "BEARISH" : "NEUTRAL";

      return Response.json({
        status: "ok",
        provider: feed.provider,
        updatedAt: new Date().toISOString(),
        overall,
        counts,
        highImpact: articles.filter(item => item.impact === "HIGH").length,
        articles
      }, {headers: {"Cache-Control": "public, max-age=180, s-maxage=180"}});
    } catch (error) {
      failures.push(feed.provider + ": " + String(error && error.message || error));
    }
  }

  return Response.json({
    status: "error",
    message: "All news sources are temporarily unavailable.",
    detail: failures.join("; "),
    articles: []
  }, {status: 502, headers: {"Cache-Control": "no-store"}});
}