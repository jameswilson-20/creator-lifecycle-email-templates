import test from "node:test";
import assert from "node:assert/strict";
import { lifecycleRequest } from "../src/lifecycle.js";

test("asset delivery requires a valid signed download URL", () => {
  const parsed = lifecycleRequest.safeParse({ kind: "asset_delivery", to: "chenhua@changba.com", name: "Reader", assetTitle: "Field Notes", downloadUrl: "https://files.example.com/notes" });
  assert.equal(parsed.success, true);
  const rejected = lifecycleRequest.safeParse({ kind: "asset_delivery", to: "chenhua@changba.com", name: "Reader", assetTitle: "Field Notes", downloadUrl: "notes" });
  assert.equal(rejected.success, false);
});

test("lifecycle mail is restricted to the authorized recipient", () => {
  const rejected = lifecycleRequest.safeParse({ kind: "subscriber_update", to: "reader@example.com", name: "Reader", assetTitle: "Field Notes", update: "New edition available" });
  assert.equal(rejected.success, false);
});
