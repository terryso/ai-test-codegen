import { test } from "e2e";

// Human-maintained. Regenerate tests/e2e/saucedemo/gen-02-add-to-cart.spec.ts with npm run export-pw.
test("adds the backpack from the inventory", async ({ app, agent }) => {
  await app.open("/");
  await agent.act(
    "Type standard_user into the username field, type secret_sauce into the password field, and click Login",
  );
  await agent.act("On the inventory, add 「Sauce Labs Backpack」 to the cart");
  await agent.assert("Check: the cart control shows 「Remove」 for the backpack");
});
