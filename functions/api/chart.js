const ALLOWED_MARKETS={xau:"XAU/USD",bitcoin:"BTC/USD"};
const INTERVALS={"5m":"5min","15m":"15min","30m":"30min","60m":"1h","240m":"4h"};

export async function onRequestGet({request,env}) {
  const apiKey=env.TWELVE_DATA_API_KEY;
  if(!apiKey) return Response.json({status:"error",error:"TWELVE_DATA_API_KEY is not configured in Cloudflare Pages."},{status:503});
  const requestUrl=new URL(request.url);
  const market=requestUrl.searchParams.get("market")||"xau";
  const interval=requestUrl.searchParams.get("interval")||"15m";
  const symbol=ALLOWED_MARKETS[market];
  const providerInterval=INTERVALS[interval];
  if(!symbol||!providerInterval) return Response.json({status:"error",error:"Unsupported market or timeframe."},{status:400});
  const requestedSize=Number(requestUrl.searchParams.get("outputsize")||250);
  const outputsize=Number.isFinite(requestedSize)?Math.min(300,Math.max(50,Math.floor(requestedSize))):250;
  try {
    const upstreamUrl=new URL("https://api.twelvedata.com/time_series");
    upstreamUrl.searchParams.set("symbol",symbol);
    upstreamUrl.searchParams.set("interval",providerInterval);
    upstreamUrl.searchParams.set("outputsize",String(outputsize));
    upstreamUrl.searchParams.set("timezone","UTC");
    upstreamUrl.searchParams.set("apikey",apiKey);
    const upstream=await fetch(upstreamUrl.toString(),{headers:{accept:"application/json"},cf:{cacheTtl:60,cacheEverything:true}});
    const payload=await upstream.json();
    if(!upstream.ok||!Array.isArray(payload&&payload.values)) {
      return Response.json({status:"error",error:(payload&&payload.message)||"Twelve Data did not return candle data for this symbol/timeframe.",provider_status:upstream.status},
        {status:upstream.status===429?429:502,headers:{"Cache-Control":"no-store"}});
    }
    const candles=payload.values.slice().reverse().map(row=>{
      const raw=String(row.datetime||"").trim();
      const iso=/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)?raw:raw.replace(" ","T")+"Z";
      return {t:Date.parse(iso),o:Number(row.open),h:Number(row.high),l:Number(row.low),c:Number(row.close),v:Number(row.volume||0)};
    }).filter(c=>Number.isFinite(c.t)&&Number.isFinite(c.o)&&Number.isFinite(c.h)&&Number.isFinite(c.l)&&Number.isFinite(c.c));
    if(!candles.length) return Response.json({status:"error",error:"Twelve Data returned no valid candles."},{status:502});
    return Response.json({status:"ok",symbol,interval:providerInterval,candles,updated_at:new Date().toISOString()},
      {headers:{"Cache-Control":"public, max-age=30, s-maxage=60"}});
  } catch(error) {
    return Response.json({status:"error",error:"Unable to reach Twelve Data: "+String(error&&error.message||error)},
      {status:502,headers:{"Cache-Control":"no-store"}});
  }
}
