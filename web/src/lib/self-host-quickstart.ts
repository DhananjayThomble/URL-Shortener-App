/* #795 — the steps the /self-host page prints under "Quick start".

   The page used to say "self-host in one command" and show none. The real
   procedure is several steps (SELF-HOSTING.md §2-§5), so the page now shows
   them. This file is the single copy of those commands; they must stay verbatim
   what SELF-HOSTING.md says — self-host-quickstart.test.ts checks that against
   the guide itself, so the marketing page cannot drift from it. */

export const SELF_HOST_REPO_URL = "https://github.com/DhananjayThomble/URL-Shortener-App";

export const SELF_HOST_GUIDE_URL = `${SELF_HOST_REPO_URL}/blob/main/SELF-HOSTING.md`;

/** The commands, in the order SELF-HOSTING.md gives them. Comments are not commands. */
export const SELF_HOST_QUICKSTART_LINES = [
  "git clone https://github.com/DhananjayThomble/URL-Shortener-App.git",
  "cd URL-Shortener-App/deploy/single-node",
  "./init.sh",
  "docker compose pull",
  "docker compose up -d",
  "docker compose --profile migrate up migrate",
] as const;

/** The block as shown: the commands with a comment marking the one step that is an edit, not a command. */
export const SELF_HOST_QUICKSTART = [
  "# 1. Get it",
  SELF_HOST_QUICKSTART_LINES[0],
  SELF_HOST_QUICKSTART_LINES[1],
  "",
  "# 2. Configure: generates the secrets, then you set APP_DOMAIN and SHORT_DOMAIN in .env",
  SELF_HOST_QUICKSTART_LINES[2],
  "",
  "# 3. Pull, start, and apply the database schema",
  SELF_HOST_QUICKSTART_LINES[3],
  SELF_HOST_QUICKSTART_LINES[4],
  SELF_HOST_QUICKSTART_LINES[5],
].join("\n");
