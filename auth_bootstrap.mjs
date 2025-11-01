import http from "http";
import crypto from "crypto";
import open from "open";
import fetch from "node-fetch";

const CLIENT_ID = process.env.X_CLIENT_ID;
const REDIRECT_URI = "http://localhost:8080/callback";
const SCOPES = "tweet.read users.read offline.access";

const b64url = b => b.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const auth = new URL("https://twitter.com/i/oauth2/authorize");
auth.searchParams.set("response_type","code");
auth.searchParams.set("client_id",CLIENT_ID!);
auth.searchParams.set("redirect_uri",REDIRECT_URI);
auth.searchParams.set("scope",SCOPES);
auth.searchParams.set("state",state);
auth.searchParams.set("code_challenge",challenge);
auth.searchParams.set("code_challenge_method","S256");

console.log("Opening browser for X login…");
await open(auth.toString());

http.createServer(async (req,res)=>{
  if(!req.url?.startsWith("/callback")) return res.end("ok");
  const qs = new URL(req.url, REDIRECT_URI).searchParams;
  if(qs.get("state") !== state){ res.end("state mismatch"); return; }
  const code = qs.get("code");

  const body = new URLSearchParams({
    grant_type:"authorization_code",
    client_id: CLIENT_ID!,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });

  const r = await fetch("https://api.twitter.com/2/oauth2/token",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const tokens = await r.json();

  res.end("Done. You can close this tab.");
  console.log("\n=== COPY THIS REFRESH TOKEN ===\n", tokens.refresh_token, "\n");
  process.exit(0);
}).listen(8080,()=>console.log("Waiting on http://localhost:8080/callback"));