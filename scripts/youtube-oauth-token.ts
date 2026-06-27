import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

const clientId = process.env.YOUTUBE_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim() ?? "";
const port = Number(process.env.YOUTUBE_OAUTH_PORT ?? 53682);
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const scope = "https://www.googleapis.com/auth/youtube.upload";
const state = randomBytes(18).toString("hex");

function requireConfig(): void {
  if (!clientId || !clientSecret) {
    throw new Error([
      "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET before running this helper.",
      "Example:",
      "YOUTUBE_CLIENT_ID='...' YOUTUBE_CLIENT_SECRET='...' npm run youtube:oauth",
    ].join("\n"));
  }
}

function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code: string): Promise<unknown> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  return data;
}

function openBrowser(url: string): void {
  execFile("open", [url], (error) => {
    if (error) {
      console.log(`Open this URL in your browser:\n${url}`);
    }
  });
}

async function main(): Promise<void> {
  requireConfig();
  const authUrl = buildAuthUrl();

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", redirectUri);
      if (requestUrl.pathname !== "/oauth2callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        throw new Error(`Google returned error: ${error}`);
      }

      if (!code || returnedState !== state) {
        throw new Error("OAuth callback was missing a valid code/state.");
      }

      const tokens = await exchangeCodeForTokens(code) as {
        refresh_token?: string;
        access_token?: string;
        expires_in?: number;
        scope?: string;
      };

      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("YouTube OAuth connected. You can close this tab and return to Terminal.");

      console.log("\nYouTube OAuth complete.\n");
      if (tokens.refresh_token) {
        console.log("Add this to your worker environment:");
        console.log(`YOUTUBE_REFRESH_TOKEN='${tokens.refresh_token}'`);
      } else {
        console.log("Google did not return a refresh_token.");
        console.log("Re-run this helper with the same account, or remove the app's access at https://myaccount.google.com/permissions and try again.");
      }
      console.log("\nOther worker values:");
      console.log("YOUTUBE_DEFAULT_PRIVACY_STATUS='private'");
      console.log("YOUTUBE_API_VERIFIED='false'");
      console.log(`Granted scope: ${tokens.scope ?? scope}`);
      console.log(`Access token expires in: ${tokens.expires_in ?? "unknown"} seconds`);

      server.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(message);
      console.error(message);
      server.close();
      process.exitCode = 1;
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Listening for Google OAuth callback at ${redirectUri}`);
    console.log(`Opening browser for YouTube upload consent:\n${authUrl}`);
    openBrowser(authUrl);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
