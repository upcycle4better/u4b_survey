import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

test("only the root application tree is present", async () => {
  for (const path of ["../scripts/public", "../scripts/tests", "../tests/public", "../tests/tests"]) {
    assert.equal(await exists(new URL(path, import.meta.url)), false, `${path} must not exist`);
  }
  assert.equal(await exists(new URL("../api/google-submit.mjs", import.meta.url)), false);
  assert.equal(await exists(new URL("../google_apps_script", import.meta.url)), false);
});
