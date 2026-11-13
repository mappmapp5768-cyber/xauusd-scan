const ALLOWED_MARKETS = {xau:"XAU/USD", bitcoin:"BTC/USD"};

export async function onRequestGet({request, env}) {
  const apiKey=env.TWELVE_DATA_API_KEY;
  if(!apiKey) return Response.json({status:"error",error:"TWELVE_DATA_API_KEY is not configured in Cloudflare Pages."},{status:503});
  const requestUrl=new URL(request.url);
  const market=requestUrl.searchParams.get("market")||"xau";
  const symbol=ALLOWED_MARKETS[market];
  if(!symbol) return Response.json({status:"error",error:"Unsupported market."},{status:400});
  try {
    const upstreamUrl=new URL("https://api.twelvedata.com/price");
    upstreamUrl.searchParams.set("symbol",symbol);
    upstreamUrl.searchParams.set("apikey",apiKey);
    const upstream=await fetch(upstreamUrl.toString(),{headers:{accept:"application/json"},cf:{cacheTtl:30,cacheEverything:true}});
    const payload=await upstream.json();
    const price=Number(payload&&payload.price);
    if(!upstream.ok||!Number.isFinite(price)||price<=0) {
      return Response.json({status:"error",error:(payload&&payload.message)||"Twelve Data did not return a valid price.",provider_status:upstream.status},
        {status:upstream.status===429?429:502,headers:{"Cache-Control":"no-store"}});
    }
    return Response.json({status:"ok",symbol,price,updated_at:new Date().toISOString()},
      {headers:{"Cache-Control":"public, max-age=20, s-maxage=30"}});
  } catch(error) {
    return Response.json({status:"error",error:"Unable to reach Twelve Data: "+String(error&&error.message||error)},
      {status:502,headers:{"Cache-Control":"no-store"}});
  }
}
