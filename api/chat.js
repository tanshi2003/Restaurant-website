const rateBuckets = new Map();
const ALLOWED_ORIGINS = new Set(["https://tanshi2003.github.io","https://restaurant-website.vercel.app"]);
function send(res,status,payload){res.statusCode=status;res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify(payload));}
module.exports = async function handler(req,res){
 const origin=req.headers.origin||"";
 const local=/^http:\/\/localhost(?::\d+)?$/.test(origin);
 const vercel=/^https:\/\/[a-z0-9.-]+\.vercel\.app$/i.test(origin);
 const allowed=!origin||ALLOWED_ORIGINS.has(origin)||local||vercel;
 if(origin&&allowed){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin")}
 res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");
 if(!allowed)return send(res,403,{error:"This website is not allowed to use the restaurant chat service."});
 if(req.method==="OPTIONS"){res.statusCode=204;return res.end()}
 if(req.method!=="POST")return send(res,405,{error:"Use POST for chat messages."});
 const apiKey=process.env.GEMINI_API_KEY;if(!apiKey)return send(res,503,{error:"GEMINI_API_KEY is not configured on the server."});
 const ip=String(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").split(",")[0].trim();
 const now=Date.now(),bucket=rateBuckets.get(ip)||{start:now,count:0};if(now-bucket.start>60000){bucket.start=now;bucket.count=0}bucket.count++;rateBuckets.set(ip,bucket);
 if(bucket.count>18)return send(res,429,{error:"A few too many messages arrived at once. Please wait a minute and try again."});
 let body=req.body||{};if(typeof body==="string"){try{body=JSON.parse(body)}catch{return send(res,400,{error:"The chat request was not valid JSON."})}}
 const history=Array.isArray(body.history)?body.history.slice(-10):[];const contents=[];let previousRole=null;
 for(const m of history){if(!m||(m.role!=="user"&&m.role!=="model")||typeof m.text!=="string"||m.role===previousRole)continue;contents.push({role:m.role,parts:[{text:m.text.slice(0,900)}]});previousRole=m.role}
 if(!contents.length||contents[contents.length-1].role!=="user")return send(res,400,{error:"Send a food question to start the conversation."});
 const menu=Array.isArray(body.menuContext)?body.menuContext.slice(0,30).map(d=>({name:String(d.name||"").slice(0,100),category:String(d.category||"").slice(0,60),section:String(d.section||"").slice(0,80),subcategory:String(d.subcategory||"").slice(0,60),price:Number.isFinite(Number(d.price))?Number(d.price):null,diet:d.diet==="nonveg"?"Non-veg":"Veg",description:String(d.description||"").slice(0,180)})):[];
 const systemPrompt=[
  "You are Olive, the friendly AI food guide for Saffron & Stone, a multi-cuisine restaurant and premium cafe.",
  "Your job is limited to food, menu items, cuisine, usual flavours, common ingredients, dietary labels, menu browsing and helping the guest decide what to order.",
  "Be conversational and specific. Remember the conversation history. Ask a short follow-up when the guest preferences are unclear.",
  "The MENU CONTEXT below is the only source of truth for what this restaurant currently lists, its names, sample prices and vegetarian labels. Never invent a dish, menu price, availability or dietary label.",
  "You may use general culinary knowledge to explain what a named dish typically is and what it commonly tastes like, but say that exact restaurant preparation and ingredients may vary.",
  "Do not guess about allergens, cross-contamination, Jain suitability, halal status or exact ingredients. Say the menu does not confirm these details and advise the guest to check with restaurant staff.",
  "Suggest up to three dishes from the supplied menu context. Include the listed price and Veg or Non-veg label when useful. Never recommend an item missing from the context.",
  "If a guest asks something unrelated to food, gently bring the conversation back to the menu.",
  "Keep replies concise, warm and useful, usually 2 to 5 sentences. Do not claim to place orders or accept payments.",
  "MENU CONTEXT: "+JSON.stringify(menu)
 ].join("\n");
 try{
  const model=process.env.GEMINI_MODEL||"gemini-3.5-flash-lite";
  const googleResponse=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},body:JSON.stringify({systemInstruction:{parts:[{text:systemPrompt}]},contents,generationConfig:{temperature:0.55,maxOutputTokens:520}})});
  const result=await googleResponse.json().catch(()=>({}));
  if(!googleResponse.ok)return send(res,502,{error:(result.error?.message||"The food guide provider returned an error.").slice(0,300)});
  const reply=(result.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim();
  if(!reply)return send(res,502,{error:"The food guide returned an empty answer. Please try again."});
  return send(res,200,{reply,model});
 }catch(error){return send(res,502,{error:"The AI food guide is temporarily unavailable. Please try again."})}
}