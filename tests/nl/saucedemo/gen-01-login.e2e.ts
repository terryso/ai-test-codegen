import { test } from "e2e";

// Human-maintained. The mirrored Playwright spec is generated from .e2e/cache.
test("standard user reaches the inventory", async ({ app, agent }) => {
  await app.open("/");
  await agent.act(
    "Type standard_user into the username field, type secret_sauce into the password field, and click Login",
  );
  await agent.assert("Check: the inventory heading shows 「Products」");
});
